import { parseBlob } from 'music-metadata';
import type { LyricLine, SongMetadata } from '../types';
export const id = () => crypto.randomUUID();
export function normalizeLines(lines: LyricLine[], duration = 0, explicitEnds = false): LyricLine[] {
  const ordered = [...lines].sort((a, b) => a.startTime - b.startTime);
  return ordered.map((l, i) => ({ ...l, endTime: explicitEnds ? l.endTime : ordered[i + 1]?.startTime ?? (duration > l.startTime ? duration : l.startTime + 5) }));
}
export function parseLRC(text: string, duration = 0): LyricLine[] {
  const groups = new Map<number, string[]>();
  const offset = Number(text.match(/^\[offset:([+-]?\d+)\]/mi)?.[1] ?? 0) / 1000;
  for (const raw of text.replace(/^\uFEFF/, '').replace(/\r/g, '').split('\n')) {
    const matches = [...raw.matchAll(/\[(\d+):([0-5]\d)(?:[.,](\d{1,3}))?\]/g)];
    if (!matches.length) continue;
    let pending: number[] = [];
    for (const [index, m] of matches.entries()) {
      const time = Math.max(0, Math.round((Number(m[1]) * 60 + Number(m[2]) + Number((m[3] ?? '').padEnd(3, '0')) / 1000 + offset) * 1000) / 1000);
      pending.push(time);
      const content = raw.slice(m.index! + m[0].length, matches[index + 1]?.index ?? raw.length);
      if (content || index === matches.length - 1) { for (const start of pending) groups.set(start, [...(groups.get(start) ?? []), content]); pending = []; }
    }
  }
  return normalizeLines([...groups].map(([startTime, text]) => ({ id: id(), startTime, endTime: 0, original: text[0], translation: text.slice(1).join('\n') })), duration);
}
export function parseTime(value: string): number {
  const parts = value.trim().replace(',', '.').split(':').map(Number);
  return parts.every(Number.isFinite) ? parts.reduce((n, v) => n * 60 + v, 0) : NaN;
}
export function parseSRT(text: string): LyricLine[] {
  return text.replace(/^\uFEFF/, '').replace(/\r/g, '').split(/\n\s*\n/).flatMap(block => {
    const rows = block.split('\n'); const index = rows.findIndex(l => l.includes('-->'));
    if (index < 0) return [];
    const [a, b] = rows[index].split('-->').map(parseTime);
    if (!Number.isFinite(a) || !Number.isFinite(b) || b <= a) return [];
    return [{ id: id(), startTime: a, endTime: b, original: rows.slice(index + 1).join('\n'), translation: '' }];
  }).sort((a, b) => a.startTime - b.startTime);
}
export function formatTime(t: number, srt = false): string {
  const ms = Math.max(0, Math.round(t * 1000)), seconds = Math.floor(ms / 1000);
  const pad = (n: number, length = 2) => String(n).padStart(length, '0');
  if (srt) return `${pad(Math.floor(seconds / 3600))}:${pad(Math.floor(seconds / 60) % 60)}:${pad(seconds % 60)},${pad(ms % 1000, 3)}`;
  return `${pad(Math.floor(seconds / 60))}:${pad(seconds % 60)}.${pad(ms % 1000, 3)}`;
}
export function serializeLRC(lines: LyricLine[], offset = 0): string {
  return lines.flatMap(l => [l.original, ...l.translation.split('\n').filter(Boolean)].map(text => `[${formatTime(l.startTime + offset)}]${text}`)).join('\n');
}
export function serializeSRT(lines: LyricLine[], offset = 0): string {
  return lines.map((l, i) => `${i + 1}\n${formatTime(l.startTime + offset, true)} --> ${formatTime(l.endTime + offset, true)}\n${[l.original, l.translation].filter(Boolean).join('\n')}`).join('\n\n');
}
export function validateLyrics(lines: LyricLine[], duration = 0, offset = 0): string[] {
  const errors: string[] = [];
  lines.forEach((l, i) => {
    if (!Number.isFinite(l.startTime) || !Number.isFinite(l.endTime) || l.startTime < 0 || l.endTime <= l.startTime) errors.push(`第 ${i + 1} 行時間無效`);
    if (i && l.startTime < lines[i - 1].endTime) errors.push(`第 ${i + 1} 行時間重疊`);
    if (l.startTime + offset < 0 || (duration && l.startTime + offset >= duration)) errors.push(`第 ${i + 1} 行超出媒體時間`);
  });
  return errors;
}
export const isSupportedAudioFile = (f: File) => /\.(mp3|m4a|m4b|aac|opus|ogg|wav|flac|aiff?|alac|wma|ape|webm)$/i.test(f.name) || f.type.startsWith('audio/');
export async function extractMetadataFromAudio(file: File): Promise<{ metadata: SongMetadata; artwork?: Blob; lyrics: LyricLine[]; untimedLyrics?: string }> {
  const fallback = file.name.replace(/\.[^.]+$/, '').split(' - ');
  const metadata: SongMetadata = { title: fallback.length > 1 ? fallback.slice(1).join(' - ') : fallback[0], artist: fallback.length > 1 ? fallback[0] : 'Unknown Artist', album: '', albumArtist: '', duration: 0 };
  let parsed;
  try { parsed = await parseBlob(file, { duration: true }); } catch { return { metadata, lyrics: [] }; }
  const c = parsed.common;
  Object.assign(metadata, { title: c.title || metadata.title, artist: c.artist || metadata.artist, album: c.album || '', albumArtist: c.albumartist || '', discNumber: c.disk?.no ?? undefined, trackNumber: c.track?.no ?? undefined, duration: parsed.format.duration || 0 });
  const picture = c.picture?.[0];
  const artwork = picture ? new Blob([new Uint8Array(picture.data)], { type: picture.format }) : undefined;
  const candidates: string[] = [];
  const collect = (v: unknown) => {
    if (typeof v === 'string') candidates.push(v.replace(/\u0000/g, ''));
    else if (Array.isArray(v)) v.forEach(collect);
    else if (v && typeof v === 'object') for (const key of ['text', 'lyrics', 'value']) collect((v as Record<string, unknown>)[key]);
  };
  collect(c.lyrics);
  for (const tags of Object.values(parsed.native) as { id: string; value: unknown }[][]) for (const tag of tags) if (/lyric|uslt|©lyr/i.test(tag.id)) collect(tag.value);
  const timed = candidates.map(t => parseLRC(t, metadata.duration)).sort((a, b) => b.length - a.length)[0] ?? [];
  return { metadata, artwork, lyrics: timed, untimedLyrics: !timed.length ? candidates.find(Boolean) : undefined };
}
