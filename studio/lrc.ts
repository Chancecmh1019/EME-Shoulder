import * as OpenCC from 'opencc-js';
/** Line-level source domain. Provider translations must be removed by the adapter. */
export interface SourceLine { id: string; timeMs: number; original: string }
export interface Removal { row: number; text: string; reason: 'prefatory-credit' | 'metadata' | 'sentinel' }
export class StudioError extends Error {
  constructor(public code: string, public status = 422, message = code) { super(message); }
}
export function stamp(ms: number): string {
  if (!Number.isSafeInteger(ms) || ms < 0) throw new StudioError('INVALID_TIMESTAMP');
  return `${String(Math.floor(ms / 60000)).padStart(2, '0')}:${String(Math.floor(ms / 1000) % 60).padStart(2, '0')}.${String(ms % 1000).padStart(3, '0')}`;
}
export function normalizeSource(text: string): { lines: SourceLine[]; removed: Removal[] } {
  if (typeof text !== 'string' || text.length > 100000) throw new StudioError('INVALID_SOURCE');
  const records: { timeMs: number; original: string }[] = [], removed: Removal[] = [];
  let preface = true;
  for (const [i, row] of text.replace(/^\uFEFF/, '').replace(/\r\n?/g, '\n').split('\n').entries()) {
    if (!row.trim()) continue;
    if (/^\s*\[(ar|ti|al|by|re|ve|length):[^\]]*\]\s*$/i.test(row)) { removed.push({ row: i + 1, text: row, reason: 'metadata' }); continue; }
    // Offset needs an explicit audited transform, never an implicit import rewrite.
    if (/\[offset:/i.test(row)) throw new StudioError('OFFSET_REQUIRES_REVIEW');
    const m = row.match(/^((?:\[\d{2,}:[0-5]\d(?:[.,]\d{1,3})?\])+)(.*)$/u);
    if (!m || /\[\d+:|<\d+:/.test(m[2])) throw new StudioError('INVALID_SOURCE_ROW', 422, `第 ${i + 1} 行格式無效`);
    const original = m[2];
    const times = [...m[1].matchAll(/\[(\d+):([0-5]\d)(?:[.,](\d{1,3}))?\]/g)].map(t => Number(t[1]) * 60000 + Number(t[2]) * 1000 + Number((t[3] ?? '').padEnd(3, '0')));
    if (!original.trim()) {
      if (times.every(t => t === 0)) { removed.push({ row: i + 1, text: row, reason: 'sentinel' }); continue; }
      throw new StudioError('EMPTY_SOURCE_LINE');
    }
    // Only exact role labels before the first sung line, with an explicit colon.
    if (preface && /^(?:詞|词|曲|作詞|作词|填詞|填词|作曲|編曲|编曲|製作人|制作人|演唱|歌手|混音|錄音|录音|母帶|母带|lyricist|composer|arranger|producer|performer|engineer)\s*[:：]\s*\S.{0,100}$/iu.test(original)) {
      removed.push({ row: i + 1, text: row, reason: 'prefatory-credit' }); continue;
    }
    preface = false;
    for (const timeMs of times) { stamp(timeMs); records.push({ timeMs, original }); }
  }
  if (!records.length || records.length > 2000) throw new StudioError('INVALID_LINE_COUNT');
  if (records.some((r, i) => i > 0 && r.timeMs < records[i - 1].timeMs)) throw new StudioError('TIMING_ORDER_REQUIRES_REVIEW');
  return { lines: records.map((r, i) => ({ ...r, id: `line-${i + 1}` })), removed };
}
export interface TranslationLine { id: string; timeMs: number; original: string; translation: string }
export function validateTranslation(source: SourceLine[], value: unknown): { lines: TranslationLine[]; warnings: string[]; fixes: string[] } {
  if (!Array.isArray(value) || value.length !== source.length) throw new StudioError('LINE_COUNT_MISMATCH');
  const fixes: string[] = [], warnings: string[] = [];
  const traditional = OpenCC.Converter({ from: 'cn', to: 'tw' });
  const lines = source.map((s, i) => {
    const t = value[i];
    if (!t || t.id !== s.id || t.timeMs !== s.timeMs || t.original !== s.original) throw new StudioError('SOURCE_PAIR_MISMATCH');
    if (typeof t.translation !== 'string' || !t.translation.trim() || t.translation.length > 2000 || /[\r\n\[\]\u0000-\u001f]/.test(t.translation)) throw new StudioError('INVALID_TRANSLATION_LINE');
    const translation = t.translation.replace(/[,，]/g, ' ');
    if (translation !== t.translation) fixes.push(`${s.id}:COMMA_TO_SPACE`);
    if (!/\p{Script=Han}/u.test(translation)) warnings.push(`${s.id}:TRADITIONAL_CHINESE_REVIEW`);
    if (traditional(translation) !== translation) warnings.push(`${s.id}:TRADITIONAL_VARIANT_REVIEW`);
    return { ...s, translation };
  });
  const repeats = new Map<string, Set<string>>();
  for (const l of lines) repeats.set(l.original, (repeats.get(l.original) ?? new Set()).add(l.translation));
  for (const [original, variants] of repeats) if (lines.filter(l => l.original === original).length > 1 && variants.size === 1) warnings.push('REPEATED_LINE_VARIATION_REQUIRED');
  return { lines, warnings: [...new Set(warnings)], fixes };
}
export function bilingualLrc(lines: TranslationLine[]): string {
  return ['[00:00.000]', ...lines.flatMap(l => [`[${stamp(l.timeMs)}]${l.original}`, `[${stamp(l.timeMs)}]${l.translation}`])].join('\n');
}
