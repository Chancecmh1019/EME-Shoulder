import { parseBuffer } from 'music-metadata';
import { StudioError, normalizeSource } from '../../studio/lrc.ts';
/** Decode PCM WAV, including every declared sample. Energy is integrity evidence, not lyric identity. */
export function inspectPcmWav(bytes: Uint8Array) {
  const b = Buffer.from(bytes), header = b.toString('ascii', 0, 4);
  if (header !== 'RIFF' || b.toString('ascii', 8, 12) !== 'WAVE' || b.readUInt32LE(4) + 8 !== b.length) throw new StudioError('AUDIO_CORRUPT');
  let rate = 0, channels = 0, bits = 0, format = 0, data: Buffer | undefined;
  for (let offset = 12; offset + 8 <= b.length;) {
    const size = b.readUInt32LE(offset + 4), end = offset + 8 + size;
    if (end > b.length) throw new StudioError('AUDIO_TRUNCATED');
    const type = b.toString('ascii', offset, offset + 4);
    if (type === 'fmt ' && size >= 16) { format = b.readUInt16LE(offset + 8); channels = b.readUInt16LE(offset + 10); rate = b.readUInt32LE(offset + 12); bits = b.readUInt16LE(offset + 22); }
    if (type === 'data') data = b.subarray(offset + 8, end);
    offset = end + size % 2;
  }
  if (format !== 1 || bits !== 16 || !data || ![1, 2].includes(channels) || rate < 8000 || rate > 192000 || data.length % (channels * 2)) throw new StudioError('PCM_FORMAT_UNSUPPORTED');
  let sum = 0, peak = 0, clipped = 0, audible = 0, first = -1, last = -1;
  const frames = data.length / (channels * 2);
  for (let f = 0; f < frames; f++) {
    let power = 0;
    for (let c = 0; c < channels; c++) { const v = data.readInt16LE((f * channels + c) * 2) / 32768; sum += v * v; power += v * v; peak = Math.max(peak, Math.abs(v)); if (Math.abs(v) >= .999) clipped++; }
    if (Math.sqrt(power / channels) > .01) { audible++; if (first < 0) first = f; last = f; }
  }
  const durationMs = frames / rate * 1000;
  return { decoded: true, durationMs, channels, sampleRate: rate, rms: Math.sqrt(sum / (frames * channels)), peak, clippedFraction: clipped / (frames * channels), audibleFraction: audible / frames, leadingSilenceMs: (first < 0 ? frames : first) / rate * 1000, trailingSilenceMs: (last < 0 ? frames : frames - last - 1) / rate * 1000, lyricIdentityVerified: false };
}
export async function inspectAsset(bytes: Uint8Array, kind: string) {
  if (!bytes.length || bytes.length > 3 * 1024 * 1024) throw new StudioError('ASSET_TOO_LARGE', 413);
  const b = Buffer.from(bytes);
  if (kind === 'source_lrc') { const text = new TextDecoder('utf-8', { fatal: true }).decode(bytes); normalizeSource(text); return { mime: 'text/plain; charset=utf-8', inspection: { format: 'line-lrc', verifiedOriginalIdentity: false } }; }
  if (kind === 'audio') {
    const metadata = await parseBuffer(bytes, undefined, { duration: true }).catch(() => { throw new StudioError('AUDIO_CORRUPT'); });
    if (!Number.isFinite(metadata.format.duration) || metadata.format.duration < 1) throw new StudioError('AUDIO_TOO_SHORT');
    const wav = b.toString('ascii', 0, 4) === 'RIFF';
    const inspection = wav ? inspectPcmWav(bytes) : { decoded: false, durationMs: metadata.format.duration * 1000, channels: metadata.format.numberOfChannels, sampleRate: metadata.format.sampleRate, codec: metadata.format.codec, lyricIdentityVerified: false, diagnostic: 'FULL_DECODE_REQUIRED_ON_MEDIA_WORKER' };
    return { mime: wav ? 'audio/wav' : 'application/octet-stream', inspection };
  }
  if (kind === 'artwork') {
    const png = b.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10])), jpeg = b[0] === 255 && b[1] === 216 && b.at(-2) === 255 && b.at(-1) === 217;
    if (!png && !jpeg) throw new StudioError('ARTWORK_FORMAT_UNSUPPORTED');
    return { mime: png ? 'image/png' : 'image/jpeg', inspection: { magicVerified: true, decoded: false } };
  }
  throw new StudioError('ASSET_KIND_UNSUPPORTED');
}
