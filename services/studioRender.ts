import { defaultVisual, type TrackProject } from '../types';
import { renderTrack, makeThumbnail } from './renderEngine';
import { getMedia, putMedia, deleteMedia } from './storage';
import { renderCapabilities } from './renderProbe';
import { sha256Bytes, validateRenderRequest, type RenderRequest } from '../studio/renderContract';
import { Input, BlobSource, ALL_FORMATS } from 'mediabunny';

/** External browser worker entry point. No cloud credentials or publishing capability. */
export async function runStudioRender(request: RenderRequest, audio: Blob, artwork: Blob, progress: (value: number) => void, signal: AbortSignal) {
  await validateRenderRequest(request);
  if (audio.size > 1024 * 1024 * 1024 || artwork.size > 10 * 1024 * 1024) throw new Error('RENDER_ASSET_TOO_LARGE');
  const [audioHash, artworkHash, capabilities] = await Promise.all([sha256Bytes(await audio.arrayBuffer()), sha256Bytes(await artwork.arrayBuffer()), renderCapabilities()]);
  if (audioHash !== request.audioSha256 || artworkHash !== request.artworkSha256) throw new Error('RENDER_ASSET_HASH_MISMATCH');
  if (!capabilities.ready) throw new Error('DEDICATED_RENDER_WORKER_REQUIRED');
  const id = `studio-${request.trackId}-${request.sourceRevision}`, audioKey = `${id}/audio`, artworkKey = `${id}/artwork`;
  const track: TrackProject = { id, title: request.title, artist: request.artist, album: request.album, albumArtist: request.artist, duration: request.duration, kind: 'lyric', importOrder: 0, sourceKey: audioKey, audioKey, artworkKey,
    lyrics: request.lines.map((line, i) => ({ id: line.id, original: line.original, translation: line.translation, startTime: line.timeMs / 1000, endTime: i + 1 < request.lines.length ? request.lines[i + 1].timeMs / 1000 : request.duration })),
    lyricOffset: 0, review: 'approved', thumbnailSeed: 0, privacy: 'private', render: 'idle', publish: 'idle', renderProgress: 0, uploadProgress: 0 };
  const album = { id: request.jobId, artworkKey, visual: defaultVisual };
  let outputKey: string | undefined;
  try {
    await putMedia(audioKey, audio); await putMedia(artworkKey, artwork);
    const thumbnail = await makeThumbnail(track, album);
    outputKey = await renderTrack(track, album, progress, signal);
    const video = await getMedia(outputKey); if (!video) throw new Error('RENDER_OUTPUT_MISSING');
    const input = new Input({ source: new BlobSource(video), formats: ALL_FORMATS });
    try {
      const duration = await input.computeDuration(), v = await input.getPrimaryVideoTrack(), a = await input.getPrimaryAudioTrack();
      if (!v || !a || v.displayWidth !== 1920 || v.displayHeight !== 1080 || Math.abs(duration - request.duration) > .15) throw new Error('RENDER_MEDIA_QA_FAILED');
      const report = { schema: 'eme.render-result.v1', jobId: request.jobId, trackId: request.trackId, sourceRevision: request.sourceRevision, sourceHash: request.sourceHash, promptHash: request.promptHash,
        sourceAudioSha256: request.sourceAudioSha256, renderAudioSha256: audioHash, videoSha256: await sha256Bytes(await video.arrayBuffer()), thumbnailSha256: await sha256Bytes(await thumbnail.arrayBuffer()),
        duration, width: v.displayWidth, height: v.displayHeight, videoCodec: v.codec, audioCodec: a.codec, videoBytes: video.size, thumbnailBytes: thumbnail.size,
        engine: 'existing renderTrack + makeThumbnail + BookletScene', verificationScope: request.verificationScope, publicationRights: request.publicationRights,
        visualAndAudioListeningReview: 'PENDING', storage: 'BROWSER_SCRATCH_EXPORT_REQUIRED', youtubeUploaded: false, capabilities };
      return { video, thumbnail, report };
    } finally { input.dispose(); }
  } finally { await deleteMedia(audioKey); await deleteMedia(artworkKey); if (outputKey) await deleteMedia(outputKey); }
}
