// Install only upstream runtime packages into ignored tool storage; never vendor providers into EME.
import { mkdirSync, writeFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
const root = '.studio/providers'; mkdirSync(root, { recursive: true });
async function json(url) { const r = await fetch(url, { signal: AbortSignal.timeout(20000) }); if (!r.ok) throw new Error(`PROVIDER_CATALOG_HTTP_${r.status}`); return r.json(); }
const release = await json('https://api.github.com/repos/Replica0110/Lyrico-Plugins/releases/tags/v0.5.0');
const registry = await json('https://raw.githubusercontent.com/mornyeapp/Mornye-Extension/main/registry.json');
const plans = ['qq', 'apple'].map(family => {
  const name = family === 'qq' ? 'com.qqmusic.source-0.5.0.zip' : 'com.applemusic.source-0.4.1.zip';
  const asset = release.assets.find(a => a.name === name);
  if (!asset) throw new Error('OFFICIAL_LYRICO_ASSET_MISSING');
  return { family, url: asset.browser_download_url, expected: asset.digest?.replace(/^sha256:/, ''), file: `${family}.zip`, version: family === 'qq' ? '0.5.0' : '0.4.1' };
});
const yt = registry.extensions.find(e => e.id === 'ytmusic-spotiflac');
plans.push({ family: 'ytmusic', url: yt.download_url, expected: yt.sha256, file: 'ytmusic.sflx', version: yt.version });
const receipts = {};
for (const plan of plans) {
  const url = new URL(plan.url);
  if (url.protocol !== 'https:' || !['github.com', 'raw.githubusercontent.com'].includes(url.hostname)) throw new Error('PROVIDER_PACKAGE_ORIGIN_REJECTED');
  const response = await fetch(url, { signal: AbortSignal.timeout(20000) });
  if (!response.ok) throw new Error(`PROVIDER_PACKAGE_HTTP_${response.status}`);
  const bytes = Buffer.from(await response.arrayBuffer());
  if (bytes.length > 4 * 1024 * 1024) throw new Error('PROVIDER_PACKAGE_TOO_LARGE');
  const sha256 = createHash('sha256').update(bytes).digest('hex');
  if (plan.expected && plan.expected !== sha256) throw new Error('PROVIDER_PACKAGE_HASH_MISMATCH');
  writeFileSync(`${root}/${plan.file}`, bytes);
  receipts[plan.family] = { ...plan, sha256, publishedHashVerified: !!plan.expected, installedAt: new Date().toISOString() };
  console.log(JSON.stringify({ family: plan.family, version: plan.version, bytes: bytes.length, sha256, publishedHashVerified: !!plan.expected }));
}
writeFileSync(`${root}/receipts.json`, JSON.stringify(receipts, null, 2));
