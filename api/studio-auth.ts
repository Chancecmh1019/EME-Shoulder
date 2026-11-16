import { cloudRuntime } from '../server/studio/runtime.ts';
import { authHandler } from '../server/studio/auth-http.ts';
import { StudioError } from '../studio/lrc.ts';
export default async function handler(req: any, res: any) {
  res.setHeader('Cache-Control', 'no-store');
  try {
    const { config, sessions } = cloudRuntime();
    return await authHandler({ sessions, origin: config.origin, supabase: config.supabase, authKey: config.authKey })(req, res);
  } catch (e) { return res.status(e instanceof StudioError ? e.status : 503).json({ code: e instanceof StudioError ? e.code : 'STAGING_UNAVAILABLE', error: 'Studio Staging 登入尚未設定或暫時無法使用。' }); }
}
