import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { resolve, join } from 'node:path';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { translationPrompts } from '../../utils/translationPrompts.ts';
import { normalizeSource } from '../../studio/lrc.ts';
import { sha256Bytes, validateRenderRequest, type RenderRequest } from '../../studio/renderContract.ts';
import { acceptExternalTranslation, validateExternalPackage, type ExternalPackage } from '../../studio/externalPackage.ts';
import { verifyAcquisition } from './verify.ts';
import { fileHash } from './audio.ts';
import { pythonCommand } from './python.ts';
import { parseDotTranslation } from '../../studio/translationInput.ts';
const digest = (text: string) => sha256Bytes(new TextEncoder().encode(text).buffer);

/** Default workflow: temporary files on Dot/worker, no PostgreSQL/S3 prerequisite. */
export async function createFilePackage(id: string) {
  const report = await verifyAcquisition(id, 'medium');
  if (!report.translationAllowed) throw new Error('PAIR_NOT_VERIFIED');
  const directory = resolve('.studio/acquisition/jobs', id), originalLrc = readFileSync(report.lyrics.path, 'utf8'), lines = normalizeSource(originalLrc).lines;
  const preparedPath = join(directory, 'render-audio.json'), prepared = existsSync(preparedPath) ? JSON.parse(readFileSync(preparedPath, 'utf8')) : undefined;
  if (prepared && (prepared.sourceSha256 !== report.audio.sha256 || !prepared.sourceAndDerivativePcmIdentical || await fileHash(prepared.path) !== prepared.sha256)) throw new Error('RENDER_AUDIO_BINDING_FAILED');
  const pkg: ExternalPackage = { schema: 'eme.dot-local.v1', jobId: id, trackId: id, sourceRevision: report.lyrics.revision ?? 1, sourceHash: await digest(JSON.stringify(lines)), promptHash: await digest(translationPrompts.lrc), exactLrcPrompt: translationPrompts.lrc,
    originalLrc, lines, title: report.requested.title, artist: report.requested.artist, album: report.requested.album ?? report.requested.title, duration: report.audio.metadata.format.duration,
    audioSha256: report.audio.sha256, renderAudioSha256: prepared?.sha256, artworkSha256: prepared?.artwork?.sha256,
    verification: { policy: report.verification.policy, first: report.verification.first, last: report.verification.last, interiorWeakLines: report.verification.interiorWeakLines }, publicationRights: report.external?.authorization?.publicationRights ?? 'unconfirmed' };
  await validateExternalPackage(pkg);
  const path = join(directory, 'dot-local-package.json'); writeFileSync(path, JSON.stringify(pkg, null, 2));
  return { pkg, path };
}

export async function submitFileTranslation(id: string, inputPath: string) {
  const { pkg } = await createFilePackage(id), raw = readFileSync(resolve(inputPath), 'utf8');
  let input: any;
  if (/^\s*\{/.test(raw)) input = JSON.parse(raw);
  else { const translations = parseDotTranslation(raw, pkg.lines); input = { sourceRevision: pkg.sourceRevision, sourceHash: pkg.sourceHash, promptHash: pkg.promptHash, lines: pkg.lines.map(line => ({ ...line, translation: translations[line.id] })) }; }
  const result = await acceptExternalTranslation(pkg, input);
  const directory = resolve('.studio/acquisition/jobs', id), key = await digest(JSON.stringify(input)), path = join(directory, `translation-${key}.json`);
  const current = join(directory, 'translation-accepted.json');
  const replay = existsSync(current) && JSON.parse(readFileSync(current, 'utf8')).inputHash === key;
  if (existsSync(current)) {
    const old = JSON.parse(readFileSync(current, 'utf8'));
    const oldResult = JSON.parse(readFileSync(old.path, 'utf8'));
    if (old.inputHash !== key && oldResult.sourceHash === pkg.sourceHash) throw new Error('TRANSLATION_ALREADY_ACCEPTED_CREATE_EXPLICIT_NEW_REVISION');
  }
  if (!existsSync(path)) writeFileSync(path, JSON.stringify(result, null, 2));
  writeFileSync(current, JSON.stringify({ inputHash: key, path, sha256: await fileHash(path) }, null, 2));
  return { jobId: id, state: result.state, lines: result.lines.length, warnings: result.warnings, path, sha256: await fileHash(path), replay };
}

export async function createFileRenderRequest(id: string) {
  const { pkg } = await createFilePackage(id), directory = resolve('.studio/acquisition/jobs', id), accepted = JSON.parse(readFileSync(join(directory, 'translation-accepted.json'), 'utf8'));
  if (await fileHash(accepted.path) !== accepted.sha256) throw new Error('TRANSLATION_FILE_CHANGED');
  const translation = JSON.parse(readFileSync(accepted.path, 'utf8'));
  await acceptExternalTranslation(pkg, translation);
  execFileSync(pythonCommand(), [fileURLToPath(new URL('../../scripts/prepare-render-audio.py', import.meta.url)), id], { timeout: 240000, windowsHide: true });
  const audio = JSON.parse(readFileSync(join(directory, 'render-audio.json'), 'utf8'));
  if (audio.sourceSha256 !== pkg.audioSha256 || !audio.sourceAndDerivativePcmIdentical || await fileHash(audio.path) !== audio.sha256 || await fileHash(audio.artwork.path) !== audio.artwork.sha256) throw new Error('RENDER_ASSETS_CHANGED');
  const request: RenderRequest = { schema: 'eme.render.v1', jobId: id, trackId: id, sourceRevision: pkg.sourceRevision, sourceHash: pkg.sourceHash, promptHash: pkg.promptHash,
    sourceAudioSha256: pkg.audioSha256, audioSha256: audio.sha256, artworkSha256: audio.artwork.sha256, title: pkg.title, artist: pkg.artist, album: pkg.album, duration: pkg.duration,
    lines: translation.lines, warnings: translation.warnings, verificationScope: pkg.verification.policy, publicationRights: pkg.publicationRights };
  await validateRenderRequest(request);
  const path = join(directory, 'render-request.json'); writeFileSync(path, JSON.stringify(request, null, 2));
  return { jobId: id, path, audio: audio.path, artwork: audio.artwork.path, rendered: false };
}
