import { execFileSync } from 'node:child_process';
import { createContext, runInContext } from 'node:vm';
import { inflateSync } from 'node:zlib';
import { createHash } from 'node:crypto';
import { mkdirSync, readFileSync, writeFileSync, existsSync, renameSync } from 'node:fs';
import { resolve, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { pythonCommand } from './python.ts';

export type Family = 'qq' | 'apple' | 'ytmusic' | 'lrclib' | 'mornye' | 'yt1d';
export interface RequestOutcome { family: Family; url: string; status: number; error?: string; cached: boolean }
/** A local CLI bridge, not a security sandbox for arbitrary third-party code. Only supplied reference plugins are loaded. */
export class ProviderHost {
  readonly outcomes: RequestOutcome[] = [];
  constructor(readonly root = resolve('.studio/acquisition/cache')) { mkdirSync(root, { recursive: true }); }
  request(family: Family, url: string, method = 'GET', body?: string, headers: Record<string, string> = {}) {
    let cacheBody = body;
    try { const parsed = JSON.parse(body ?? 'null'); if (parsed?.req_0?.param) delete parsed.req_0.param.search_id; cacheBody = JSON.stringify(parsed); } catch { /* Non-JSON bodies retain their exact identity. */ }
    const hash = createHash('sha256').update(JSON.stringify({ family, url, method, body: cacheBody })).digest('hex'), file = join(this.root, `${hash}.json`);
    let value: { status: number; text?: string; error?: string; at: number }, cached = false;
    if (existsSync(file)) { value = JSON.parse(readFileSync(file, 'utf8')); cached = Date.now() - value.at < (value.status === 200 ? 3600000 : 900000); }
    if (!cached) {
      const output = execFileSync(process.execPath, [fileURLToPath(new URL('../../scripts/provider-http.mjs', import.meta.url))], { input: JSON.stringify({ family, url, method, body, headers }), encoding: 'utf8', timeout: 18000, maxBuffer: 10 * 1024 * 1024, windowsHide: true });
      value = { ...JSON.parse(output), at: Date.now() };
      writeFileSync(`${file}.tmp`, JSON.stringify(value)); renameSync(`${file}.tmp`, file);
    }
    this.outcomes.push({ family, url: new URL(url).origin + new URL(url).pathname, status: value!.status, error: value!.error, cached });
    if (value!.status !== 200) throw new Error(`${family}: ${value!.error ?? `HTTP_${value!.status}`}`);
    return value!.text ?? '';
  }
  plugin(family: 'qq' | 'apple' | 'ytmusic') {
    const installed = resolve('.studio/providers', family === 'ytmusic' ? 'ytmusic.sflx' : `${family}.zip`);
    const useInstalled = existsSync(installed);
    const archive = useInstalled ? installed : family === 'ytmusic' ? 'Mornye-Extension-main.zip' : 'Lyrico-Plugins-main.zip';
    if (useInstalled) {
      const receipt = JSON.parse(readFileSync(resolve('.studio/providers/receipts.json'), 'utf8'))[family];
      if (!receipt?.publishedHashVerified || createHash('sha256').update(readFileSync(installed)).digest('hex') !== receipt.sha256) throw new Error('INSTALLED_PROVIDER_HASH_MISMATCH');
    }
    const prefix = useInstalled ? family === 'ytmusic' ? '' : `${family}/` : family === 'ytmusic' ? 'Mornye-Extension-main/sources/ytmusic-spotiflac/' : `Lyrico-Plugins-main/${family}/`;
    const python = 'import zipfile,json,sys;z=zipfile.ZipFile(sys.argv[1]);p=sys.argv[2];entry=sys.argv[3];n=sorted(x for x in z.namelist() if x.startswith(p+"lib/") and x.endswith(".js"));n += [p+entry];print(json.dumps({x:z.read(x).decode("utf-8") for x in n},ensure_ascii=True))';
    const files = JSON.parse(execFileSync(pythonCommand(), ['-c', python, resolve(archive), prefix, family === 'ytmusic' ? 'index.js' : 'source.js'], { encoding: 'utf8', maxBuffer: 2 * 1024 * 1024, windowsHide: true })) as Record<string, string>;
    const cache = new Map<string, string>(); let calls = 0;
    const http = (url: string, method: string, body?: string, options: any = {}) => {
      if (++calls > 15) throw new Error('PROVIDER_REQUEST_BUDGET');
      const hostname = new URL(url).hostname;
      return this.request(hostname === 'api.zarz.moe' ? 'mornye' : hostname === 'yt1d.io' ? 'yt1d' : family, url, method, body, { ...(options.headers ?? {}), ...(options.contentType ? { 'Content-Type': options.contentType } : {}) });
    };
    const context = createContext({
      URL, URLSearchParams, TextEncoder, TextDecoder,
      Platform: {
        http: { getText: (u: string, o: unknown) => http(u, 'GET', undefined, o), postText: (u: string, b: string, o: unknown) => http(u, 'POST', b, o) },
        base64: { encodeText: (s: string) => Buffer.from(s).toString('base64'), decodeText: (s: string) => Buffer.from(s, 'base64').toString('utf8'), decodeUrlText: (s: string) => Buffer.from(s, 'base64url').toString('utf8') },
        compression: { inflateBytesToText: (bytes: number[]) => { try { return inflateSync(Buffer.from(bytes), { maxOutputLength: 1024 * 1024 }).toString('utf8'); } catch { return ''; } } },
        cache: { get: (k: string) => cache.get(k), set: (k: string, v: string) => cache.set(k, v), remove: (k: string) => cache.delete(k) },
        log: { debug() {}, warn() {} }, i18n: { t: (...args: string[]) => args.join(' ') }, app: { getUserAgent: () => 'EME-Studio/2.0' }, runtime: { getInfo: () => ({ supportedHostApis: [] }) },
      },
      fetch: (url: string, options: any = {}) => { const text = http(url, options.method ?? 'GET', options.body, options); return { ok: true, status: 200, text: () => text, json: () => JSON.parse(text), headers: { get: () => null } }; },
      log: { info() {}, warn() {}, error() {}, debug() {} }, storage: { get: (k: string) => cache.get(k), set: (k: string, v: string) => cache.set(k, v) },
      utils: { isDownloadCancelled: () => false },
      registerExtension: (value: unknown) => { context.registered = value; },
      registered: undefined as any, __request: undefined as any, __song: undefined as any,
      __developerToken: process.env.APPLE_DEVELOPER_TOKEN ?? '',
    });
    for (const [name, source] of Object.entries(files)) runInContext(source, context, { filename: name, timeout: 5000 });
    if (family === 'apple') runInContext('getDeveloperToken = function(){ return __developerToken; }; applyAppleOfficialLocalizationToTtml = function(xml){ return xml; };', context);
    if (family === 'ytmusic') runInContext('registered.initialize({poTokenMode:"off",logLevel:"error"})', context);
    const call = (name: string, request: unknown, song?: unknown) => {
      if (!['searchSongs', 'getLyricsForSong', 'customSearch', 'handleUrl', 'getAlbum', 'requestCobaltAudioDownload', 'requestYt1dAudioDownload'].includes(name)) throw new Error('PLUGIN_ACTION_REJECTED');
      context.__request = request; context.__song = song;
      const expression = family === 'ytmusic' && !['requestCobaltAudioDownload', 'requestYt1dAudioDownload'].includes(name) ? `registered.${name}(__request,__song)` : `${name}(__request,__song)`;
      const result = runInContext(expression, context, { timeout: 120000 });
      return result === undefined ? null : JSON.parse(JSON.stringify(result));
    };
    return { call, sourceHashes: Object.fromEntries(Object.entries(files).map(([p, s]) => [p, createHash('sha256').update(s).digest('hex')])) };
  }
}
