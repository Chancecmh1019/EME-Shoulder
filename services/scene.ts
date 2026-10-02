import type { LyricLine, RenderClock, TrackProject, VisualConfig } from '../types';
import type { AlbumBackground } from './background';
export const FONT = '"Noto Serif", "Noto Serif TC", "Noto Serif JP", "Noto Serif KR", serif';
export async function loadSceneFonts(track: TrackProject) {
  const text = [track.title, track.artist, track.album, ...track.lyrics.flatMap(l => [l.original, l.translation]), 'EMBRASEA 繁體中文歌詞'].join('');
  await Promise.all(['Noto Serif', 'Noto Serif TC', 'Noto Serif JP', 'Noto Serif KR'].map(family => document.fonts.load(`400 80px "${family}"`, text)));
  await document.fonts.ready;
}
const clamp = (x: number) => Math.max(0, Math.min(1, x));
export function hash(text: string): number { let n = 2166136261; for (const c of text) n = Math.imul(n ^ c.charCodeAt(0), 16777619); return n >>> 0; }
export const thumbnailTime = (albumId: string, t: TrackProject) => 8 + (hash(`${albumId}/${t.discNumber}/${t.trackNumber}/${t.title}/${t.thumbnailSeed}`) % 12000) / 100;
export function wrapText(ctx: CanvasRenderingContext2D, text: string, maxWidth: number): string[] {
  const result: string[] = [];
  for (const paragraph of text.split('\n')) {
    let line = '';
    // Text shaping is measured with the same Canvas context used in both paths.
    for (const token of paragraph.match(/\s+|[\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}]|[^\s\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}]+/gu) ?? ['']) {
      if (line && ctx.measureText(line + token).width > maxWidth) { result.push(line.trimEnd()); line = ''; }
      if (ctx.measureText(token).width > maxWidth) {
        for (const char of [...token]) { if (line && ctx.measureText(line + char).width > maxWidth) { result.push(line); line = ''; } line += char; }
      } else line += token;
    }
    result.push(line.trimEnd());
  }
  return result;
}
export interface MeasuredLine { line: LyricLine; original: string[]; translation: string[]; height: number; center: number }
export function measureLyrics(ctx: CanvasRenderingContext2D, lyrics: LyricLine[], scale: number): MeasuredLine[] {
  let top = 0;
  return lyrics.map(line => {
    ctx.font = `400 ${60 * scale}px ${FONT}`; const original = wrapText(ctx, line.original, 960);
    ctx.font = `400 ${44 * scale}px ${FONT}`; const translation = line.translation ? wrapText(ctx, line.translation, 960) : [];
    const height = original.length * 80 * scale + translation.length * 62 * scale + (translation.length ? 16 : 0);
    const item = { line, original, translation, height, center: top + height / 2 };
    top += height + 46; return item;
  });
}
export function activeLine(lyrics: LyricLine[], time: number): number {
  let lo = 0, hi = lyrics.length - 1, found = -1;
  while (lo <= hi) { const mid = (lo + hi) >> 1; if (lyrics[mid].startTime <= time) { found = mid; lo = mid + 1; } else hi = mid - 1; }
  return found >= 0 && time < lyrics[found].endTime ? found : -1;
}
export function sceneState(track: TrackProject, clock: RenderClock, measured: MeasuredLine[]) {
  const time = clock.currentTimeSeconds - track.lyricOffset;
  const index = activeLine(track.lyrics, time);
  let anchorIndex = index;
  if (anchorIndex < 0) { anchorIndex = 0; for (let i = 0; i < track.lyrics.length; i++) if (track.lyrics[i].startTime <= time) anchorIndex = i; }
  const current = measured[anchorIndex], previous = measured[Math.max(0, anchorIndex - 1)];
  const transition = current ? Math.min(0.72, Math.max(0.1, current.line.endTime - current.line.startTime) * 0.45) : 0.72;
  const x = current ? clamp((time - current.line.startTime) / transition) : 1;
  const ease = x * x * (3 - 2 * x);
  const anchor = (previous?.center ?? 0) + ((current?.center ?? 0) - (previous?.center ?? 0)) * ease;
  return { time: clock.currentTimeSeconds, activeIndex: index, cover: { x: 108, y: 235, size: 590 }, lyrics: measured.map((m, i) => {
    const y = 660 + m.center - anchor; const distance = Math.abs(y - 660);
    return { index: i, y, opacity: clamp(1 - distance / 440) * (i === index ? 1 : 0.40), blur: i === index ? 0 : Math.min(2.2, distance / 130), scale: i === index ? 1 : 0.96, active: i === index };
  }) };
}
export async function loadCover(blob?: Blob): Promise<HTMLImageElement> {
  let url: string;
  if (blob) url = URL.createObjectURL(blob);
  else { const c = document.createElement('canvas'); c.width = c.height = 600; const ctx = c.getContext('2d')!; ctx.fillStyle = '#344b4d'; ctx.fillRect(0, 0, 600, 600); ctx.fillStyle = '#bcae91'; ctx.font = `48px ${FONT}`; ctx.fillText('EMBRASEA', 135, 310); url = c.toDataURL(); }
  try { const img = new Image(); img.src = url; await img.decode(); return img; } finally { if (blob) URL.revokeObjectURL(url); }
}
export class BookletScene {
  private background: AlbumBackground;
  private measured: MeasuredLine[];
  private luminance = 0.35;
  private lyricCanvas = document.createElement('canvas');
  private constructor(private track: TrackProject, private visual: VisualConfig, private cover: HTMLImageElement, context: CanvasRenderingContext2D, background: AlbumBackground) {
    this.background = background;
    this.lyricCanvas.width = 1060; this.lyricCanvas.height = 560;
    this.measured = measureLyrics(context, track.lyrics, visual.fontScale);
    const c = document.createElement('canvas'); c.width = c.height = 16; const ctx = c.getContext('2d')!; ctx.drawImage(cover, 0, 0, 16, 16);
    const pixels = ctx.getImageData(0, 0, 16, 16).data; let sum = 0;
    for (let i = 0; i < pixels.length; i += 4) sum += (pixels[i] * .2126 + pixels[i + 1] * .7152 + pixels[i + 2] * .0722) / 255;
    this.luminance = sum / 256;
  }
  static async create(track: TrackProject, visual: VisualConfig, artwork: Blob | undefined, context: CanvasRenderingContext2D) {
    await loadSceneFonts(track); const cover = await loadCover(artwork); const { AlbumBackground } = await import('./background'); const scene = new BookletScene(track, visual, cover, context, new AlbumBackground());
    try { await scene.background.setArtwork(cover); return scene; } catch (e) { scene.dispose(); throw e; }
  }
  draw(ctx: CanvasRenderingContext2D, clock: RenderClock, thumbnail = false) {
    const { track, visual } = this; const state = sceneState(track, clock, this.measured);
    ctx.save(); ctx.scale(ctx.canvas.width / 1920, ctx.canvas.height / 1080);
    // Reset the full compositing surface: antialiased mesh boundaries can be
    // transparent, and must never retain pixels from a previously sought frame.
    ctx.fillStyle = '#233438'; ctx.fillRect(0, 0, 1920, 1080);
    // Crop beyond the moving mesh perimeter so its edge lobes never enter the frame.
    ctx.drawImage(this.background.draw(state.time, visual.flowSpeed), 144, 50, 672, 440, 0, 0, 1920, 1080);
    const shade = ctx.createLinearGradient(600, 0, 1920, 0); shade.addColorStop(0, 'rgba(12,20,22,0.04)'); shade.addColorStop(1, `rgba(12,20,22,${0.20 + this.luminance * .20})`); ctx.fillStyle = shade; ctx.fillRect(0, 0, 1920, 1080);
    const vignette = ctx.createRadialGradient(960, 540, 250, 960, 540, 1150); vignette.addColorStop(0, 'transparent'); vignette.addColorStop(1, `rgba(8,15,17,${visual.vignette})`); ctx.fillStyle = vignette; ctx.fillRect(0, 0, 1920, 1080);
    ctx.shadowColor = '#0005'; ctx.shadowBlur = 45; ctx.shadowOffsetY = 18;
    const cover = thumbnail ? { x: 80, y: 220, size: 640 } : state.cover;
    ctx.save(); ctx.beginPath(); ctx.roundRect(cover.x, cover.y, cover.size, cover.size, cover.size * .025); ctx.clip();
    ctx.drawImage(this.cover, cover.x, cover.y, cover.size, cover.size); ctx.restore(); ctx.shadowBlur = 0; ctx.shadowOffsetY = 0;
    ctx.fillStyle = '#f6f0e5'; ctx.textBaseline = 'top';
    const titleFont = thumbnail ? 120 : 57, titleWidth = thumbnail ? 1020 : 960, titleX = thumbnail ? 820 : 824;
    ctx.font = `400 ${titleFont}px ${FONT}`; let size = titleFont;
    while (wrapText(ctx, track.title, titleWidth).length * size * 1.22 > (thumbnail ? 430 : 145) && size > (thumbnail ? 64 : 28)) { size -= 2; ctx.font = `400 ${size}px ${FONT}`; }
    const titleLines = wrapText(ctx, track.title, titleWidth); const titleY = thumbnail ? 520 - titleLines.length * size * 1.22 / 2 : 210;
    ctx.shadowColor = '#0009'; ctx.shadowBlur = thumbnail ? 14 : 0;
    titleLines.forEach((l, i) => ctx.fillText(l, titleX, titleY + i * size * 1.22)); ctx.shadowBlur = 0;
    ctx.font = `400 ${thumbnail ? 64 : 27}px ${FONT}`; ctx.fillStyle = '#eee4d3'; ctx.fillText(track.artist, titleX, titleY - (thumbnail ? 100 : 58), titleWidth);
    ctx.font = `400 ${thumbnail ? 52 : 22}px ${FONT}`; ctx.fillStyle = '#e2dbcd'; ctx.fillText(track.album, titleX, titleY + titleLines.length * size * 1.22 + 30, titleWidth);
    if (!thumbnail) {
      const layer = this.lyricCanvas.getContext('2d')!; layer.clearRect(0, 0, 1060, 560); layer.textBaseline = 'top';
      for (const pose of state.lyrics) {
        const m = this.measured[pose.index]; if (pose.y + m.height / 2 < 380 || pose.y - m.height / 2 > 960) continue;
        const edgeBlur = Math.max(0, Math.abs(pose.y - 670) - 150) / 12;
        layer.save(); layer.translate(39, pose.y - 390); layer.scale(pose.scale, pose.scale); layer.globalAlpha = pose.opacity; layer.filter = `blur(${Math.min(14, pose.blur + edgeBlur)}px)`;
        let y = -m.height / 2; layer.font = `400 ${60 * visual.fontScale}px ${FONT}`; layer.fillStyle = '#fffaf1';
        m.original.forEach(l => { layer.fillText(l, 0, y); y += 80 * visual.fontScale; }); y += 16;
        layer.font = `400 ${44 * visual.fontScale}px ${FONT}`; layer.fillStyle = '#f0dfc2'; m.translation.forEach(l => { layer.fillText(l, 0, y); y += 62 * visual.fontScale; }); layer.restore();
      }
      layer.save(); layer.globalCompositeOperation = 'destination-in';
      const fade = layer.createLinearGradient(0, 0, 0, 560); fade.addColorStop(0, 'transparent'); fade.addColorStop(.18, '#fff'); fade.addColorStop(.82, '#fff'); fade.addColorStop(1, 'transparent');
      layer.fillStyle = fade; layer.fillRect(0, 0, 1060, 560); layer.restore(); ctx.drawImage(this.lyricCanvas, 785, 390);
    } else { ctx.font = `400 40px ${FONT}`; ctx.fillText('繁體中文歌詞', 820, 875); }
    ctx.globalAlpha = .82; ctx.fillStyle = '#f6f0e5'; ctx.font = `400 ${thumbnail ? 28 : 19}px ${FONT}`; ctx.fillText('EMBRASEA  /  MUSIC ENTERTAINMENT', 108, 970);
    ctx.textAlign = 'right'; ctx.fillText(`DISC ${track.discNumber || 1}  ·  ${String(track.trackNumber ?? track.importOrder + 1).padStart(2, '0')}`, 1812, 970); ctx.restore();
  }
  dispose() { this.background.dispose(); this.cover.src = ''; this.lyricCanvas.width = this.lyricCanvas.height = 1; }
}
export function drawSubtitles(ctx: CanvasRenderingContext2D, track: TrackProject, clock: RenderClock) {
  const current = track.lyrics[activeLine(track.lyrics, clock.currentTimeSeconds - track.lyricOffset)]; if (!current) return;
  ctx.save(); const scale = ctx.canvas.height / 1080; const width = ctx.canvas.width;
  ctx.font = `400 ${60 * scale}px ${FONT}`; const lines = wrapText(ctx, [current.original, current.translation].filter(Boolean).join('\n'), width * .84);
  const lineHeight = 80 * scale, boxHeight = lines.length * lineHeight + 30 * scale;
  ctx.fillStyle = '#0009'; ctx.fillRect(width * .06, ctx.canvas.height - boxHeight - 50 * scale, width * .88, boxHeight);
  ctx.textAlign = 'center'; ctx.textBaseline = 'top'; ctx.fillStyle = '#fffaf1';
  lines.forEach((line, i) => ctx.fillText(line, width / 2, ctx.canvas.height - boxHeight - 35 * scale + i * lineHeight)); ctx.restore();
}
