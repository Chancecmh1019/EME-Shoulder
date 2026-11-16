import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync, statSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { acquireAudio } from '../server/acquisition/audio.ts';
import { identityMatch, normalizeProviderLyrics } from '../server/acquisition/lyrics.ts';
import { syntheticWav } from './helpers/wav.ts';
import { readFileSync } from 'node:fs';
import { randomBytes } from 'node:crypto';
import { externalTask, ingestExternalAudio, type ExternalAudioReceipt } from '../server/acquisition/handoff.ts';
import { fileHash } from '../server/acquisition/audio.ts';
import { parseBulkTranslations, trackProgress } from '../studio/dotWorkflow.ts';
test('recording matching rejects wrong artist, live version, short clip and unrelated edition; explicit aliases only', () => {
  const expected = { title: 'November 11th', artist: 'Stray Kids', album: 'November 11th', durationMs: 186000, aliases: ['11월 11일 (November 11th)'], albumAliases: ['11월 11일 (November 11th)'] };
  assert.equal(identityMatch(expected, { title: '11월 11일 (November 11th)', artist: 'Stray Kids', album: '11월 11일 (November 11th)', duration: 186000 }).accepted, true);
  for (const song of [{ title: 'November 11th', artist: 'Someone else', album: 'November 11th', duration: 186000 }, { title: 'November 11th (Live)', artist: 'Stray Kids', album: 'November 11th', duration: 186000 }, { title: 'November 11th', artist: 'Stray Kids', album: 'November 11th', duration: 30000 }]) assert.equal(identityMatch(expected, song).accepted, false);
});
test('provider original-only conversion removes contextual title and QQ credit labels, keeps real zero lyric and ignores translations', () => {
  const source = { original: [[0, 100, 'Test song - Test Artist (별명)'], [100, 200, '词：Author'], [200, 300, '曲：Author'], [300, 400, '编曲：Author'], [5000, 7000, 'A real lyric'], [8000, 9000, '作曲是我的夢']], translated: [[5000, 7000, 'UPSTREAM_TRANSLATION_MUST_NOT_LEAK']] };
  const normalized = normalizeProviderLyrics(source, { title: 'Test song', artist: 'Test Artist' });
  assert.equal(normalized.lines.length, 2); assert.equal(normalized.lines[0].timeMs, 5000); assert.equal(normalized.lines[1].original, '作曲是我的夢');
  assert.equal(normalized.removed.length + normalized.providerRemoved.length, 4); assert.ok(!normalized.lrc.includes('UPSTREAM'));
  assert.equal(normalized.lrc.split('\n').filter(l => l === '[00:00.000]').length, 1);
});
test('local authorized file ingestion transfers a real PCM asset larger than 3 MiB, hashes and reuses it without recopy', async () => {
  const directory = mkdtempSync(join(tmpdir(), 'eme-large-audio-'));
  try {
    const source = join(directory, 'authorized.wav'), out = join(directory, 'task'); mkdirSync(out); writeFileSync(source, syntheticWav(120));
    let progress = 0; const spec = { file: source, permission: { basis: 'synthetic test asset', reference: 'programmatically generated; not a real song' } };
    const result = await acquireAudio(spec, out, bytes => progress = bytes);
    assert.ok(result.bytes > 3 * 1024 * 1024); assert.equal(progress, result.bytes); assert.ok(Math.abs(result.metadata.format.duration! - 120) < .1);
    const time = statSync(result.path).mtimeMs, again = await acquireAudio(spec, out, () => { throw new Error('must not recopy'); });
    assert.equal(again.sha256, result.sha256); assert.equal(statSync(result.path).mtimeMs, time);
  } finally { rmSync(directory, { recursive: true, force: true }); }
});
test('fragmented MP4 with FLAC imports using its parsed audio-track codec, not the filename', async () => {
  const directory = mkdtempSync(join(tmpdir(), 'eme-flac-mp4-'));
  try {
    const result = await acquireAudio({ file: 'tests/fixtures/synthetic-fragmented-flac.m4a', permission: { basis: 'synthetic tone fixture', reference: 'FFmpeg lavfi sine, 2 seconds, no real song' } }, directory, () => {});
    assert.ok(result.metadata.format.codec); assert.ok(Math.abs(result.metadata.format.duration! - 2) < .1);
  } finally { rmSync(directory, { recursive: true, force: true }); }
});
test('external handoff binds task and bytes, rejects wrong duration and replays without releasing translation', async () => {
  const id = randomBytes(10).toString('hex'), directory = join('.studio/acquisition/jobs', id);
  mkdirSync(directory, { recursive: true });
  try {
    const lyric = join(directory, 'source.lrc'); writeFileSync(lyric, '[00:00.000]\n[00:01.000]Synthetic fixture');
    writeFileSync(join(directory, 'report.json'), JSON.stringify({ requested: { title: 'Fixture', artist: 'Generated', durationMs: 2000 }, reference: { id: 'fixture', durationMs: 2000 }, events: [], lyrics: { path: lyric }, state: 'AUDIO_PENDING', translationAllowed: false }));
    const task = externalTask(id), input = join(directory, 'input.wav'); writeFileSync(input, syntheticWav(2));
    const receipt: ExternalAudioReceipt = { schema: 'eme.external-audio-result.v1', jobId: id, requestHash: task.requestHash, provider: 'synthetic fixture, not a real provider', executionMethod: 'owner-import', sourceReference: 'https://example.org/synthetic', acquiredAt: new Date().toISOString(), authorization: { basis: 'generated test', reference: 'test', publicationRights: 'unconfirmed' }, audio: { path: input, sha256: await fileHash(input) } };
    await assert.rejects(ingestExternalAudio({ ...receipt, requestHash: '0'.repeat(64) }), /STALE_EXTERNAL_TASK/);
    await assert.rejects(ingestExternalAudio({ ...receipt, audio: { ...receipt.audio, sha256: '0'.repeat(64) } }), /HASH_MISMATCH/);
    assert.equal((await ingestExternalAudio(receipt)).state, 'PAIR_VERIFICATION');
    assert.equal((await ingestExternalAudio(receipt)).replay, true);
    const wrong = join(directory, 'wrong.wav'); writeFileSync(wrong, syntheticWav(8));
    await assert.rejects(ingestExternalAudio({ ...receipt, audio: { path: wrong, sha256: await fileHash(wrong) } }), /DURATION_CONFLICT/);
    const report = JSON.parse(readFileSync(join(directory, 'report.json'), 'utf8'));
    assert.equal(report.audio.sha256, receipt.audio.sha256); assert.equal(report.translationAllowed, false);
  } finally { rmSync(directory, { recursive: true, force: true }); }
});
test('bulk Dot submission cannot drop or rewrite source fields; progress never invents rendering or upload completion', () => {
  assert.deepEqual({ ...parseBulkTranslations('[{"id":"a","translation":"甲"}]', ['a']) }, { a: '甲' });
  for (const text of ['[]', '[{"id":"a","translation":"甲","timeMs":0}]', '[{"id":"b","translation":"乙"}]']) assert.throws(() => parseBulkTranslations(text, ['a']));
  assert.equal(trackProgress('AUDIO_PENDING').some(stage => stage.complete), false);
  assert.equal(trackProgress('ALIGN').filter(stage => stage.complete).length, 3);
});
