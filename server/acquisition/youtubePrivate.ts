import { open } from 'node:fs/promises';
export interface PrivateUploadState { jobId: string; videoSha256: string; bytes: number; uploadUrl?: string; offset: number; videoId?: string; thumbnailSet?: boolean }
export type AuthorizedRequest = (url: string, init?: RequestInit) => Promise<Response>;
function sessionUrl(raw: string) {
  const url = new URL(raw);
  if (url.protocol !== 'https:' || url.hostname !== 'www.googleapis.com' || url.pathname !== '/upload/youtube/v3/videos' || !url.searchParams.get('upload_id') || url.username || url.password) throw new Error('INVALID_GOOGLE_UPLOAD_SESSION');
  return url.href;
}
function offset(response: Response, bytes: number) {
  const raw = response.headers.get('Range');
  const value = raw ? Number(/^bytes=0-(\d+)$/.exec(raw)?.[1]) + 1 : 0;
  if (!Number.isSafeInteger(value) || value < 0 || value > bytes) throw new Error('INVALID_GOOGLE_RANGE');
  return value;
}
/** Dedicated worker protocol. Credentials are provided only through a private process callback. */
export class PrivateYouTube {
  constructor(private request: AuthorizedRequest) {}
  async upload(path: string, title: string, description: string, state: PrivateUploadState, save: (state: PrivateUploadState) => Promise<void>) {
    if (!Number.isSafeInteger(state.bytes) || state.bytes <= 0 || [...title].length > 100 || !title.trim() || Buffer.byteLength(description) > 5000 || /[<>]/.test(title + description)) throw new Error('INVALID_PRIVATE_UPLOAD');
    if (state.videoId) return state.videoId;
    const recover = async () => {
      const response = await this.request(sessionUrl(state.uploadUrl!), { method: 'PUT', headers: { 'Content-Range': `bytes */${state.bytes}`, 'Content-Length': '0' } });
      if (response.status === 308) state.offset = offset(response, state.bytes);
      else if (response.ok) { const value = await response.json(); if (!/^[A-Za-z0-9_-]{11}$/.test(value.id)) throw new Error('UPLOAD_SUCCESS_WITHOUT_VIDEO_ID'); state.videoId = value.id; state.offset = state.bytes; }
      else if ([404, 410].includes(response.status)) throw new Error('SESSION_EXPIRED_RECONCILE_BEFORE_NEW_UPLOAD');
      else throw new Error(`UPLOAD_STATUS_HTTP_${response.status}`);
      await save(state);
    };
    if (state.uploadUrl) await recover();
    if (!state.uploadUrl && !state.videoId) {
      const response = await this.request('https://www.googleapis.com/upload/youtube/v3/videos?uploadType=resumable&part=snippet,status', { method: 'POST', headers: { 'Content-Type': 'application/json', 'X-Upload-Content-Type': 'video/mp4', 'X-Upload-Content-Length': String(state.bytes) }, body: JSON.stringify({ snippet: { title, description, categoryId: '10' }, status: { privacyStatus: 'private', selfDeclaredMadeForKids: false } }) });
      if (!response.ok) throw new Error(`PRIVATE_SESSION_HTTP_${response.status}`);
      state.uploadUrl = sessionUrl(response.headers.get('Location') ?? ''); state.offset = 0; await save(state);
    }
    const handle = await open(path, 'r'); let failures = 0;
    try {
      while (!state.videoId && state.offset < state.bytes) {
        const start = state.offset, bytes = Buffer.alloc(Math.min(8 * 1024 * 1024, state.bytes - start));
        const read = await handle.read(bytes, 0, bytes.length, start);
        if (read.bytesRead !== bytes.length) throw new Error('VIDEO_FILE_TRUNCATED');
        try {
          const response = await this.request(sessionUrl(state.uploadUrl!), { method: 'PUT', headers: { 'Content-Type': 'video/mp4', 'Content-Range': `bytes ${start}-${start + bytes.length - 1}/${state.bytes}` }, body: new Uint8Array(bytes) });
          if (response.status === 308) { const next = offset(response, state.bytes); if (next <= start) throw new Error('UPLOAD_NO_FORWARD_PROGRESS'); state.offset = next; }
          else if (response.ok) { const value = await response.json(); if (!/^[A-Za-z0-9_-]{11}$/.test(value.id)) throw new Error('UPLOAD_SUCCESS_WITHOUT_VIDEO_ID'); state.videoId = value.id; state.offset = state.bytes; }
          else throw new Error(`UPLOAD_HTTP_${response.status}`);
          failures = 0; await save(state);
        } catch (error) {
          if (++failures > 3) throw error;
          // Probe the same session after an ambiguous response. Never create a second upload.
          await recover();
        }
      }
    } finally { await handle.close(); }
    if (!state.videoId) { await recover(); if (!state.videoId) throw new Error('UPLOAD_ID_UNCONFIRMED'); }
    return state.videoId!;
  }
  async thumbnail(videoId: string, bytes: Uint8Array) {
    if (!/^[A-Za-z0-9_-]{11}$/.test(videoId) || !bytes.length || bytes.length > 2 * 1024 * 1024) throw new Error('INVALID_THUMBNAIL');
    const response = await this.request(`https://www.googleapis.com/upload/youtube/v3/thumbnails/set?videoId=${videoId}&uploadType=media`, { method: 'POST', headers: { 'Content-Type': 'image/jpeg' }, body: bytes as BodyInit });
    if (!response.ok) throw new Error(`THUMBNAIL_HTTP_${response.status}`);
    if (!(await response.json()).items?.length) throw new Error('THUMBNAIL_NOT_CONFIRMED');
  }
  async status(videoId: string) {
    if (!/^[A-Za-z0-9_-]{11}$/.test(videoId)) throw new Error('INVALID_VIDEO_ID');
    const response = await this.request(`https://www.googleapis.com/youtube/v3/videos?part=status,processingDetails&id=${videoId}`);
    if (!response.ok) throw new Error(`VIDEO_VERIFY_HTTP_${response.status}`);
    const video = (await response.json()).items?.[0];
    if (!video || video.id !== videoId) throw new Error('VIDEO_NOT_FOUND');
    if (video.status?.privacyStatus !== 'private') throw new Error('VIDEO_NOT_PRIVATE');
    const processingStatus = video.processingDetails?.processingStatus, uploadStatus = video.status?.uploadStatus;
    if (['failed', 'terminated'].includes(processingStatus) || ['failed', 'rejected', 'deleted'].includes(uploadStatus)) throw new Error('YOUTUBE_PROCESSING_FAILED');
    return { videoId, privacyStatus: 'private', processingStatus, uploadStatus, complete: processingStatus === 'succeeded' && uploadStatus === 'processed' };
  }
}
