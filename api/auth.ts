import { randomBytes, createHash, timingSafeEqual } from 'node:crypto';
import { config, seal, unseal, cookie, setCookie, headers, mutation, session, accessToken, verifyIdentity } from './_security.js';
export default async function handler(req: any, res: any) {
  headers(res);
  let callbackOrigin: string | undefined;
  try {
    const action = req.query.action; const c = config(); const redirect = `${c.origin}/api/auth?action=callback`;
    callbackOrigin = c.origin;
    if (action === 'start' && req.method === 'GET') {
      const verifier = randomBytes(32).toString('base64url'), state = randomBytes(24).toString('base64url'), nonce = randomBytes(24).toString('base64url');
      setCookie(res, 'eme_oauth', seal({ verifier, state, nonce, expires: Date.now() + 10 * 60000 }), 600);
      const parameters = new URLSearchParams({ client_id: c.clientId, redirect_uri: redirect, response_type: 'code', scope: 'openid email https://www.googleapis.com/auth/youtube.upload https://www.googleapis.com/auth/youtube.readonly', state, nonce, code_challenge: createHash('sha256').update(verifier).digest('base64url'), code_challenge_method: 'S256', access_type: 'offline', prompt: 'consent', login_hint: c.owner });
      return res.redirect(302, `https://accounts.google.com/o/oauth2/v2/auth?${parameters}`);
    }
    if (action === 'callback' && req.method === 'GET') {
      const pending = unseal<{ verifier: string; state: string; nonce: string; expires: number }>(cookie(req, 'eme_oauth'));
      setCookie(res, 'eme_oauth', '', 0); const incoming = Buffer.from(String(req.query.state ?? ''));
      if (!pending || pending.expires < Date.now() || incoming.length !== Buffer.byteLength(pending.state) || !timingSafeEqual(incoming, Buffer.from(pending.state))) throw new Error('授權驗證已失效。請使用正式網站重新連接，並允許網站 Cookie。');
      if (req.query.error || !req.query.code) throw new Error('Google 授權未完成。');
      const r = await fetch('https://oauth2.googleapis.com/token', { method: 'POST', body: new URLSearchParams({ client_id: c.clientId, client_secret: c.clientSecret, code: String(req.query.code), code_verifier: pending.verifier, grant_type: 'authorization_code', redirect_uri: redirect }) });
      const t = await r.json();
      if (!r.ok || !t.access_token || !t.id_token) {
        if (t.error === 'invalid_client') throw new Error('Google OAuth Client ID 與 Client Secret 不相符，請檢查 Vercel 設定後重新部署。');
        if (t.error === 'invalid_grant') throw new Error('Google 授權碼已失效，請重新連接；請確認 Google 回呼網址與正式網站完全一致。');
        throw new Error('Google 授權交換失敗，請重新連接。');
      }
      const email = await verifyIdentity(t.id_token, pending.nonce);
      const scopes = new Set(String(t.scope).split(' '));
      if (!scopes.has('https://www.googleapis.com/auth/youtube.upload') || !scopes.has('https://www.googleapis.com/auth/youtube.readonly')) throw new Error('請授予 YouTube 上傳與頻道讀取權限。');
      setCookie(res, 'eme_session', seal({ email, accessToken: t.access_token, refreshToken: t.refresh_token, expiresAt: Date.now() + t.expires_in * 1000, expires: Date.now() + 30 * 86400000 }), 30 * 86400);
      return res.redirect(302, `${c.origin}/?auth=connected#/settings`);
    }
    if (action === 'status' && req.method === 'GET') {
      let s; try { s = session(req); } catch { return res.json({ configured: true, connected: false, clientId: c.clientId }); }
      if (!s.refreshToken && !s.accessToken) return res.json({ configured: true, connected: false, email: s.email, clientId: c.clientId });
      const token = await accessToken(req, res); const r = await fetch('https://www.googleapis.com/youtube/v3/channels?part=snippet&mine=true', { headers: { Authorization: `Bearer ${token}` } });
      const channel = await r.json(); if (!r.ok) throw new Error('無法讀取 YouTube 頻道。');
      if (!channel.items?.[0]?.id) throw new Error('此 Google 帳號沒有可用的 YouTube 頻道，請先在 YouTube 建立頻道後重新連接。');
      return res.json({ configured: true, connected: true, email: s.email, channel: channel.items?.[0]?.snippet?.title, channelId: channel.items?.[0]?.id, clientId: c.clientId });
    }
    mutation(req);
    if (action === 'identity') { const email = await verifyIdentity(req.body.credential); setCookie(res, 'eme_session', seal({ email, expires: Date.now() + 86400000 }), 86400); return res.json({ email }); }
    if (action === 'token') return res.json({ accessToken: await accessToken(req, res) });
    if (action === 'logout') {
      let s; try { s = session(req); } catch {};
      if (s?.refreshToken || s?.accessToken) await fetch('https://oauth2.googleapis.com/revoke', { method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, body: new URLSearchParams({ token: s.refreshToken || s.accessToken! }) });
      setCookie(res, 'eme_session', '', 0); return res.json({ connected: false });
    }
    res.status(404).json({ error: 'Unknown action' });
  } catch (e) {
    const error = e instanceof Error ? e.message : 'Google 授權失敗，請重新連接。';
    if (req.query.action === 'callback' && callbackOrigin) return res.redirect(302, `${callbackOrigin}/?auth_error=${encodeURIComponent(error)}#/settings`);
    res.status(400).json({ error });
  }
}
