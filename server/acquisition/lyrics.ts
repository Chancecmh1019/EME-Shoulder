import { execFileSync } from 'node:child_process';
import { normalizeSource, stamp } from '../../studio/lrc.ts';
import { ProviderHost } from './plugins.ts';
export interface Identity { title: string; artist: string; album?: string; durationMs?: number; aliases?: string[]; artistAliases?: string[]; albumAliases?: string[] }
const clean = (s: unknown) => String(s ?? '').normalize('NFKC').toLowerCase().replace(/[^\p{L}\p{N}]/gu, '');
export const albumName = (s: string) => clean(s.replace(/\s*\(explicit\)\s*/gi, ''));
const versions = (s: string) => (s.match(/\b(live|remix|acoustic|instrumental|karaoke|cover|demo|remaster|sped|slowed)\b|現場|现场|翻唱|伴奏|純音樂|纯音乐/gi) ?? []).map(clean).sort().join('|');
export function identityMatch(expected: Identity, song: any) {
  const title = String(song.title ?? song.name ?? ''), artist = String(song.artist ?? song.artists ?? ''), album = String(song.album ?? song.album_name ?? '');
  const reasons: string[] = [], names = [expected.title, ...(expected.aliases ?? [])].map(clean);
  if (!names.includes(clean(title))) reasons.push('TITLE_MISMATCH');
  if (![expected.artist, ...(expected.artistAliases ?? [])].map(clean).includes(clean(artist))) reasons.push('ARTIST_MISMATCH');
  if (versions(`${title} ${album}`) !== versions(`${expected.title} ${expected.album ?? ''}`)) reasons.push('RECORDING_VERSION_MISMATCH');
  const duration = Number(song.duration ?? song.duration_ms ?? 0);
  if (expected.durationMs && duration && Math.abs(expected.durationMs - duration) > Math.max(3000, expected.durationMs * .02)) reasons.push('DURATION_MISMATCH');
  if (expected.album && album && ![expected.album, ...(expected.albumAliases ?? [])].map(albumName).includes(albumName(album))) reasons.push('ALBUM_EDITION_MISMATCH');
  if (!album || !duration) reasons.push('METADATA_INCOMPLETE');
  return { accepted: reasons.length === 0, reasons, candidate: { id: song.id, title, artist, album, durationMs: duration } };
}
export function normalizeProviderLyrics(raw: any, song: any) {
  if (!raw) throw new Error('NO_SYNCHRONIZED_LYRICS');
  let lrc: string;
  if (Array.isArray(raw.original) && raw.original.length) {
    lrc = raw.original.flatMap((row: any[]) => { const text = typeof row[2] === 'string' ? row[2] : (row[2] ?? []).map((w: any[]) => String(w[2] ?? '')).join(''); return text.trim() ? [`[${stamp(Math.round(Number(row[0])))}]${text}`] : []; }).join('\n');
  } else if (raw.rawPlainLrc || raw.rawEnhancedLrc || raw.rawMultiPersonEnhancedLrc) {
    lrc = String(raw.rawPlainLrc ?? raw.rawEnhancedLrc ?? raw.rawMultiPersonEnhancedLrc).replace(/<\d+:\d+(?:\.\d+)?>/g, '');
  } else if (raw.rawTtml) {
    const py = 'import sys,json,xml.etree.ElementTree as E;v=sys.stdin.read();assert "<!DOCTYPE" not in v and "<!ENTITY" not in v;r=E.fromstring(v);out=[]\nfor p in r.iter():\n if p.tag.split("}")[-1]!="p" or "begin" not in p.attrib: continue\n for parent in p.iter():\n  for c in list(parent):\n   if any("translation" in str(x).lower() or "roman" in str(x).lower() for k,x in c.attrib.items() if k.split("}")[-1]=="role"): parent.remove(c)\n t=p.attrib["begin"];parts=t.rstrip("s").split(":");sec=0\n for n in parts: sec=sec*60+float(n)\n ms=round(sec*1000);text="".join(p.itertext()).strip()\n if text: out.append("[%02d:%02d.%03d]%s"%(ms//60000,ms//1000%60,ms%1000,text))\nprint(json.dumps(out,ensure_ascii=True))';
    lrc = JSON.parse(execFileSync('python', ['-c', py], { input: String(raw.rawTtml), encoding: 'utf8', maxBuffer: 1024 * 1024, windowsHide: true })).join('\n');
  } else throw new Error('NO_ORIGINAL_LINE_LYRICS');
  const providerRemoved: { row: number; text: string; reason: string }[] = []; let preface = true;
  const cleaned = lrc.split('\n').filter((row, i) => {
    const content = row.replace(/^\[[^\]]+\]/, '');
    const header = clean(content) === clean(`${song.title} ${song.artist}`) || (/\s[-–—]\s/.test(content) && clean(content).includes(clean(song.title)) && clean(content).includes(clean(song.artist)));
    const credit = /^(written\s+by|lyrics?\s+by|music\s+by)\s*(?:[:：-]|�G)?\s*/i;
    const author = content.replace(credit, '');
    if (preface && (header || (credit.test(content) && clean(author) === clean(song.artist)))) { providerRemoved.push({ row: i + 1, text: row, reason: header ? 'identity-preface' : 'prefatory-author-credit' }); return false; }
    preface = false; return true;
  }).join('\n');
  if (cleaned.includes('\uFFFD')) throw new Error('SOURCE_ENCODING_REQUIRES_REVIEW');
  const normalized = normalizeSource(cleaned);
  return { ...normalized, providerRemoved, lrc: ['[00:00.000]', ...normalized.lines.map(l => `[${stamp(l.timeMs)}]${l.original}`)].join('\n') };
}
export function acquireLyrics(host: ProviderHost, identity: Identity) {
  const queries = [...new Set([`${identity.title} ${identity.artist}`, ...(identity.aliases ?? []).map(a => `${a} ${identity.artist}`)])].slice(0, 5);
  const attempts: any[] = [];
  const crossRelease: { song: any; plugin: ReturnType<ProviderHost['plugin']>; family: string }[] = [];
  for (const family of ['qq', 'apple'] as const) {
    const plugin = host.plugin(family);
    for (const keyword of queries) {
      let songs: any[];
      try {
        if (family === 'qq') songs = plugin.call('searchSongs', { keyword, page: 1, pageSize: 10, separator: '/', metadata: false, config: { metadata_details: false } }) ?? [];
        else { const result = JSON.parse(host.request('apple', `https://itunes.apple.com/search?${new URLSearchParams({ term: keyword, entity: 'song', limit: '15', country: 'us' })}`)); songs = (result.results ?? []).map((x: any) => ({ id: String(x.trackId), title: x.trackName, artist: x.artistName, album: x.collectionName, duration: x.trackTimeMillis, date: x.releaseDate })); }
      } catch (e) { attempts.push({ provider: family, keyword, error: String(e) }); continue; }
      for (const song of songs) {
        const match = identityMatch(identity, song); attempts.push({ provider: family, keyword, ...match });
        if (!match.accepted) { if (match.reasons.length === 1 && match.reasons[0] === 'ALBUM_EDITION_MISMATCH') crossRelease.push({ song, plugin, family }); continue; }
        try {
          const raw = plugin.call('getLyricsForSong', { config: { region: 'us', language: 'en-US', lyrics_provider: process.env.APPLE_MEDIA_USER_TOKEN ? 'official' : 'third_party', media_user_token: process.env.APPLE_MEDIA_USER_TOKEN ?? '' } }, song);
          const normalized = normalizeProviderLyrics(raw, song);
          return { provider: family, song, ...normalized, attempts, pluginHashes: plugin.sourceHashes };
        } catch (e) { attempts.push({ provider: family, id: song.id, error: String(e) }); }
      }
    }
  }
  // A different release is retained as an unverified lyric candidate, never silently accepted as the requested recording.
  for (const { song, plugin, family } of crossRelease.slice(0, 2)) {
    try {
      const raw = plugin.call('getLyricsForSong', { config: { lyrics_provider: 'third_party', region: 'us', language: 'en-US' } }, song);
      const normalized = normalizeProviderLyrics(raw, song);
      attempts.push({ provider: family, id: song.id, decision: 'CROSS_RELEASE_LYRIC_CANDIDATE_REQUIRES_AUDIO_VERIFICATION', selectedAudioUnchanged: true });
      return { provider: family, song, ...normalized, attempts, pluginHashes: plugin.sourceHashes, identityVerified: false, crossReleaseCandidate: true };
    } catch (e) { attempts.push({ provider: family, id: song.id, error: String(e), crossReleaseCandidate: true }); }
  }
  return { provider: null, attempts, error: 'NO_VERIFIED_USABLE_QQ_OR_APPLE_LYRICS' };
}
