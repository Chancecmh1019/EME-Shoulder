import { defaultVisual, type AlbumProject, type TrackProject } from '../types';
import { extractMetadataFromAudio, id, isSupportedAudioFile } from '../utils/parsers';
import { prepareAudioForBrowser } from './audioSupport';
import { deleteMedia, putMedia } from './storage';
export const sortTracks = (tracks: TrackProject[]) => [...tracks].sort((a, b) => (a.discNumber || 1) - (b.discNumber || 1) || (a.trackNumber ?? Infinity) - (b.trackNumber ?? Infinity) || a.importOrder - b.importOrder);
export function groupTracks(tracks: TrackProject[]): AlbumProject[] {
  const groups = new Map<string, TrackProject[]>();
  for (const t of tracks) { const key = t.album.trim().toLocaleLowerCase() || 'untitled'; groups.set(key, [...(groups.get(key) ?? []), t]); }
  return [...groups.values()].map(ts => ({ id: id(), title: ts[0].album || 'Untitled album', artist: ts.find(t => t.albumArtist)?.albumArtist || (new Set(ts.map(t => t.artist)).size > 1 ? 'Various Artists' : ts[0].artist), artworkKey: ts.find(t => t.artworkKey)?.artworkKey, visual: { ...defaultVisual }, tracks: sortTracks(ts), createdAt: Date.now(), updatedAt: Date.now() }));
}
export async function importAlbum(files: File[], progress: (message: string) => void): Promise<{ albums: AlbumProject[]; errors: string[] }> {
  const selected = files.filter(isSupportedAudioFile), tracks: TrackProject[] = [], errors: string[] = [];
  if (!selected.length) throw new Error('請選擇音訊檔案。');
  await navigator.storage?.persist?.();
  // Sequential conversion caps FFmpeg, decoder and PCM allocations at one track.
  for (const [index, file] of selected.entries()) {
    progress(`讀取 ${index + 1} / ${selected.length} · ${file.name}`);
    const key = id(); const written: string[] = [];
    try {
      const parsed = await extractMetadataFromAudio(file);
      const prepared = await prepareAudioForBrowser(file);
      const sourceKey = `${key}/source`, audioKey = prepared.converted ? `${key}/audio` : sourceKey;
      await putMedia(sourceKey, file); written.push(sourceKey);
      if (audioKey !== sourceKey) { await putMedia(audioKey, prepared.file); written.push(audioKey); }
      const artworkKey = parsed.artwork ? `${key}/artwork` : undefined;
      if (parsed.artwork) { await putMedia(artworkKey!, parsed.artwork); written.push(artworkKey!); }
      tracks.push({ ...parsed.metadata, id: key, kind: 'lyric', importOrder: index, sourceKey, audioKey, artworkKey, lyrics: parsed.lyrics, untimedLyrics: parsed.untimedLyrics, lyricOffset: 0, review: parsed.lyrics.length ? 'needs-review' : 'needs-lyrics', thumbnailSeed: 0, privacy: 'private', render: 'idle', publish: 'idle', renderProgress: 0, uploadProgress: 0 });
    } catch (e) { await Promise.all(written.map(deleteMedia)); errors.push(`${file.name}：${e instanceof Error ? e.message : String(e)}`); }
  }
  return { albums: groupTracks(tracks), errors };
}
