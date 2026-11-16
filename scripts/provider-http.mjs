// Synchronous host bridge for the supplied Lyrico/Mornye plugins. Never deployed as an HTTP proxy.
const input = JSON.parse(await new Promise(resolve => { let s = ''; process.stdin.setEncoding('utf8'); process.stdin.on('data', c => s += c); process.stdin.on('end', () => resolve(s)); }));
const families = {
  qq: ['u.y.qq.com', 'shu6.y.qq.com', 'c.y.qq.com'],
  apple: ['amp-api.music.apple.com', 'lyrics.paxsenix.org', 'itunes.apple.com'],
  ytmusic: ['music.youtube.com', 'www.youtube.com', 'youtube.com'],
  lrclib: ['lrclib.net'],
  mornye: ['api.zarz.moe'],
  yt1d: ['yt1d.io'],
};
try {
  const url = new URL(input.url);
  if (url.protocol !== 'https:' || url.username || url.password || url.port || !families[input.family]?.includes(url.hostname)) throw new Error('HOST_POLICY_REJECTED');
  if (input.family === 'ytmusic' && !['/youtubei/v1/search', '/youtubei/v1/browse', '/youtubei/v1/next', '/watch', '/oembed', '/api/oembed'].includes(url.pathname)) throw new Error('DISCOVERY_ONLY_NO_STREAM_EXTRACTION');
  if (input.family === 'mornye' && url.pathname !== '/v1/dl/cobalt') throw new Error('MORNYE_ENDPOINT_REJECTED');
  if (input.family === 'yt1d' && !['/results/', '/wp-admin/admin-ajax.php'].includes(url.pathname)) throw new Error('MORNYE_ENDPOINT_REJECTED');
  const r = await fetch(url, { method: input.method ?? 'GET', headers: { 'User-Agent': 'EME-Studio-Local-Acquisition/2.0', ...input.headers }, body: input.body || undefined, redirect: 'error', signal: AbortSignal.timeout(15000) });
  const chunks = []; let size = 0;
  for await (const chunk of r.body ?? []) { size += chunk.length; if (size > 8 * 1024 * 1024) throw new Error('PROVIDER_RESPONSE_TOO_LARGE'); chunks.push(chunk); }
  const text = Buffer.concat(chunks).toString('utf8');
  process.stdout.write(JSON.stringify({ status: r.status, text, contentType: r.headers.get('content-type') }));
} catch (e) { process.stdout.write(JSON.stringify({ status: 0, error: e.code ?? e.cause?.code ?? e.message ?? 'NETWORK_ERROR' })); }
