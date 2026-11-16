import { type TranslationLine, validateTranslation } from './lrc';
export interface RenderRequest {
  schema: 'eme.render.v1'; jobId: string; trackId: string; sourceRevision: number;
  sourceHash: string; promptHash: string; sourceAudioSha256: string; audioSha256: string; artworkSha256: string;
  title: string; artist: string; album: string; duration: number; lines: TranslationLine[];
  warnings: string[]; verificationScope: string; publicationRights: 'unconfirmed' | 'confirmed';
}
export async function sha256Bytes(bytes: ArrayBuffer) {
  const result = await crypto.subtle.digest('SHA-256', bytes);
  return Array.from(new Uint8Array(result), b => b.toString(16).padStart(2, '0')).join('');
}
export async function validateRenderRequest(value: RenderRequest) {
  if (value?.schema !== 'eme.render.v1' || !value.jobId || !value.trackId || !value.title || !value.artist || !Array.isArray(value.lines) || !value.lines.length || !Number.isFinite(value.duration) || value.duration < 1 || value.duration > 7200 || ![value.sourceHash, value.promptHash, value.sourceAudioSha256, value.audioSha256, value.artworkSha256].every(h => /^[a-f0-9]{64}$/.test(h)) || !['unconfirmed', 'confirmed'].includes(value.publicationRights)) throw new Error('INVALID_RENDER_REQUEST');
  const source = value.lines.map(({ id, timeMs, original }) => ({ id, timeMs, original }));
  if (await sha256Bytes(new TextEncoder().encode(JSON.stringify(source)).buffer) !== value.sourceHash) throw new Error('RENDER_SOURCE_HASH_MISMATCH');
  validateTranslation(source, value.lines);
  if (value.lines.some((line, i) => !Number.isSafeInteger(line.timeMs) || line.timeMs < 0 || line.timeMs >= value.duration * 1000 || (i > 0 && line.timeMs < value.lines[i - 1].timeMs))) throw new Error('RENDER_TIMING_OUTSIDE_AUDIO');
  return value;
}
