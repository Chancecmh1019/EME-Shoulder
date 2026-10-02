import React, { useRef, useState } from 'react';
import { LibraryStore } from '../services/library';
import { LyricsWorkbench } from './LyricsWorkbench';
import { LyricEditor } from './LyricEditor';
import { newLyricDraft } from '../utils/lyricCorrection';
import { serializeLRC, serializeSRT } from '../utils/parsers';
export function LrcLab({ store, report }: { store: LibraryStore; report: (message: string) => void }) {
  const data = store.data, draft = data.labDraft ?? newLyricDraft(data.labText); const [time, setTime] = useState(0), [audioUrl, setAudioUrl] = useState<string>(), [duration, setDuration] = useState(0), [advanced, setAdvanced] = useState(false); const media = useRef<HTMLAudioElement>(null);
  React.useEffect(() => () => { if (audioUrl) URL.revokeObjectURL(audioUrl); }, [audioUrl]);
  const update = (edit: Parameters<LibraryStore['change']>[0]) => { void store.change(edit).catch(e => report(e.message)); };
  return <main className="page lab-page"><small>LRC LAB / 一次完成歌詞整理</small><h1>貼上，校正，帶走。</h1><p className="lede">沿用原本歌詞工具的集中流程。原稿、校正結果與問題提示都在同一處。</p>
    <LyricsWorkbench draft={draft} onDraft={next => update(d => { d.labDraft = next; d.labText = next.input; })} duration={duration} report={report} onApply={lines => { update(d => { d.lab = lines; }); setAdvanced(true); }} applyLabel="逐行校稿 / 校時"/>
    <details className="advanced-review" open={advanced} onToggle={e => setAdvanced(e.currentTarget.open)}><summary>逐行校稿與音訊校時（需要時展開）</summary><label className="file-button">載入音訊<input type="file" accept="audio/*,.m4a,.flac,.opus" onChange={e => { const file = e.target.files?.[0]; if (file) setAudioUrl(URL.createObjectURL(file)); }}/></label>{audioUrl && <audio ref={media} src={audioUrl} controls onLoadedMetadata={e => setDuration(e.currentTarget.duration)} onTimeUpdate={e => setTime(e.currentTarget.currentTime)}/>}
      <LyricEditor lines={data.lab} duration={duration} offset={0} time={time} explicitEnds={draft.format === 'srt'} onChange={lines => update(d => { d.lab = lines; if (d.labDraft) d.labDraft.output = draft.format === 'srt' ? serializeSRT(lines) : serializeLRC(lines); })} onSeek={value => { if (media.current) { media.current.currentTime = value; setTime(value); } }}/>
    </details>
  </main>;
}
