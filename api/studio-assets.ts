import { cloudRuntime } from '../server/studio/runtime.ts';
import { Assets } from '../server/studio/assets.ts';
import { SupabasePrivateObjects } from '../server/studio/objectStorage.ts';
import { StudioError } from '../studio/lrc.ts';
export default async function handler(req: any, res: any) {
  res.setHeader('Cache-Control', 'private, no-store'); res.setHeader('X-Content-Type-Options', 'nosniff');
  try {
    const { config, db, sessions, repository } = cloudRuntime(), principal = await sessions.authenticate(req);
    if (principal.role !== 'owner') throw new StudioError('SCOPE_DENIED', 403);
    const assets = new Assets(db, new SupabasePrivateObjects(config));
    if (req.method === 'POST' && req.query.action === 'put') {
      if (req.headers.origin !== config.origin || req.headers['x-eme-request'] !== '1' || String(req.headers['content-type']).split(';')[0] !== 'application/json') throw new StudioError('ORIGIN_REJECTED', 403);
      await repository.rateLimit(principal.owner);
      const { jobId, kind, base64 } = req.body ?? {};
      if (typeof jobId !== 'string' || typeof kind !== 'string' || typeof base64 !== 'string' || base64.length > 4 * 1024 * 1024 || !/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(base64)) throw new StudioError('INVALID_ASSET', 422);
      return res.json(await assets.put(principal, jobId, kind, Buffer.from(base64, 'base64')));
    }
    if (req.method === 'GET' && req.query.action === 'get' && typeof req.query.id === 'string') {
      const asset = await assets.get(principal, req.query.id);
      res.setHeader('Content-Type', 'application/octet-stream'); res.setHeader('Content-Disposition', 'attachment; filename="eme-private-asset"');
      return res.end(Buffer.from(asset.bytes));
    }
    throw new StudioError('METHOD_NOT_ALLOWED', 405);
  } catch (e) { return res.status(e instanceof StudioError ? e.status : 503).json({ code: e instanceof StudioError ? e.code : 'STORAGE_UNAVAILABLE', error: e instanceof StudioError ? e.message : '私人儲存服務無法使用；沒有將素材標為驗證通過。' }); }
}
