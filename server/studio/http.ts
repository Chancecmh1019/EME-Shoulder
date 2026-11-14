import { StudioError } from '../../studio/lrc.ts';
import type { StudioRepository } from './repository.ts';

interface Dependencies {
  owner(req: any): string;
  origin(): string;
  repository(): StudioRepository;
}
/** All actions are owner-scoped; cookie mutations require same-origin non-simple requests. */
export function studioHandler(deps: Dependencies) {
  return async (req: any, res: any) => {
    res.setHeader('Cache-Control', 'no-store');
    res.setHeader('X-Content-Type-Options', 'nosniff');
    try {
      let owner: string;
      try { owner = deps.owner(req); } catch { throw new StudioError('AUTH_REQUIRED', 401, '請先由擁有者登入。'); }
      if (!owner) throw new StudioError('AUTH_REQUIRED', 401);
      if (!['GET', 'POST'].includes(req.method)) throw new StudioError('METHOD_NOT_ALLOWED', 405);
      if (req.method === 'POST' && (req.headers.origin !== deps.origin() || req.headers['x-eme-request'] !== '1' || String(req.headers['content-type'] ?? '').split(';')[0].trim().toLowerCase() !== 'application/json')) throw new StudioError('ORIGIN_REJECTED', 403);
      const action = req.query?.action, id = req.query?.id;
      if (typeof action !== 'string' || (id !== undefined && (typeof id !== 'string' || id.length > 100))) throw new StudioError('INVALID_REQUEST', 400);
      if (Buffer.byteLength(JSON.stringify(req.body ?? {})) > 200000) throw new StudioError('REQUEST_TOO_LARGE', 413);
      const repo = deps.repository();
      const requestKey = req.headers['idempotency-key'];
      if (req.method === 'GET') {
        if (action === 'jobs') return res.json({ jobs: repo.list(owner) });
        if (action === 'job' && id) return res.json(repo.job(owner, id));
        if (action === 'package' && id) return res.json(repo.package(owner, id));
        if (action === 'result' && id) return res.json(repo.result(owner, id));
      } else {
        repo.rateLimit(owner);
        if (action === 'create') return res.status(201).json(repo.create(owner, requestKey, req.body));
        if (action === 'source' && id) return res.json(repo.replaceSource(owner, id, req.body?.sourceRevision, req.body?.sourceLrc));
        if (action === 'translation' && id) return res.json(repo.submit(owner, id, requestKey, req.body));
        if (action === 'cancel' && id) return res.json(repo.cancel(owner, id));
        if (action === 'claim' && id) return res.json(repo.claim(owner, id, req.body?.worker));
        if (action === 'heartbeat' && id && typeof req.body?.token === 'string') return res.json(repo.heartbeat(owner, id, req.body.token));
      }
      throw new StudioError('NOT_FOUND', 404);
    } catch (e) {
      if (e instanceof StudioError) return res.status(e.status).json({ code: e.code, error: e.message });
      // Do not leak SQL, paths, provider responses, credentials or stack traces.
      return res.status(503).json({ code: 'STUDIO_UNAVAILABLE', error: 'Studio 服務尚未設定或暫時無法使用。' });
    }
  };
}
