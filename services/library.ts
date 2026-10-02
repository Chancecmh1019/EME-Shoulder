import { emptyLibrary, type Library, type TrackProject } from '../types';
import { loadLibrary, saveLibrary } from './storage';
export class LibraryStore {
  data: Library = emptyLibrary(); ready = false;
  private listeners = new Set<() => void>(); private saving = Promise.resolve();
  subscribe = (fn: () => void) => { this.listeners.add(fn); return () => { this.listeners.delete(fn); }; };
  snapshot = () => this.data;
  async load() { this.data = await loadLibrary(); this.ready = true; this.listeners.forEach(fn => fn()); }
  change(edit: (draft: Library) => void): Promise<void> {
    const draft = structuredClone(this.data); edit(draft);
    // Keep unchanged lyric arrays stable so queue progress never rebuilds an
    // unrelated track's preview or recreates its WebGL resources.
    for (const t of [...draft.albums.flatMap(a => a.tracks), ...draft.mv]) {
      const previous = this.track(t.id); if (previous && JSON.stringify(previous.lyrics) === JSON.stringify(t.lyrics)) t.lyrics = previous.lyrics;
    }
    this.data = draft; this.listeners.forEach(fn => fn());
    const save = this.saving.catch(() => {}).then(() => saveLibrary(draft)); this.saving = save; return save;
  }
  track(id: string) { return [...this.data.albums.flatMap(a => a.tracks), ...this.data.mv].find(t => t.id === id); }
  patchTrack(id: string, patch: Partial<TrackProject>) { return this.change(data => { const album = data.albums.find(a => a.tracks.some(t => t.id === id)); const track = album?.tracks.find(t => t.id === id) ?? data.mv.find(t => t.id === id); if (track) Object.assign(track, patch); if (album) album.updatedAt = Date.now(); }); }
}
