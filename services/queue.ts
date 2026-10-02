import { defaultVisual, type TrackProject } from '../types';
import { LibraryStore } from './library';
import { checkAbort } from './cancellation';
import { deleteMedia, getMedia, putMedia } from './storage';
import { publishTrack } from './youtube';
export class ProductionQueue {
  private rendering?: string; private publishing?: string;
  private controllers = new Map<string, AbortController>(); private stopped = false;
  private unsubscribe: () => void;
  constructor(private store: LibraryStore) { this.unsubscribe = store.subscribe(() => this.pump()); }
  dispose() { this.stopped = true; this.unsubscribe(); this.controllers.forEach(c => c.abort()); }
  private album(t: TrackProject) { return this.store.data.albums.find(a => a.tracks.some(x => x.id === t.id)) ?? { id: t.id, visual: defaultVisual, artworkKey: t.artworkKey }; }
  private pump() {
    if (this.stopped || !this.store.ready) return;
    const tracks = [...this.store.data.albums.flatMap(a => a.tracks), ...this.store.data.mv];
    if (!this.rendering) { const t = tracks.find(t => t.render === 'pending'); if (t) { this.rendering = t.id; void this.render(t); } }
    if (!this.publishing) { const t = tracks.find(t => t.id !== this.rendering && t.render === 'completed' && t.publish === 'pending'); if (t) { this.publishing = t.id; void this.publish(t); } }
  }
  async approve(t: TrackProject, autoUpload = true) { await this.store.patchTrack(t.id, { autoUpload, review: 'approved', approvedAt: Date.now(), render: 'pending', publish: 'idle', error: undefined, errorStage: undefined, renderProgress: 0, uploadProgress: 0, uploadUrl: undefined, youtubeId: undefined }); }
  async upload(id: string) { const t = this.store.track(id); if (!t?.outputKey || t.render !== 'completed') throw new Error('請先完成影片匯出。'); await this.store.patchTrack(id, { autoUpload: true, publish: 'pending', error: undefined, errorStage: undefined }); }
  async cancel(id: string) {
    this.controllers.get(id)?.abort(); const t = this.store.track(id); if (!t) return;
    await this.store.patchTrack(id, { render: t.render === 'pending' || t.render === 'running' ? 'cancelled' : t.render, publish: t.publish === 'pending' || t.publish === 'running' ? 'cancelled' : t.publish });
  }
  async retry(id: string) {
    const t = this.store.track(id); if (!t || t.render === 'running' || t.publish === 'running') return;
    const output = t.outputKey && t.render === 'completed' ? await getMedia(t.outputKey) : undefined;
    await this.store.patchTrack(id, { error: undefined, errorStage: undefined, render: output ? 'completed' : 'pending', publish: output && t.autoUpload !== false ? 'pending' : 'idle', renderProgress: output ? 100 : 0 });
  }
  private async render(t: TrackProject) {
    const controller = new AbortController(); this.controllers.set(t.id, controller);
    let outputKey: string | undefined;
    try {
      await this.store.patchTrack(t.id, { render: 'running' });
      const { renderTrack, makeThumbnail } = await import('./renderEngine');
      const album = this.album(t);
      if (t.kind === 'lyric') { const thumbnail = await makeThumbnail(t, album); checkAbort(controller.signal); await putMedia(`${t.id}/thumbnail`, thumbnail); await this.store.patchTrack(t.id, { thumbnailKey: `${t.id}/thumbnail` }); }
      outputKey = await renderTrack(t, album, p => { void this.store.patchTrack(t.id, { renderProgress: p }).catch(() => controller.abort()); }, controller.signal);
      checkAbort(controller.signal); await this.store.patchTrack(t.id, { outputKey, render: 'completed', publish: t.autoUpload === false ? 'idle' : 'pending', renderProgress: 100 });
      if (t.outputKey && t.outputKey !== outputKey) await deleteMedia(t.outputKey);
    } catch (e) {
      if (outputKey && controller.signal.aborted) await deleteMedia(outputKey);
      await this.store.patchTrack(t.id, { render: controller.signal.aborted ? 'cancelled' : 'error', errorStage: controller.signal.aborted ? undefined : 'render', error: controller.signal.aborted ? undefined : e instanceof Error ? e.message : String(e) }).catch(() => {});
    } finally { this.controllers.delete(t.id); this.rendering = undefined; this.pump(); }
  }
  private async publish(t: TrackProject) {
    const controller = new AbortController(); this.controllers.set(t.id, controller);
    try {
      await this.store.patchTrack(t.id, { publish: 'running' }); const video = await getMedia(t.outputKey!); if (!video) throw new Error('已保存的 MP4 不存在。');
      await publishTrack(t, video, t.thumbnailKey ? await getMedia(t.thumbnailKey) : undefined, p => this.store.patchTrack(t.id, p), controller.signal);
    } catch (e) { await this.store.patchTrack(t.id, { publish: controller.signal.aborted ? 'cancelled' : 'error', errorStage: controller.signal.aborted ? undefined : 'publish', error: controller.signal.aborted ? undefined : e instanceof Error ? e.message : String(e) }).catch(() => {}); }
    finally { this.controllers.delete(t.id); this.publishing = undefined; this.pump(); }
  }
}
