import React, { useRef, useState } from 'react';
import { defaultVisual, trackStatus, type AlbumProject, type TrackProject } from '../types';
import { LibraryStore } from '../services/library';
import { ProductionQueue } from '../services/queue';
import { Preview, ThumbnailPreview } from './Preview';
import { LyricEditor } from './LyricEditor';
import { AlbumIdentity } from './AlbumIdentity';
import { normalizeLines, parseLRC, parseSRT, validateLyrics } from '../utils/parsers';
import { validatePublishing, videoTitle, videoDescription } from '../utils/publishing';
import { api } from '../services/youtube';
import { LyricsWorkbench } from './LyricsWorkbench';
import { serializeLRC, serializeSRT } from '../utils/parsers';
export function Workspace({ album, track, store, queue, onSelect, onApproved, report }: { album?: AlbumProject; track: TrackProject; store: LibraryStore; queue: ProductionQueue; onSelect: (id: string) => void; onApproved: () => void; report: (message: string) => void }) {
  const media = useRef<HTMLMediaElement>(null), [time, setTime] = useState(0), [tab, setTab] = useState<'lyrics' | 'publish' | 'visual'>('lyrics'), [busy, setBusy] = useState(false), [correction, setCorrection] = useState(false), [reviewMode, setReviewMode] = useState<'bulk' | 'lines'>('bulk');
  const locked = ['pending', 'running'].includes(track.render) || ['pending', 'running'].includes(track.publish);
  const view = album ?? { id: track.id, artworkKey: track.artworkKey, visual: defaultVisual };
  const patch = (data: Partial<TrackProject>) => { void store.patchTrack(track.id, { ...data, review: data.lyrics ? data.lyrics.length ? 'needs-review' : 'needs-lyrics' : 'needs-review' }).catch(e => report(e.message)); };
  const approve = async () => {
    const problems = [...validateLyrics(track.lyrics, track.duration, track.lyricOffset), ...validatePublishing(track)];
    if (!track.lyrics.length) problems.push('請先加入歌詞／字幕。');
    if (track.review === 'approved' && track.render === 'completed' && track.publish === 'completed') problems.push('此版本已上傳。修改後再核准新的版本，避免重複上傳。');
    if (problems.length) { report(problems.join('；')); return; }
    setBusy(true);
    try { const auth = await api('/api/auth?action=status'); if (!auth.connected || !auth.channelId) throw new Error('請到 Settings 連接具有 YouTube 頻道的 Google 帳號。'); await queue.approve(track); onApproved(); }
    catch (e) { report(e instanceof Error ? e.message : String(e)); } finally { setBusy(false); }
  };
  const readLyrics = async (file?: File) => {
    if (!file) return; const text = await file.text(); const lyrics = track.kind === 'mv' ? parseSRT(text) : parseLRC(text, track.duration);
    if (!lyrics.length) { report('找不到有效的逐行時間戳記。'); return; } patch({ lyrics });
  };
  const exportOnly = async () => {
    const problems = validateLyrics(track.lyrics, track.duration, track.lyricOffset);
    if (!track.lyrics.length) problems.push('請先加入歌詞／字幕。');
    if (problems.length) return report(problems.join('；'));
    setBusy(true); try { await queue.approve(track, false); report('已加入 60 FPS 匯出佇列，完成後可在 Queue 下載 MP4。'); } catch (e) { report(e instanceof Error ? e.message : String(e)); } finally { setBusy(false); }
  };
  return <div className={`workspace ${!album ? 'mv-workspace' : ''}`}>
    <aside className="track-panel">{album ? <AlbumIdentity album={album}/> : <div className="album-identity"><small>MV SUBTITLE</small><h2>{track.title}</h2><p>讓音樂與影像保留主角的位置。</p></div>}
      <div className="track-list">{(album?.tracks ?? store.data.mv).map(t => <button key={t.id} className={t.id === track.id ? 'selected' : ''} onClick={() => { setTime(0); onSelect(t.id); }}><span className="track-number">{t.kind === 'mv' ? 'MV' : `${t.discNumber || 1}.${String(t.trackNumber ?? t.importOrder + 1).padStart(2, '0')}`}</span><span><strong>{t.title}</strong><small>{t.artist}</small><small className={`state ${t.error ? 'error' : ''}`}>{trackStatus(t)}</small></span></button>)}</div>
    </aside>
    <main className="work-center"><div className="track-heading"><div><small>{track.kind === 'mv' ? 'SUBTITLE REVIEW' : 'TRACK REVIEW'}</small><h1>{track.title}</h1><p>{track.artist} <span> / </span> {track.album}</p></div><span className="status-pill">{trackStatus(track)}</span></div>
      <Preview key={track.id} track={track} album={view} onTime={setTime} mediaRef={media}/>
      <div className="production-bar"><div><strong>完成校稿，交給 Shoulder。</strong><small>{track.privacy === 'private' ? 'Private' : track.privacy} · YouTube · 依序渲染，上傳可同時進行</small></div><button className="primary" disabled={locked || busy} onClick={() => void approve()}>{busy ? '確認頻道…' : 'Approve, Render & Upload'} <span>↗</span></button></div>
      <div className="export-local"><button disabled={locked || busy} onClick={() => void exportOnly()}>僅匯出影片 · 60 FPS</button><small>完成後在 Queue 下載，或接續上傳 YouTube。</small></div>
      {track.error && <p className="error" role="alert">{track.error}</p>}
      {locked && <p className="caption">此版本已核准，產出期間暫停編輯。你可以繼續校稿其他曲目。</p>}
      <div className="review-tool-entry"><span>整份歌詞一起調整</span><button disabled={locked} onClick={() => setCorrection(true)}>整份 LRC／SRT 校正 ↗</button></div>
      <p className="caption">{track.lyrics.length} 行歌詞 · 在集中校稿視窗一起調整</p>
    </main>
    <aside className="inspector"><div className="inspector-tabs">{(['lyrics', 'publish', 'visual'] as const).filter(x => track.kind !== 'mv' || x !== 'visual').map(x => <button key={x} className={tab === x ? 'selected' : ''} onClick={() => setTab(x)}>{x === 'lyrics' ? '曲目' : x === 'publish' ? '發佈' : '畫面'}</button>)}</div>
      {tab === 'lyrics' && <><div className="section-label">SOURCE & TIMING</div><button disabled={locked} onClick={() => setCorrection(true)}>貼上／校正歌詞</button><label className="file-button">直接匯入 {track.kind === 'mv' ? 'SRT' : 'LRC'}<input disabled={locked} type="file" accept={track.kind === 'mv' ? '.srt' : '.lrc'} onChange={e => { void readLyrics(e.target.files?.[0]).catch(e => report(e.message)); e.target.value = ''; }}/></label>
        <label>全域延遲（秒）<input disabled={locked} type="number" step="0.05" value={track.lyricOffset} onChange={e => patch({ lyricOffset: Number(e.target.value) })}/><small>正值延後顯示歌詞。</small></label>
        {(['title', 'artist', 'album', 'albumArtist'] as const).map(key => <label key={key}>{({ title: '曲名', artist: '演出者', album: '專輯', albumArtist: '專輯演出者' })[key]}<input disabled={locked} value={track[key]} onChange={e => patch({ [key]: e.target.value })}/></label>)}
        {track.untimedLyrics && <details><summary>未同步的內嵌歌詞</summary><pre>{track.untimedLyrics}</pre><p className="caption">請在 LRC Lab 校正時間後匯入。</p></details>}
        {track.kind === 'mv' && <label>手動套用曲目發佈資訊<select disabled={locked} value="" onChange={e => { const t = store.track(e.target.value); if (t) patch({ title: t.title, artist: t.artist, album: t.album, titleOverride: videoTitle(t), descriptionOverride: videoDescription(t) }); }}><option value="">選擇對應曲目…</option>{store.data.albums.flatMap(a => a.tracks).map(t => <option key={t.id} value={t.id}>{t.artist} — {t.title}</option>)}</select></label>}
      </>}
      {tab === 'publish' && <><div className="section-label">YOUTUBE METADATA</div><label>發佈標題<input disabled={locked} value={videoTitle(track)} onChange={e => patch({ titleOverride: e.target.value })}/></label><label>影片說明<textarea disabled={locked} rows={12} value={videoDescription(track)} onChange={e => patch({ descriptionOverride: e.target.value })}/></label><button disabled={locked} onClick={() => patch({ titleOverride: undefined, descriptionOverride: undefined })}>還原自動產生內容</button><label>隱私<select disabled={locked} value={track.privacy} onChange={e => patch({ privacy: e.target.value as TrackProject['privacy'] })}><option value="private">Private · 僅自己</option><option value="unlisted">Unlisted · 不公開</option><option value="public">Public · 公開</option></select></label>{track.kind === 'lyric' && <ThumbnailPreview track={track} album={view} onReshuffle={() => { if (!locked) patch({ thumbnailSeed: track.thumbnailSeed + 1 }); }}/>}</>}
      {tab === 'visual' && album && <><div className="section-label">ALBUM VISUALS</div><p className="caption">這張專輯的所有曲目共用同一套畫面設定。</p>{(['flowSpeed', 'fontScale', 'vignette'] as const).map(key => <label key={key}>{({ flowSpeed: '背景流速', fontScale: '歌詞字級', vignette: '邊緣暗度' })[key]}<input disabled={album.tracks.some(t => ['pending', 'running'].includes(t.render))} type="range" min={key === 'fontScale' ? .7 : 0} max={key === 'fontScale' ? 1.3 : 1} step="0.05" value={album.visual[key]} onChange={e => { void store.change(d => { d.albums.find(a => a.id === album.id)!.visual[key] = Number(e.target.value); }).catch(e => report(e.message)); }}/></label>)}<p className="caption">輸出固定 1920 × 1080 · 60 FPS</p></>}
    </aside>
    {correction && <div className="correction-modal" role="dialog" aria-modal="true" aria-label="集中歌詞校正" onKeyDown={e => { if (e.key === 'Escape') setCorrection(false); if (e.key === 'Tab') { const focusable = [...e.currentTarget.querySelectorAll<HTMLElement>('button:not(:disabled), input:not(:disabled), textarea, select, a[href]')]; const first = focusable[0], last = focusable[focusable.length - 1]; if (e.shiftKey && document.activeElement === first) { e.preventDefault(); last.focus(); } else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first.focus(); } } }}><div className="correction-dialog"><div className="dialog-top"><small>{track.artist} / {track.title}</small><button autoFocus onClick={() => setCorrection(false)} aria-label="關閉歌詞校正工具">×</button></div><div className="review-mode"><button aria-pressed={reviewMode === 'bulk'} onClick={() => setReviewMode('bulk')}>整份校正</button><button aria-pressed={reviewMode === 'lines'} onClick={() => setReviewMode('lines')}>逐行與時間校稿</button></div>{reviewMode === 'lines' ? <LyricEditor lines={track.lyrics} duration={track.duration} offset={track.lyricOffset} time={time} explicitEnds={track.kind === 'mv'} disabled={locked} onChange={lyrics => patch({ lyrics })} onSeek={value => { if (media.current) { media.current.currentTime = Math.max(0, value); setTime(Math.max(0, value)); } }}/> : <LyricsWorkbench initialInput={track.lyrics.length ? track.kind === 'mv' ? serializeSRT(track.lyrics) : serializeLRC(track.lyrics) : track.untimedLyrics ?? ''} format={track.kind === 'mv' ? 'srt' : 'lrc'} duration={track.duration} name={`${track.artist} - ${track.title}`} report={report} onApply={lyrics => { patch({ lyrics }); setCorrection(false); }}/>}</div></div>}
  </div>;
}
