import { StudioError, type SourceLine } from './lrc.ts';
export interface VocalObservation { lineId: string; text: string; startMs: number; endMs: number }
export interface PairEvidence {
  method: 'owner-listening';
  reviewScope?: 'full-song' | 'first-last';
  boundariesReviewed?: boolean;
  fullRecordingReviewed: boolean;
  reference: string;
  audioIdentity: 'match' | 'mismatch' | 'unknown';
  lyricIdentity: 'match' | 'mismatch' | 'unknown';
  recordingVersion: 'match' | 'mismatch' | 'unknown';
  observations: VocalObservation[];
}
export interface AudioInspection { decoded: boolean; durationMs: number; rms?: number; audibleFraction?: number; clippedFraction?: number }
export type PairDiagnosis = 'INCORRECT_AUDIO' | 'INCORRECT_LYRICS' | 'BOTH_INCORRECT' | 'GLOBAL_OFFSET' | 'SECTION_DRIFT' | 'INSUFFICIENT_EVIDENCE' | 'PAIR_VERIFIED';
const normalized = (s: string) => s.normalize('NFKC').toLocaleLowerCase().replace(/[\p{P}\p{Z}\s]/gu, '');
function similarity(a: string, b: string) {
  const x = [...normalized(a)], y = [...normalized(b)];
  if (!x.length || !y.length || x.length > 2000 || y.length > 2000) return 0;
  let row = Array.from({ length: y.length + 1 }, (_, i) => i);
  for (let i = 1; i <= x.length; i++) { const next = [i]; for (let j = 1; j <= y.length; j++) next[j] = Math.min(row[j] + 1, next[j - 1] + 1, row[j - 1] + (x[i - 1] === y[j - 1] ? 0 : 1)); row = next; }
  return 1 - row[y.length] / Math.max(x.length, y.length);
}
/** No statistical confidence is invented. Owner observations are explicitly human evidence. */
export function verifyPair(lines: SourceLine[], audio: AudioInspection, evidence: PairEvidence) {
  const result = (diagnosis: PairDiagnosis, reason: string, extra: Record<string, unknown> = {}): { diagnosis: PairDiagnosis; reason: string; evidenceKind: string; machineVocalRecognition: boolean } & Record<string, unknown> => ({ diagnosis, reason, evidenceKind: 'OWNER_LISTENING_ATTESTATION', machineVocalRecognition: false, ...extra });
  if (!evidence || evidence.method !== 'owner-listening' || !Array.isArray(evidence.observations) || typeof evidence.reference !== 'string' || evidence.reference.length < 8 || evidence.reference.length > 2000 || !['match', 'mismatch', 'unknown'].includes(evidence.audioIdentity) || !['match', 'mismatch', 'unknown'].includes(evidence.lyricIdentity) || !['match', 'mismatch', 'unknown'].includes(evidence.recordingVersion)) throw new StudioError('INVALID_PAIR_EVIDENCE');
  const badAudio = evidence.audioIdentity === 'mismatch' || evidence.recordingVersion === 'mismatch';
  if (badAudio && evidence.lyricIdentity === 'mismatch') return result('BOTH_INCORRECT', '音檔與歌詞都被觀察為錯誤；從已核實 metadata 重新找候選。');
  if (badAudio) return result('INCORRECT_AUDIO', '拒絕音檔；保留可用歌詞並尋找允許取得的錄音版本。');
  if (evidence.lyricIdentity === 'mismatch') return result('INCORRECT_LYRICS', '保留音檔；改查原文別名、QQ、Apple 或其他允許的來源。');
  if (!audio.decoded || !Number.isFinite(audio.durationMs) || audio.durationMs < 1000 || !(audio.rms! > .001) || !(audio.audibleFraction! > .01) || (audio.clippedFraction ?? 1) > .1) return result('INSUFFICIENT_EVIDENCE', '完整解碼／有效聲音檢查未通過；不能用 metadata 或波形代替聲音內容證據。');
  const boundaryOnly = evidence.reviewScope === 'first-last';
  if (evidence.reviewScope !== undefined && !['first-last', 'full-song'].includes(evidence.reviewScope)) throw new StudioError('INVALID_PAIR_EVIDENCE');
  const requiredLines = boundaryOnly && lines.length > 1 ? [lines[0], lines.at(-1)!] : lines;
  if ((boundaryOnly ? !evidence.boundariesReviewed : !evidence.fullRecordingReviewed) || evidence.audioIdentity !== 'match' || evidence.lyricIdentity !== 'match' || evidence.recordingVersion !== 'match' || evidence.observations.length !== requiredLines.length) return result('INSUFFICIENT_EVIDENCE', '缺少所選範圍的人聲對照、錄音版本或來源身分證據。');
  const offsets: number[] = [], measurements: { lineId: string; similarity: number; startMs: number; endMs: number }[] = [];
  for (const [i, line] of requiredLines.entries()) {
    const observation = evidence.observations[i];
    if (!observation || observation.lineId !== line.id || typeof observation.text !== 'string' || observation.text.length > 2000 || !Number.isSafeInteger(observation.startMs) || !Number.isSafeInteger(observation.endMs) || observation.startMs < 0 || observation.endMs <= observation.startMs || observation.endMs > audio.durationMs + 100 || (i > 0 && observation.startMs < evidence.observations[i - 1].startMs)) return result('INSUFFICIENT_EVIDENCE', '逐句人聲時間／順序證據無效。');
    const score = similarity(line.original, observation.text);
    measurements.push({ lineId: line.id, similarity: score, startMs: observation.startMs, endMs: observation.endMs });
    if (score < .85) return result('INCORRECT_LYRICS', '觀察到的人聲與候選原文有明顯差異；需查證缺句、語言與段落順序。', { measurements });
    offsets.push(observation.startMs - line.timeMs);
  }
  const sorted = [...offsets].sort((a, b) => a - b), median = sorted[Math.floor(sorted.length / 2)], spreadMs = Math.max(...offsets.map(x => Math.abs(x - median)));
  if (spreadMs > (boundaryOnly ? 750 : 300)) return result('SECTION_DRIFT', '文字對應但偏移隨段落變化；需用已觀察到的人聲時間重建逐行 LRC。', { measurements, medianOffsetMs: median, spreadMs });
  if (boundaryOnly ? Math.max(...offsets.map(Math.abs)) > 1500 : Math.abs(median) > 250) return result('GLOBAL_OFFSET', '文字與錄音相符，建議有紀錄地套用全曲偏移後重新驗證。', { measurements, offsetMs: median, spreadMs });
  return result('PAIR_VERIFIED', boundaryOnly ? '依擁有者選定的首句／末句聆聽政策通過；未驗證所有中間行，不宣稱逐字完美同步。' : '整首 owner listening 證據與解碼檢查通過；仍非機器保證語意正確。', { measurements, residualOffsetMs: median, spreadMs, reviewScope: evidence.reviewScope ?? 'full-song', interiorReviewed: !boundaryOnly });
}
