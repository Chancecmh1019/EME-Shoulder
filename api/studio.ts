import { config, session } from './_security.js';
import { studioHandler } from '../server/studio/http.ts';
import { StudioError } from '../studio/lrc.ts';
import type { StudioRepository } from '../server/studio/repository.ts';
import { cloudRuntime } from '../server/studio/runtime.ts';
import { ScopedRepository } from '../server/studio/scoped.ts';

let repository: StudioRepository | undefined;
export default async function handler(req: any, res: any) {
  if (process.env.EME_DEPLOYMENT === 'staging' || process.env.VERCEL) {
    res.setHeader('Cache-Control', 'no-store');
    try {
      const { config: cloud, sessions, repository: postgres } = cloudRuntime();
      return await studioHandler({
        owner: async r => { r.studioPrincipal = await sessions.authenticate(r); return r.studioPrincipal.owner; },
        origin: () => cloud.origin,
        repository: r => new ScopedRepository(postgres, r.studioPrincipal),
      })(req, res);
    } catch (e) { return res.status(e instanceof StudioError ? e.status : 503).json({ code: e instanceof StudioError ? e.code : 'STAGING_UNAVAILABLE', error: 'Studio Staging 尚未設定或暫時無法使用。' }); }
  }
  // Do not even import node:sqlite on a serverless deployment.
  const run = studioHandler({
    owner: r => session(r).email,
    origin: () => config().origin,
    repository: () => {
      if (!repository) throw new StudioError('STORAGE_NOT_CONFIGURED', 503, '尚未啟用 Studio 持久化服務。');
      return repository;
    },
  });
  if (process.env.EME_STUDIO_LOCAL_DB && !process.env.VERCEL && process.env.NODE_ENV !== 'production') {
    try {
      if (!repository) {
        const { StudioRepository: LocalRepository } = await import('../server/studio/repository.ts');
        repository = new LocalRepository(process.env.EME_STUDIO_LOCAL_DB);
      }
    } catch { /* Handler returns a safe unavailable response. */ }
  }
  return run(req, res);
}
