import { translationPrompts } from '../utils/translationPrompts';
import { normalizeSource, validateTranslation, bilingualLrc, type SourceLine } from './lrc';
import { sha256Bytes } from './renderContract';
import { correctStudioTranslation } from './correctTranslation';
const digest = (text: string) => sha256Bytes(new TextEncoder().encode(text).buffer);
export interface ExternalPackage {
  schema: 'eme.dot-local.v1'; jobId: string; trackId: string; sourceRevision: number;
  sourceHash: string; promptHash: string; exactLrcPrompt: string; originalLrc: string; lines: SourceLine[];
  title: string; artist: string; album: string; duration: number;
  audioSha256: string; renderAudioSha256?: string; artworkSha256?: string;
  verification: { policy: string; first: { passed: boolean }; last: { passed: boolean }; interiorWeakLines: string[] };
  publicationRights: 'unconfirmed' | 'confirmed';
}
export async function validateExternalPackage(pkg: ExternalPackage) {
  if (pkg?.schema !== 'eme.dot-local.v1' || !/^[a-f0-9]{20}$/.test(pkg.jobId) || pkg.trackId !== pkg.jobId || !Number.isSafeInteger(pkg.sourceRevision) || pkg.sourceRevision < 1 || !pkg.title || !pkg.artist || !Number.isFinite(pkg.duration) || pkg.duration < 1 || pkg.duration > 7200 || !/^[a-f0-9]{64}$/.test(pkg.audioSha256)) throw new Error('INVALID_LOCAL_PACKAGE');
  if (pkg.exactLrcPrompt !== translationPrompts.lrc || pkg.promptHash !== await digest(translationPrompts.lrc)) throw new Error('STALE_OR_MODIFIED_COMPLETE_PROMPT');
  const normalized = normalizeSource(pkg.originalLrc);
  if (JSON.stringify(normalized.lines) !== JSON.stringify(pkg.lines) || pkg.sourceHash !== await digest(JSON.stringify(pkg.lines))) throw new Error('SOURCE_PACKAGE_CHANGED');
  if (pkg.verification?.policy !== 'owner-first-last-v1' || !pkg.verification.first?.passed || !pkg.verification.last?.passed) throw new Error('PAIR_NOT_VERIFIED');
  return pkg;
}
export async function acceptExternalTranslation(pkg: ExternalPackage, value: any) {
  await validateExternalPackage(pkg);
  if (value?.sourceRevision !== pkg.sourceRevision || value.sourceHash !== pkg.sourceHash || value.promptHash !== pkg.promptHash) throw new Error('TRANSLATION_REVISION_CONFLICT');
  const result = correctStudioTranslation(pkg.lines, value.lines);
  return { schema: 'eme.dot-local-translation.v1', jobId: pkg.jobId, trackId: pkg.trackId, sourceRevision: pkg.sourceRevision, sourceHash: pkg.sourceHash, promptHash: pkg.promptHash,
    ...result, bilingualLrc: bilingualLrc(result.lines), state: 'TRANSLATION_ACCEPTED', meaningVerified: false,
    verificationScope: pkg.verification.policy, interiorWeakLines: pkg.verification.interiorWeakLines };
}
