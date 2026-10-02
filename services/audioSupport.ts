const FFMPEG_CORE_BASE_URL = '/ffmpeg';

let ffmpegInstance: any | null = null;
let ffmpegLoadPromise: Promise<any> | null = null;

export interface PreparedAudioFile {
  file: File;
  converted: boolean;
  originalFile: File;
}

const getExtension = (file: File): string =>
  file.name.split('.').pop()?.toLowerCase() || '';

const getSafeStem = (file: File): string => {
  const stem = file.name.replace(/\.[^/.]+$/, '') || 'audio';
  return stem.replace(/[^a-zA-Z0-9_-]+/g, '_').slice(0, 80) || 'audio';
};

/**
 * Verify that Web Audio can decode the selected file. The editor and the
 * renderer both ultimately depend on Web Audio, so HTMLAudioElement support
 * alone is not sufficient.
 */
export const canDecodeWithWebAudio = async (file: File): Promise<boolean> => {
  if (typeof window === 'undefined') return true;

  const AudioContextCtor = window.AudioContext || (window as any).webkitAudioContext;
  if (!AudioContextCtor) return false;

  const ctx: AudioContext = new AudioContextCtor();
  try {
    const data = await file.arrayBuffer();
    await ctx.decodeAudioData(data.slice(0));
    return true;
  } catch (error) {
    console.warn(`Native Web Audio decode failed for ${file.name}`, error);
    return false;
  } finally {
    try {
      await ctx.close();
    } catch {
      // Some older browsers throw while closing a context that never started.
    }
  }
};


export const canPlayWithAudioElement = (file: File): Promise<boolean> => {
  if (typeof document === 'undefined') return Promise.resolve(true);

  return new Promise((resolve) => {
    const audio = document.createElement('audio');
    const url = URL.createObjectURL(file);
    let settled = false;

    const finish = (ok: boolean) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      audio.removeAttribute('src');
      try { audio.load(); } catch {}
      URL.revokeObjectURL(url);
      resolve(ok);
    };

    const timer = window.setTimeout(() => finish(false), 6000);
    audio.preload = 'metadata';
    audio.onloadedmetadata = () => finish(Number.isFinite(audio.duration) && audio.duration > 0);
    audio.oncanplay = () => finish(true);
    audio.onerror = () => finish(false);
    audio.src = url;
    audio.load();
  });
};

const getFFmpeg = async (): Promise<any> => {
  if (ffmpegInstance) return ffmpegInstance;
  if (ffmpegLoadPromise) return ffmpegLoadPromise;

  ffmpegLoadPromise = (async () => {
    const [{ FFmpeg }] = await Promise.all([
      import('@ffmpeg/ffmpeg'),
      import('@ffmpeg/util'),
    ]);

    const ffmpeg = new FFmpeg();
    await ffmpeg.load({ coreURL: `${FFMPEG_CORE_BASE_URL}/ffmpeg-core.js`, wasmURL: `${FFMPEG_CORE_BASE_URL}/ffmpeg-core.wasm` });

    ffmpegInstance = ffmpeg;
    return ffmpeg;
  })();

  try {
    return await ffmpegLoadPromise;
  } catch (error) {
    ffmpegLoadPromise = null;
    throw error;
  }
};

const transcodeToWav = async (file: File): Promise<File> => {
  const [{ fetchFile }] = await Promise.all([import('@ffmpeg/util')]);
  const ffmpeg = await getFFmpeg();

  const ext = getExtension(file) || 'bin';
  const token = `${Date.now()}_${Math.random().toString(36).slice(2)}`;
  const inputName = `input_${token}.${ext}`;
  const outputName = `output_${token}.wav`;

  try {
    await ffmpeg.writeFile(inputName, await fetchFile(file));
    const exitCode = await ffmpeg.exec([
      '-i', inputName,
      '-map', '0:a:0',
      '-vn',
      '-ac', '2',
      '-ar', '48000',
      '-c:a', 'pcm_s16le',
      outputName,
    ]);

    if (exitCode !== 0) {
      throw new Error(`FFmpeg returned exit code ${exitCode}`);
    }

    const output = await ffmpeg.readFile(outputName);
    if (!(output instanceof Uint8Array)) {
      throw new Error('FFmpeg did not return binary audio data');
    }

    // Copy to a normal ArrayBuffer so TypeScript/Blob does not keep a reference
    // to FFmpeg's virtual filesystem memory.
    const copied = new Uint8Array(output.byteLength);
    copied.set(output);

    return new File(
      [copied],
      `${getSafeStem(file)}.browser.wav`,
      { type: 'audio/wav', lastModified: file.lastModified }
    );
  } finally {
    try { await ffmpeg.deleteFile(inputName); } catch {}
    try { await ffmpeg.deleteFile(outputName); } catch {}
    ffmpeg.terminate();
    ffmpegInstance = null;
    ffmpegLoadPromise = null;
  }
};

/**
 * Keep the original file whenever the browser can decode it. If Web Audio
 * rejects the codec/container (notably some M4A/ALAC or Opus combinations),
 * lazily load FFmpeg WASM and convert it to PCM WAV for consistent preview,
 * trimming and rendering.
 */
export const prepareAudioForBrowser = async (file: File): Promise<PreparedAudioFile> => {
  const [webAudioOk, mediaElementOk] = await Promise.all([
    canDecodeWithWebAudio(file),
    canPlayWithAudioElement(file),
  ]);

  if (webAudioOk && mediaElementOk) {
    return { file, converted: false, originalFile: file };
  }

  let converted: File;
  try {
    converted = await transcodeToWav(file);
  } catch (error) {
    throw new Error(
      `瀏覽器無法直接解碼「${file.name}」，而自動相容轉換也失敗。` +
      `\n${error instanceof Error ? error.message : String(error)}`
    );
  }

  if (!(await canDecodeWithWebAudio(converted))) {
    throw new Error('音訊已完成相容轉換，但瀏覽器仍無法解碼輸出的 WAV。');
  }

  return { file: converted, converted: true, originalFile: file };
};
