import type { LyricLine, RenderClock, TrackProject, VisualConfig } from '../types';
import type { AlbumBackground } from './background';
export const FONT = '"Noto Serif", "Noto Serif TC", "Noto Serif JP", "Noto Serif KR", serif';
export async function loadSceneFonts(track: TrackProject) {
  const text = [track.title, track.artist, track.album, ...track.lyrics.flatMap(l => [l.original, l.translation]), 'EMBRASEA 繁體中文歌詞'].join('');
  await Promise.all(['Noto Serif', 'Noto Serif TC', 'Noto Serif JP', 'Noto Serif KR'].map(family => document.fonts.load(`400 80px "${family}"`, text)));
  await document.fonts.ready;
}
const clamp = (x: number) => Math.max(0, Math.min(1, x));
export const BOOKLET_CONTENT = { top: 60, bottom: 940, left: 108, artworkSize: 590, lyricX: 824, lyricWidth: 960 } as const;
const BOOKLET_FOOTER_TOP = 970;
// Keep the lyric field optically balanced against the 1080p frame itself.
// The top edge starts 60 px below the frame, so the bottom edge ends 60 px
// above it as well. The footer sits outside the lyric text lane horizontally,
// so future lyrics may continue below the footer baseline without colliding.
export const LYRIC_VIEWPORT = { top: BOOKLET_CONTENT.top, bottom: 1080 - BOOKLET_CONTENT.top } as const;
const contentHeight = BOOKLET_CONTENT.bottom - BOOKLET_CONTENT.top;
// Canonical 1080p values; multiply by 2/3 for the 720p reference.
export const METADATA_STYLE = {
  artistFontSize: 24, songTitleFontSize: 37.5, albumFontSize: 21,
  artistLeading: 1.18, songTitleLeading: 1.12, albumLeading: 1.20,
  artworkGap: 25.5, artistTitleGap: 15, titleAlbumGap: 21,
} as const;
// Lyric tokens are authored at 720p, then converted to the shared scene space.
const LYRIC_REFERENCE_HEIGHT = 720;
const lyricPixels = (referencePixels: number) => referencePixels * 1080 / LYRIC_REFERENCE_HEIGHT;
export const LYRIC_STYLE = {
  activeOriginalFontSize: lyricPixels(40), activeTranslationFontSize: lyricPixels(31),
  contextOriginalFontSize: lyricPixels(32), contextTranslationFontSize: lyricPixels(25),
  translationOpacity: .87, internalGap: lyricPixels(20),
  nearGap: lyricPixels(42), farGap: lyricPixels(38), anchorRatio: .435,
} as const;
// Optical focus uses physical distances at the 720p reference, not item indices.
export const LYRIC_DEPTH = {
  activeBlur: 0, maxBlur: lyricPixels(2.5),
  distances: [0, 85, 160, 250, 350, 440, 520],
  blur: [0, .65, 1.1, 1.55, 1.9, 2.25, 2.5],
  opacityDistances: [0, 100, 180, 280, 380, 480],
  opacity: [1, .60, .47, .35, .25, .18],
} as const;
function interpolatePhysicalFocus(distance: number, positions: readonly number[], values: readonly number[]): number {
  if (distance <= positions[0]) return values[0];
  for (let i = 1; i < positions.length; i++) {
    if (distance > positions[i]) continue;
    const progress = clamp((distance - positions[i - 1]) / (positions[i] - positions[i - 1]));
    const eased = progress * progress * (3 - 2 * progress);
    return values[i - 1] + (values[i] - values[i - 1]) * eased;
  }
  return values[values.length - 1];
}
export function lyricOpticalFocus(physicalDistancePx: number) {
  // Scene geometry is always in 1080p space; the output canvas scales both
  // positions and blur together for preview, master, and Threads renders.
  const distance = Math.abs(physicalDistancePx) * LYRIC_REFERENCE_HEIGHT / 1080;
  return {
    blur: Math.min(LYRIC_DEPTH.maxBlur, lyricPixels(interpolatePhysicalFocus(distance, LYRIC_DEPTH.distances, LYRIC_DEPTH.blur))),
    opacity: interpolatePhysicalFocus(distance, LYRIC_DEPTH.opacityDistances, LYRIC_DEPTH.opacity),
  };
}
const LYRIC_MASK_FEATHER = lyricPixels(32);
export function lyricEdgeOpacity(y: number): number {
  const edgeDistance = Math.min(y - LYRIC_VIEWPORT.top, LYRIC_VIEWPORT.bottom - y);
  const progress = clamp(edgeDistance / LYRIC_MASK_FEATHER);
  return progress * progress * (3 - 2 * progress);
}
export function displayAlbumTitle(album: string): string {
  const title = album.trim();
  return title ? (title.startsWith('《') && title.endsWith('》') ? title : `《${title}》`) : '';
}
interface TextBlock { lines: string[]; size: number; lineHeight: number; inkTop: number; height: number }
interface MetadataBlock extends TextBlock { y: number; color: string; gapBefore: number }
function measureTextBlock(ctx: CanvasRenderingContext2D, text: string, size: number, width: number, maxLines = Infinity, closeBracket = false, leading = 1.28): TextBlock {
  ctx.font = `400 ${size}px ${FONT}`;
  const lines = text ? wrapText(ctx, text, width) : [];
  if (lines.length > maxLines) {
    lines.length = maxLines;
    let last = lines[maxLines - 1].replace(/[\s》]+$/u, '');
    const suffix = closeBracket ? '…》' : '…';
    while (last && ctx.measureText(last + suffix).width > width) last = [...last].slice(0, -1).join('');
    lines[maxLines - 1] = last + suffix;
  }
  const metrics = lines.map(line => ctx.measureText(line || '國Mg'));
  const inkTop = metrics.length ? Math.min(...metrics.map(m => -m.actualBoundingBoxAscent)) : 0;
  const inkBottom = metrics.length ? Math.max(...metrics.map(m => m.actualBoundingBoxDescent)) : 0;
  const inkHeight = inkBottom - inkTop;
  const lineHeight = Math.max(size * leading, inkHeight + size * .05);
  return { size, lines, inkTop, lineHeight, height: lines.length ? (lines.length - 1) * lineHeight + inkHeight : 0 };
}
export function measureArtworkColumn(ctx: CanvasRenderingContext2D, track: TrackProject) {
  ctx.save(); ctx.textBaseline = 'top';
  try {
    let textScale = 1;
    let blocks: MetadataBlock[] = [];
    let textHeight = 0, coverSize: number = BOOKLET_CONTENT.artworkSize;
    // Usually the artwork remains 590 px. Exceptionally long metadata first
    // borrows artwork space, then fits its typography without dropping text.
    for (;;) {
      blocks = ([
        { text: track.artist, size: METADATA_STYLE.artistFontSize, color: '#e4dccd', gapBefore: 0, maxLines: Infinity, leading: METADATA_STYLE.artistLeading },
        { text: track.title, size: METADATA_STYLE.songTitleFontSize, color: '#f6f0e5', gapBefore: METADATA_STYLE.artistTitleGap, maxLines: 2, leading: METADATA_STYLE.songTitleLeading },
        { text: displayAlbumTitle(track.album), size: METADATA_STYLE.albumFontSize, color: '#c9c2b6', gapBefore: METADATA_STYLE.titleAlbumGap, maxLines: 2, leading: METADATA_STYLE.albumLeading },
      ]).filter(b => b.text.trim()).map((b, i) => {
        return { ...measureTextBlock(ctx, b.text, b.size * textScale, coverSize * .91, b.maxLines, b.text.startsWith('《'), b.leading), color: b.color, gapBefore: i ? b.gapBefore : 0, y: 0 };
      });
      textHeight = blocks.reduce((sum, b) => sum + b.height + b.gapBefore, 0);
      if (coverSize + textHeight + (blocks.length ? METADATA_STYLE.artworkGap : 0) <= contentHeight) break;
      if (coverSize > 360) coverSize = Math.max(360, Math.min(coverSize - 1, contentHeight - textHeight - METADATA_STYLE.artworkGap));
      else textScale *= .95;
    }
    const height = coverSize + textHeight + (blocks.length ? METADATA_STYLE.artworkGap : 0);
    const top = BOOKLET_CONTENT.top + (contentHeight - height) / 2;
    let y = top + coverSize + METADATA_STYLE.artworkGap;
    for (const block of blocks) { y += block.gapBefore; block.y = y; y += block.height; }
    return { top, bottom: top + height, height, cover: { x: BOOKLET_CONTENT.left + (BOOKLET_CONTENT.artworkSize - coverSize) / 2, y: top, size: coverSize }, blocks };
  } finally { ctx.restore(); }
}
export function hash(text: string): number { let n = 2166136261; for (const c of text) n = Math.imul(n ^ c.charCodeAt(0), 16777619); return n >>> 0; }
export const thumbnailTime = (albumId: string, t: TrackProject) => 8 + (hash(`${albumId}/${t.discNumber}/${t.trackNumber}/${t.title}/${t.thumbnailSeed}`) % 12000) / 100;
export function wrapText(ctx: CanvasRenderingContext2D, text: string, maxWidth: number): string[] {
  const result: string[] = [];
  for (const paragraph of text.split('\n')) {
    const paragraphStart = result.length;
    let line = '';
    // Text shaping is measured with the same Canvas context used in both paths.
    for (const token of paragraph.match(/\s+|[\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}]|[^\s\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}]+/gu) ?? ['']) {
      if (line && ctx.measureText(line + token).width > maxWidth) { result.push(line.trimEnd()); line = ''; }
      if (ctx.measureText(token).width > maxWidth) {
        for (const char of [...token]) { if (line && ctx.measureText(line + char).width > maxWidth) { result.push(line); line = ''; } line += char; }
      } else line += token;
    }
    result.push(line.trimEnd());
    // Rebalance an isolated CJK glyph/closing mark after a measured wrap,
    // without joining explicit paragraph breaks or splitting Latin words.
    if (result.length > paragraphStart + 1) {
      const last = result[result.length - 1], previous = [...result[result.length - 2]];
      const cjk = /[\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}\p{Script=Hangul}]/u;
      if (/^[\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}\p{Script=Hangul}。！？、，；：）》」』】]$/u.test(last) && previous.length > 1 && cjk.test(previous[previous.length - 1])) {
        const balanced = previous[previous.length - 1] + last;
        if (ctx.measureText(balanced).width <= maxWidth) { result[result.length - 2] = previous.slice(0, -1).join(''); result[result.length - 1] = balanced; }
      }
    }
  }
  return result;
}
export interface MeasuredLine { line: LyricLine; original: string[]; translation: string[]; originalBlock: TextBlock; translationBlock: TextBlock; contextOriginalBlock: TextBlock; contextTranslationBlock: TextBlock; internalGap: number; height: number }
export function measureLyrics(ctx: CanvasRenderingContext2D, lyrics: LyricLine[], scale: number): MeasuredLine[] {
  ctx.save(); ctx.textBaseline = 'top';
  try {
    return lyrics.map(line => {
      const originalBlock = measureTextBlock(ctx, line.original, LYRIC_STYLE.activeOriginalFontSize * scale, BOOKLET_CONTENT.lyricWidth);
      const translationBlock = measureTextBlock(ctx, line.translation, LYRIC_STYLE.activeTranslationFontSize * scale, BOOKLET_CONTENT.lyricWidth);
      // Keep wrapping stable during focus changes; measure each category at its
      // own font size while retaining the active block's safe line breaks.
      const contextOriginalBlock = measureTextBlock(ctx, originalBlock.lines.join('\n'), LYRIC_STYLE.contextOriginalFontSize * scale, BOOKLET_CONTENT.lyricWidth);
      const contextTranslationBlock = measureTextBlock(ctx, translationBlock.lines.join('\n'), LYRIC_STYLE.contextTranslationFontSize * scale, BOOKLET_CONTENT.lyricWidth);
      const height = originalBlock.height + translationBlock.height + (translationBlock.lines.length ? LYRIC_STYLE.internalGap * scale : 0);
      return { line, original: originalBlock.lines, translation: translationBlock.lines, originalBlock, translationBlock, contextOriginalBlock, contextTranslationBlock, internalGap: LYRIC_STYLE.internalGap * scale, height };
    });
  } finally { ctx.restore(); }
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
  const current = measured[anchorIndex];
  const transition = current ? Math.min(0.72, Math.max(0.1, current.line.endTime - current.line.startTime) * 0.45) : 0.72;
  const x = current ? clamp((time - current.line.startTime) / transition) : 1;
  const ease = x * x * (3 - 2 * x);
  const previousIndex = Math.max(0, anchorIndex - 1);
  const focus = previousIndex + (anchorIndex - previousIndex) * ease;
  const interpolateDepth = (distance: number, stops: number[]) => {
    const segment = Math.min(stops.length - 2, Math.floor(distance));
    const progress = clamp(distance - segment);
    const blend = progress * progress * (3 - 2 * progress);
    return stops[segment] + (stops[segment + 1] - stops[segment]) * blend;
  };
  const scales = measured.map((_, i) => {
    const distance = Math.abs(i - focus);
    if (i >= focus && distance > 4) return Math.max(.91, .945 - (distance - 4) * .008);
    return interpolateDepth(distance, i >= focus ? [1, .99, .97, .955, .945] : [1, .99, .97, .96]);
  });
  const typography = measured.map((m, i) => {
    const distance = clamp(Math.abs(i - focus));
    const weight = 1 - distance * distance * (3 - 2 * distance);
    const blendBlock = (context: TextBlock, active: TextBlock): TextBlock => ({
      lines: active.lines,
      size: context.size + (active.size - context.size) * weight,
      lineHeight: context.lineHeight + (active.lineHeight - context.lineHeight) * weight,
      inkTop: context.inkTop + (active.inkTop - context.inkTop) * weight,
      height: context.height + (active.height - context.height) * weight,
    });
    const originalBlock = blendBlock(m.contextOriginalBlock, m.originalBlock);
    const translationBlock = blendBlock(m.contextTranslationBlock, m.translationBlock);
    const height = originalBlock.height + translationBlock.height + (m.translation.length ? m.internalGap : 0);
    return { originalBlock, translationBlock, height };
  });
  const heights = typography.map((m, i) => m.height * scales[i]);
  const mix = (a: number, b: number) => a + (b - a) * ease;
  const desiredGaps = measured.slice(1).map((_, i) => LYRIC_STYLE.nearGap - (LYRIC_STYLE.nearGap - LYRIC_STYLE.farGap) * clamp(Math.abs(i + .5 - focus) - .5));
  const centers: number[] = [];
  for (let i = 0; i < measured.length; i++) {
    const gap = i ? desiredGaps[i - 1] : 0;
    centers[i] = i ? centers[i - 1] + heights[i - 1] / 2 + gap + heights[i] / 2 : heights[i] / 2;
  }
  const scrollAnchor = mix(centers[previousIndex] ?? 0, centers[anchorIndex] ?? 0);
  const lyricRegionTop = LYRIC_VIEWPORT.top, lyricRegionBottom = LYRIC_VIEWPORT.bottom;
  // Extending visibility below the stream must not move its approved focus.
  const activeAnchor = BOOKLET_CONTENT.top + contentHeight * LYRIC_STYLE.anchorRatio;
  const activeCenterY = activeAnchor + (centers[index >= 0 ? index : anchorIndex] ?? 0) - scrollAnchor;
  const lyrics = measured.map((m, i) => {
    // Layout decides what fits; optical focus and the pixel-position edge mask
    // must not hide a short item merely because its logical index is farther.
    const distance = Math.abs(i - focus);
    const y = activeAnchor + centers[i] - scrollAnchor;
    const physicalDistancePx = Math.abs(y - activeCenterY);
    const opticalFocus = lyricOpticalFocus(physicalDistancePx);
    let blur = opticalFocus.blur;
    // The timed active item stays sharp even while its scroll focus is arriving.
    if (i === index) blur = LYRIC_DEPTH.activeBlur;
    return { ...typography[i], index: i, y, opacity: opticalFocus.opacity, blur, scale: scales[i], active: i === index, distance, physicalDistancePx };
  });
  return { time: clock.currentTimeSeconds, activeIndex: index, contentTop: BOOKLET_CONTENT.top, contentBottom: BOOKLET_CONTENT.bottom, lyricRegionTop, lyricRegionBottom, activeAnchor, lyrics };
}
export async function loadCover(blob?: Blob): Promise<HTMLImageElement> {
  let url: string;
  if (blob) url = URL.createObjectURL(blob);
  else { const c = document.createElement('canvas'); c.width = c.height = 600; const ctx = c.getContext('2d')!; ctx.fillStyle = '#344b4d'; ctx.fillRect(0, 0, 600, 600); ctx.fillStyle = '#bcae91'; ctx.font = `48px ${FONT}`; ctx.fillText('EMBRASEA', 135, 310); url = c.toDataURL(); }
  try { const img = new Image(); img.src = url; await img.decode(); return img; } finally { if (blob) URL.revokeObjectURL(url); }
}
export class BookletScene {
  private readonly lyricTop = LYRIC_VIEWPORT.top;
  private readonly lyricHeight = LYRIC_VIEWPORT.bottom - LYRIC_VIEWPORT.top;
  private background: AlbumBackground;
  private measured: MeasuredLine[];
  private artworkColumn: ReturnType<typeof measureArtworkColumn>;
  private luminance = 0.35;
  private lyricCanvas = document.createElement('canvas');
  private constructor(private track: TrackProject, private visual: VisualConfig, private cover: HTMLImageElement, context: CanvasRenderingContext2D, background: AlbumBackground) {
    this.background = background;
    this.lyricCanvas.width = 1060; this.lyricCanvas.height = this.lyricHeight;
    this.measured = measureLyrics(context, track.lyrics, visual.fontScale);
    this.artworkColumn = measureArtworkColumn(context, track);
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
    const cover = thumbnail ? { x: 80, y: 220, size: 640 } : this.artworkColumn.cover;
    ctx.save(); ctx.beginPath(); ctx.roundRect(cover.x, cover.y, cover.size, cover.size, cover.size * .025); ctx.clip();
    ctx.drawImage(this.cover, cover.x, cover.y, cover.size, cover.size); ctx.restore(); ctx.shadowBlur = 0; ctx.shadowOffsetY = 0;
    ctx.fillStyle = '#f6f0e5'; ctx.textBaseline = 'top';
    if (thumbnail) {
      const titleWidth = 1020, titleX = 820; let size = 120;
      ctx.font = `400 ${size}px ${FONT}`;
      while (wrapText(ctx, track.title, titleWidth).length * size * 1.22 > 430 && size > 64) { size -= 2; ctx.font = `400 ${size}px ${FONT}`; }
      const titleLines = wrapText(ctx, track.title, titleWidth); const titleY = 520 - titleLines.length * size * 1.22 / 2;
      ctx.shadowColor = '#0009'; ctx.shadowBlur = 14;
      titleLines.forEach((l, i) => ctx.fillText(l, titleX, titleY + i * size * 1.22)); ctx.shadowBlur = 0;
      ctx.font = `400 64px ${FONT}`; ctx.fillStyle = '#eee4d3'; ctx.fillText(track.artist, titleX, titleY - 100, titleWidth);
      ctx.font = `400 52px ${FONT}`; ctx.fillStyle = '#e2dbcd'; ctx.fillText(displayAlbumTitle(track.album), titleX, titleY + titleLines.length * size * 1.22 + 30, titleWidth);
    } else {
      ctx.textAlign = 'center';
      for (const block of this.artworkColumn.blocks) {
        ctx.font = `400 ${block.size}px ${FONT}`; ctx.fillStyle = block.color;
        block.lines.forEach((line, i) => ctx.fillText(line, this.artworkColumn.cover.x + this.artworkColumn.cover.size / 2, block.y - block.inkTop + i * block.lineHeight));
      }
      ctx.textAlign = 'left';
    }
    if (!thumbnail) {
      const layer = this.lyricCanvas.getContext('2d')!; layer.clearRect(0, 0, 1060, this.lyricHeight); layer.textBaseline = 'top';
      for (const pose of state.lyrics) {
        const m = this.measured[pose.index]; if (pose.opacity <= 0 || pose.y + pose.height * pose.scale / 2 < this.lyricTop - 24 || pose.y - pose.height * pose.scale / 2 > state.lyricRegionBottom + 24) continue;
        layer.save(); layer.translate(39, pose.y - this.lyricTop); layer.scale(pose.scale, pose.scale); layer.globalAlpha = pose.opacity; layer.filter = `blur(${pose.blur}px)`;
        let y = -pose.height / 2; layer.font = `400 ${pose.originalBlock.size}px ${FONT}`; layer.fillStyle = '#fffaf1';
        m.original.forEach((l, i) => layer.fillText(l, 0, y - pose.originalBlock.inkTop + i * pose.originalBlock.lineHeight));
        y += pose.originalBlock.height; if (m.translation.length) y += m.internalGap;
        layer.globalAlpha = pose.opacity * LYRIC_STYLE.translationOpacity;
        layer.font = `400 ${pose.translationBlock.size}px ${FONT}`; layer.fillStyle = '#f0dfc2'; m.translation.forEach((l, i) => layer.fillText(l, 0, y - pose.translationBlock.inkTop + i * pose.translationBlock.lineHeight)); layer.restore();
      }
      layer.save(); layer.globalCompositeOperation = 'destination-in';
      // Mirror the same source-space opacity envelope at both fixed edges.
      // Apply it to the composed bilingual layer, without shifting any item.
      const fade = layer.createLinearGradient(0, 0, 0, this.lyricHeight);
      const maskSteps = 8;
      for (let step = 0; step <= maskSteps; step++) {
        const inset = LYRIC_MASK_FEATHER * step / maskSteps;
        const alpha = lyricEdgeOpacity(state.lyricRegionTop + inset);
        fade.addColorStop(inset / this.lyricHeight, `rgba(255,255,255,${alpha})`);
      }
      for (let step = maskSteps; step >= 0; step--) {
        const inset = LYRIC_MASK_FEATHER * step / maskSteps;
        const alpha = lyricEdgeOpacity(state.lyricRegionBottom - inset);
        fade.addColorStop(1 - inset / this.lyricHeight, `rgba(255,255,255,${alpha})`);
      }
      layer.fillStyle = fade; layer.fillRect(0, 0, 1060, this.lyricHeight); layer.restore(); ctx.drawImage(this.lyricCanvas, BOOKLET_CONTENT.lyricX - 39, this.lyricTop);
    } else { ctx.font = `400 40px ${FONT}`; ctx.fillText('繁體中文歌詞', 820, 875); }
    ctx.globalAlpha = .82; ctx.fillStyle = '#f6f0e5'; ctx.font = `400 ${thumbnail ? 28 : 19}px ${FONT}`; ctx.fillText('EMBRASEA  /  MUSIC ENTERTAINMENT', 108, BOOKLET_FOOTER_TOP);
    ctx.textAlign = 'right'; ctx.fillText(`DISC ${track.discNumber || 1}  ·  ${String(track.trackNumber ?? track.importOrder + 1).padStart(2, '0')}`, 1812, BOOKLET_FOOTER_TOP); ctx.restore();
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
