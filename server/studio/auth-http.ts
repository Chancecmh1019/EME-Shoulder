import { StudioError } from '../../studio/lrc.ts';
import { Sessions, getCookie, setSessionCookie, token, digest, SESSION_COOKIE, DEVICE_COOKIE, LOGIN_COOKIE } from './sessions.ts';

export function authHandler(deps: { sessions: Sessions; origin: string; supabase: string; authKey: string; fetch?: typeof fetch }) {
  const { sessions: s } = deps, send = deps.fetch ?? fetch;
  async function authRequest(path: string, body: unknown) {
    const response = await send(`${deps.supabase}/auth/v1/${path}`, { method: 'POST', redirect: 'error', signal: AbortSignal.timeout(10000), headers: { apikey: deps.authKey, 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
    if (!response.ok) throw new StudioError('OTP_FAILED', 401, '驗證碼無效、已過期或寄送受限，請稍後重試。');
    return response.json();
  }
  return async (req: any, res: any) => {
    res.setHeader('Cache-Control', 'no-store'); res.setHeader('X-Content-Type-Options', 'nosniff');
    try {
      if (req.method !== 'GET' && req.method !== 'POST') throw new StudioError('METHOD_NOT_ALLOWED', 405);
      if (req.method === 'POST' && (req.headers.origin !== deps.origin || req.headers['x-eme-request'] !== '1' || String(req.headers['content-type']).split(';')[0] !== 'application/json')) throw new StudioError('ORIGIN_REJECTED', 403);
      if (Buffer.byteLength(JSON.stringify(req.body ?? {})) > 4096) throw new StudioError('REQUEST_TOO_LARGE', 413);
      const action = req.query?.action;
      if (req.method === 'GET') {
        const p = await s.authenticate(req);
        if (action === 'status') return res.json({ role: p.role, expiresAt: p.expiresAt, persistence: 'POSTGRESQL', deployment: 'staging', release: 'NO_GO', youtube: 'DISABLED' });
        if (action === 'grants' && p.role === 'owner') return res.json({ grants: (await s.db.query('SELECT id,expires_at,revoked_at FROM eme.dot_grants WHERE owner=$1 ORDER BY created_at DESC LIMIT 50', [p.owner])).rows });
        throw new StudioError('SCOPE_DENIED', 403);
      }
      // A global ceiling prevents forwarded-header spoofing from bypassing the budget.
      await s.budget('global', 120);
      await s.budget(digest(String(req.headers['x-forwarded-for'] ?? req.socket?.remoteAddress ?? 'unknown')), 20);
      if (action === 'otp-send') {
        await s.budget('otp-send', 1);
        const raw = token();
        await s.db.query('INSERT INTO eme.login_challenges VALUES($1,$2,0)', [digest(raw), Date.now() + 600000]);
        await authRequest('otp', { email: s.owner, create_user: false });
        setSessionCookie(res, LOGIN_COOKIE, raw, 600);
        return res.json({ sent: true });
      }
      if (action === 'otp-verify') {
        const raw = getCookie(req, LOGIN_COOKIE), code = req.body?.code;
        if (!raw || typeof code !== 'string' || !/^\d{6,8}$/.test(code)) throw new StudioError('INVALID_OTP', 422);
        const challenge = (await s.db.query('UPDATE eme.login_challenges SET attempts=attempts+1 WHERE hash=$1 AND expires_at>$2 AND attempts<5 RETURNING hash', [digest(raw), Date.now()])).rows[0];
        if (!challenge) throw new StudioError('LOGIN_EXPIRED', 401);
        const verified = await authRequest('verify', { type: 'email', email: s.owner, token: code });
        if (verified.user?.email?.toLowerCase() !== s.owner || !verified.user?.email_confirmed_at) throw new StudioError('OWNER_REQUIRED', 403);
        const consumed = await s.db.query('DELETE FROM eme.login_challenges WHERE hash=$1 RETURNING hash', [digest(raw)]);
        if (!consumed.rows.length) throw new StudioError('LOGIN_EXPIRED', 401);
        const session = await s.issue('owner');
        setSessionCookie(res, SESSION_COOKIE, session.raw, 8 * 3600); setSessionCookie(res, LOGIN_COOKIE, '', 0);
        return res.json({ role: 'owner', expiresAt: session.expiresAt });
      }
      if (action === 'device-start') {
        const pair = await s.startDevice();
        setSessionCookie(res, DEVICE_COOKIE, pair.raw, 600);
        return res.json({ code: pair.code, expiresAt: pair.expiresAt });
      }
      if (action === 'device-finish') {
        const session = await s.finishDevice(getCookie(req, DEVICE_COOKIE));
        setSessionCookie(res, SESSION_COOKIE, session.raw, 2 * 3600); setSessionCookie(res, DEVICE_COOKIE, '', 0);
        return res.json({ role: 'dot', expiresAt: session.expiresAt });
      }
      const p = await s.authenticate(req);
      if (action === 'logout') {
        await s.db.query('UPDATE eme.sessions SET revoked_at=$1 WHERE token_hash=$2', [Date.now(), digest(getCookie(req, SESSION_COOKIE)!)]);
        setSessionCookie(res, SESSION_COOKIE, '', 0); return res.json({ loggedOut: true });
      }
      if (p.role !== 'owner') throw new StudioError('SCOPE_DENIED', 403);
      if (action === 'approve') return res.json(await s.approve(req.body?.code));
      if (action === 'revoke') return res.json(await s.revoke(req.body?.grantId));
      throw new StudioError('NOT_FOUND', 404);
    } catch (e) {
      if (e instanceof StudioError) return res.status(e.status).json({ code: e.code, error: e.message });
      return res.status(503).json({ code: 'AUTH_UNAVAILABLE', error: '登入服務尚未設定或暫時無法使用。' });
    }
  };
}
