import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { execFileSync } from 'node:child_process';
import { StudioRepository, sha256 } from '../server/studio/repository.ts';
import { normalizeSource, validateTranslation, bilingualLrc } from '../studio/lrc.ts';
import { studioHandler } from '../server/studio/http.ts';
import { parseLRC, serializeLRC, parseSRT, serializeSRT } from '../utils/parsers.ts';
import { correctLyrics, newLyricDraft } from '../utils/lyricCorrection.ts';
import { translationPrompts } from '../utils/translationPrompts.ts';

const source = '[00:00.000]\r\n[00:00.100]作曲：測試者\r\n[00:04.125]The sea returns\r\n[00:08.750]I write the song';
const input = { title: 'Synthetic album', albumContext: '測試資料，無故事假設', tracks: [{ title: 'Synthetic song', sourceLrc: source }] };
function submission(repo: StudioRepository, track: string) {
  const p = repo.package('owner', track);
  return { sourceRevision: p.sourceRevision, sourceHash: p.sourceHash, promptHash: p.promptHash, lines: p.lines.map((l, i) => ({ ...l, translation: i ? '我寫下這首歌' : '海潮，再次歸來' })) };
}
function fixture() { const repo = new StudioRepository(':memory:'); const job = repo.create('owner', 'create-key-001', input); const track = String(job.tracks[0].id); return { repo, job, track }; }

