import type { TrackProject } from '../types';
import { videoTitle, videoDescription, validatePublishing } from '../utils/publishing';
import { checkAbort } from './cancellation';
export async function api<T = any>(url: string, body?: unknown): Promise<T> {
  const response = await fetch(url, { method: body === undefined ? 'GET' : 'POST', headers: body === undefined ? {} : { 'Content-Type': 'application/json', 'X-EME-Request': '1' }, body: body === undefined ? undefined : JSON.stringify(body) });
  const text = await response.text(); let data: any;
  try { data = JSON.parse(text); } catch {
    if (response.status >= 500) throw new Error(`上傳 API 伺服器啟動或執行失敗（HTTP ${response.status}）。請查看 Vercel 的 Runtime Logs，修正後重新部署。`);
    throw new Error(`上傳 API 未回傳有效資料（HTTP ${response.status}）。請確認部署包含 /api 函式；本機請使用 npm run dev。`);
  }
  if (!response.ok) throw new Error(data.error || `Request failed (${response.status})`); return data;
}
export async function publishTrack(t: TrackProject, video: Blob, thumbnail: Blob | undefined, update: (patch: Partial<TrackProject>) => Promise<void>, signal: AbortSignal) {
  const issues = validatePublishing(t); if (issues.length) throw new Error(issues.join('；'));
  let youtubeId = t.youtubeId, url = t.uploadUrl, offset = 0;
  let cachedToken: string | undefined, tokenUntil = 0;
  const token = async () => {
    checkAbort(signal);
    if (!cachedToken || Date.now() >= tokenUntil) {
      cachedToken = (await api('/api/auth?action=token', {})).accessToken;
      tokenUntil = Date.now() + 5 * 60000;
    }
    checkAbort(signal); return cachedToken!;
  };
  const authorizedFetch = async (target: string, options: RequestInit) => {
    const send = async () => {
      const headers = new Headers(options.headers); headers.set('Authorization', `Bearer ${await token()}`);
      return fetch(target, { ...options, headers, signal });
    };
    let response = await send();
    // A token can expire earlier than the local cache window. Refresh once,
    // preserving the same resumable session and byte range.
    if (response.status === 401) { cachedToken = undefined; response = await send(); }
    return response;
  };
  const recover = async () => {
    const status = await api('/api/youtube?action=status', { url, size: video.size });
    if (status.expired) { url = undefined; offset = 0; await update({ uploadUrl: undefined, uploadedBytes: 0 }); }
    else { offset = status.bytes; youtubeId = status.id; if (youtubeId) await update({ youtubeId }); }
  };
  if (!youtubeId && url) await recover();
  if (!youtubeId && !url) { checkAbort(signal); const session = await api('/api/youtube?action=session', { title: videoTitle(t), description: videoDescription(t), privacy: t.privacy, size: video.size }); url = session.url; await update({ uploadUrl: url, uploadedBytes: 0 }); }
  let failures = 0;
  while (!youtubeId && offset < video.size) {
    checkAbort(signal); const end = Math.min(offset + 8 * 1024 * 1024, video.size);
    try {
      const r = await authorizedFetch(url!, { method: 'PUT', headers: { 'Content-Type': 'video/mp4', 'Content-Range': `bytes ${offset}-${end - 1}/${video.size}` }, body: video.slice(offset, end) });
      if (r.status === 308) { const range = r.headers.get('Range'); if (range) offset = Number(range.match(/-(\d+)$/)?.[1] ?? -1) + 1; else await recover(); }
      else if (r.ok) { const data = await r.json(); if (!data.id) throw new Error('YouTube did not return a video ID'); youtubeId = data.id; offset = video.size; await update({ youtubeId, uploadUrl: undefined }); }
      else throw new Error(`YouTube upload failed (${r.status})`);
      failures = 0; await update({ uploadedBytes: offset, uploadProgress: offset / video.size * 97 });
    } catch (e) {
      checkAbort(signal); if (++failures > 4) throw e;
      await new Promise(resolve => setTimeout(resolve, Math.min(16000, 1000 * 2 ** failures))); checkAbort(signal); await recover();
      if (!url) throw new Error('上傳工作已到期。重試會重新上傳已保存的 MP4。');
    }
  }
  if (!youtubeId && url) await recover();
  if (!youtubeId) throw new Error('Upload finished without a confirmed video ID. 請重試恢復。');
  await update({ youtubeId, uploadProgress: 98 }); checkAbort(signal);
  if (thumbnail) {
    const r = await authorizedFetch(`https://www.googleapis.com/upload/youtube/v3/thumbnails/set?videoId=${encodeURIComponent(youtubeId)}`, { method: 'POST', headers: { 'Content-Type': 'image/jpeg' }, body: thumbnail });
    if (!r.ok) throw new Error(`影片已上傳，縮圖設定失敗 (${r.status})。重試只會設定縮圖。`);
  }
  await update({ publish: 'completed', uploadProgress: 100, uploadUrl: undefined, error: undefined, errorStage: undefined });
}
