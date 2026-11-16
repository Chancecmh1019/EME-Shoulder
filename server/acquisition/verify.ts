import { execFileSync } from 'node:child_process';
import { readFileSync, writeFileSync, existsSync, readdirSync, copyFileSync, renameSync } from 'node:fs';
import { resolve, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { fileHash } from './audio.ts';
import { normalizeSource, stamp } from '../../studio/lrc.ts';
import { pythonCommand } from './python.ts';
export async function verifyAcquisition(id: string, model = 'base') {
  if (!/^[a-f0-9]{20}$/.test(id) || !['tiny', 'base', 'small', 'medium', 'tiny.en', 'base.en', 'small.en'].includes(model)) throw new Error('INVALID_TASK_OR_MODEL');
  const directory = resolve('.studio/acquisition/jobs', id), path = join(directory, 'report.json'), report = JSON.parse(readFileSync(path, 'utf8'));
  function save(state: string, reason: string) { report.state = state; report.translationAllowed = state === 'TRANSLATION_READY'; report.events.push({ state, reason, at: new Date().toISOString() }); writeFileSync(`${path}.tmp`, JSON.stringify(report, null, 2)); renameSync(`${path}.tmp`, path); }
  if (!report.audio?.path || !report.lyrics?.path) { save('AUDIO_PENDING', '缺少完整音訊或同步原文，沒有啟動語音模型，也沒有放行翻譯。'); return report; }
  const audioHash = await fileHash(report.audio.path), sourceHash = await fileHash(report.lyrics.path);
  if (audioHash !== report.audio.sha256 || sourceHash !== report.lyrics.sha256) { save('BLOCKED', '素材雜湊已變更，原檢查作廢；請重新匯入並取得對應版本。'); return report; }
  let evidencePath = join(directory, `asr-${model}.json`);
  let evidence = existsSync(evidencePath) ? JSON.parse(readFileSync(evidencePath, 'utf8')) : undefined;
  if (evidence?.audioSha256 === audioHash && evidence.verification?.sourceSha256 !== sourceHash && Number.isSafeInteger(report.lyrics.globalOffsetMs)) {
    const originalHash = await fileHash(report.lyrics.originalPath), source = normalizeSource(readFileSync(report.lyrics.path, 'utf8')).lines;
    if (originalHash !== report.lyrics.originalSha256 || evidence.verification.sourceSha256 !== originalHash || evidence.verification.lines.length !== source.length || source.some((line, i) => line.original !== evidence.verification.lines[i].original || line.timeMs !== evidence.verification.lines[i].timeMs + report.lyrics.globalOffsetMs)) throw new Error('OFFSET_EVIDENCE_BINDING_FAILED');
    const parentEvidenceHash = await fileHash(evidencePath);
    evidence = { ...evidence, sourceTimingAdjustment: { globalOffsetMs: report.lyrics.globalOffsetMs, parentEvidenceHash, originalSourceSha256: originalHash }, verification: { ...evidence.verification, sourceSha256: sourceHash, lines: evidence.verification.lines.map((line: any, i: number) => ({ ...line, timeMs: source[i].timeMs })) } };
    evidencePath = join(directory, `alignment-${model}-offset-${report.lyrics.globalOffsetMs}.json`);
    writeFileSync(evidencePath, JSON.stringify(evidence, null, 2));
  }
  if (!evidence || evidence.audioSha256 !== audioHash || evidence.verification?.sourceSha256 !== sourceHash) {
    const prior = readdirSync(directory).filter(f => /^asr-(tiny|base|small|medium)(\.en)?(-tail)?\.json$/.test(f));
    if (prior.length >= 3) { save('BLOCKED', '本素材已達三次語音辨識檢查上限；保留診斷，等待可靠新證據或人工聆聽複核。'); return report; }
    try {
      execFileSync(pythonCommand(), [fileURLToPath(new URL('../../scripts/verify-acquired-audio.py', import.meta.url)), report.audio.path, evidencePath, model, report.language ?? 'auto', report.lyrics.path], { timeout: 1800000, maxBuffer: 2 * 1024 * 1024, windowsHide: true, env: { ...process.env, HF_HUB_DISABLE_TELEMETRY: '1', HF_HUB_DISABLE_SYMLINKS_WARNING: '1' }, stdio: ['ignore', 'pipe', 'pipe'] });
      evidence = JSON.parse(readFileSync(evidencePath, 'utf8'));
    } catch (e) { report.verificationError = e instanceof Error ? e.message.slice(0, 1500) : String(e); save('BLOCKED', '本機辨識或解碼失敗，詳見 verificationError；沒有偽造驗證結果。'); return report; }
  }
  if (evidence.audioSha256 !== audioHash || evidence.verification?.sourceSha256 !== sourceHash || evidence.lyricsUsedAsPrompt !== false) throw new Error('ASR_EVIDENCE_BINDING_FAILED');
  report.verification = { ...evidence.verification, method: evidence.method, model: evidence.model, audioSha256: audioHash, path: evidencePath, inspection: evidence.inspection };
  // The owner explicitly selected first/last correspondence rather than perfect whole-song ASR.
  // Keep the original strict report; this separate policy cannot invent recognition evidence.
  const boundariesPath = join(directory, `boundaries-${model}.json`);
  const tailPath = join(directory, `asr-${model}-tail.json`);
  execFileSync(pythonCommand(), [fileURLToPath(new URL('../../scripts/review-audio-boundaries.py', import.meta.url)), evidencePath, boundariesPath, ...(existsSync(tailPath) ? [tailPath] : [])], { timeout: 15000, windowsHide: true });
  const boundaries = JSON.parse(readFileSync(boundariesPath, 'utf8'));
  if (boundaries.audioSha256 !== audioHash || boundaries.sourceSha256 !== sourceHash) throw new Error('BOUNDARY_EVIDENCE_BINDING_FAILED');
  report.verification = { ...report.verification, diagnosis: boundaries.diagnosis, policy: boundaries.policy, boundariesPath, first: boundaries.first, last: boundaries.last, interiorWeakLines: boundaries.interiorWeakLines, strictWholeSongDiagnosis: boundaries.strictWholeSongDiagnosis };
  if (report.verification.diagnosis === 'PAIR_VERIFIED') {
    copyFileSync(report.lyrics.path, join(directory, 'validated.lrc'));
    save('TRANSLATION_READY', '依擁有者指定的首句／末句最低驗收政策通過；保留中間弱行警示，不宣稱全曲逐字／逐句完美同步。');
  } else if (['GLOBAL_OFFSET', 'SECTION_DRIFT'].includes(report.verification.diagnosis)) save('TIMING_REPAIR', '文字證據足夠但時間需修正；保留原始時間，不自動覆寫。');
  else save('BLOCKED', '人聲對照證據不足；保留實測覆蓋率與弱行，禁止翻譯。');
  return report;
}

export async function recoverEnding(id: string) {
  if (!/^[a-f0-9]{20}$/.test(id)) throw new Error('INVALID_TASK');
  const directory = resolve('.studio/acquisition/jobs', id), report = JSON.parse(readFileSync(join(directory, 'report.json'), 'utf8'));
  const full = JSON.parse(readFileSync(join(directory, 'asr-medium.json'), 'utf8'));
  const audioHash = await fileHash(report.audio.path), output = join(directory, 'asr-medium-tail.json');
  if (audioHash !== report.audio.sha256 || full.audioSha256 !== audioHash) throw new Error('ENDING_AUDIO_BINDING_FAILED');
  if (!existsSync(output)) {
    const attempts = readdirSync(directory).filter(f => /^asr-(tiny|base|small|medium)(\.en)?(-tail)?\.json$/.test(f));
    if (attempts.length >= 3) throw new Error('RECOGNITION_ATTEMPT_LIMIT');
    execFileSync(pythonCommand(), [fileURLToPath(new URL('../../scripts/verify-audio-tail.py', import.meta.url)), report.audio.path, output], { timeout: 240000, maxBuffer: 1024 * 1024, windowsHide: true });
  }
  return verifyAcquisition(id, 'medium');
}