test('prompt file is byte-for-byte unchanged from baseline; package exposes exact current literal', () => {
  const original = execFileSync('git', ['show', '9f34162:utils/translationPrompts.ts']);
  assert.deepEqual(readFileSync(new URL('../utils/translationPrompts.ts', import.meta.url)), original);
  const { repo, track } = fixture();
  try { const p = repo.package('owner', track); assert.equal(p.exactLrcPrompt, translationPrompts.lrc); assert.equal(p.promptHash, sha256(translationPrompts.lrc)); assert.equal(p.lines.length, 2); assert.ok(!JSON.stringify(p).includes('sourceTranslation')); } finally { repo.close(); }
});
test('source normalization preserves zero originals, simultaneous originals, Unicode and contextual credits', () => {
  const result = normalizeSource('\uFEFF[00:00.000]\r\n[00:00.000]Composer: Tester\r\n[00:00.000]作曲是我的夢\r\n[00:00.000]君と 바다\r\n[00:02.001]作曲：這句已是正文');
  assert.equal(result.lines.length, 3); assert.equal(result.lines[0].timeMs, 0); assert.equal(result.lines[2].original, '作曲：這句已是正文'); assert.equal(result.removed.length, 2);
  assert.throws(() => normalizeSource('[offset:-10]\n[00:01]hello'), /OFFSET_REQUIRES_REVIEW/);
  assert.throws(() => normalizeSource('[00:01]<00:01.20>word'), { code: 'INVALID_SOURCE_ROW' });
  assert.throws(() => normalizeSource('[00:01]a\n[00:00]b'), /TIMING_ORDER/);
  assert.throws(() => normalizeSource('[00:01.000]'), /EMPTY_SOURCE_LINE/);
});
test('legacy parser/export/correction keeps exactly one sentinel without moving real first lyric', () => {
  let text = '[00:00.000]\n[00:00.000]\n[00:00.000]Hello\n[00:00.000]你好\n[00:14.500]Sea\n[00:14.500]海';
  for (let i = 0; i < 3; i++) { const parsed = parseLRC(text); assert.equal(parsed.length, 2); assert.equal(parsed[0].original, 'Hello'); text = serializeLRC(parsed); assert.equal(text.split('\n').filter(l => l === '[00:00.000]').length, 1); }
  assert.equal(parseLRC('[offset:2000]\n[00:00.000]\n[00:14.500]First')[0].startTime, 16.5);
  const corrected = correctLyrics({ ...newLyricDraft(text), convertChinese: false });
  assert.equal(corrected.output.split('\n').filter(l => l === '[00:00.000]').length, 1);
  assert.equal(correctLyrics({ ...newLyricDraft(corrected.output), convertChinese: false }).output, corrected.output);
});
test('independent SRT workflow round-trips', () => {
  const srt = '1\n00:00:01,000 --> 00:00:03,500\n字幕測試';
  assert.equal(serializeSRT(parseSRT(srt)), srt);
});
test('single-track create → exact package → external fixture submission → QA and LRC; no audio/render claim', () => {
  const { repo, job, track } = fixture();
  try {
    const result = repo.submit('owner', track, 'translation-001', submission(repo, track));
    assert.equal(result.state, 'ALIGN'); assert.equal(result.meaningVerified, false); assert.equal(result.alignmentVerified, false);
    assert.match(result.bilingualLrc, /^\[00:00.000\]\n\[00:04.125\]The sea returns\n\[00:04.125\]海潮 再次歸來/);
    assert.equal(result.fixes.length, 1); assert.equal(repo.job('owner', job.id).capabilities.youtube, 'DISABLED');
    assert.equal(repo.job('owner', job.id).events.length, 3);
  } finally { repo.close(); }
});
test('idempotency replay survives response loss; changed input conflicts without duplicate events', () => {
  const { repo, job, track } = fixture();
  try {
    assert.equal(repo.create('owner', 'create-key-001', input).id, job.id);
    assert.throws(() => repo.create('owner', 'create-key-001', { ...input, title: 'changed' }), /IDEMPOTENCY_CONFLICT/);
    const body = submission(repo, track), a = repo.submit('owner', track, 'translation-001', body), b = repo.submit('owner', track, 'translation-001', body);
    assert.deepEqual(a, b); assert.equal(repo.job('owner', job.id).events.length, 3);
    assert.throws(() => repo.submit('owner', track, 'translation-002', body), /TRANSLATION_ALREADY/);
  } finally { repo.close(); }
});
test('stale source or prompt returns conflict; no partial writes', () => {
  const { repo, job, track } = fixture();
  try {
    const old = submission(repo, track);
    repo.replaceSource('owner', track, 1, '[00:05.000]A changed line');
    assert.throws(() => repo.submit('owner', track, 'translation-old', old), /歌詞或提示詞已更新/);
    const body = submission(repo, track); body.promptHash = 'stale';
    assert.throws(() => repo.submit('owner', track, 'translation-new', body), /歌詞或提示詞已更新/);
    assert.equal(repo.job('owner', job.id).tracks[0].state, 'TRANSLATE');
    assert.equal(repo.db.prepare('SELECT count(*) n FROM translations').get()?.n, 0);
    assert.throws(() => repo.db.prepare("UPDATE sources SET raw='overwrite'").run(), /immutable/);
    assert.throws(() => repo.db.prepare("DELETE FROM events").run(), /immutable/);
  } finally { repo.close(); }
});
test('format, timing, source preservation, line IDs, repeated variants and script warnings', () => {
  const lines = normalizeSource('[00:01.111]Again\n[00:03.222]Again').lines;
  const translations = lines.map(l => ({ ...l, translation: 'again' }));
  assert.ok(validateTranslation(lines, translations).warnings.includes('REPEATED_LINE_VARIATION_REQUIRED'));
  assert.throws(() => validateTranslation(lines, translations.slice(1)), /LINE_COUNT/);
  assert.throws(() => validateTranslation(lines, translations.map(l => ({ ...l, timeMs: 0 }))), /SOURCE_PAIR/);
  assert.throws(() => validateTranslation(lines, translations.map(l => ({ ...l, original: 'edited' }))), /SOURCE_PAIR/);
  assert.throws(() => validateTranslation(lines, translations.map(l => ({ ...l, translation: 'a\nb' }))), /INVALID_TRANSLATION/);
  assert.equal(bilingualLrc(validateTranslation(lines, translations).lines).split('\n').length, 5);
});
test('restart preserves work; ownership prevents cross-owner access', () => {
  const directory = mkdtempSync(join(tmpdir(), 'eme-studio-')), path = join(directory, 'test.sqlite');
  let repo = new StudioRepository(path);
  try {
    const job = repo.create('owner', 'create-key-001', input), track = String(job.tracks[0].id);
    const body = submission(repo, track); repo.submit('owner', track, 'translation-001', body); repo.close(); repo = new StudioRepository(path);
    assert.equal(repo.job('owner', job.id).tracks[0].state, 'ALIGN');
    assert.match(repo.result('owner', track).bilingualLrc, /The sea returns/);
    assert.throws(() => repo.result('intruder', track), /NOT_FOUND/);
    assert.deepEqual(repo.submit('owner', track, 'translation-001', body).state, 'ALIGN');
    assert.throws(() => repo.job('intruder', job.id), /NOT_FOUND/);
    assert.throws(() => repo.package('intruder', track), /NOT_FOUND/);
    assert.throws(() => repo.cancel('intruder', track), /NOT_FOUND/);
    assert.equal(repo.list('intruder').length, 0);
  } finally { repo.close(); rmSync(directory, { recursive: true, force: true }); }
});
test('album tracks advance independently; cancelled track cannot submit', () => {
  const repo = new StudioRepository(':memory:');
  try {
    const j = repo.create('owner', 'album-key-001', { ...input, tracks: [input.tracks[0], { title: 'Second', sourceLrc: '[00:05.000]A second song' }] });
    const a = String(j.tracks[0].id), b = String(j.tracks[1].id), old = submission(repo, a);
    repo.cancel('owner', a); repo.submit('owner', b, 'translation-002', submission(repo, b));
    assert.throws(() => repo.submit('owner', a, 'translation-001', old), /TRACK_CANCELLED/);
    assert.deepEqual(repo.job('owner', j.id).tracks.map(t => t.state), ['CANCELLED', 'ALIGN']);
  } finally { repo.close(); }
});
test('atomic lease fencing, heartbeat, expiry and bounded retries', () => {
  let now = 100000; const repo = new StudioRepository(':memory:', () => now);
  try {
    const j = repo.create('owner', 'lease-key-001', input), track = String(j.tracks[0].id);
    const lease = repo.claim('owner', track, 'worker-a');
    assert.throws(() => repo.submit('owner', track, 'translation-001', submission(repo, track)), /LEASE_CONFLICT/);
    assert.throws(() => repo.claim('owner', track, 'worker-b'), /LEASE_BUSY/);
    assert.throws(() => repo.heartbeat('owner', track, 'wrong'), /LEASE_EXPIRED/);
    now += 1000; assert.ok(repo.heartbeat('owner', track, lease.token).expiresAt > lease.expiresAt);
    now += 130000; assert.throws(() => repo.heartbeat('owner', track, lease.token), /LEASE_EXPIRED/);
    repo.claim('owner', track, 'worker-b'); now += 130000; repo.claim('owner', track, 'worker-c'); now += 130000;
    assert.throws(() => repo.claim('owner', track, 'worker-d'), /RETRY_LIMIT/);
  } finally { repo.close(); }
});
test('lease replacement fences old worker; accepted worker may replay receipt after lease removal', () => {
  let now = 100000; const repo = new StudioRepository(':memory:', () => now);
  try {
    const j = repo.create('owner', 'lease-key-002', input), track = String(j.tracks[0].id);
    const first = repo.claim('owner', track, 'worker-a'); now += 130000;
    const second = repo.claim('owner', track, 'worker-b');
    assert.throws(() => repo.submit('owner', track, 'translation-001', { ...submission(repo, track), leaseToken: first.token }), /LEASE_CONFLICT/);
    const body = { ...submission(repo, track), leaseToken: second.token };
    const a = repo.submit('owner', track, 'translation-002', body);
    assert.deepEqual(repo.submit('owner', track, 'translation-002', body), a);
  } finally { repo.close(); }
});
test('a real server prompt change invalidates a previously read package', () => {
  let prompt = 'original exact prompt\r\n';
  const repo = new StudioRepository(':memory:', () => Date.now(), () => prompt);
  try {
    const j = repo.create('owner', 'prompt-key-001', input), track = String(j.tracks[0].id), old = submission(repo, track);
    prompt += 'changed';
    assert.throws(() => repo.submit('owner', track, 'translation-001', old), { code: 'REVISION_CONFLICT' });
    assert.equal(repo.package('owner', track).exactLrcPrompt, prompt);
  } finally { repo.close(); }
});
test('two database connections cannot claim the same track; invalid album leaves no partial rows', () => {
  const directory = mkdtempSync(join(tmpdir(), 'eme-concurrency-')), path = join(directory, 'test.sqlite');
  const a = new StudioRepository(path), b = new StudioRepository(path);
  try {
    assert.throws(() => a.create('owner', 'bad-album-key', { ...input, tracks: [input.tracks[0], { title: 'bad', sourceLrc: 'untimed' }] }));
    assert.equal(a.list('owner').length, 0);
    const j = a.create('owner', 'multi-db-key', input), track = String(j.tracks[0].id);
    a.claim('owner', track, 'worker-a');
    assert.throws(() => b.claim('owner', track, 'worker-b'), /LEASE_BUSY/);
  } finally { a.close(); b.close(); rmSync(directory, { recursive: true, force: true }); }
});
test('HTTP rejects unauthenticated, CSRF, wrong owner, oversized payload, arbitrary actions and method; no token disclosure', async () => {
  const { repo, track } = fixture();
  const handler = studioHandler({ owner: req => { if (!req.testOwner) throw new Error('no session'); return req.testOwner; }, origin: () => 'https://studio.test', repository: () => repo });
  async function call(overrides = {}) {
    let status = 200, body: any;
    const response = { setHeader() {}, status(value: number) { status = value; return this; }, json(value: unknown) { body = value; } };
    await handler({ method: 'GET', query: { action: 'package', id: track }, headers: {}, ...overrides }, response);
    return { status, body };
  }
  try {
    assert.equal((await call()).status, 401);
    assert.equal((await call({ testOwner: 'intruder' })).status, 404);
    assert.equal((await call({ testOwner: 'owner', method: 'POST' })).status, 403);
    assert.equal((await call({ testOwner: 'owner', method: 'DELETE' })).status, 405);
    assert.equal((await call({ testOwner: 'owner', body: { huge: 'x'.repeat(200001) } })).status, 413);
    assert.equal((await call({ testOwner: 'owner', query: { action: 'token' } })).status, 404);
    const good = await call({ testOwner: 'owner' }); assert.equal(good.status, 200); assert.ok(!JSON.stringify(good.body).includes('accessToken'));
  } finally { repo.close(); }
});
test('durable rate limit persists and resets by window', () => {
  let now = 100000; const repo = new StudioRepository(':memory:', () => now);
  try { for (let i = 0; i < 60; i++) repo.rateLimit('owner'); assert.throws(() => repo.rateLimit('owner'), /RATE_LIMIT/); now += 60000; assert.doesNotThrow(() => repo.rateLimit('owner')); } finally { repo.close(); }
});
