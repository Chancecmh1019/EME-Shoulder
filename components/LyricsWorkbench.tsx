import React, { useRef, useState } from 'react';
import type { LyricDraft, LyricLine } from '../types';
import { correctLyrics, newLyricDraft } from '../utils/lyricCorrection';
import { parseLRC, parseSRT } from '../utils/parsers';
import { download } from '../services/storage';
export function LyricsWorkbench({ draft: controlled, onDraft, initialInput = '', format, duration = 0, onApply, applyLabel = '套用到目前曲目', name = 'lyrics', report, onClear, onUndo, canUndo }: { draft?: LyricDraft; onDraft?: (draft: LyricDraft) => void; initialInput?: string; format?: 'lrc' | 'srt'; duration?: number; onApply?: (lines: LyricLine[]) => void; applyLabel?: string; name?: string; report: (message: string) => void; onClear?: () => void; onUndo?: () => void; canUndo?: boolean }) {
  const [local, setLocal] = useState(() => newLyricDraft(initialInput, format)); const draft = controlled ?? local;
  const [previous, setPrevious] = useState<LyricDraft>(), [copying, setCopying] = useState(false); const latest = useRef(draft); latest.current = draft;
  const set = (next: LyricDraft) => { setLocal(next); onDraft?.(next); };
  const clear = () => { setPrevious(structuredClone(draft)); set(newLyricDraft('', draft.format)); onClear?.(); };
  const undo = () => { if (onUndo) onUndo(); else if (previous) set(previous); setPrevious(undefined); };
  const copy = async (andClear = false) => {
    setCopying(true);
    try { await navigator.clipboard.writeText(draft.output); if (andClear && JSON.stringify(latest.current) === JSON.stringify(draft)) { clear(); report('校正結果已複製，工作區已清空。可按 Undo 復原。'); } else report('校正結果已複製。'); }
    catch { report('無法寫入剪貼簿，內容仍保留。請允許剪貼簿權限，或選取結果手動複製。'); }
    finally { setCopying(false); }
  };
  const input = (text: string) => set({ ...draft, input: text, format: text.includes('-->') ? 'srt' : text.includes('[') ? 'lrc' : draft.format });
  const execute = () => { const result = correctLyrics(draft); set(result); };
  const apply = () => { const lines = draft.format === 'srt' ? parseSRT(draft.output) : parseLRC(draft.output, duration); if (!lines.length) report('請先校正並確認結果。'); else onApply?.(lines); };
  return <section className="correction-workbench" aria-label="歌詞校正工具"><div className="correction-heading"><div><h2>歌詞校正工具</h2><p>貼上原稿，一次整理時間格式、排序、繁體中文與翻譯提醒。</p></div><div className="format-switch"><button aria-pressed={draft.format === 'lrc'} onClick={() => set({ ...draft, format: 'lrc' })}>LRC</button><button aria-pressed={draft.format === 'srt'} onClick={() => set({ ...draft, format: 'srt' })}>SRT</button></div></div>
    <div className="correction-options"><label><input type="checkbox" checked={draft.convertChinese} onChange={e => set({ ...draft, convertChinese: e.target.checked })}/> 同時轉為繁體中文</label><label>時間位移（秒）<input aria-label="校正時間位移" type="number" step="0.05" value={draft.offset} onChange={e => set({ ...draft, offset: Number(e.target.value) })}/></label><label className="file-button">匯入 LRC / SRT<input type="file" accept=".lrc,.srt,.txt" onChange={e => { const file = e.target.files?.[0]; if (file) void file.text().then(input).catch(e => report(e.message)); e.target.value = ''; }}/></label></div>
    <div className="correction-columns"><label>原始內容<textarea aria-label="原始歌詞內容" rows={16} value={draft.input} onChange={e => input(e.target.value)} placeholder={draft.format === 'lrc' ? '[00:39.24]Hello[00:39.24]你好\n可直接貼上黏在一起或時間格式不一致的歌詞。' : '1\n00:00:01,000 --> 00:00:04,000\n字幕內容'}/></label><label>校正結果<textarea aria-label="歌詞校正結果" rows={16} value={draft.output} onChange={e => set({ ...draft, output: e.target.value })} placeholder="執行校正後，結果會出現在這裡。可繼續修改。"/></label></div>
    <div className="correction-actions"><button className="primary" onClick={execute}>執行校正 <span>→</span></button><div><button disabled={!draft.output || copying} onClick={() => void copy()}>Copy</button><button className="primary" disabled={!draft.output || copying} onClick={() => void copy(true)}>Copy & Clear</button><button disabled={copying} onClick={clear}>Clear</button>{(canUndo ?? !!previous) && <button onClick={undo}>Undo</button>}<button disabled={!draft.output} onClick={() => download(new Blob([draft.output], { type: 'text/plain;charset=utf-8' }), `${name}.${draft.format}`)}>下載 {draft.format.toUpperCase()}</button>{onApply && <button className="primary" disabled={!draft.output} onClick={apply}>{applyLabel}</button>}</div></div>
    {!!draft.logs.length && <div className="correction-logs" role="status">{draft.logs.map((l, i) => <p key={i} className={l.type}>{l.type === 'error' ? '×' : l.type === 'warning' ? '!' : '✓'} {l.message}</p>)}</div>}
  </section>;
}
