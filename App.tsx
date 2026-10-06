import React, { lazy, Suspense, useEffect, useRef, useState, useSyncExternalStore } from 'react';
import { LibraryStore } from './services/library';
import { ProductionQueue } from './services/queue';
import { importAlbum } from './services/importAlbum';
import { AlbumIdentity } from './components/AlbumIdentity';
import { id, parseSRT } from './utils/parsers';
import { trackStatus, type TrackProject } from './types';
import { putMedia } from './services/storage';
import './index.css';
const Workspace = lazy(() => import('./components/Workspace').then(m => ({ default: m.Workspace })));
const QueueView = lazy(() => import('./components/QueueView').then(m => ({ default: m.QueueView })));
const LrcLab = lazy(() => import('./components/LrcLab').then(m => ({ default: m.LrcLab })));
const Settings = lazy(() => import('./components/Settings').then(m => ({ default: m.Settings })));
const hot = (import.meta as ImportMeta & { hot?: { data: Record<string, any>; dispose(fn: (data: Record<string, any>) => void): void } }).hot;
const store: LibraryStore = hot?.data.store ?? new LibraryStore();
hot?.dispose(data => { data.store = store; });
type Page = 'home' | 'album' | 'mv' | 'lab' | 'queue' | 'settings';
const pages: { id: Page; label: string }[] = [{ id: 'home', label: 'Shoulder' }, { id: 'album', label: 'Album Workspace' }, { id: 'mv', label: 'MV Subtitle' }, { id: 'queue', label: 'Queue' }, { id: 'settings', label: 'Settings' }];
function currentPage(): Page { const value = location.hash.replace('#/', ''); return value !== 'lab' && pages.some(p => p.id === value) ? value as Page : 'home'; }
export default function App() {
  const library = useSyncExternalStore(store.subscribe, store.snapshot), [ready, setReady] = useState(false), [page, setPage] = useState<Page>(currentPage), [albumId, setAlbumId] = useState(''), [trackId, setTrackId] = useState(''), [mvId, setMvId] = useState(''), [message, setMessage] = useState(''), [busy, setBusy] = useState(''), [labOpen, setLabOpen] = useState(location.hash === '#/lab');
  const queueRef = useRef<ProductionQueue>(null), importer = useRef<HTMLInputElement>(null), mvImporter = useRef<HTMLInputElement>(null);
  const report = (text: string) => setMessage(text);
  useEffect(() => { if (!labOpen) return; const previous = document.body.style.overflow; document.body.style.overflow = 'hidden'; return () => { document.body.style.overflow = previous; }; }, [labOpen]);
  useEffect(() => { let alive = true; void store.load().then(() => { if (!alive) return; queueRef.current = new ProductionQueue(store); setAlbumId(store.data.lastAlbumId ?? ''); setTrackId(store.data.lastTrackId ?? ''); setReady(true); }).catch(e => report(`無法開啟本機資料庫：${e.message}`)); const onHash = () => { if (location.hash === '#/lab') setLabOpen(true); else setPage(currentPage()); }; window.addEventListener('hashchange', onHash); return () => { alive = false; queueRef.current?.dispose(); window.removeEventListener('hashchange', onHash); }; }, []);
  const navigate = (p: Page) => { location.hash = `/${p}`; setPage(p); };
  const select = (a: string, t?: string) => { setAlbumId(a); setTrackId(t ?? ''); void store.change(d => { d.lastAlbumId = a; d.lastTrackId = t; }).catch(e => report(e.message)); };
  const album = library.albums.find(a => a.id === albumId) ?? library.albums[0]; const track = album?.tracks.find(t => t.id === trackId) ?? album?.tracks[0]; const mv = library.mv.find(t => t.id === mvId) ?? library.mv[0];
  const importFiles = async (files: File[]) => {
    setMessage(''); setBusy('準備音訊…');
    try { const result = await importAlbum(files, setBusy); await store.change(d => { d.albums.push(...result.albums); }); if (result.albums[0]) { select(result.albums[0].id, result.albums[0].tracks[0]?.id); navigate('album'); } if (result.errors.length) report(result.errors.join('\n')); }
    catch (e) { report(e instanceof Error ? e.message : String(e)); } finally { setBusy(''); }
  };
  const importMv = async (file: File) => {
    setBusy('讀取 MV…'); let url: string | undefined;
    try {
      if (!/\.mp4$/i.test(file.name)) throw new Error('請選擇 MP4 影片。');
      const video = document.createElement('video'); url = URL.createObjectURL(file); video.src = url; video.preload = 'metadata';
      await new Promise<void>((resolve, reject) => { const timer = setTimeout(() => reject(new Error('影片讀取逾時')), 15000); video.onloadedmetadata = () => { clearTimeout(timer); resolve(); }; video.onerror = () => { clearTimeout(timer); reject(new Error('瀏覽器無法讀取這個 MP4')); }; });
      const duration = video.duration; video.removeAttribute('src'); video.load(); if (!Number.isFinite(duration) || duration <= 0) throw new Error('影片時長無效');
      const key = id(); await putMedia(`${key}/source`, file);
      const t: TrackProject = { id: key, kind: 'mv', importOrder: library.mv.length, sourceKey: `${key}/source`, audioKey: `${key}/source`, title: file.name.replace(/\.mp4$/i, ''), artist: '', album: '', albumArtist: '', duration, lyrics: [], lyricOffset: 0, review: 'needs-lyrics', render: 'idle', publish: 'idle', renderProgress: 0, uploadProgress: 0, thumbnailSeed: 0, privacy: 'private' };
      await store.change(d => { d.mv.push(t); }); setMvId(key); navigate('mv');
    } catch (e) { report(e instanceof Error ? e.message : String(e)); } finally { if (url) URL.revokeObjectURL(url); setBusy(''); }
  };
  const allTracks = [...library.albums.flatMap(a => a.tracks), ...library.mv]; const active = allTracks.filter(t => t.render === 'running' || t.publish === 'running' || t.threads?.render === 'running');
  return <div className="app-shell"><header className="app-header"><a className="brand" href="#/home"><img className="brand-logo" src="/logo.svg" width="45" height="45" alt="EME Shoulder 標誌"/><span>EME Shoulder<small>by EMBRASEA Music Entertainment</small></span></a><nav aria-label="主導覽">{pages.map(p => <a key={p.id} href={`#/${p.id}`} aria-haspopup={p.id === 'lab' ? 'dialog' : undefined} onClick={e => { if (p.id === 'lab') { e.preventDefault(); setLabOpen(true); } }} aria-current={page === p.id ? 'page' : undefined}>{p.label}{p.id === 'queue' && active.length > 0 && <span className="queue-dot"/>}</a>)}</nav><span className="header-note">A little room for music.</span></header>
    <input className="hidden" ref={importer} type="file" multiple accept="audio/*,.m4a,.flac,.opus,.aiff,.ape" onChange={e => { void importFiles(Array.from(e.target.files ?? [])); e.target.value = ''; }}/><input className="hidden" ref={mvImporter} type="file" accept=".mp4" onChange={e => { if (e.target.files?.[0]) void importMv(e.target.files[0]); e.target.value = ''; }}/>
    {message && <div className="notice" role="status"><span>{message}</span><button aria-label="關閉訊息" onClick={() => setMessage('')}>×</button></div>}
    {!ready ? <main className="page"><p>正在開啟 Shoulder…</p></main> : <Suspense fallback={<main className="page">正在開啟工作區…</main>}>
      {page === 'home' && <main className="home"><section className="home-intro"><div><small className="eyebrow">EMBRASEA MUSIC ENTERTAINMENT / PRODUCTION STUDIO</small><h1>A shoulder.<br/><em>For your music.</em></h1><p className="home-copy">把反覆的工作交給肩膀。<br/>把心力，留給音樂抵達的地方。</p><div className="home-actions"><button className="primary" onClick={() => setLabOpen(true)}>Prepare / Correct Lyrics <span>↗</span></button><button onClick={() => importer.current?.click()}>Import Album <span>↗</span></button><button onClick={() => mvImporter.current?.click()}>Subtitle an MV <span>↗</span></button></div></div><div className="home-art" aria-hidden="true"><svg viewBox="0 0 600 500"><defs><linearGradient id="sea" x2="0" y2="1"><stop stopColor="#c7d0c7"/><stop offset=".6" stopColor="#9dafa9"/><stop offset="1" stopColor="#506c70"/></linearGradient></defs><rect width="600" height="500" fill="url(#sea)"/>{Array.from({ length: 18 }, (_, i) => <path key={i} d={`M -30 ${250 + i * 16} C 130 ${230 + i * 17}, 330 ${280 + i * 14}, 630 ${235 + i * 17}`} stroke="#e0e5dc" strokeWidth="1" opacity={.15 + i * .015} fill="none"/>)}</svg><div className="art-caption"><span>EMBRACE + SEA</span><p>Let it arrive.<br/>Let it move.</p><small>01 / A QUIETER WAY TO MAKE</small></div></div></section>
        <section className="recent"><div className="recent-heading"><div><small>YOUR COLLECTION</small><h2>Recent Albums</h2></div><button onClick={() => importer.current?.click()}>＋ 匯入專輯</button></div>{!library.albums.length ? <div className="first-album"><p>從一張專輯開始。</p><span>封面、曲序與內嵌歌詞，會一起進入工作區。</span></div> : <div className="album-grid">{[...library.albums].sort((a, b) => b.updatedAt - a.updatedAt).map(a => <button className="album-card" key={a.id} onClick={() => { select(a.id); navigate('album'); }}><AlbumIdentity album={a}/><span className="album-date">{new Date(a.updatedAt).toLocaleDateString('zh-TW')} · 開啟專輯 ↗</span></button>)}</div>}</section><footer className="home-footer"><span>EME Shoulder</span><span>Embrace what arrives. Let the sea move.</span><span>EMBRASEA / MUSIC ENTERTAINMENT</span></footer>
      </main>}
      {page === 'album' && (album && track ? <><div className="workspace-toolbar"><label>專輯<select value={album.id} onChange={e => select(e.target.value)}>{library.albums.map(a => <option key={a.id} value={a.id}>{a.title} · {a.artist}</option>)}</select></label><button onClick={() => importer.current?.click()}>＋ 匯入專輯</button></div><Workspace key={track.id} album={album} track={track} store={store} queue={queueRef.current!} onSelect={t => select(album.id, t)} onApproved={() => { const index = album.tracks.findIndex(t => t.id === track.id); const following = [...album.tracks.slice(index + 1), ...album.tracks.slice(0, index)].find(t => t.review !== 'approved'); if (following) select(album.id, following.id); else navigate('queue'); }} report={report}/></> : <main className="page empty"><h1>每一張專輯，都有自己的空間。</h1><button className="primary" onClick={() => importer.current?.click()}>Import Album ↗</button></main>)}
      {page === 'mv' && <><div className="workspace-toolbar"><p>MV SUBTITLE / 獨立製作流程</p><button onClick={() => mvImporter.current?.click()}>＋ 匯入 MP4</button></div>{mv ? <Workspace key={mv.id} track={mv} store={store} queue={queueRef.current!} onSelect={setMvId} onApproved={() => navigate('queue')} report={report}/> : <main className="page empty"><h1>為影像，留一句清楚的話。</h1><p>MP4 → SRT → 校稿 → Render & Upload</p><button className="primary" onClick={() => mvImporter.current?.click()}>匯入 MP4 ↗</button></main>}</>}
      {page === 'queue' && <QueueView store={store} queue={queueRef.current!} report={report}/>}{page === 'settings' && <Settings report={report}/>}
    </Suspense>}
    {labOpen && ready && <div className="correction-modal lab-modal" role="dialog" aria-modal="true" aria-label="LRC Lab 歌詞校正彈窗" onKeyDown={e => { if (e.key === 'Escape') setLabOpen(false); if (e.key === 'Tab') { const items = [...e.currentTarget.querySelectorAll<HTMLElement>('button:not(:disabled), input:not(:disabled), textarea, select, a[href], summary')]; const first = items[0], last = items[items.length - 1]; if (e.shiftKey && document.activeElement === first) { e.preventDefault(); last.focus(); } else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first.focus(); } } }}><div className="correction-dialog lab-dialog"><div className="dialog-top"><small>LRC LAB / 歌詞校正</small><button autoFocus aria-label="關閉 LRC Lab" onClick={() => { setLabOpen(false); if (location.hash === '#/lab') location.hash = '/home'; }}>×</button></div><Suspense fallback={<p>準備歌詞工具…</p>}><LrcLab store={store} report={report}/></Suspense></div></div>}
    {active.length > 0 && <a href="#/queue" className="bottom-queue">{active.map(t => <span key={t.id}>{t.title} · {t.threads?.render === 'running' ? 'Threads Rendering' : trackStatus(t)} · {Math.round(t.render === 'running' ? t.renderProgress : t.threads?.render === 'running' ? t.threads.renderProgress : t.uploadProgress)}%</span>)}<span>檢視 Queue ↗</span></a>}
    {busy && <div className="busy-overlay" role="status" aria-live="polite"><span className="loading-ring"/><h2>{busy}</h2><p>素材留在你的瀏覽器內。</p></div>}
  </div>;
}
