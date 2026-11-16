import { createHash } from 'node:crypto';
import { mkdirSync, readFileSync, writeFileSync, existsSync, renameSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { ProviderHost } from './plugins.ts';
import { acquireLyrics, identityMatch, albumName, type Identity } from './lyrics.ts';
import { acquireAudio, fileHash, type AudioSource } from './audio.ts';
export interface AcquisitionSpec { identity: Identity; audio?: AudioSource; language?: string }
export async function runAcquisition(spec: AcquisitionSpec) {
  if (!spec?.identity?.title || !spec.identity.artist) throw new Error('TITLE_AND_ARTIST_REQUIRED');
  const key = createHash('sha256').update(JSON.stringify(spec)).digest('hex').slice(0, 20), directory = resolve('.studio/acquisition/jobs', key);
  mkdirSync(directory, { recursive: true });
  const previous = existsSync(join(directory, 'report.json')) ? JSON.parse(readFileSync(join(directory, 'report.json'), 'utf8')) : {};
  const host = new ProviderHost(), report: any = { id: key, directory, requested: spec.identity, language: spec.language ?? 'auto', state: 'IDENTIFY', translationAllowed: false, events: previous.events ?? [], requests: host.outcomes };
  function save(state: string, reason: string) { report.state = state; report.events.push({ state, reason, at: new Date().toISOString() }); writeFileSync(join(directory, 'report.json.tmp'), JSON.stringify(report, null, 2)); renameSync(join(directory, 'report.json.tmp'), join(directory, 'report.json')); console.log(JSON.stringify({ task: key, state, reason })); }
  try {
    const discovery = host.plugin('ytmusic');
    const candidates = discovery.call('customSearch', `${spec.identity.title} ${spec.identity.artist}`, { filter: 'tracks' }) ?? [];
    report.discovery = { provider: 'Mornye ytmusic-spotiflac (metadata only)', candidates, matches: candidates.map((c: any) => identityMatch(spec.identity, c)), pluginHashes: discovery.sourceHashes };
    let matches = report.discovery.matches.filter((m: any) => m.accepted);
    if (!matches.length) {
      const qq = host.plugin('qq').call('searchSongs', { keyword: `${spec.identity.title} ${spec.identity.artist}`, page: 1, pageSize: 10, separator: '/', metadata: false, config: { metadata_details: false } }) ?? [];
      report.discovery.secondary = { provider: 'QQ metadata', matches: qq.map((c: any) => identityMatch(spec.identity, c)) };
      matches = report.discovery.secondary.matches.filter((m: any) => m.accepted);
    }
    report.reference = matches.length === 1 ? matches[0].candidate : null;
    if (!report.reference) { save('MATCH_AMBIGUOUS', '沒有唯一的 YouTube Music 錄音候選；不使用相似錄音冒充。'); return report; }
    save('ACQUIRE_AUDIO', '歌曲版本已記錄；音訊只接受明確授權的檔案或下載連結。');
    if (spec.audio) {
      try { report.audio = await acquireAudio(spec.audio, directory, (bytes, total) => console.log(JSON.stringify({ task: key, stage: 'audio-transfer', bytes, total }))); }
      catch (e) { report.audioError = e instanceof Error ? e.message : String(e); save('AUDIO_REJECTED', report.audioError); }
    } else { report.audioError = 'AUTHORIZED_AUDIO_SOURCE_REQUIRED'; save('AUDIO_PENDING', '未指定允許取得的完整音檔；仍會保留真實取得的同步歌詞。'); }
    const durationMs = report.audio ? report.audio.metadata.format.duration * 1000 : report.reference.durationMs;
    if (Math.abs(durationMs - report.reference.durationMs) > Math.max(3000, report.reference.durationMs * .02)) throw new Error('AUDIO_DURATION_VERSION_CONFLICT');
    if (report.audio?.metadata.title && report.audio.metadata.artist) {
      const tags = identityMatch({ ...spec.identity, album: undefined, durationMs }, { title: report.audio.metadata.title, artist: report.audio.metadata.artist, album: spec.identity.album ?? 'source edition pending', duration: durationMs });
      if (tags.reasons.some((x: string) => x === 'ARTIST_MISMATCH' || x === 'TITLE_MISMATCH' || x === 'RECORDING_VERSION_MISMATCH')) throw new Error(`AUDIO_TAG_CONFLICT:${tags.reasons.join(',')}`);
    }
    if (spec.identity.album && report.audio?.metadata.album && albumName(spec.identity.album) !== albumName(report.audio.metadata.album)) throw new Error('AUDIO_ALBUM_EDITION_CONFLICT');
    save('FIND_LYRICS', '依序執行原始 QQ、Apple 插件，忽略來源翻譯；音訊是否可用另列狀態。');
    const lyrics = acquireLyrics(host, { ...spec.identity, durationMs });
    report.lyrics = lyrics;
    if (!lyrics.provider || !('lrc' in lyrics)) { save('LYRICS_PENDING', 'QQ／Apple 沒有通過版本與格式檢查的原文，已保留每次實際錯誤。'); return report; }
    const lrcPath = join(directory, 'source.lrc'); writeFileSync(lrcPath, lyrics.lrc, 'utf8');
    report.lyrics.sha256 = await fileHash(lrcPath); report.lyrics.path = lrcPath;
    save(report.audio ? 'PAIR_VERIFICATION' : 'AUDIO_PENDING', report.audio ? '同步原文已保存；音訊內容尚未驗證，禁止翻譯。' : '錄音資料與同步原文已保存；缺少允許取得的完整音檔，禁止翻譯。');
    return report;
  } catch (e) { report.error = e instanceof Error ? e.message : String(e); save('BLOCKED', report.error); return report; }
}
