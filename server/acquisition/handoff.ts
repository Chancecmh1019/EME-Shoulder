import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync, rmdirSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { acquireAudio, fileHash } from './audio.ts';
import { identityMatch, type Identity } from './lyrics.ts';

const hash = (value: unknown) => createHash('sha256').update(JSON.stringify(value)).digest('hex');
function location(id: string) {
  if (!/^[a-f0-9]{20}$/.test(id)) throw new Error('INVALID_LOCAL_ACQUISITION_JOB');
  return resolve('.studio/acquisition/jobs', id);
}
/** Portable task data, never a command, credential, or claim of successful execution. */
export function externalTask(id: string) {
  const directory = location(id), report = JSON.parse(readFileSync(join(directory, 'report.json'), 'utf8'));
  const task = {
    schema: 'eme.external-audio.v1', jobId: id, requested: report.requested as Identity,
    reference: report.reference, operation: 'acquire-full-audio',
    methods: ['mornye-python', 'authenticated-mornye-rest', 'owner-import'],
    requirements: { originalRecording: true, maxBytes: 1024 * 1024 * 1024, sha256: true, providerTranslation: false, protectedStreamBypass: false },
  };
  const request = { ...task, requestHash: hash(task), state: 'EXTERNAL_EXECUTION_REQUIRED' };
  writeFileSync(join(directory, 'external-task.json'), JSON.stringify(request, null, 2));
  return request;
}
export interface ExternalAudioReceipt {
  schema: 'eme.external-audio-result.v1'; jobId: string; requestHash: string;
  provider: string; executionMethod: 'mornye-python' | 'authenticated-mornye-rest' | 'owner-import';
  sourceReference: string; acquiredAt: string;
  authorization: { basis: string; reference: string; publicationRights: 'unconfirmed' | 'confirmed' };
  audio: { path: string; sha256: string };
}
/** Local worker ingress; cloud ingress must independently authenticate a scoped worker. */
export async function ingestExternalAudio(receipt: ExternalAudioReceipt) {
  const directory = location(receipt.jobId), path = join(directory, 'report.json'), lock = join(directory, '.ingest-lock');
  if (receipt.schema !== 'eme.external-audio-result.v1' || !/^[a-f0-9]{64}$/.test(receipt.audio?.sha256 ?? '') || !receipt.provider || !receipt.authorization?.basis || !receipt.authorization.reference || !['unconfirmed', 'confirmed'].includes(receipt.authorization.publicationRights) || !['mornye-python', 'authenticated-mornye-rest', 'owner-import'].includes(receipt.executionMethod) || !Number.isFinite(Date.parse(receipt.acquiredAt))) throw new Error('INVALID_EXTERNAL_RECEIPT');
  const source = new URL(receipt.sourceReference);
  if (source.protocol !== 'https:' || source.username || source.password || source.hash) throw new Error('INVALID_SOURCE_REFERENCE');
  const task = externalTask(receipt.jobId);
  if (task.requestHash !== receipt.requestHash) throw new Error('STALE_EXTERNAL_TASK');
  if (await fileHash(receipt.audio.path) !== receipt.audio.sha256) throw new Error('EXTERNAL_AUDIO_HASH_MISMATCH');
  try { mkdirSync(lock); } catch { throw new Error('INGEST_BUSY_OR_INTERRUPTED_CHECK_LOCAL_LOCK'); }
  try {
    const report = JSON.parse(readFileSync(path, 'utf8'));
    if (report.external?.receiptHash === hash(receipt)) return { jobId: receipt.jobId, state: report.state, replay: true, sha256: report.audio.sha256 };
    const target = join(directory, 'external', receipt.audio.sha256); mkdirSync(target, { recursive: true });
    const audio = await acquireAudio({ file: receipt.audio.path, permission: { basis: receipt.authorization.basis, reference: receipt.authorization.reference } }, target, () => {});
    const expected = report.requested as Identity;
    const match = identityMatch({ ...expected, album: undefined }, { title: audio.metadata.title ?? '', artist: audio.metadata.artist ?? '', duration: (audio.metadata.format.duration ?? 0) * 1000 });
    const duration = (audio.metadata.format.duration ?? 0) * 1000;
    const expectedDuration = expected.durationMs ?? report.reference?.durationMs;
    const badTags = !!audio.metadata.title && !!audio.metadata.artist && match.reasons.some((r: string) => ['TITLE_MISMATCH', 'ARTIST_MISMATCH', 'RECORDING_VERSION_MISMATCH'].includes(r));
    if (!expectedDuration || Math.abs(duration - expectedDuration) > Math.max(3000, expectedDuration * .02) || badTags) {
      report.events.push({ state: 'EXTERNAL_AUDIO_REJECTED', at: new Date().toISOString(), reason: badTags ? 'RECORDING_TAG_CONFLICT' : 'DURATION_CONFLICT', sha256: audio.sha256 });
      writeFileSync(`${path}.tmp`, JSON.stringify(report, null, 2)); renameSync(`${path}.tmp`, path);
      throw new Error(badTags ? 'EXTERNAL_RECORDING_TAG_CONFLICT' : 'EXTERNAL_DURATION_CONFLICT');
    }
    if (audio.sha256 !== receipt.audio.sha256) throw new Error('EXTERNAL_AUDIO_CHANGED_DURING_TRANSFER');
    const receiptPath = join(target, 'receipt.json'); writeFileSync(receiptPath, JSON.stringify(receipt, null, 2));
    report.audio = audio; report.audioError = undefined; report.verification = undefined; report.verificationError = undefined;
    report.translationAllowed = false; report.state = existsSync(report.lyrics?.path ?? '') ? 'PAIR_VERIFICATION' : 'LYRICS_PENDING';
    report.external = { receiptHash: hash(receipt), receiptPath, provider: receipt.provider, executionMethod: receipt.executionMethod, sourceReference: receipt.sourceReference, acquiredAt: receipt.acquiredAt, authorization: receipt.authorization };
    report.events.push({ state: report.state, at: new Date().toISOString(), reason: '外部完整音檔已保存並檢查容器／時長；內容核對尚未通過，禁止翻譯。', sha256: audio.sha256 });
    writeFileSync(`${path}.tmp`, JSON.stringify(report, null, 2)); renameSync(`${path}.tmp`, path);
    return { jobId: receipt.jobId, state: report.state, replay: false, sha256: audio.sha256, translationAllowed: false };
  } finally { rmdirSync(lock); }
}
