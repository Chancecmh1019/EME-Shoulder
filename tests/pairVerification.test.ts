import { test } from 'node:test';
import assert from 'node:assert/strict';
import { verifyPair, type PairEvidence } from '../studio/pairVerification.ts';
import { inspectPcmWav } from '../server/studio/media.ts';
import { syntheticWav } from './helpers/wav.ts';
const lines = [{ id: 'a', timeMs: 1000, original: 'The sea returns' }, { id: 'b', timeMs: 3000, original: 'I wait for you' }];
const audio = inspectPcmWav(syntheticWav());
const evidence: PairEvidence = { method: 'owner-listening', fullRecordingReviewed: true, reference: 'Synthetic observation fixture, not real speech verification', audioIdentity: 'match', lyricIdentity: 'match', recordingVersion: 'match', observations: lines.map(l => ({ lineId: l.id, text: l.original, startMs: l.timeMs, endMs: l.timeMs + 500 })) };
test('diagnoses audio/lyrics/version failures separately and fails closed on missing vocal evidence', () => {
  assert.equal(verifyPair(lines, audio, { ...evidence, audioIdentity: 'mismatch' }).diagnosis, 'INCORRECT_AUDIO');
  assert.equal(verifyPair(lines, audio, { ...evidence, recordingVersion: 'mismatch' }).diagnosis, 'INCORRECT_AUDIO');
  assert.equal(verifyPair(lines, audio, { ...evidence, lyricIdentity: 'mismatch' }).diagnosis, 'INCORRECT_LYRICS');
  assert.equal(verifyPair(lines, audio, { ...evidence, audioIdentity: 'mismatch', lyricIdentity: 'mismatch' }).diagnosis, 'BOTH_INCORRECT');
  assert.equal(verifyPair(lines, audio, { ...evidence, observations: [] }).diagnosis, 'INSUFFICIENT_EVIDENCE');
  assert.equal(verifyPair(lines, { ...audio, decoded: false }, evidence).diagnosis, 'INSUFFICIENT_EVIDENCE');
  assert.equal(verifyPair(lines, audio, { ...evidence, observations: evidence.observations.map(l => ({ ...l, text: 'a completely different lyric' })) }).diagnosis, 'INCORRECT_LYRICS');
});
test('uniform offset is timing repair, variable drift is line repair; neither is mislabeled wrong song', () => {
  const shifted = { ...evidence, observations: evidence.observations.map(l => ({ ...l, startMs: l.startMs + 400, endMs: l.endMs + 400 })) };
  const uniform = verifyPair(lines, audio, shifted);
  assert.equal(uniform.diagnosis, 'GLOBAL_OFFSET'); assert.equal(uniform.offsetMs, 400);
  assert.equal(verifyPair(lines, audio, { ...shifted, observations: shifted.observations.map((l, i) => ({ ...l, startMs: l.startMs + i * 500, endMs: l.endMs + i * 500 })) }).diagnosis, 'SECTION_DRIFT');
  const verified = verifyPair(lines, audio, evidence); assert.equal(verified.diagnosis, 'PAIR_VERIFIED'); assert.equal(verified.machineVocalRecognition, false);
});
test('actual PCM integrity rejects truncated bytes and detects silent audio; energy never proves lyrics', () => {
  const wav = syntheticWav(); assert.equal(audio.decoded, true); assert.equal(audio.lyricIdentityVerified, false);
  assert.throws(() => inspectPcmWav(wav.subarray(0, wav.length - 1)), { code: 'AUDIO_CORRUPT' });
  wav.fill(0, 44); const silent = inspectPcmWav(wav);
  assert.equal(silent.rms, 0); assert.equal(verifyPair(lines, silent, evidence).diagnosis, 'INSUFFICIENT_EVIDENCE');
});
test('owner-selected boundary scope needs actual first and last evidence and does not claim interior review', () => {
  const expanded = [lines[0], { id: 'middle', timeMs: 2000, original: 'Interior line is not reviewed' }, lines[1]];
  const boundary: PairEvidence = { ...evidence, reviewScope: 'first-last', boundariesReviewed: true, fullRecordingReviewed: false };
  const result = verifyPair(expanded, audio, boundary);
  assert.equal(result.diagnosis, 'PAIR_VERIFIED'); assert.equal(result.interiorReviewed, false);
  assert.equal(verifyPair(expanded, audio, { ...boundary, boundariesReviewed: false }).diagnosis, 'INSUFFICIENT_EVIDENCE');
  assert.equal(verifyPair(expanded, audio, { ...boundary, observations: [boundary.observations[0]] }).diagnosis, 'INSUFFICIENT_EVIDENCE');
});
