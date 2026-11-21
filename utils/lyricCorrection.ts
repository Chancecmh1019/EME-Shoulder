import * as OpenCC from 'opencc-js';
import type { CorrectionLog, LyricDraft } from '../types';
import { formatTime, parseSRT, serializeSRT } from './parsers';
export const newLyricDraft = (input = '', format: 'lrc' | 'srt' = input.includes('-->') ? 'srt' : 'lrc'): LyricDraft => ({ input, output: '', format, convertChinese: true, offset: 0, logs: [] });
export function correctLyrics(draft: LyricDraft): LyricDraft {
  const logs: CorrectionLog[] = []; const convert = draft.convertChinese ? OpenCC.Converter({ from: 'cn', to: 'tw' }) : (text: string) => text;
  const raw = draft.input.replace(/^\uFEFF/, '').replace(/\r\n?/g, '\n');
  if (!raw.trim()) return { ...draft, output: '', logs: [{ type: 'error', message: '請先貼上 LRC 或 SRT。' }] };
  let converted = 0, trimmed = 0;
  const content = (text: string) => { const clean = text.split('\n').map(l => l.trimEnd()).join('\n'); if (text !== clean) trimmed++; const result = convert(clean); if (result !== clean) converted++; return result; };
  if (draft.format === 'srt') {
    const blocks = raw.split(/\n\s*\n/).filter(b => b.trim());
    const lines = blocks.flatMap((block, index) => {
      const parsed = parseSRT(block.replace(/(\d{2}:\d{2}:\d{2})[.](\d{1,3})/g, '$1,$2'));
      if (!parsed.length) { logs.push({ type: 'error', message: `第 ${index + 1} 個字幕區塊時間無效，請先修正。` }); return []; }
      return parsed.map(l => ({ ...l, original: content(l.original), startTime: Math.max(0, l.startTime + draft.offset), endTime: Math.max(0, l.endTime + draft.offset) }));
    });
    if (logs.some(l => l.type === 'error')) return { ...draft, output: '', logs };
    if (converted) logs.push({ type: 'success', message: `已將 ${converted} 個字幕區塊轉為繁體中文。` });
    if (trimmed) logs.push({ type: 'success', message: `已清理 ${trimmed} 處尾部空白。` });
    logs.unshift({ type: 'success', message: `校正完成：${lines.length} 個字幕區塊，時間格式與編號已統一。` });
    return { ...draft, output: serializeSRT(lines), logs };
  }
  const records: { time: number; text: string; order: number }[] = [], metadata: string[] = []; let glued = 0, standardized = 0;
  const stamp = /\[(\d{1,3})[.:,]([0-5]?\d)(?:[.:,](\d{1,3}))?\]/g;
  for (const [lineIndex, line] of raw.split('\n').entries()) {
    if (!line.trim()) continue;
    if (/^\s*\[(ar|ti|al|by|offset|re|ve|length):.*\]\s*$/i.test(line)) { metadata.push(line.trim()); continue; }
    const matches = [...line.matchAll(stamp)];
    if (!matches.length) { logs.push({ type: 'error', message: `第 ${lineIndex + 1} 行沒有可校正的時間戳記；內容未刪除，請修正輸入。` }); continue; }
    if (line.slice(0, matches[0].index).trim()) { logs.push({ type: 'error', message: `第 ${lineIndex + 1} 行時間戳記之前有未同步文字，請修正輸入。` }); continue; }
    let pending: number[] = [];
    matches.forEach((match, index) => {
      const time = Math.round((Number(match[1]) * 60 + Number(match[2]) + Number((match[3] || '').padEnd(3, '0')) / 1000 + draft.offset) * 1000) / 1000;
      if (time < 0) logs.push({ type: 'warning', message: `第 ${lineIndex + 1} 行位移後小於零，已限制為 00:00。` });
      pending.push(Math.max(0, time));
      if (match[0] !== `[${formatTime(time)}]`) standardized++;
      const segment = line.slice(match.index! + match[0].length, matches[index + 1]?.index ?? line.length);
      if (segment || index === matches.length - 1) {
        const text = content(segment);
        for (const start of pending) records.push({ time: start, text, order: records.length });
        if (index < matches.length - 1 && text) glued++;
        pending = [];
      }
    });
  }
  // Never silently drop damaged input or replace a usable result with partial data.
  if (logs.some(l => l.type === 'error')) return { ...draft, output: '', logs };
  records.sort((a, b) => a.time - b.time || a.order - b.order);
  const groups = new Map<number, string[]>(); records.forEach(r => groups.set(r.time, [...(groups.get(r.time) ?? []), r.text]));
  for (const [time, rows] of groups) {
    if (rows.length === 1 && /[A-Za-z\p{Script=Hangul}\p{Script=Hiragana}\p{Script=Katakana}]/u.test(rows[0])) logs.push({ type: 'warning', message: `[${formatTime(time)}] 可能缺少繁體中文翻譯。` });
    if (rows.length >= 3 && rows.length % 2 !== 0) logs.push({ type: 'warning', message: `[${formatTime(time)}] 有 ${rows.length} 行，請確認原文與翻譯的對應。` });
  }
  if (glued) logs.push({ type: 'success', message: `已拆開 ${glued} 處黏連的時間與歌詞。` });
  if (standardized) logs.push({ type: 'success', message: `已統一 ${standardized} 個時間戳記為標準 LRC。` });
  if (converted) logs.push({ type: 'success', message: `已將 ${converted} 行中文轉為繁體中文。` });
  if (trimmed) logs.push({ type: 'success', message: `已清理 ${trimmed} 處尾部空白。` });
  logs.unshift({ type: 'success', message: `校正完成：${groups.size} 個時間點，已排序並保留原文／翻譯。` });
  return { ...draft, output: [...metadata, ...records.map(r => `[${formatTime(r.time)}]${r.text}`)].join('\n'), logs };
}
