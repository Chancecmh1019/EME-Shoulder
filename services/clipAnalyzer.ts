import type { ClipCandidate, TrackProject } from '../types';
import { checkAbort } from './cancellation';
import { getMedia } from './storage';
export interface ClipAnalyzer { analyze(track: TrackProject, signal: AbortSignal, progress?: (value: number) => void): Promise<ClipCandidate[]> }
export const clipFingerprint = (track: TrackProject) => JSON.stringify([track.audioKey, track.duration, track.lyricOffset, track.lyrics.map(l => [l.startTime, l.endTime, l.original])]);
const normalize = (text: string) => text.toLocaleLowerCase().replace(/[\p{P}\p{S}\s]/gu, '');
// Only analysis text is normalized; the supplied lyrics are never changed.
export function selectClipCandidates(track: TrackProject, energy: number[], binSeconds = .5): ClipCandidate[] {
  const duration = track.duration;
  if (!(duration > 0 && Number.isFinite(duration))) return [];
  if (duration <= 25) return [{ id: 'whole-song', start: 0, end: duration, reasons: ['完整短曲段落'] }];
  const lines = track.lyrics.filter(l => l.original.trim()).map(l => ({ start: l.startTime + track.lyricOffset, end: l.endTime + track.lyricOffset, text: normalize(l.original) }));
  const boundaries = [...new Set([0, ...lines.map(l => l.start).filter(t => t >= 0 && t < duration), duration])].sort((a, b) => a - b);
  const repeated = new Map<string, number>(); lines.forEach(l => { if (l.text) repeated.set(l.text, (repeated.get(l.text) ?? 0) + 1); });
  const peak = Math.max(1e-8, ...energy);
  const mean = (start: number, end: number) => { const values = energy.slice(Math.max(0, Math.floor(start / binSeconds)), Math.ceil(end / binSeconds)); return values.length ? values.reduce((sum, n) => sum + n, 0) / values.length / peak : 0; };
  const windows: { start: number; end: number; clean: boolean }[] = [];
  for (const start of boundaries) for (const end of boundaries) if (end - start >= 25 && end - start <= 40) windows.push({ start, end, clean: true });
  // Instrumental tracks and sparse lyrics still receive locally scored ranges.
  if (!windows.length || lines.length < 3) for (let start = 0; start < duration - 25; start += 3) windows.push({ start, end: Math.min(duration, start + 32), clean: false });
  const scored = windows.map(w => {
    const inside = lines.filter(l => l.start >= w.start - .001 && l.start < w.end);
    const repeats = inside.filter(l => (repeated.get(l.text) ?? 0) > 1).length / Math.max(1, inside.length);
    const loudness = mean(w.start, w.end), increase = Math.max(0, mean(w.start, w.start + 4) - mean(Math.max(0, w.start - 4), w.start));
    const tail = mean(Math.max(w.start, w.end - 3), w.end);
    const score = loudness * 3 + repeats * 1.6 + increase + (w.clean ? 1 : 0) + Math.min(inside.length / 6, 1) + (w.start / duration > .55 ? .3 : 0) - Math.abs(w.end - w.start - 32) / 18 - (w.start < 5 ? .7 : 0) - (tail < .03 && energy.length ? 1 : 0);
    const reasons = [w.clean ? '完整歌詞邊界' : '音樂能量段落', ...(repeats > .3 ? ['重複歌詞段落'] : []), ...(loudness > .5 ? ['音樂能量較集中'] : []), ...(increase > .1 ? ['能量逐步上升'] : []), ...(w.start / duration > .65 ? ['後段情緒延伸'] : [])];
    return { ...w, score, reasons };
  }).sort((a, b) => b.score - a.score || a.start - b.start);
  const result: ClipCandidate[] = [];
  for (const w of scored) {
    const overlaps = result.some(c => Math.max(0, Math.min(c.end, w.end) - Math.max(c.start, w.start)) / Math.min(c.end - c.start, w.end - w.start) > .65);
    if (!overlaps) result.push({ id: `clip-${Math.round(w.start * 1000)}-${Math.round(w.end * 1000)}`, start: w.start, end: w.end, reasons: w.reasons });
    if (result.length === 3) break;
  }
  return result;
}
export class LocalClipAnalyzer implements ClipAnalyzer {
  async analyze(track: TrackProject, signal: AbortSignal, progress: (value: number) => void = () => {}) {
    checkAbort(signal); const blob = await getMedia(track.audioKey); if (!blob) throw new Error('找不到音訊，請重新匯入。');
    const { Input, BlobSource, ALL_FORMATS, AudioBufferSink } = await import('mediabunny');
    const input = new Input({ source: new BlobSource(blob), formats: ALL_FORMATS });
    let iterator: AsyncIterator<{ buffer: AudioBuffer; timestamp: number }> | undefined;
    try {
      const audio = await input.getPrimaryAudioTrack(); if (!audio) throw new Error('音訊沒有可讀取的聲音軌。');
      const sums: number[] = [], counts: number[] = []; const bin = .5;
      iterator = new AudioBufferSink(audio).buffers()[Symbol.asyncIterator]();
      let next = await iterator.next(), lastYield = 0;
      while (!next.done) {
        checkAbort(signal); const { buffer, timestamp } = next.value;
        const stride = Math.max(1, Math.round(buffer.sampleRate / 8000));
        for (let channel = 0; channel < buffer.numberOfChannels; channel++) { const samples = buffer.getChannelData(channel); for (let i = 0; i < samples.length; i += stride) { const index = Math.floor((timestamp + i / buffer.sampleRate) / bin); if (index < 0) continue; sums[index] = (sums[index] ?? 0) + samples[i] ** 2; counts[index] = (counts[index] ?? 0) + 1; } }
        progress(Math.min(98, (timestamp + buffer.duration) / track.duration * 100));
        if (timestamp - lastYield > 1) { await new Promise(resolve => setTimeout(resolve, 0)); lastYield = timestamp; }
        next = await iterator.next();
      }
      checkAbort(signal); const energy = Array.from({ length: Math.ceil(track.duration / bin) }, (_, i) => Math.sqrt((sums[i] ?? 0) / Math.max(1, counts[i] ?? 0)));
      progress(100); return selectClipCandidates(track, energy, bin);
    } finally { await iterator?.return?.(); input.dispose(); }
  }
}
