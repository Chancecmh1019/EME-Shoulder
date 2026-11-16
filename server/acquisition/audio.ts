import { createHash } from 'node:crypto';
import { createReadStream, createWriteStream, existsSync, statSync, readFileSync, writeFileSync, renameSync } from 'node:fs';
import { Transform, Readable } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import { resolve } from 'node:path';
import { lookup } from 'node:dns/promises';
import { isIP } from 'node:net';
import { parseFile } from 'music-metadata';
export interface AudioSource { file?: string; url?: string; permission: { basis: string; reference: string }; allowedRedirectHosts?: string[] }
export async function fileHash(path: string) { const hash = createHash('sha256'); for await (const chunk of createReadStream(path)) hash.update(chunk); return hash.digest('hex'); }
async function publicUrl(raw: string, hosts: string[]) {
  const u = new URL(raw);
  if (u.protocol !== 'https:' || u.port || u.username || u.password || isIP(u.hostname) || !hosts.includes(u.hostname)) throw new Error('AUDIO_URL_POLICY_REJECTED');
  const addresses = await lookup(u.hostname, { all: true });
  if (!addresses.length || addresses.some(({ address }) => /^(127\.|10\.|192\.168\.|169\.254\.|0\.|172\.(1[6-9]|2\d|3[01])\.|::1$|fc|fd|fe80|::ffff:)/i.test(address))) throw new Error('PRIVATE_NETWORK_REJECTED');
  return u;
}
/** Full-length local streaming ingress: no Vercel request or 3 MiB body involved. */
export async function acquireAudio(source: AudioSource, directory: string, progress: (bytes: number, total?: number) => void) {
  if (!source?.permission?.basis || !source.permission.reference || (!!source.file === !!source.url)) throw new Error('AUDIO_PERMISSION_AND_EXACT_SOURCE_REQUIRED');
  const output = resolve(directory, 'audio.source'), receipt = resolve(directory, 'audio.json'), partial = `${output}.partial`, checkpoint = `${partial}.json`;
  const sourceId = createHash('sha256').update(JSON.stringify(source)).digest('hex');
  if (existsSync(output) && existsSync(receipt)) {
    const old = JSON.parse(readFileSync(receipt, 'utf8'));
    if (old.sourceId === sourceId && await fileHash(output) === old.sha256) return { ...old, reused: true };
    throw new Error('EXISTING_ASSET_CONFLICT_USE_A_NEW_TASK');
  }
  const max = 1024 * 1024 * 1024;
  let written = 0, total: number | undefined, stream: NodeJS.ReadableStream, append = false;
  if (source.file) {
    const path = resolve(source.file); total = statSync(path).size;
    if (!total || total > max) throw new Error('AUDIO_SIZE_LIMIT_1_GIB');
    stream = createReadStream(path);
  } else {
    const hosts = [...new Set([new URL(source.url!).hostname, ...(source.allowedRedirectHosts ?? [])])];
    let url = source.url!, offset = 0, etag: string | undefined;
    if (existsSync(partial) && existsSync(checkpoint)) { const cp = JSON.parse(readFileSync(checkpoint, 'utf8')); if (cp.sourceId === sourceId && cp.etag) { offset = statSync(partial).size; etag = cp.etag; } }
    let response: Response | undefined;
    for (let redirects = 0; redirects <= 3; redirects++) {
      await publicUrl(url, hosts);
      response = await fetch(url, { headers: { 'User-Agent': 'EME-Studio-Local-Acquisition/2.0', ...(offset ? { Range: `bytes=${offset}-`, 'If-Range': etag! } : {}) }, redirect: 'manual', signal: AbortSignal.timeout(180000) });
      if ([301, 302, 303, 307, 308].includes(response.status) && response.headers.get('location')) { await response.body?.cancel(); url = new URL(response.headers.get('location')!, url).href; continue; }
      break;
    }
    if (!response || ![200, 206].includes(response.status) || !response.body) throw new Error(`AUDIO_HTTP_${response?.status ?? 'NO_RESPONSE'}`);
    if (response.status === 206) {
      if (!offset || !response.headers.get('content-range')?.startsWith(`bytes ${offset}-`) || response.headers.get('etag') !== etag) throw new Error('UNSAFE_RESUME_RESPONSE');
      append = true; written = offset;
    }
    const length = Number(response.headers.get('content-length'));
    if (Number.isFinite(length) && length > 0) total = written + length;
    if ((total ?? 0) > max) throw new Error('AUDIO_SIZE_LIMIT_1_GIB');
    writeFileSync(checkpoint, JSON.stringify({ sourceId, etag: response.headers.get('etag') }));
    stream = Readable.fromWeb(response.body as any);
  }
  let last = 0;
  const meter = new Transform({ transform(chunk, _encoding, done) { written += chunk.length; if (written > max) return done(new Error('AUDIO_SIZE_LIMIT_1_GIB')); if (Date.now() - last > 500) { progress(written, total); last = Date.now(); } done(null, chunk); } });
  await pipeline(stream, meter, createWriteStream(partial, { flags: append ? 'a' : 'w' }));
  if (total && written !== total) throw new Error('AUDIO_TRUNCATED_TRANSFER');
  const parsed = await parseFile(partial, { duration: true });
  // Fragmented MP4 can carry FLAC in a track without music-metadata setting the summary codec.
  // Read the parser's actual audio-track description; do not infer a codec from the filename.
  const metadata = { ...parsed, format: { ...parsed.format, codec: parsed.format.codec ?? parsed.format.trackInfo?.find(track => track.audio && track.codecName)?.codecName } };
  if (!metadata.format.duration || metadata.format.duration < 1 || metadata.format.duration > 7200 || !metadata.format.codec) throw new Error('AUDIO_NOT_DECODABLE_OR_INVALID_DURATION');
  const result = { path: output, sourceId, sha256: await fileHash(partial), bytes: statSync(partial).size, permission: source.permission, origin: source.url ?? 'owner-file', metadata: { title: metadata.common.title, artist: metadata.common.artist, album: metadata.common.album, date: metadata.common.date, track: metadata.common.track, disk: metadata.common.disk, isrc: metadata.common.isrc, format: metadata.format }, integrity: 'CONTAINER_PARSED_FULL_DECODE_PENDING' };
  renameSync(partial, output); writeFileSync(receipt, JSON.stringify(result, null, 2)); progress(written, total);
  return result;
}
