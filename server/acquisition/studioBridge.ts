import { readFileSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { createHash } from 'node:crypto';
import { StudioRepository } from '../studio/repository.ts';
import { verifyAcquisition } from './verify.ts';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { fileHash } from './audio.ts';
import { pythonCommand } from './python.ts';
import { validateRenderRequest, type RenderRequest } from '../../studio/renderContract.ts';
/** Trusted local execution boundary: recheck real bytes/evidence before enabling a Studio package.
 * This CLI adapter is never imported into serverless handlers or browser code.
 */
export async function bridgeToLocalStudio(id: string, databasePath: string, owner: string, model = 'medium') {
  if (process.env.VERCEL || process.env.NODE_ENV === 'production') throw new Error('LOCAL_WORKER_ONLY');
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(owner) || !databasePath) throw new Error('EXPLICIT_LOCAL_DATABASE_AND_OWNER_REQUIRED');
  const report = await verifyAcquisition(id, model);
  if (report.state !== 'TRANSLATION_READY' || !report.translationAllowed) throw new Error('PAIR_NOT_VERIFIED');
  const directory = resolve('.studio/acquisition/jobs', id), source = readFileSync(report.lyrics.path, 'utf8');
  const repo = new StudioRepository(resolve(databasePath));
  try {
    const job = repo.create(owner, `acquisition-${id}`, { title: `${report.requested.artist} — ${report.requested.title}`, albumContext: JSON.stringify({ requested: report.requested, reference: report.reference, provider: report.external?.provider, evidence: 'owner-first-last-v1; interior weak lines require review; rights not confirmed' }), tracks: [{ title: report.requested.title, sourceLrc: source }] });
    const track = job.tracks[0] as { id: string; revision: number };
    const canonical = repo.db.prepare('SELECT source_hash FROM sources WHERE track_id=? AND revision=?').get(track.id, track.revision) as { source_hash: string };
    const audioId = `local-${report.audio.sha256}`, evidence = JSON.stringify({ kind: 'LOCAL_INDEPENDENT_ASR', audioSha256: report.audio.sha256, sourceFileSha256: report.lyrics.sha256, verification: report.verification });
    repo.db.exec('BEGIN IMMEDIATE');
    try {
      const previous = repo.db.prepare('SELECT audio_hash FROM pair_inputs WHERE track_id=?').get(track.id) as { audio_hash: string } | undefined;
      if (previous && previous.audio_hash !== report.audio.sha256) throw new Error('STUDIO_AUDIO_REVISION_CONFLICT');
      const existing = repo.db.prepare("SELECT sequence FROM pair_reports WHERE track_id=? AND revision=? AND source_hash=? AND audio_hash=? AND status='PAIR_VERIFIED'").get(track.id, track.revision, canonical.source_hash, report.audio.sha256);
      if (!existing) {
        repo.db.prepare("INSERT INTO pair_inputs VALUES(?,?,?,?, 'TRANSLATION_READY') ON CONFLICT(track_id) DO UPDATE SET audio_id=excluded.audio_id,audio_hash=excluded.audio_hash,inspection=excluded.inspection,state=excluded.state").run(track.id, audioId, report.audio.sha256, JSON.stringify(report.verification.inspection));
        repo.db.prepare("INSERT INTO pair_reports(track_id,revision,source_hash,audio_id,audio_hash,status,evidence,report,created_at) VALUES(?,?,?,?,?,'PAIR_VERIFIED',?,?,?)").run(track.id, track.revision, canonical.source_hash, audioId, report.audio.sha256, evidence, JSON.stringify(report.verification), Date.now());
        repo.db.prepare('INSERT INTO events(owner,job_id,track_id,kind,data,created_at) VALUES(?,?,?,?,?,?)').run(owner, job.id, track.id, 'EXTERNAL_PAIR_VERIFIED', JSON.stringify({ acquisitionId: id, audioSha256: report.audio.sha256, sourceSha256: canonical.source_hash, policy: report.verification.policy, interiorWeakLines: report.verification.interiorWeakLines }), Date.now());
      }
      repo.db.exec('COMMIT');
    } catch (error) { repo.db.exec('ROLLBACK'); throw error; }
    const pkg = repo.package(owner, track.id), path = join(directory, 'dot-translation-package.json');
    writeFileSync(path, JSON.stringify(pkg, null, 2));
    const receipt = { acquisitionId: id, jobId: job.id, trackId: track.id, databasePath: resolve(databasePath), packagePath: path, packageSha256: createHash('sha256').update(readFileSync(path)).digest('hex'), promptHash: pkg.promptHash, sourceRevision: pkg.sourceRevision, sourceHash: pkg.sourceHash, lines: pkg.lines.length, state: 'TRANSLATION_READY', verificationScope: report.verification.policy, fullDotWorkflowVerified: false };
    writeFileSync(join(directory, 'studio-handoff.json'), JSON.stringify(receipt, null, 2));
    return receipt;
  } finally { repo.close(); }
}

export async function buildLocalRenderRequest(id: string, databasePath: string, owner: string) {
  const handoff = await bridgeToLocalStudio(id, databasePath, owner), repository = new StudioRepository(resolve(databasePath));
  try {
    const result = repository.result(owner, handoff.trackId), pkg = repository.package(owner, handoff.trackId);
    if (result.sourceRevision !== pkg.sourceRevision) throw new Error('RENDER_TRANSLATION_REVISION_CONFLICT');
    const directory = resolve('.studio/acquisition/jobs', id), report = JSON.parse(readFileSync(join(directory, 'report.json'), 'utf8'));
    execFileSync(pythonCommand(), [fileURLToPath(new URL('../../scripts/prepare-render-audio.py', import.meta.url)), id], { timeout: 240000, windowsHide: true });
    const audio = JSON.parse(readFileSync(join(directory, 'render-audio.json'), 'utf8'));
    if (!audio.sourceAndDerivativePcmIdentical || audio.sourceSha256 !== report.audio.sha256 || await fileHash(audio.path) !== audio.sha256 || await fileHash(audio.artwork.path) !== audio.artwork.sha256) throw new Error('RENDER_DERIVATIVE_BINDING_FAILED');
    const request: RenderRequest = { schema: 'eme.render.v1', jobId: handoff.jobId, trackId: handoff.trackId, sourceRevision: pkg.sourceRevision, sourceHash: pkg.sourceHash, promptHash: pkg.promptHash,
      sourceAudioSha256: report.audio.sha256, audioSha256: audio.sha256, artworkSha256: audio.artwork.sha256,
      title: report.requested.title, artist: report.requested.artist, album: report.requested.album ?? report.requested.title, duration: report.audio.metadata.format.duration,
      lines: result.lines, warnings: result.warnings, verificationScope: report.verification.policy, publicationRights: report.external?.authorization?.publicationRights ?? 'unconfirmed' };
    await validateRenderRequest(request);
    const path = join(directory, 'render-request.json'); writeFileSync(path, JSON.stringify(request, null, 2));
    return { jobId: handoff.jobId, trackId: handoff.trackId, path, sha256: await fileHash(path), audio: audio.path, artwork: audio.artwork.path, execution: '/studio-render on Dot computer or dedicated browser worker', rendered: false };
  } finally { repository.close(); }
}
