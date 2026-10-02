import { emptyLibrary, type Library } from '../types';
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
  for (const album of library.albums) album.visual.fps = 60;
  for (const t of [...library.albums.flatMap(a => a.tracks), ...library.mv]) {
    if (t.render === 'running' || t.render === 'pending') { t.render = 'error'; t.error = '渲染已中斷。請重試。'; t.errorStage = 'render'; }
    if (t.publish === 'running' || t.publish === 'pending') { t.publish = 'error'; t.error = '上傳已中斷。可從已保存的 MP4 重試。'; t.errorStage = 'publish'; }
  }
  return library;
}
export function download(blob: Blob, name: string) {
  const url = URL.createObjectURL(blob); const a = document.createElement('a'); a.href = url; a.download = name; a.click(); setTimeout(() => URL.revokeObjectURL(url), 10000);
}
