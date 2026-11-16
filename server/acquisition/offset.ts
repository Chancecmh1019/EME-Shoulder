import { readFileSync, writeFileSync, renameSync } from 'node:fs';
import { resolve, join } from 'node:path';
import { normalizeSource, stamp } from '../../studio/lrc.ts';
import { fileHash } from './audio.ts';
import { verifyAcquisition } from './verify.ts';
/** Absolute offset relative to the preserved provider LRC; replay never compounds the shift. */
export async function setGlobalOffset(id: string, offsetMs: number) {
  if (!/^[a-f0-9]{20}$/.test(id) || !Number.isSafeInteger(offsetMs) || Math.abs(offsetMs) > 5000) throw new Error('INVALID_GLOBAL_OFFSET');
  const directory = resolve('.studio/acquisition/jobs', id), path = join(directory, 'report.json'), report = JSON.parse(readFileSync(path, 'utf8'));
  if (report.lyrics?.globalOffsetMs === offsetMs) return { id, state: report.state, unchanged: true, globalOffsetMs: offsetMs };
  if (report.verification?.policy !== 'owner-first-last-v1' || !report.verification.first?.passed || !report.verification.last?.passed || Math.abs(report.verification.first.offsetMs - report.verification.last.offsetMs) > 500) throw new Error('UNIFORM_OFFSET_EVIDENCE_REQUIRED');
  const originalPath = report.lyrics.originalPath ?? report.lyrics.path, originalSha256 = report.lyrics.originalSha256 ?? report.lyrics.sha256;
  if (await fileHash(originalPath) !== originalSha256 || await fileHash(report.audio.path) !== report.audio.sha256) throw new Error('ORIGINAL_ASSET_CHANGED');
  const source = normalizeSource(readFileSync(originalPath, 'utf8')).lines;
  if (source.some(line => line.timeMs + offsetMs < 0)) throw new Error('OFFSET_WOULD_REMOVE_OR_CLAMP_LYRICS');
  const corrected = '[00:00.000]\n' + source.map(line => `[${stamp(line.timeMs + offsetMs)}]${line.original}`).join('\n') + '\n';
  const correctedPath = join(directory, `source-offset-${offsetMs}.lrc`); writeFileSync(correctedPath, corrected, 'utf8');
  const previousSha256 = report.lyrics.sha256;
  report.lyrics = { ...report.lyrics, originalPath, originalSha256, path: correctedPath, sha256: await fileHash(correctedPath), globalOffsetMs: offsetMs, revision: (report.lyrics.revision ?? 1) + 1 };
  report.state = 'PAIR_VERIFICATION'; report.translationAllowed = false;
  report.events.push({ state: 'GLOBAL_OFFSET_APPLIED', at: new Date().toISOString(), absoluteOffsetMs: offsetMs, previousSha256, originalSha256, sourceSha256: report.lyrics.sha256, sourceRevision: report.lyrics.revision, reason: 'Owner authorized practical global correction; original provider timestamps preserved separately.' });
  writeFileSync(`${path}.tmp`, JSON.stringify(report, null, 2)); renameSync(`${path}.tmp`, path);
  const checked = await verifyAcquisition(id, 'medium');
  return { id, state: checked.state, translationAllowed: checked.translationAllowed, globalOffsetMs: offsetMs, firstResidualMs: checked.verification?.first?.offsetMs, lastResidualMs: checked.verification?.last?.offsetMs, originalPath, correctedPath };
}
