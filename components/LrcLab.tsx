import React, { useEffect, useRef, useState } from 'react';
import { LibraryStore } from '../services/library';
import { LyricsWorkbench } from './LyricsWorkbench';
import { LyricEditor } from './LyricEditor';
import { newLyricDraft } from '../utils/lyricCorrection';
import { serializeLRC, serializeSRT } from '../utils/parsers';
import { translationPrompts } from '../utils/translationPrompts';
import type { LyricDraft, LyricLine } from '../types';
export function LrcLab({ store, report }: { store: LibraryStore; report: (message: string) => void }) {
  const data = store.data, draft = data.labDraft ?? newLyricDraft(data.labText);
  const [stage, setStage] = useState<1 | 2>(1), [copied, setCopied] = useState(false), [time, setTime] = useState(0), [file, setFile] = useState<File>(), [audioUrl, setAudioUrl] = useState<string>(), [duration, setDuration] = useState(0), [advanced, setAdvanced] = useState(false), [canUndo, setCanUndo] = useState(false);
  const media = useRef<HTMLAudioElement>(null), undo = useRef<{ draft: LyricDraft; lines: LyricLine[]; text: string; file?: File; time: number; duration: number; advanced: boolean } | undefined>(undefined);
  useEffect(() => { if (!file) { setAudioUrl(undefined); return; } const url = URL.createObjectURL(file); setAudioUrl(url); return () => URL.revokeObjectURL(url); }, [file]);
  const update = (edit: Parameters<LibraryStore['change']>[0]) => { void store.change(edit).catch(e => report(e.message)); };
  const mode = data.labPromptFormat ?? 'lrc';
  const clear = () => {
    undo.current = { draft: structuredClone(draft), lines: structuredClone(data.lab), text: data.labText, file, time, duration, advanced };
    media.current?.pause(); setFile(undefined); setTime(0); setDuration(0); setAdvanced(false); setCanUndo(true);
    update(d => { d.labDraft = newLyricDraft('', draft.format); d.labText = ''; d.lab = []; });
  };
  const restore = () => { const old = undo.current; if (!old) return; update(d => { d.labDraft = old.draft; d.labText = old.text; d.lab = old.lines; }); setFile(old.file); setTime(old.time); setDuration(old.duration); setAdvanced(old.advanced); undo.current = undefined; setCanUndo(false); };
  return <main className="page lab-page"><div className="lab-steps" aria-label="歌詞準備步驟"><button aria-pressed={stage === 1} onClick={() => setStage(1)}>1 · Translation Prompt</button><button aria-pressed={stage === 2} onClick={() => setStage(2)}>2 · Correction</button></div>
    {stage === 1 ? <section className="prompt-stage"><h2>讓翻譯，先有一個清楚的起點。</h2><p className="caption">複製指令，與原歌詞一起在外部使用；帶著翻譯結果回來校正。</p><div className="format-switch">{(['lrc', 'srt'] as const).map(format => <button key={format} aria-pressed={mode === format} onClick={() => { update(d => { d.labPromptFormat = format; }); setCopied(false); }}>{format.toUpperCase()}</button>)}</div><textarea readOnly aria-label={`${mode.toUpperCase()} 翻譯指令`} value={translationPrompts[mode]}/><div className="button-row"><button className="primary" onClick={() => { void navigator.clipboard.writeText(translationPrompts[mode]).then(() => { setCopied(true); report('翻譯指令已完整複製。'); }).catch(() => report('請允許剪貼簿權限，或選取指令手動複製。')); }}>{copied ? 'Copied ✓' : 'Copy Prompt'}</button><button onClick={() => { update(d => { if (!d.labDraft?.input && !d.labDraft?.output) d.labDraft = newLyricDraft('', mode); }); setStage(2); }}>帶著結果，開始校正 →</button></div></section> : <>
    <LyricsWorkbench draft={draft} onDraft={next => update(d => { d.labDraft = next; d.labText = next.input; })} duration={duration} report={report} onClear={clear} onUndo={restore} canUndo={canUndo} onApply={lines => { update(d => { d.lab = lines; }); setAdvanced(true); }} applyLabel="逐行校稿 / 校時"/>
    <details className="advanced-review" open={advanced} onToggle={e => setAdvanced(e.currentTarget.open)}><summary>逐行校稿與音訊校時（需要時展開）</summary><label className="file-button">載入音訊<input type="file" accept="audio/*,.m4a,.flac,.opus" onChange={e => { if (e.target.files?.[0]) setFile(e.target.files[0]); e.target.value = ''; }}/></label>{audioUrl && <audio ref={media} src={audioUrl} controls onLoadedMetadata={e => { setDuration(e.currentTarget.duration); e.currentTarget.currentTime = Math.min(time, e.currentTarget.duration); }} onTimeUpdate={e => setTime(e.currentTarget.currentTime)}/>}
      <LyricEditor lines={data.lab} duration={duration} offset={0} time={time} explicitEnds={draft.format === 'srt'} onChange={lines => update(d => { d.lab = lines; if (d.labDraft) d.labDraft.output = draft.format === 'srt' ? serializeSRT(lines) : serializeLRC(lines); })} onSeek={value => { if (media.current) { media.current.currentTime = value; setTime(value); } }}/>
    </details></>}
  </main>;
}
