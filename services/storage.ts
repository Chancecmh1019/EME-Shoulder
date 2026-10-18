import { defaultVisual, emptyLibrary, type Library, type SongMetadata } from '../types';
let dbPromise: Promise<IDBDatabase> | undefined;
function database() {
  return dbPromise ??= new Promise<IDBDatabase>((resolve, reject) => {
    const req = indexedDB.open('eme-shoulder', 1);
    req.onupgradeneeded = () => { req.result.createObjectStore('state'); req.result.createObjectStore('media'); };
    req.onsuccess = () => resolve(req.result); req.onerror = () => reject(req.error);
  });
}
async function operation<T>(store: string, mode: IDBTransactionMode, action: (s: IDBObjectStore) => IDBRequest): Promise<T> {
  const db = await database();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(store, mode); const req = action(tx.objectStore(store));
    tx.oncomplete = () => resolve(req.result as T); tx.onerror = () => reject(tx.error); tx.onabort = () => reject(tx.error ?? new Error('Storage transaction aborted'));
  });
}
export const putMedia = (key: string, blob: Blob) => operation<void>('media', 'readwrite', s => s.put(blob, key));
export const getMedia = (key: string) => operation<Blob | undefined>('media', 'readonly', s => s.get(key));
export const deleteMedia = (key: string) => operation<void>('media', 'readwrite', s => s.delete(key));
export const saveLibrary = (data: Library) => operation<void>('state', 'readwrite', s => s.put(data, 'library'));
export async function loadLibrary(): Promise<Library> {
  const library = await operation<Library | undefined>('state', 'readonly', s => s.get('library')) ?? emptyLibrary();
  library.renderJobs ??= [];
  for (const album of library.albums) album.visual.fps = 60;
  for (const t of [...library.albums.flatMap(a => a.tracks), ...library.mv]) {
    if (t.render === 'running') { t.render = 'pending'; t.renderProgress = 0; t.error = undefined; t.errorStage = undefined; }
    if (t.publish === 'running') { t.publish = 'pending'; t.error = undefined; t.errorStage = undefined; }
    if (t.threads?.analysis === 'running') { t.threads.analysis = 'cancelled'; t.threads.error = '分析已中斷，可重新尋找片段。'; }
    if (t.threads?.render === 'running') { t.threads.render = 'pending'; t.threads.renderProgress = 0; t.threads.error = undefined; }
    if (t.render !== 'idle' && !library.renderJobs.some(j => j.trackId === t.id && j.kind !== 'THREADS_CLIP')) {
      const album = library.albums.find(a => a.tracks.some(x => x.id === t.id));
      library.renderJobs.push({ id: crypto.randomUUID(), trackId: t.id, kind: t.kind === 'mv' ? 'MV_MASTER' : 'ALBUM_MASTER', enqueuedAt: t.approvedAt ?? 0, state: t.render, progress: t.renderProgress, snapshot: t.render === 'completed' ? undefined : structuredClone(t), album: { id: album?.id ?? t.id, artworkKey: album?.artworkKey ?? t.artworkKey, visual: album?.visual ?? defaultVisual }, outputKey: t.outputKey, error: t.errorStage === 'render' ? t.error : undefined });
    }
  }
  for (const job of library.renderJobs) if (job.state === 'running') { job.state = 'pending'; job.progress = 0; job.error = undefined; }
  // Never skip an interrupted job and immediately start its successors.
  // Keep original FIFO timestamps and resumable-upload URLs intact.
  if (library.renderJobs.some(j => j.state === 'pending') || [...library.albums.flatMap(a => a.tracks), ...library.mv].some(t => t.publish === 'pending')) library.queuePaused = true;
  return library;
}
export function download(blob: Blob, name: string) {
  const url = URL.createObjectURL(blob); const a = document.createElement('a'); a.href = url; a.download = safeFilename(name); a.style.display = 'none'; document.body.appendChild(a);
  try { a.click(); } finally { a.remove(); setTimeout(() => URL.revokeObjectURL(url), 60000); }
}
export const safeFilename = (name: string) => name.replace(/[<>:"/\\|?*\x00-\x1f]/g, '_').replace(/[. ]+$/g, '').slice(0, 180) || 'EMBRASEA.mp4';
export const threadsFilename = (track: Pick<SongMetadata, 'artist' | 'title'>) => safeFilename(`${track.artist} - ${track.title} - EMBRASEA Threads Clip.mp4`);
