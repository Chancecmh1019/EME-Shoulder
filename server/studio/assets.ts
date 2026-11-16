import { createHash, randomUUID } from 'node:crypto';
import type { SqlPool } from './sql.ts';
import { transaction, type Principal } from './sessions.ts';
import { StudioError } from '../../studio/lrc.ts';
import { assetKey, type PrivateObjects } from './objectStorage.ts';
import { inspectAsset } from './media.ts';
export class Assets {
  constructor(private db: SqlPool, private objects: PrivateObjects) {}
  async put(p: Principal, job: string, kind: string, bytes: Uint8Array) {
    if (p.role !== 'owner') throw new StudioError('SCOPE_DENIED', 403);
    const { mime, inspection } = await inspectAsset(bytes, kind), hash = createHash('sha256').update(bytes).digest('hex');
    const key = assetKey(p.owner, job, kind, hash);
    const asset = await transaction(this.db, async c => {
      await c.query('SELECT pg_advisory_xact_lock(hashtextextended($1,0))', [p.owner]);
      if (!(await c.query('SELECT id FROM eme.jobs WHERE id=$1 AND owner=$2', [job, p.owner])).rows.length) throw new StudioError('NOT_FOUND', 404);
      const old = (await c.query('SELECT id,status FROM eme.assets WHERE owner=$1 AND job_id=$2 AND sha256=$3 AND kind=$4', [p.owner, job, hash, kind])).rows[0];
      if (old) return old;
      const size = Number((await c.query("SELECT coalesce(sum(bytes),0) n FROM eme.assets WHERE owner=$1", [p.owner])).rows[0].n);
      if (size + bytes.length > 100 * 1024 * 1024) throw new StudioError('STORAGE_QUOTA', 409);
      const id = randomUUID();
      await c.query("INSERT INTO eme.assets VALUES($1,$2,$3,$4,$5,$6,$7,$8,'pending',$9,$10)", [id, p.owner, job, hash, key, mime, bytes.length, kind, JSON.stringify(inspection), Date.now()]);
      return { id, status: 'pending' };
    });
    try {
      if (asset.status !== 'ready') { await this.objects.put(key, bytes, mime); const readback = await this.objects.get(key); if (createHash('sha256').update(readback).digest('hex') !== hash) throw new StudioError('ASSET_HASH_MISMATCH', 502); await this.db.query("UPDATE eme.assets SET status='ready' WHERE id=$1 AND owner=$2", [asset.id, p.owner]); }
      return { id: asset.id, sha256: hash, bytes: bytes.length, mime, inspection, status: 'ready' };
    } catch (e) { await this.db.query("UPDATE eme.assets SET status='failed' WHERE id=$1 AND owner=$2 AND status<>'ready'", [asset.id, p.owner]); throw e; }
  }
  async get(p: Principal, id: string) {
    if (p.role !== 'owner') throw new StudioError('SCOPE_DENIED', 403);
    const row = (await this.db.query("SELECT * FROM eme.assets WHERE id=$1 AND owner=$2 AND status='ready'", [id, p.owner])).rows[0];
    if (!row) throw new StudioError('NOT_FOUND', 404);
    const bytes = await this.objects.get(row.storage_key);
    if (createHash('sha256').update(bytes).digest('hex') !== row.sha256) throw new StudioError('ASSET_HASH_MISMATCH', 502);
    return { id: row.id, jobId: row.job_id, kind: row.kind, sha256: row.sha256, mime: row.mime, inspection: row.inspected, bytes };
  }
}
