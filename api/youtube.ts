import { accessToken, headers, mutation, uploadUrl } from './_security';
export default async function handler(req: any, res: any) {
  headers(res);
  try {
    mutation(req); const token = await accessToken(req, res); const authorization = { Authorization: `Bearer ${token}` };
    if (req.query.action === 'session') {
      const { title, description, privacy, size } = req.body;
      if (typeof title !== 'string' || !title.trim() || [...title].length > 100 || typeof description !== 'string' || Buffer.byteLength(description) > 5000 || /[<>]/.test(title + description) || !['private', 'unlisted', 'public'].includes(privacy) || !Number.isSafeInteger(size) || size <= 0) throw new Error('Invalid publishing metadata');
      const r = await fetch('https://www.googleapis.com/upload/youtube/v3/videos?uploadType=resumable&part=snippet,status', { method: 'POST', headers: { ...authorization, 'Content-Type': 'application/json', 'X-Upload-Content-Type': 'video/mp4', 'X-Upload-Content-Length': String(size) }, body: JSON.stringify({ snippet: { title, description, categoryId: '10' }, status: { privacyStatus: privacy, selfDeclaredMadeForKids: false } }) });
      if (!r.ok) throw new Error(`YouTube session failed (${r.status})`);
      const url = r.headers.get('Location'); if (!url) throw new Error('Missing resumable upload URL'); return res.json({ url: uploadUrl(url) });
    }
    if (req.query.action === 'status') {
      const size = Number(req.body.size); if (!Number.isSafeInteger(size) || size <= 0) throw new Error('Invalid media size');
      const r = await fetch(uploadUrl(req.body.url), { method: 'PUT', headers: { ...authorization, 'Content-Range': `bytes */${size}`, 'Content-Length': '0' }, redirect: 'manual' });
      if (r.status === 308) return res.json({ bytes: Number(r.headers.get('Range')?.match(/-(\d+)$/)?.[1] ?? -1) + 1 });
      if (r.status === 404 || r.status === 410) return res.json({ expired: true });
      if (!r.ok) throw new Error(`Upload recovery failed (${r.status})`);
      const video = await r.json(); return res.json({ id: video.id, bytes: size });
    }
    res.status(404).json({ error: 'Unknown action' });
  } catch (e) { res.status(400).json({ error: e instanceof Error ? e.message : 'YouTube request failed' }); }
}
