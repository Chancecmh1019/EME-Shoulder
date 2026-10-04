export interface LyricLine { id: string; startTime: number; endTime: number; original: string; translation: string }
export interface SongMetadata { title: string; artist: string; album: string; albumArtist: string; discNumber?: number; trackNumber?: number; duration: number }
export type JobState = 'idle' | 'pending' | 'running' | 'completed' | 'error' | 'cancelled';
export interface ClipRange { start: number; end: number }
export interface ClipCandidate extends ClipRange { id: string; reasons: string[] }
export interface ThreadsClipState {
  candidates: ClipCandidate[]; selectedCandidate?: string; range?: ClipRange;
  analysis: JobState; analysisFingerprint?: string; analysisProgress?: number;
  render: JobState; renderProgress: number; jobId?: string; outputKey?: string;
  lastRenderedAt?: number; lastRenderedRange?: ClipRange; error?: string;
}
export interface RenderJob {
  id: string; trackId: string; kind: 'ALBUM_MASTER' | 'MV_MASTER' | 'THREADS_CLIP';
  enqueuedAt: number; state: JobState; progress: number; range?: ClipRange;
  snapshot?: TrackProject; album?: Pick<AlbumProject, 'id' | 'artworkKey' | 'visual'>;
  outputKey?: string; error?: string;
}
export interface TrackProject extends SongMetadata {
  id: string; kind: 'lyric' | 'mv'; importOrder: number; sourceKey: string; audioKey: string;
  artworkKey?: string; lyrics: LyricLine[]; untimedLyrics?: string; lyricOffset: number;
  review: 'needs-lyrics' | 'needs-review' | 'approved'; thumbnailSeed: number;
  titleOverride?: string; descriptionOverride?: string; privacy: 'private' | 'unlisted' | 'public';
  render: JobState; publish: JobState; renderProgress: number; uploadProgress: number;
  outputKey?: string; thumbnailKey?: string; youtubeId?: string; uploadUrl?: string; uploadedBytes?: number;
  error?: string; errorStage?: 'import' | 'render' | 'publish'; approvedAt?: number; autoUpload?: boolean;
  threads?: ThreadsClipState;
}
export interface VisualConfig { fps: 30 | 60; flowSpeed: number; fontScale: number; vignette: number }
export interface AlbumProject { id: string; title: string; artist: string; artworkKey?: string; visual: VisualConfig; tracks: TrackProject[]; createdAt: number; updatedAt: number }
export interface CorrectionLog { type: 'success' | 'warning' | 'error'; message: string }
export interface LyricDraft { input: string; output: string; format: 'lrc' | 'srt'; convertChinese: boolean; offset: number; logs: CorrectionLog[] }
export interface Library { albums: AlbumProject[]; mv: TrackProject[]; lab: LyricLine[]; labText: string; labDraft?: LyricDraft; labPromptFormat?: 'lrc' | 'srt'; renderJobs: RenderJob[]; lastAlbumId?: string; lastTrackId?: string }
export interface RenderClock { currentTimeSeconds: number; frameIndex?: number }
export const defaultVisual: VisualConfig = { fps: 60, flowSpeed: 0.35, fontScale: 1, vignette: 0.22 };
export const emptyLibrary = (): Library => ({ albums: [], mv: [], lab: [], labText: '', renderJobs: [] });
export const newThreadsClip = (): ThreadsClipState => ({ candidates: [], analysis: 'idle', render: 'idle', renderProgress: 0 });
export function trackStatus(t: TrackProject): string {
  if (t.error) return 'Error';
  if (t.publish === 'completed') return 'Uploaded';
  if (t.publish === 'running') return 'Uploading';
  if (t.render === 'running') return 'Rendering';
  if (t.render === 'pending') return 'Queued';
  if (t.publish === 'pending') return 'Waiting to upload';
  if (t.review === 'needs-lyrics') return 'Needs Lyrics';
  if (t.review === 'needs-review') return 'Needs Review';
  if (t.render === 'completed') return 'Rendered';
  return 'Ready';
}
