import { existsSync, realpathSync, lstatSync, rmSync } from 'node:fs';
import { resolve, relative, isAbsolute, sep } from 'node:path';
/** Only invoked after live YouTube verification. Never accepts an arbitrary deletion path. */
export function removeCompletedTemporaryFiles(workspace: string, jobId: string, requestHash: string | undefined, status: { complete: boolean; privacyStatus: string; thumbnailSet: boolean }) {
  if (!status.complete || status.privacyStatus !== 'private' || !status.thumbnailSet || !/^[a-f0-9]{20}$/.test(jobId) || (requestHash !== undefined && !/^[a-f0-9]{64}$/.test(requestHash))) throw new Error('CLEANUP_REQUIRES_VERIFIED_PRIVATE_COMPLETION');
  const root = realpathSync(resolve(workspace));
  const candidates = [...(requestHash ? [resolve(root, '.studio/mornye-external/outputs', requestHash)] : []), resolve(root, '.studio/acquisition/jobs', jobId)];
  // Validate all actual absolute targets before performing any recursive removal on Windows.
  for (const candidate of candidates) {
    if (!existsSync(candidate)) continue;
    const actual = realpathSync(candidate), rel = relative(root, actual);
    if (!rel || isAbsolute(rel) || rel === '..' || rel.startsWith(`..${sep}`) || actual.toLowerCase() !== candidate.toLowerCase() || lstatSync(candidate).isSymbolicLink()) throw new Error('CLEANUP_PATH_OUTSIDE_JOB_WORKSPACE');
  }
  const removed: string[] = [];
  for (const candidate of candidates) if (existsSync(candidate)) { rmSync(candidate, { recursive: true, force: false }); removed.push(candidate); }
  return { jobId, temporaryMaterialDirectoriesRemoved: removed.length, temporaryFilesRemoved: true };
}
