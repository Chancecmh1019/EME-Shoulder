import { stamp, type SourceLine } from './lrc';
import { parseBulkTranslations } from './dotWorkflow';
/** The original prompt outputs bilingual LRC. Convert it to the handshake without asking Dot to reformat. */
export function parseDotTranslation(text: string, source: SourceLine[]) {
  const clean = text.replace(/^\uFEFF/, '').replace(/\r\n?/g, '\n').trim();
  if (!/^\[\d{1,3}:[0-5]\d\.\d{3}\]/.test(clean)) return parseBulkTranslations(clean, source.map(line => line.id));
  const rows = clean.split('\n').filter(row => row.trim() && row !== '[00:00.000]');
  if (rows.length !== source.length * 2) throw new Error('雙語 LRC 必須每行原文緊接一行譯文，不能缺句或附加說明。');
  const result: Record<string, string> = Object.create(null);
  source.forEach((line, i) => {
    const prefix = `[${stamp(line.timeMs)}]`;
    if (rows[i * 2] !== prefix + line.original || !rows[i * 2 + 1].startsWith(prefix)) throw new Error(`原文或時間戳已改動：${line.id}`);
    const translation = rows[i * 2 + 1].slice(prefix.length);
    if (!translation.trim()) throw new Error(`缺少譯文：${line.id}`);
    result[line.id] = translation;
  });
  return result;
}
