import { canEncodeVideo, canEncodeAudio, Input, BlobSource, ALL_FORMATS } from 'mediabunny';
import { defaultVisual, type TrackProject } from '../types';
import { putMedia, getMedia, deleteMedia } from './storage';
import { renderTrack } from './renderEngine';

export async function renderCapabilities() {
  const canvas = document.createElement('canvas'), gl = canvas.getContext('webgl2') ?? canvas.getContext('webgl');
  const webgl = !!gl;
  gl?.getExtension('WEBGL_lose_context')?.loseContext();
  const [h264, aac] = await Promise.all([
    canEncodeVideo('avc', { width: 1920, height: 1080, bitrate: 8_000_000 }).catch(() => false),
    canEncodeAudio('aac', { sampleRate: 48000, numberOfChannels: 2, bitrate: 192_000 }).catch(() => false),
  ]);
  let storage = false;
  const key = `probe/${crypto.randomUUID()}`;
  try { await putMedia(key, new Blob(['synthetic storage probe'])); storage = (await getMedia(key))?.size === 23; }
  finally { await deleteMedia(key).catch(() => {}); }
  return { runtime: navigator.userAgent, secureContext: isSecureContext, webgl, h264, aac, storage, cloudIdentity: 'UNVERIFIED_THIS_IS_THE_CURRENT_BROWSER', ready: isSecureContext && webgl && h264 && aac && storage };
}
function sineWave(seconds: number): Blob {
  const rate = 48000, length = rate * seconds, bytes = new ArrayBuffer(44 + length * 2), view = new DataView(bytes);
  const str = (offset: number, value: string) => [...value].forEach((c, i) => view.setUint8(offset + i, c.charCodeAt(0)));
  str(0, 'RIFF'); view.setUint32(4, 36 + length * 2, true); str(8, 'WAVE'); str(12, 'fmt '); view.setUint32(16, 16, true); view.setUint16(20, 1, true); view.setUint16(22, 1, true); view.setUint32(24, rate, true); view.setUint32(28, rate * 2, true); view.setUint16(32, 2, true); view.setUint16(34, 16, true); str(36, 'data'); view.setUint32(40, length * 2, true);
  for (let i = 0; i < length; i++) view.setInt16(44 + i * 2, Math.round(Math.sin(i * Math.PI * 2 * 440 / rate) * 5000), true);
  return new Blob([bytes], { type: 'audio/wav' });
}
/** Same BookletScene and existing encoder, synthetic owner-created fixture only. */
export async function runSyntheticRender(seconds: 30 | 180, progress: (p: number) => void, signal: AbortSignal) {
  const capabilities = await renderCapabilities();
  if (!capabilities.ready) throw new Error(`RENDER_CAPABILITY_UNAVAILABLE: ${JSON.stringify(capabilities)}`);
  const id = `probe-${crypto.randomUUID()}`, sourceKey = `${id}/audio`;
  const track: TrackProject = { id, title: '海的來信・合成測試', artist: 'EMBRASEA', album: 'Studio 2.0 / Render Probe', albumArtist: 'EMBRASEA', duration: seconds, kind: 'lyric', importOrder: 0, sourceKey, audioKey: sourceKey, lyrics: Array.from({ length: seconds / 5 }, (_, i) => ({ id: `probe-line-${i}`, startTime: i * 5, endTime: (i + 1) * 5, original: `Synthetic line ${i + 1}`, translation: `合成測試歌詞 第 ${i + 1} 行` })), lyricOffset: 0, review: 'approved', thumbnailSeed: 0, privacy: 'private', render: 'idle', publish: 'idle', renderProgress: 0, uploadProgress: 0 };
  let outputKey: string | undefined;
  const started = performance.now();
  try {
    await putMedia(sourceKey, sineWave(seconds));
    outputKey = await renderTrack(track, { id, visual: defaultVisual }, progress, signal);
    const blob = await getMedia(outputKey); if (!blob) throw new Error('PROBE_OUTPUT_MISSING');
    const input = new Input({ source: new BlobSource(blob), formats: ALL_FORMATS });
    try {
      const duration = await input.computeDuration(), video = await input.getPrimaryVideoTrack(), audio = await input.getPrimaryAudioTrack();
      const stats = await video?.computePacketStats();
      const report = { capabilities, secondsRequested: seconds, duration, hasVideo: !!video, hasAudio: !!audio, width: video?.displayWidth, height: video?.displayHeight, videoCodec: video?.codec, audioCodec: audio?.codec, averageFrameRate: stats?.averagePacketRate, bytes: blob.size, elapsedSeconds: (performance.now() - started) / 1000, engine: 'existing renderTrack / BookletScene', durationPass: Math.abs(duration - seconds) <= .15, visualInspection: 'PENDING', audioIdentity: 'SYNTHETIC_440HZ_NOT_SONG_MATCHING', persistence: 'BROWSER_SCRATCH_ONLY_NOT_CLOUD' };
      return { blob, report };
    } finally { input.dispose(); }
  } finally { await deleteMedia(sourceKey); if (outputKey) await deleteMedia(outputKey); }
}
