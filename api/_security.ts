import { createCipheriv, createDecipheriv, randomBytes } from 'node:crypto';
export function config() {
  const { APP_ORIGIN, GOOGLE_CLIENT_ID, GOOGLE_CLIENT_SECRET, SESSION_SECRET, OWNER_EMAIL } = process.env;
  if (!APP_ORIGIN || !GOOGLE_CLIENT_ID || !GOOGLE_CLIENT_SECRET || !SESSION_SECRET || !OWNER_EMAIL) throw new Error('請先設定 Vercel OAuth 與單一擁有者環境變數。');
  const key = Buffer.from(SESSION_SECRET, 'base64'); if (key.length !== 32) throw new Error('SESSION_SECRET must contain 32 random bytes (base64).');
  return { origin: new URL(APP_ORIGIN).origin, clientId: GOOGLE_CLIENT_ID, clientSecret: GOOGLE_CLIENT_SECRET, owner: OWNER_EMAIL.toLowerCase(), key };
}
export function seal(data: unknown) { const iv = randomBytes(12), c = createCipheriv('aes-256-gcm', config().key, iv); return Buffer.concat([iv, c.update(JSON.stringify(data)), c.final(), c.getAuthTag()]).toString('base64url'); }
export function unseal<T>(value?: string): T | undefined {
  if (!value) return;
  try { const bytes = Buffer.from(value, 'base64url'), d = createDecipheriv('aes-256-gcm', config().key, bytes.subarray(0, 12)); d.setAuthTag(bytes.subarray(-16)); return JSON.parse(Buffer.concat([d.update(bytes.subarray(12, -16)), d.final()]).toString()); } catch { return; }
}
export function cookie(req: any, name: string) { return (req.headers.cookie ?? '').split(';').map((p: string) => p.trim()).find((p: string) => p.startsWith(`${name}=`))?.slice(name.length + 1); }
export function setCookie(res: any, name: string, value: string, age: number) { const existing = res.getHeader('Set-Cookie') ?? []; res.setHeader('Set-Cookie', [...(Array.isArray(existing) ? existing : [existing]), `${name}=${value}; HttpOnly; Secure; SameSite=Lax; Path=/api; Max-Age=${age}`]); }
export function mutation(req: any) { if (req.method !== 'POST' || req.headers.origin !== config().origin || req.headers['x-eme-request'] !== '1') throw new Error('Invalid request origin'); }
export function headers(res: any) { res.setHeader('Cache-Control', 'no-store'); res.setHeader('X-Content-Type-Options', 'nosniff'); }
export interface Session { email: string; accessToken?: string; refreshToken?: string; expiresAt?: number; expires: number }
export function session(req: any): Session { const s = unseal<Session>(cookie(req, 'eme_session')); if (!s || s.expires < Date.now() || s.email !== config().owner) throw new Error('請先連接 Google / YouTube。'); return s; }
export async function accessToken(req: any, res: any) {
  const s = session(req); if (s.accessToken && (s.expiresAt ?? 0) > Date.now() + 60000) return s.accessToken;
  if (!s.refreshToken) throw new Error('請重新授權 YouTube。'); const c = config();
  const r = await fetch('https://oauth2.googleapis.com/token', { method: 'POST', body: new URLSearchParams({ client_id: c.clientId, client_secret: c.clientSecret, refresh_token: s.refreshToken, grant_type: 'refresh_token' }) });
  const token = await r.json(); if (!r.ok || !token.access_token) throw new Error('授權已失效，請重新連接 YouTube。');
  s.accessToken = token.access_token; s.expiresAt = Date.now() + token.expires_in * 1000; setCookie(res, 'eme_session', seal(s), Math.floor((s.expires - Date.now()) / 1000)); return s.accessToken!;
}
export async function verifyIdentity(token: string, nonce?: string) {
  const r = await fetch(`https://oauth2.googleapis.com/tokeninfo?id_token=${encodeURIComponent(token)}`); const identity = await r.json(); const c = config();
  if (!r.ok || identity.aud !== c.clientId || !['accounts.google.com', 'https://accounts.google.com'].includes(identity.iss) || !['true', true].includes(identity.email_verified) || identity.email?.toLowerCase() !== c.owner || Number(identity.exp) * 1000 <= Date.now() || (nonce && identity.nonce !== nonce)) throw new Error('僅允許設定的頻道擁有者登入。');
  return identity.email.toLowerCase();
}
export function uploadUrl(raw: string): string { const u = new URL(raw); if (u.protocol !== 'https:' || u.hostname !== 'www.googleapis.com' || u.pathname !== '/upload/youtube/v3/videos' || !u.searchParams.get('upload_id')) throw new Error('Invalid upload session'); return u.href; }
