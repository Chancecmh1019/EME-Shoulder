import React, { useEffect, useRef, useState } from 'react';
import { newThreadsClip, type AlbumProject, type ClipRange, type TrackProject, type ThreadsClipState } from '../types';
import { clipFingerprint, LocalClipAnalyzer } from '../services/clipAnalyzer';
import { LibraryStore } from '../services/library';
import { ProductionQueue } from '../services/queue';
import { download, getMedia, threadsFilename } from '../services/storage';
import { formatTime } from '../utils/parsers';
export function ThreadsClip({ track, album, store, queue, report, onPreview }: { track: TrackProject; album: Pick<AlbumProject, 'id' | 'artworkKey' | 'visual'>; store: LibraryStore; queue: ProductionQueue; report: (text: string) => void; onPreview: (range?: ClipRange, play?: boolean) => void }) {
  const state = track.threads ?? newThreadsClip(), [open, setOpen] = useState(false); const controller = useRef<AbortController | undefined>(undefined);
  useEffect(() => () => controller.current?.abort(), []);
  const patch = (values: Partial<ThreadsClipState>) => store.patchTrack(track.id, { threads: { ...(store.track(track.id)?.threads ?? newThreadsClip()), ...values } });
  const run = (action: () => Promise<unknown>) => { void action().catch(e => report(e.message)); };
  const analyze = async () => {
    controller.current?.abort(); const abort = new AbortController(); controller.current = abort;
    await patch({ analysis: 'running', analysisProgress: 0, error: undefined });
    try {
      const candidates = await new LocalClipAnalyzer().analyze(track, abort.signal, p => { void patch({ analysisProgress: p }).catch(() => abort.abort()); });
      if (abort.signal.aborted) return;
      if (!candidates.length) throw new Error('找不到有效片段。請確認音訊時長。');
      await patch({ candidates, selectedCandidate: candidates[0].id, range: { start: candidates[0].start, end: candidates[0].end }, analysis: 'completed', analysisProgress: 100, analysisFingerprint: clipFingerprint(track) });
      onPreview(candidates[0]);
    } catch (e) { await patch({ analysis: abort.signal.aborted ? 'cancelled' : 'error', error: abort.signal.aborted ? undefined : e instanceof Error ? e.message : String(e) }); }
  };
  const locked = ['pending', 'running'].includes(state.render), analyzing = state.analysis === 'running';
  const range = state.range, valid = !!range && Number.isFinite(range.start) && Number.isFinite(range.end) && range.start >= 0 && range.end > range.start && range.end <= track.duration;
  const stale = state.analysisFingerprint && state.analysisFingerprint !== clipFingerprint(track);
  const boundaries = [...new Set([0, ...track.lyrics.map(l => l.startTime + track.lyricOffset).filter(t => t >= 0 && t <= track.duration), track.duration])].sort((a, b) => a - b);
  const changeRange = (next: ClipRange) => { onPreview(validRange(next) ? next : undefined); run(() => patch({ range: next, selectedCandidate: undefined })); };
  const validRange = (r: ClipRange) => r.start >= 0 && r.end > r.start && r.end <= track.duration;
  return <section className="threads-clip"><div className="threads-heading"><div><small>DERIVED MEDIA / THREADS</small><h2>留一段，讓音樂靠近。</h2></div><button aria-expanded={open} onClick={() => setOpen(!open)}>Threads Clip {open ? '−' : '+'}</button></div>{open && <div className="threads-body"><p className="caption">沿用 16:9 CD-Booklet · 約 25–40 秒。下載後，由你親自發佈到 Threads。</p><div className="button-row"><button disabled={analyzing || locked} onClick={() => run(analyze)}>{state.candidates.length ? '重新尋找片段' : '尋找三個片段'}</button>{analyzing && <><span>分析音訊 · {Math.round(state.analysisProgress ?? 0)}%</span><button onClick={() => controller.current?.abort()}>停止分析</button></>}</div>{stale && <p className="caption">歌詞或位移已變更，建議重新分析。</p>}
    <div className="clip-candidates">{state.candidates.map((candidate, i) => <button key={candidate.id} disabled={locked} aria-pressed={state.selectedCandidate === candidate.id} onClick={() => { run(() => patch({ selectedCandidate: candidate.id, range: { start: candidate.start, end: candidate.end } })); onPreview(candidate, true); }}><strong>{i === 0 ? 'Recommended' : `另一個時刻 ${i}`}</strong><span>{formatTime(candidate.start)} → {formatTime(candidate.end)}</span><small>{(candidate.end - candidate.start).toFixed(1)} sec · {candidate.reasons.join(' · ')}</small></button>)}</div>
    {range && <><div className="clip-range"><label>開始（秒）<input disabled={locked} type="number" min="0" max={track.duration} step="0.001" value={range.start} onChange={e => changeRange({ ...range, start: Number(e.target.value) })}/></label><label>結束（秒）<input disabled={locked} type="number" min="0" max={track.duration} step="0.001" value={range.end} onChange={e => changeRange({ ...range, end: Number(e.target.value) })}/></label></div><div className="button-row"><button disabled={locked || !valid} onClick={() => changeRange({ start: boundaries.reduce((a, b) => Math.abs(b - range.start) < Math.abs(a - range.start) ? b : a, 0), end: boundaries.reduce((a, b) => Math.abs(b - range.end) < Math.abs(a - range.end) ? b : a, track.duration) })}>對齊歌詞邊界</button><button disabled={!valid} onClick={() => onPreview(range, true)}>預覽所選片段 ↗</button><button onClick={() => onPreview(undefined)}>回到整首預覽</button></div><p className={valid ? 'caption' : 'error'}>{valid ? `上方預覽播放 ${formatTime(range.start)} → ${formatTime(range.end)}，共 ${(range.end - range.start).toFixed(3)} 秒。` : '請輸入有效範圍，結束時間需晚於開始且不超過歌曲。'}</p><button className="primary" disabled={!valid || locked || analyzing} onClick={() => run(async () => { await queue.enqueueClip(track, album, range); report('Threads Clip 已加入共用渲染佇列。完成後會嘗試自動下載。'); })}>Render & Download Threads Clip ↗</button></>}
    {state.render !== 'idle' && <p className="caption">Threads · {state.render} · {Math.round(state.renderProgress)}%</p>}{state.error && <p className="error">{state.error}</p>}{state.outputKey && <div className="clip-download"><p>片段已保留。若未自動下載，請點下方按鈕。</p><button className="primary" onClick={() => run(async () => { const blob = await getMedia(state.outputKey!); if (!blob) throw new Error('片段檔案已不存在，請重新渲染。'); download(blob, threadsFilename(track)); })}>Download Threads Clip</button></div>}</div>}</section>;
}
