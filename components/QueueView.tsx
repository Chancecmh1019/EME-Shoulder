import React from 'react';
import { trackStatus, type TrackProject } from '../types';
import { LibraryStore } from '../services/library';
import { ProductionQueue } from '../services/queue';
import { deleteMedia, download, getMedia } from '../services/storage';
export function QueueView({ store, queue, report }: { store: LibraryStore; queue: ProductionQueue; report: (message: string) => void }) {
  const tracks = [...store.data.albums.flatMap(a => a.tracks), ...store.data.mv].filter(t => t.render !== 'idle' || t.publish !== 'idle');
  const run = (action: () => Promise<unknown>) => { void action().catch(e => report(e.message)); };
  return <main className="page queue-page"><small>PRODUCTION / QUEUE</small><h1>留一個肩膀，給正在完成的歌。</h1><p className="lede">一首渲染，一首上傳。已完成的 MP4 會保留，失敗後可直接重試。</p>
    {!tracks.length && <div className="empty">完成曲目校稿後，工作會出現在這裡。</div>}
    {tracks.map(t => <article key={t.id} className="queue-row"><div><small>{t.kind === 'mv' ? 'MV' : t.album}</small><h2>{t.title}</h2><p>{t.artist}</p><span className="status-pill">{trackStatus(t)}</span></div><div className="queue-progress"><label>Render · {t.render} · {Math.round(t.renderProgress)}%<progress max="100" value={t.renderProgress}/></label><label>Publish · {t.publish} · {Math.round(t.uploadProgress)}%<progress max="100" value={t.uploadProgress}/></label>{t.youtubeId && t.publish !== 'completed' && <p className="caption">YouTube 已收到影片，正在完成縮圖。</p>}{t.error && <p className="error" role="alert">{t.error}</p>}</div><div className="queue-actions">
      {['pending', 'running'].includes(t.render) || ['pending', 'running'].includes(t.publish) ? <button onClick={() => run(() => queue.cancel(t.id))}>取消</button> : null}
      {(t.render === 'error' || t.render === 'cancelled' || t.publish === 'error' || t.publish === 'cancelled') && <button className="primary" onClick={() => run(() => queue.retry(t.id))}>重試 {t.outputKey ? '上傳' : '渲染'}</button>}
      {t.outputKey && <button onClick={() => run(async () => { const blob = await getMedia(t.outputKey!); if (!blob) throw new Error('MP4 已不存在'); download(blob, `${t.artist} - ${t.title}.mp4`); })}>Download MP4</button>}
      {t.outputKey && t.render === 'completed' && t.publish === 'idle' && <button onClick={() => run(() => queue.upload(t.id))}>上傳已匯出的影片</button>}
      {t.youtubeId && <a className="button" href={`https://studio.youtube.com/video/${encodeURIComponent(t.youtubeId)}/edit`} target="_blank" rel="noreferrer">YouTube Studio ↗</a>}
      {t.outputKey && t.publish === 'completed' && <button onClick={() => run(async () => { await deleteMedia(t.outputKey!); await store.patchTrack(t.id, { outputKey: undefined }); })}>釋放本機 MP4</button>}
    </div></article>)}
  </main>;
}
