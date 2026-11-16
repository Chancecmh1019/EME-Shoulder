import { ProviderHost } from '../server/acquisition/plugins.ts';
import { mkdirSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { readFileSync } from 'node:fs';
import { runAcquisition } from '../server/acquisition/workflow.ts';
import { acquireLyrics } from '../server/acquisition/lyrics.ts';
import { verifyAcquisition, recoverEnding } from '../server/acquisition/verify.ts';
import { externalTask, ingestExternalAudio } from '../server/acquisition/handoff.ts';
const [command, ...args] = process.argv.slice(2), host = new ProviderHost();
const out = resolve('.studio/acquisition'); mkdirSync(out, { recursive: true });
if (command === 'offset') {
  const { setGlobalOffset } = await import('../server/acquisition/offset.ts');
  console.log(JSON.stringify(await setGlobalOffset(args[0], Number(args[1])), null, 2));
} else if (command === 'package-file') {
  const { createFilePackage } = await import('../server/acquisition/fileWorkflow.ts');
  const { pkg, path } = await createFilePackage(args[0]);
  console.log(JSON.stringify({ jobId: pkg.jobId, path, promptHash: pkg.promptHash, lines: pkg.lines.length, mode: 'DOT_COMPUTER_TEMPORARY_FILES_NO_DATABASE' }, null, 2));
} else if (command === 'submit-file') {
  const { submitFileTranslation } = await import('../server/acquisition/fileWorkflow.ts');
  console.log(JSON.stringify(await submitFileTranslation(args[0], args[1]), null, 2));
} else if (command === 'package-render-file') {
  const { createFileRenderRequest } = await import('../server/acquisition/fileWorkflow.ts');
  console.log(JSON.stringify(await createFileRenderRequest(args[0]), null, 2));
} else if (command === 'package-render') {
  const { buildLocalRenderRequest } = await import('../server/acquisition/studioBridge.ts');
  console.log(JSON.stringify(await buildLocalRenderRequest(args[0], args[1], args[2]), null, 2));
} else if (command === 'recover-ending') {
  const result = await recoverEnding(args[0]);
  console.log(JSON.stringify({ id: result.id, state: result.state, translationAllowed: result.translationAllowed, verificationScope: result.verification?.policy }, null, 2));
} else if (command === 'package-local') {
  const { bridgeToLocalStudio } = await import('../server/acquisition/studioBridge.ts');
  console.log(JSON.stringify(await bridgeToLocalStudio(args[0], args[1], args[2], args[3] ?? 'medium'), null, 2));
} else if (command === 'external-task') {
  const task = externalTask(args[0]);
  console.log(JSON.stringify({ ...task, path: `${out}/jobs/${args[0]}/external-task.json` }, null, 2));
} else if (command === 'ingest-external') {
  console.log(JSON.stringify(await ingestExternalAudio(JSON.parse(readFileSync(resolve(args[0]), 'utf8'))), null, 2));
} else if (command === 'mornye-source') {
  const url = new URL(args[0]);
  if (url.protocol !== 'https:' || url.hostname !== 'music.youtube.com' || !/^[A-Za-z0-9_-]{11}$/.test(url.searchParams.get('v') ?? '')) throw new Error('EXPECTED_VERIFIED_YOUTUBE_MUSIC_LINK');
  let result: any;
  const plugin = host.plugin('ytmusic'), attempts: { provider: string; error?: string }[] = [];
  for (const method of ['requestCobaltAudioDownload', 'requestYt1dAudioDownload']) {
    try { result = { source: plugin.call(method, url.href), pluginHashes: plugin.sourceHashes }; attempts.push({ provider: method }); break; }
    catch (e) { attempts.push({ provider: method, error: e instanceof Error ? e.message : String(e) }); }
  }
  result = { ...result, attempts };
  if (!result.source?.url) { result.error = 'MORNYE_NORMAL_SERVICES_UNAVAILABLE'; process.exitCode = 1; }
  writeFileSync(`${out}/mornye-source.json`, JSON.stringify({ ...result, requested: url.href, requests: host.outcomes }, null, 2));
  console.log(JSON.stringify({ available: !!result.source?.url, extension: result.source?.extension, error: result.error, requests: host.outcomes, evidence: `${out}/mornye-source.json` }, null, 2));
} else if (command === 'verify') {
  const result = await verifyAcquisition(args[0], args[1] ?? 'base');
  console.log(JSON.stringify({ id: result.id, state: result.state, translationAllowed: result.translationAllowed, diagnosis: result.verification?.diagnosis, coverage: result.verification?.coverage, evidence: result.verification?.path, error: result.verificationError }, null, 2));
  if (!result.translationAllowed) process.exitCode = 1;
} else if (command === 'album') {
  const plugin = host.plugin('ytmusic'), raw = args.join(' '), id = raw.startsWith('https://') ? new URL(raw).pathname.split('/').at(-1) : raw;
  if (!id || !/^[A-Za-z0-9_-]+$/.test(id)) throw new Error('INVALID_ALBUM_ID');
  const album = plugin.call('getAlbum', id);
  writeFileSync(`${out}/album.json`, JSON.stringify({ album, requests: host.outcomes, sourceHashes: plugin.sourceHashes }, null, 2));
  console.log(JSON.stringify({ evidence: `${out}/album.json`, title: album?.name, tracks: album?.tracks?.length ?? 0, requests: host.outcomes }, null, 2));
  if (!album?.tracks?.length) process.exitCode = 1;
} else if (command === 'search') {
  const keyword = args.join(' '), report: Record<string, unknown> = {};
  for (const provider of ['ytmusic', 'qq'] as const) {
    try { const plugin = host.plugin(provider); const songs = provider === 'qq' ? plugin.call('searchSongs', { keyword, page: 1, pageSize: 10, separator: '/', metadata: false, config: { metadata_details: false } }) : plugin.call('customSearch', keyword, { filter: 'tracks' }); report[provider] = { candidates: songs, sourceHashes: plugin.sourceHashes }; }
    catch (e) { report[provider] = { error: e instanceof Error ? e.message : String(e) }; }
  }
  report.requests = host.outcomes; writeFileSync(`${out}/search.json`, JSON.stringify(report, null, 2));
  console.log(JSON.stringify({ evidence: `${out}/search.json`, providers: Object.fromEntries(Object.entries(report).filter(([k]) => k !== 'requests').map(([k, v]: any) => [k, { count: v.candidates?.length ?? 0, error: v.error }])), requests: host.outcomes }, null, 2));
} else if (command === 'lyrics') {
  const spec = JSON.parse(readFileSync(resolve(args[0]), 'utf8'));
  const result = acquireLyrics(host, spec.identity);
  writeFileSync(`${out}/lyrics-result.json`, JSON.stringify({ ...result, requests: host.outcomes }, null, 2));
  if ('lrc' in result) writeFileSync(`${out}/source.lrc`, result.lrc);
  console.log(JSON.stringify({ provider: result.provider, lines: 'lines' in result ? result.lines.length : 0, attempts: result.attempts, requests: host.outcomes, evidence: `${out}/lyrics-result.json` }, null, 2));
  if (!result.provider) process.exitCode = 1;
} else if (command === 'run') {
  const input = JSON.parse(readFileSync(resolve(args[0]), 'utf8')), tracks = input.tracks ?? [input];
  if (!Array.isArray(tracks) || tracks.length > 30) throw new Error('INVALID_TRACK_LIST');
  const results = [];
  for (const spec of tracks) results.push(await runAcquisition(spec));
  console.log(JSON.stringify({ tasks: results.map(r => ({ id: r.id, state: r.state, directory: r.directory, audio: r.audio?.path, lyricProvider: r.lyrics?.provider, lrc: r.lyrics?.path, translationAllowed: r.translationAllowed, error: r.error })) }, null, 2));
  if (results.some(r => r.state === 'BLOCKED' || r.state === 'LYRICS_PENDING' || r.state === 'MATCH_AMBIGUOUS')) process.exitCode = 1;
} else throw new Error('Usage: npm run acquire -- search "song artist" | run path/to/spec.json');
