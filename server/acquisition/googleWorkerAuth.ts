import { OAuth2Client } from 'google-auth-library';
import { createServer } from 'node:http';
import { randomBytes, createHash, timingSafeEqual } from 'node:crypto';
import { readFileSync } from 'node:fs';
/** Native worker OAuth. Tokens remain in process memory, never in browser JS or a Dot prompt. */
export async function authorizeWorker(clientFile: string, owner: string, onAuthorizationUrl: (url: string) => void) {
  const config = JSON.parse(readFileSync(clientFile, 'utf8')).installed;
  if (!config?.client_id || !config.client_secret || !owner) throw new Error('OWNER_DESKTOP_OAUTH_CONFIGURATION_REQUIRED');
  const state = randomBytes(32).toString('base64url'), nonce = randomBytes(32).toString('base64url'), verifier = randomBytes(48).toString('base64url');
  const path = `/eme-youtube/${randomBytes(16).toString('hex')}`;
  let complete!: (code: string) => void, failure!: (error: Error) => void;
  const code = new Promise<string>((resolve, reject) => { complete = resolve; failure = reject; });
  const server = createServer((req, res) => {
    const url = new URL(req.url ?? '/', 'http://127.0.0.1'), incoming = Buffer.from(url.searchParams.get('state') ?? '');
    if (req.method !== 'GET' || url.pathname !== path || incoming.length !== Buffer.byteLength(state) || !timingSafeEqual(incoming, Buffer.from(state))) { res.writeHead(400).end('Invalid authorization callback'); return; }
    res.writeHead(200, { 'Content-Type': 'text/plain;charset=utf-8', 'Cache-Control': 'no-store', 'Referrer-Policy': 'no-referrer' }).end('授權回呼已收到，請返回 EME worker。');
    if (url.searchParams.get('error') || !url.searchParams.get('code')) failure(new Error('OWNER_GOOGLE_AUTHORIZATION_NOT_COMPLETED'));
    else complete(url.searchParams.get('code')!);
  });
  await new Promise<void>((resolve, reject) => { server.once('error', reject); server.listen(0, '127.0.0.1', resolve); });
  const address = server.address(); if (!address || typeof address === 'string') throw new Error('LOOPBACK_BIND_FAILED');
  const client = new OAuth2Client(config.client_id, config.client_secret, `http://127.0.0.1:${address.port}${path}`);
  const timer = setTimeout(() => failure(new Error('OWNER_GOOGLE_AUTHORIZATION_TIMEOUT')), 600000);
  try {
    onAuthorizationUrl(client.generateAuthUrl({ access_type: 'offline', prompt: 'consent', scope: ['openid', 'email', 'https://www.googleapis.com/auth/youtube.upload', 'https://www.googleapis.com/auth/youtube.readonly'], state, nonce, code_challenge: createHash('sha256').update(verifier).digest('base64url'), code_challenge_method: 'S256' as any, login_hint: owner }));
    const { tokens } = await client.getToken({ code: await code, codeVerifier: verifier });
    if (!tokens.id_token || !tokens.access_token) throw new Error('GOOGLE_AUTHORIZATION_TOKEN_MISSING');
    const identity = (await client.verifyIdToken({ idToken: tokens.id_token, audience: config.client_id })).getPayload();
    if (!identity?.email_verified || identity.email?.toLowerCase() !== owner.toLowerCase() || identity.nonce !== nonce) throw new Error('OWNER_GOOGLE_IDENTITY_MISMATCH');
    client.setCredentials(tokens);
    return client;
  } finally { clearTimeout(timer); server.close(); }
}
