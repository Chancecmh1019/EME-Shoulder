import { createHash } from 'node:crypto';
import { StudioError, stamp, normalizeSource, type SourceLine } from '../../studio/lrc.ts';
import { verifyPair, type PairEvidence } from '../../studio/pairVerification.ts';
import { transaction, type Principal } from './sessions.ts';
import type { SqlPool, SqlConnection } from './sql.ts';

const hash = (text: string) => createHash('sha256').update(text).digest('hex');
export class PairWorkflow {
  constructor(private db: SqlPool) {}
  private owner(p: Principal) { if (p.role !== 'owner') throw new StudioError('SCOPE_DENIED', 403); }
  private async source(c: Pick<SqlConnection, 'query'>, p: Principal, id: string) {
    const row = (await c.query('SELECT t.*,s.source_hash,s.raw,s.lines,s.removed FROM eme.tracks t JOIN eme.sources s ON t.id=s.track_id AND t.revision=s.revision WHERE t.id=$1 AND t.owner=$2', [id, p.owner])).rows[0];
    if (!row) throw new StudioError('NOT_FOUND', 404);
    if (row.state === 'CANCELLED') throw new StudioError('TRACK_CANCELLED', 409);
    return row;
  }
  async status(p: Principal, id: string) {
    this.owner(p);
    const source = await this.source(this.db, p, id), input = (await this.db.query('SELECT audio_id,audio_hash,state FROM eme.pair_inputs WHERE track_id=$1', [id])).rows[0];
    const latest = (await this.db.query('SELECT sequence,status,report,created_at FROM eme.pair_reports WHERE track_id=$1 AND revision=$2 ORDER BY sequence DESC LIMIT 1', [id, source.revision])).rows[0];
    return { trackId: id, jobId: source.job_id, sourceRevision: Number(source.revision), lines: JSON.parse(source.lines), sourceHash: source.source_hash, state: input?.state ?? 'AUDIO_PENDING', audioId: input?.audio_id, audioHash: input?.audio_hash, latest: latest ? { ...latest, report: JSON.parse(latest.report) } : null };
  }
  async selectAudio(p: Principal, id: string, assetId: string) {
    this.owner(p);
    if (typeof assetId !== 'string' || assetId.length > 100) throw new StudioError('INVALID_ASSET');
    return transaction(this.db, async c => {
      await c.query('SELECT pg_advisory_xact_lock(hashtextextended($1,0))', [p.owner]);
      const source = await this.source(c, p, id);
      const asset = (await c.query("SELECT * FROM eme.assets WHERE id=$1 AND owner=$2 AND job_id=$3 AND kind='audio' AND status='ready'", [assetId, p.owner, source.job_id])).rows[0];
      if (!asset) throw new StudioError('AUDIO_NOT_AVAILABLE', 409);
      const old = (await c.query('SELECT * FROM eme.pair_inputs WHERE track_id=$1', [id])).rows[0];
      if (old?.audio_id === assetId && old.audio_hash === asset.sha256) return { state: old.state, unchanged: true };
      if (old) {
        const revision = Number(source.revision) + 1;
        await c.query('INSERT INTO eme.sources VALUES($1,$2,$3,$4,$5,$6)', [id, revision, source.source_hash, source.raw, source.lines, source.removed]);
        await c.query("UPDATE eme.tracks SET revision=$1,state='TRANSLATE' WHERE id=$2 AND owner=$3", [revision, id, p.owner]);
      }
      await c.query("INSERT INTO eme.pair_inputs VALUES($1,$2,$3,$4,'PAIR_VERIFICATION') ON CONFLICT(track_id) DO UPDATE SET audio_id=excluded.audio_id,audio_hash=excluded.audio_hash,inspection=excluded.inspection,state=excluded.state", [id, assetId, asset.sha256, JSON.stringify(asset.inspected)]);
      await c.query('DELETE FROM eme.leases WHERE track_id=$1', [id]);
      await c.query('INSERT INTO eme.events(owner,job_id,track_id,kind,data,created_at) VALUES($1,$2,$3,$4,$5,$6)', [p.owner, source.job_id, id, 'AUDIO_ACQUIRED', JSON.stringify({ audioId: assetId, audioHash: asset.sha256, previousVerificationInvalidated: !!old }), Date.now()]);
      return { state: 'PAIR_VERIFICATION', audioId: assetId };
    });
  }
  async verify(p: Principal, id: string, expected: number, audioId: string, evidence: PairEvidence) {
    this.owner(p);
    return transaction(this.db, async c => {
      await c.query('SELECT pg_advisory_xact_lock(hashtextextended($1,0))', [p.owner]);
      const source = await this.source(c, p, id), audio = (await c.query('SELECT * FROM eme.pair_inputs WHERE track_id=$1', [id])).rows[0];
      if (Number(source.revision) !== expected || !audio || audio.audio_id !== audioId) throw new StudioError('PAIR_REVISION_CONFLICT', 409);
      const encoded = JSON.stringify(evidence), old = (await c.query('SELECT status,report FROM eme.pair_reports WHERE track_id=$1 AND revision=$2 AND audio_hash=$3 AND evidence=$4 ORDER BY sequence DESC LIMIT 1', [id, expected, audio.audio_hash, encoded])).rows[0];
      if (old) return JSON.parse(old.report);
      const attempts = Number((await c.query('SELECT count(*) n FROM eme.pair_reports WHERE track_id=$1 AND revision=$2 AND audio_hash=$3', [id, expected, audio.audio_hash])).rows[0].n);
      if (attempts >= 3) throw new StudioError('PAIR_RECOVERY_LIMIT', 409, '此素材組合已達三次檢查上限；請取得新證據或更換錯誤素材。');
      const report = verifyPair(JSON.parse(source.lines), JSON.parse(audio.inspection), evidence);
      const states = { INCORRECT_AUDIO: 'AUDIO_REJECTED', INCORRECT_LYRICS: 'LYRICS_REJECTED', BOTH_INCORRECT: 'BLOCKED', GLOBAL_OFFSET: 'TIMING_REPAIR', SECTION_DRIFT: 'TIMING_REPAIR', INSUFFICIENT_EVIDENCE: 'BLOCKED', PAIR_VERIFIED: 'TRANSLATION_READY' };
      await c.query('INSERT INTO eme.pair_reports(track_id,revision,source_hash,audio_id,audio_hash,status,evidence,report,created_at) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9)', [id, expected, source.source_hash, audioId, audio.audio_hash, report.diagnosis, encoded, JSON.stringify(report), Date.now()]);
      await c.query('UPDATE eme.pair_inputs SET state=$1 WHERE track_id=$2', [states[report.diagnosis], id]);
      await c.query('INSERT INTO eme.events(owner,job_id,track_id,kind,data,created_at) VALUES($1,$2,$3,$4,$5,$6)', [p.owner, source.job_id, id, report.diagnosis, JSON.stringify({ audioId, audioHash: audio.audio_hash, sourceRevision: expected, sourceHash: source.source_hash, reason: report.reason }), Date.now()]);
      return report;
    });
  }
  async repair(p: Principal, id: string, expected: number, mode: 'global' | 'lines') {
    this.owner(p);
    if (!['global', 'lines'].includes(mode)) throw new StudioError('INVALID_REPAIR');
    return transaction(this.db, async c => {
      await c.query('SELECT pg_advisory_xact_lock(hashtextextended($1,0))', [p.owner]);
      const source = await this.source(c, p, id), selected = (await c.query('SELECT * FROM eme.pair_inputs WHERE track_id=$1', [id])).rows[0];
      const previous = (await c.query('SELECT report,evidence,audio_hash FROM eme.pair_reports WHERE track_id=$1 AND revision=$2 ORDER BY sequence DESC LIMIT 1', [id, expected])).rows[0];
      if (Number(source.revision) !== expected || !previous || selected?.state !== 'TIMING_REPAIR' || previous.audio_hash !== selected.audio_hash) throw new StudioError('PAIR_REVISION_CONFLICT', 409);
      const report = JSON.parse(previous.report), lines = JSON.parse(source.lines) as SourceLine[];
      if ((mode === 'global' && report.diagnosis !== 'GLOBAL_OFFSET') || (mode === 'lines' && report.diagnosis !== 'SECTION_DRIFT')) throw new StudioError('REPAIR_EVIDENCE_MISMATCH');
      if (mode === 'lines' && (!Array.isArray(report.measurements) || report.measurements.length !== lines.length || report.measurements.some((m: any, i: number) => m.lineId !== lines[i].id))) throw new StudioError('FULL_LINE_EVIDENCE_REQUIRED', 409, '首句／末句證據不足以重建所有中間行，請先取得逐行時間。');
      const repaired = lines.map((l, i) => ({ ...l, timeMs: mode === 'global' ? l.timeMs + report.offsetMs : report.measurements[i].startMs }));
      const raw = repaired.map(l => `[${stamp(l.timeMs)}]${l.original}`).join('\n'), normalized = normalizeSource(raw), revision = expected + 1;
      await c.query('INSERT INTO eme.sources VALUES($1,$2,$3,$4,$5,$6)', [id, revision, hash(JSON.stringify(normalized.lines)), raw, JSON.stringify(normalized.lines), '[]']);
      await c.query("UPDATE eme.tracks SET revision=$1,state='TRANSLATE' WHERE id=$2 AND owner=$3", [revision, id, p.owner]);
      await c.query("UPDATE eme.pair_inputs SET state='PAIR_VERIFICATION' WHERE track_id=$1", [id]);
      await c.query('DELETE FROM eme.leases WHERE track_id=$1', [id]);
      await c.query('INSERT INTO eme.events(owner,job_id,track_id,kind,data,created_at) VALUES($1,$2,$3,$4,$5,$6)', [p.owner, source.job_id, id, 'TIMING_REPAIRED', JSON.stringify({ fromRevision: expected, toRevision: revision, mode, conversion: lines.map((l, i) => ({ id: l.id, fromMs: l.timeMs, toMs: repaired[i].timeMs })) }), Date.now()]);
      return { sourceRevision: revision, state: 'PAIR_VERIFICATION', reverifyRequired: true };
    });
  }
}
