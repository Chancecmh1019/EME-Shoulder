import { Input, BlobSource, ALL_FORMATS, Output, Mp4OutputFormat, BufferTarget, StreamTarget, CanvasSource, AudioSampleSource, AudioSample, AudioBufferSink, CanvasSink, canEncodeVideo, canEncodeAudio } from 'mediabunny';
import type { AlbumProject, TrackProject, VisualConfig } from '../types';
import { BookletScene, drawSubtitles, thumbnailTime, loadSceneFonts } from './scene';
import { getMedia, putMedia } from './storage';
import { checkAbort } from './cancellation';
export { checkAbort } from './cancellation';
export async function makeThumbnail(track: TrackProject, album: Pick<AlbumProject, 'id' | 'artworkKey' | 'visual'>): Promise<Blob> {
  const canvas = document.createElement('canvas'); canvas.width = 1280; canvas.height = 720;
  const ctx = canvas.getContext('2d')!; const artwork = await getMedia(track.artworkKey || album.artworkKey || '');
  const scene = await BookletScene.create(track, album.visual, artwork, ctx);
  try { scene.draw(ctx, { currentTimeSeconds: thumbnailTime(album.id, track) }, true); return await new Promise<Blob>((resolve, reject) => canvas.toBlob(b => b ? resolve(b) : reject(new Error('Thumbnail failed')), 'image/jpeg', .90)); }
  finally { scene.dispose(); canvas.width = canvas.height = 1; }
}
export async function renderTrack(track: TrackProject, album: Pick<AlbumProject, 'id' | 'artworkKey' | 'visual'>, onProgress: (p: number) => void, signal: AbortSignal): Promise<string> {
  checkAbort(signal);
  await loadSceneFonts(track); checkAbort(signal);
  const file = await getMedia(track.kind === 'mv' ? track.sourceKey : track.audioKey); if (!file) throw new Error('來源媒體不存在，請重新匯入。');
  const visual: VisualConfig = { ...album.visual, fps: 60 }; const fps = 60;
  if (!await canEncodeVideo('avc', { width: 1920, height: 1080, bitrate: 8_000_000 })) throw new Error('瀏覽器不支援 H.264 WebCodecs。請使用最新版 Chrome / Edge。');
  const input = new Input({ source: new BlobSource(file), formats: ALL_FORMATS });
  let scene: BookletScene | undefined; let output: Output | undefined; let root: FileSystemDirectoryHandle | undefined; let tempName: string | undefined;
  const canvas = document.createElement('canvas'); canvas.width = 1920; canvas.height = 1080; const ctx = canvas.getContext('2d', { alpha: false })!;
  try {
    const duration = await input.computeDuration(); if (!(duration > 0 && Number.isFinite(duration))) throw new Error('媒體時長無效。');
    const audioTrack = await input.getPrimaryAudioTrack(); const videoTrack = track.kind === 'mv' ? await input.getPrimaryVideoTrack() : null;
    if (track.kind === 'mv' && !videoTrack) throw new Error('MP4 沒有可讀取的影像軌。');
    if (audioTrack && !await canEncodeAudio('aac', { sampleRate: 48000, numberOfChannels: 2, bitrate: 192_000 })) throw new Error('瀏覽器不支援 AAC 編碼。請使用最新版 Chrome / Edge。');
    const videoSink = videoTrack ? new CanvasSink(videoTrack, { width: 1920, height: 1080, fit: 'contain', poolSize: 2 }) : undefined;
    if (!videoSink) scene = await BookletScene.create(track, visual, await getMedia(track.artworkKey || album.artworkKey || ''), ctx);
    let target: BufferTarget | StreamTarget = new BufferTarget(); let tempHandle: FileSystemFileHandle | undefined;
    if (navigator.storage?.getDirectory) {
      root = await navigator.storage.getDirectory(); tempName = `render-${track.id}-${crypto.randomUUID()}.mp4`; tempHandle = await root.getFileHandle(tempName, { create: true });
      target = new StreamTarget(await tempHandle.createWritable(), { chunked: true, chunkSize: 4 * 1024 * 1024 });
    }
    output = new Output({ format: new Mp4OutputFormat({ fastStart: 'fragmented' }), target });
    const video = new CanvasSource(canvas, { codec: 'avc', bitrate: 8_000_000 }); output.addVideoTrack(video, { frameRate: fps });
    const audio = audioTrack ? new AudioSampleSource({ codec: 'aac', bitrate: 192_000 }) : undefined; if (audio) output.addAudioTrack(audio);
    await output.start();
    const iterator = audioTrack ? new AudioBufferSink(audioTrack).buffers()[Symbol.asyncIterator]() : undefined; let nextAudio = await iterator?.next();
    const addAudio = async () => {
      if (!nextAudio || !nextAudio.value || !audio) return;
      for (const sample of AudioSample.fromAudioBuffer(nextAudio.value.buffer, nextAudio.value.timestamp)) { try { await audio.add(sample); } finally { sample.close(); } }
      nextAudio = await iterator!.next();
    };
    try {
      const total = Math.ceil(duration * fps);
      for (let i = 0; i < total; i++) {
        checkAbort(signal); const time = i / fps;
        while (nextAudio?.value && nextAudio.value.timestamp <= time + 1 / fps) { checkAbort(signal); await addAudio(); }
        if (videoSink) { const frame = await videoSink.getCanvas(time); ctx.fillStyle = '#000'; ctx.fillRect(0, 0, 1920, 1080); if (frame) ctx.drawImage(frame.canvas, 0, 0); drawSubtitles(ctx, track, { currentTimeSeconds: time, frameIndex: i }); }
        else scene!.draw(ctx, { currentTimeSeconds: time, frameIndex: i });
        await video.add(time, Math.min(1 / fps, duration - time));
        if (i % 15 === 0) { onProgress(i / total * 98); await new Promise(resolve => setTimeout(resolve, 0)); }
      }
      while (nextAudio && !nextAudio.done) { checkAbort(signal); await addAudio(); }
    } finally { await iterator?.return?.(); }
    video.close(); audio?.close(); checkAbort(signal); await output.finalize();
    const blob = tempHandle ? await tempHandle.getFile() : new Blob([(target as BufferTarget).buffer!], { type: 'video/mp4' });
    const outputKey = `${track.id}/output/${crypto.randomUUID()}`; await putMedia(outputKey, blob); onProgress(100); return outputKey;
  } catch (e) { await output?.cancel().catch(() => {}); throw e; }
  finally { input.dispose(); scene?.dispose(); canvas.width = canvas.height = 1; if (root && tempName) await root.removeEntry(tempName).catch(() => {}); }
}
