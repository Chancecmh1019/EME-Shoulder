import { correctLyrics, newLyricDraft } from '../utils/lyricCorrection';
import { stamp, validateTranslation, type SourceLine } from './lrc';
/** Reuse the original website correction engine on translations; original source bytes/text stay intact. */
export function correctStudioTranslation(source: SourceLine[], input: unknown) {
  const before = validateTranslation(source, input);
  const translationLrc = before.lines.map(line => `[${stamp(line.timeMs)}]${line.translation}`).join('\n');
  const correction = correctLyrics({ ...newLyricDraft(translationLrc, 'lrc'), convertChinese: true, offset: 0 });
  if (!correction.output || correction.logs.some(log => log.type === 'error')) throw new Error('LEGACY_LYRIC_CORRECTION_FAILED');
  const rows = correction.output.split('\n').filter(line => line !== '[00:00.000]');
  if (rows.length !== source.length) throw new Error('CORRECTION_LINE_COUNT_CHANGED');
  const fixes = [...before.fixes];
  const lines = before.lines.map((line, index) => {
    const prefix = `[${stamp(line.timeMs)}]`;
    if (!rows[index].startsWith(prefix)) throw new Error('CORRECTION_TIMESTAMP_CHANGED');
    const translation = rows[index].slice(prefix.length);
    if (translation !== line.translation) fixes.push(`${line.id}:LEGACY_TRADITIONAL_AND_FORMAT_CORRECTION`);
    return { ...line, translation };
  });
  const checked = validateTranslation(source, lines);
  if (checked.warnings.some(warning => warning.endsWith(':TRADITIONAL_VARIANT_REVIEW'))) throw new Error('TRADITIONAL_CORRECTION_INCOMPLETE');
  return { ...checked, fixes: [...new Set([...fixes, ...checked.fixes])], correctionLogs: correction.logs, correctionEngine: 'original utils/lyricCorrection.ts / OpenCC cn→tw', originalsAndTimestampsPreserved: true };
}
