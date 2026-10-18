import { defaultVisual, newThreadsClip, type AlbumProject, type ClipRange, type Library, type RenderJob, type TrackProject } from '../types';
import { LibraryStore } from './library';
import { checkAbort } from './cancellation';
import { deleteMedia, download, getMedia, putMedia, threadsFilename } from './storage';
import { publishTrack } from './youtube';
const findTrack = (data: Library, id: string) => [...data.albums.flatMap(a => a.tracks), ...data.mv].find(t => t.id === id);
export class ProductionQueue {
  private rendering?: string; private publishing?: string;
  private controllers = new Map<string, AbortController>(); private stopped = false;
  private unsubscribe: () => void;
  constructor(private store: LibraryStore) { this.unsubscribe = store.subscribe(() => this.pump()); document.addEventListener('visibilitychange', this.onVisibility); this.pump(); }
  dispose() { this.stopped = true; this.unsubscribe(); document.removeEventListener('visibilitychange', this.onVisibility); this.controllers.forEach(c => c.abort()); }
  private onVisibility = () => { if (document.visibilityState === 'visible') this.pump(); };
  private album(t: TrackProject) { const a = this.store.data.albums.find(a => a.tracks.some(x => x.id === t.id)); return { id: a?.id ?? t.id, visual: structuredClone(a?.visual ?? defaultVisual), artworkKey: a?.artworkKey ?? t.artworkKey }; }
  private snapshot(t: TrackProject) { const copy = structuredClone(t); delete copy.threads; return copy; }
  private patchJob(id: string, patch: Partial<RenderJob>) {
    return this.store.change(data => {
      const job = data.renderJobs.find(j => j.id === id); if (!job) return; Object.assign(job, patch);
      const t = findTrack(data, job.trackId); if (!t) return;
      if (job.kind === 'THREADS_CLIP') { if (t.threads?.jobId === job.id) Object.assign(t.threads, { render: job.state, renderProgress: job.progress, error: job.error }); }
      else { t.render = job.state; t.renderProgress = job.progress; if (patch.error !== undefined || patch.state === 'pending') { t.error = patch.error; t.errorStage = patch.error ? 'render' : undefined; } }
    });
  }
  private pump() {
    if (this.stopped || !this.store.ready || this.store.data.queuePaused || document.visibilityState !== 'visible') return;
    if (!this.rendering) { const job = this.store.data.renderJobs.filter(j => j.state === 'pending').sort((a,b) => a.enqueuedAt - b.enqueuedAt)[0]; if (job) { this.rendering = job.id; void this.render(job); } }
    if (!this.publishing) { const t = [...this.store.data.albums.flatMap(a => a.tracks), ...this.store.data.mv].filter(t => t.render === 'completed' && t.publish === 'pending').sort((a,b) => (a.approvedAt ?? 0) - (b.approvedAt ?? 0))[0]; if (t) { this.publishing = t.id; void this.publish(t); } }
  }
  async resume() { await this.store.change(data => { data.queuePaused = false; }); }
  async approve(t: TrackProject, autoUpload = true) {
    if (this.store.data.renderJobs.some(j => j.trackId === t.id && j.kind !== 'THREADS_CLIP' && ['pending','running'].includes(j.state))) throw new Error('此曲目已在渲染佇列。');
    const flags = { autoUpload, review: 'approved' as const, approvedAt: Date.now(), render: 'pending' as const, publish: 'idle' as const, error: undefined, errorStage: undefined, renderProgress: 0, uploadProgress: 0, uploadUrl: undefined, youtubeId: undefined };
    const job: RenderJob = { id: crypto.randomUUID(), trackId: t.id, kind: t.kind === 'mv' ? 'MV_MASTER' : 'ALBUM_MASTER', enqueuedAt: Date.now(), state: 'pending', progress: 0, snapshot: this.snapshot({ ...t, ...flags }), album: this.album(t) };
    await this.store.change(data => { const track = findTrack(data, t.id); if (!track) throw new Error('曲目已不存在。'); Object.assign(track, flags); data.renderJobs.push(job); });
  }
  async enqueueClip(t: TrackProject, album: Pick<AlbumProject,'id'|'artworkKey'|'visual'>, range: ClipRange) {
    if (t.kind !== 'lyric' || !Number.isFinite(range.start) || !Number.isFinite(range.end) || range.start < 0 || range.end <= range.start || range.end > t.duration) throw new Error('Threads 片段範圍無效。');
    if (this.store.data.renderJobs.some(j => j.trackId === t.id && j.kind === 'THREADS_CLIP' && ['pending','running'].includes(j.state))) throw new Error('此曲目的片段已在佇列。');
    const job: RenderJob = { id: crypto.randomUUID(), trackId: t.id, kind: 'THREADS_CLIP', enqueuedAt: Date.now(), state: 'pending', progress: 0, range: { ...range }, snapshot: this.snapshot(t), album: structuredClone(album) };
    await this.store.change(data => { const track = findTrack(data,t.id); if (!track) throw new Error('曲目已不存在。'); track.threads = { ...(track.threads ?? newThreadsClip()), render: 'pending', renderProgress: 0, jobId: job.id, error: undefined }; data.renderJobs.push(job); });
  }
  async upload(id: string) { const t = this.store.track(id); if (!t?.outputKey || t.render !== 'completed') throw new Error('請先完成影片匯出。'); await this.store.patchTrack(id, { autoUpload: true, publish: 'pending', error: undefined, errorStage: undefined }); }
  async cancelJob(id: string) { const job = this.store.data.renderJobs.find(j => j.id === id); if (!job || !['pending','running'].includes(job.state)) return; this.controllers.get(`render:${id}`)?.abort(); await this.patchJob(id, { state: 'cancelled', error: undefined }); }
  async cancel(id: string) {
    const jobs = this.store.data.renderJobs.filter(j => j.trackId === id && j.kind !== 'THREADS_CLIP' && ['pending','running'].includes(j.state));
    for (const job of jobs) await this.cancelJob(job.id);
    this.controllers.get(`publish:${id}`)?.abort(); const t = this.store.track(id); if (t && ['pending','running'].includes(t.publish)) await this.store.patchTrack(id, { publish: 'cancelled' });
  }
  async retryJob(id: string) { const job = this.store.data.renderJobs.find(j => j.id === id); if (!job || !['error','cancelled'].includes(job.state)) return; if (!job.snapshot) throw new Error('請重新校稿並加入佇列。'); await this.patchJob(id, { state: 'pending', enqueuedAt: Date.now(), progress: 0, error: undefined }); }
  async retry(id: string) {
    const t = this.store.track(id); if (!t || t.render === 'running' || t.publish === 'running') return;
    const output = t.outputKey && t.render === 'completed' ? await getMedia(t.outputKey) : undefined;
    if (output) { await this.store.patchTrack(id, { error: undefined, errorStage: undefined, publish: t.autoUpload === false ? 'idle' : 'pending' }); return; }
    const job = [...this.store.data.renderJobs].reverse().find(j => j.trackId === id && j.kind !== 'THREADS_CLIP' && ['error','cancelled'].includes(j.state));
    if (job) await this.retryJob(job.id); else await this.approve(t, t.autoUpload !== false);
  }
  private async render(job: RenderJob) {
    const controller = new AbortController(); this.controllers.set(`render:${job.id}`, controller); let outputKey: string | undefined;
    const t = job.snapshot ?? this.store.track(job.trackId), album = job.album ?? (t ? this.album(t) : undefined);
    try {
      if (!t || !album) throw new Error('渲染來源曲目已不存在。');
      checkAbort(controller.signal); await this.patchJob(job.id, { state: 'running' });
      const { renderTrack, makeThumbnail } = await import('./renderEngine');
      if (job.kind === 'ALBUM_MASTER') { const thumbnail = await makeThumbnail(t, album); checkAbort(controller.signal); await putMedia(`${t.id}/thumbnail`, thumbnail); await this.store.patchTrack(t.id, { thumbnailKey: `${t.id}/thumbnail` }); }
      let lastProgressUpdate = -Infinity;
      outputKey = await renderTrack(t, album, p => {
        const now = performance.now();
        // Progress writes clone/persist the library. Cap UI work without
        // changing frame generation, encoding, or the final completion write.
        if (p < 100 && now - lastProgressUpdate < 250) return;
        lastProgressUpdate = now;
        void this.patchJob(job.id, { progress: p }).catch(() => controller.abort());
      }, controller.signal, job.range);
      checkAbort(controller.signal);
      const oldKey = job.kind === 'THREADS_CLIP' ? this.store.track(t.id)?.threads?.outputKey : this.store.track(t.id)?.outputKey;
      await this.store.change(data => {
        const current = data.renderJobs.find(j => j.id === job.id), track = findTrack(data,t.id); if (!current || !track) throw new Error('曲目已不存在。');
        Object.assign(current, { state: 'completed', progress: 100, outputKey, snapshot: undefined });
        if (job.kind === 'THREADS_CLIP') Object.assign(track.threads!, { render: 'completed', renderProgress: 100, outputKey, lastRenderedAt: Date.now(), lastRenderedRange: job.range, error: undefined });
        else Object.assign(track, { outputKey, render: 'completed', publish: t.autoUpload === false ? 'idle' : 'pending', renderProgress: 100, error: undefined, errorStage: undefined });
        if (oldKey && oldKey !== outputKey) for (const previous of data.renderJobs) if (previous.outputKey === oldKey) previous.outputKey = undefined;
      });
      if (oldKey && oldKey !== outputKey) await deleteMedia(oldKey);
      // A blocked delayed download never changes the completed render state.
      if (job.kind === 'THREADS_CLIP') { try { const blob = await getMedia(outputKey); if (blob) download(blob, threadsFilename(t)); } catch {} }
    } catch (e) {
      if (outputKey && controller.signal.aborted) await deleteMedia(outputKey);
      await this.patchJob(job.id, { state: controller.signal.aborted ? 'cancelled' : 'error', error: controller.signal.aborted ? undefined : e instanceof Error ? e.message : String(e) }).catch(() => {});
    } finally { this.controllers.delete(`render:${job.id}`); this.rendering = undefined; this.pump(); }
  }
  private async publish(t: TrackProject) {
    const controller = new AbortController(); this.controllers.set(`publish:${t.id}`, controller);
    try {
      await this.store.patchTrack(t.id, { publish: 'running' }); const video = await getMedia(t.outputKey!); if (!video) throw new Error('已保存的 MP4 不存在。');
      await publishTrack(t, video, t.thumbnailKey ? await getMedia(t.thumbnailKey) : undefined, p => this.store.patchTrack(t.id, p), controller.signal);
    } catch (e) { await this.store.patchTrack(t.id, { publish: controller.signal.aborted ? 'cancelled' : 'error', errorStage: controller.signal.aborted ? undefined : 'publish', error: controller.signal.aborted ? undefined : e instanceof Error ? e.message : String(e) }).catch(() => {}); }
    finally { this.controllers.delete(`publish:${t.id}`); this.publishing = undefined; this.pump(); }
  }
}
