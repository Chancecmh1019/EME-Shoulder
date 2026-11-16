import { test } from 'node:test';
import assert from 'node:assert/strict';
import { PGlite } from '@electric-sql/pglite';
import { readFile, mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { PostgresRepository } from '../server/studio/postgres.ts';
import { Sessions, SESSION_COOKIE } from '../server/studio/sessions.ts';
import { ScopedRepository } from '../server/studio/scoped.ts';
import { Assets } from '../server/studio/assets.ts';
import type { SqlPool } from '../server/studio/sql.ts';
import { PairWorkflow } from '../server/studio/pairWorkflow.ts';
import { syntheticWav } from './helpers/wav.ts';
import { authHandler } from '../server/studio/auth-http.ts';

export function pglitePool(db: PGlite): SqlPool {
  return {
    async query(sql, values) { const r = await db.query(sql, values); return { rows: r.rows, rowCount: r.affectedRows }; },
    async connect() { return { query: async (sql, values) => { const r = await db.query(sql, values); return { rows: r.rows, rowCount: r.affectedRows }; }, release() {} }; },
    async end() { await db.close(); },
  };
}
test('PostgreSQL migration, immutable data, durable restart, Dot scope and revocation (PGlite engine; not hosted Supabase)', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'eme-postgres-'));
  let db = new PGlite(directory), repo = new PostgresRepository(pglitePool(db));
  try {
    await db.exec(await readFile(new URL('../supabase/migrations/202611140001_studio.sql', import.meta.url), 'utf8'));
    await db.exec(await readFile(new URL('../supabase/migrations/202611150002_pair_gate.sql', import.meta.url), 'utf8'));
    const objects = new Map<string, Uint8Array>();
    let assets = new Assets(repo.pool, { async put(key, bytes) { objects.set(key, bytes.slice()); }, async get(key) { return objects.get(key)!; } });
    const owner = { owner: 'owner', role: 'owner' as const, expiresAt: Date.now() + 100000 };
    const jobInput = { title: 'Cloud fixture', albumContext: '', tracks: [{ title: 'fixture', sourceLrc: '[00:01.000]The sea\n[00:03.000]Returns' }] };
    const job = await repo.create('owner', 'cloud-create-001', jobInput);
    assert.equal((await repo.create('owner', 'cloud-create-001', jobInput)).id, job.id);
    const track = job.tracks[0].id;
    await assert.rejects(() => repo.package('owner', track), { code: 'PAIR_UNVERIFIED' });
    const audio = await assets.put(owner, job.id, 'audio', syntheticWav());
    const workflow = new PairWorkflow(repo.pool);
    await workflow.selectAudio(owner, track, audio.id);
    // Injected listening observations exercise the gate; a sine signal is NOT real lyric evidence.
    const evidence = { method: 'owner-listening' as const, fullRecordingReviewed: true, reference: 'TEST DOUBLE: not a real listening review', audioIdentity: 'match' as const, lyricIdentity: 'match' as const, recordingVersion: 'match' as const, observations: [{ lineId: 'line-1', text: 'The sea', startMs: 1000, endMs: 1800 }, { lineId: 'line-2', text: 'Returns', startMs: 3000, endMs: 3800 }] };
    assert.equal((await workflow.verify(owner, track, 1, audio.id, { ...evidence, audioIdentity: 'mismatch' })).diagnosis, 'INCORRECT_AUDIO');
    await assert.rejects(() => repo.package('owner', track), { code: 'PAIR_UNVERIFIED' });
    assert.equal((await workflow.verify(owner, track, 1, audio.id, evidence)).diagnosis, 'PAIR_VERIFIED');
    const pkg = await repo.package('owner', track);
    assert.equal(pkg.sourceRevision, 1);
    const body = { sourceRevision: pkg.sourceRevision, sourceHash: pkg.sourceHash, promptHash: pkg.promptHash, lines: pkg.lines.map(l => ({ ...l, translation: '海潮歸來' })) };
    const translated = await repo.submit('owner', track, 'translation-001', body);
    assert.equal(translated.state, 'ALIGN');
    await assert.rejects(() => db.query('DELETE FROM eme.events'), /immutable/);
    await repo.close(); db = new PGlite(directory); repo = new PostgresRepository(pglitePool(db));
    assets = new Assets(repo.pool, { async put(key, bytes) { objects.set(key, bytes.slice()); }, async get(key) { return objects.get(key)!; } });
    assert.match((await repo.result('owner', track)).bilingualLrc, /海潮歸來/);
    assert.equal((await repo.job('owner', job.id)).tracks[0].state, 'ALIGN');
    await assert.rejects(() => repo.job('intruder', job.id), { code: 'NOT_FOUND' });
    const sessions = new Sessions(repo.pool, 'owner');
    const auth = authHandler({ sessions, origin: 'https://studio.test', supabase: 'https://fixture.supabase.co', authKey: 'nonsecret-test-key', fetch: async () => new Response(JSON.stringify({ access_token: 'upstream-test-token-not-for-client', refresh_token: 'upstream-test-refresh', user: { email: 'owner', email_confirmed_at: new Date().toISOString() } }), { status: 200 }) });
    const callAuth = async (action: string, body: any, cookie = '', origin = 'https://studio.test') => {
      let status = 200, result: any, cookies: string[] = [];
      const response = { setHeader(name: string, value: any) { if (name === 'Set-Cookie') cookies = value; }, getHeader() { return cookies; }, status(n: number) { status = n; return this; }, json(value: any) { result = value; } };
      await auth({ method: 'POST', query: { action }, body, headers: { cookie, origin, 'content-type': 'application/json', 'x-eme-request': '1' } }, response);
      return { status, result, cookies };
    };
    assert.equal((await callAuth('otp-send', {}, '', 'https://evil.test')).status, 403);
    const sent = await callAuth('otp-send', {}), challenge = sent.cookies.find(s => s.startsWith('__Host-eme_login='))!.split(';')[0];
    const verified = await callAuth('otp-verify', { code: '123456' }, challenge);
    assert.equal(verified.status, 200); assert.equal(verified.result.role, 'owner');
    assert.ok(!JSON.stringify(verified.result).includes('upstream-test'));
    assert.match(verified.cookies[0], /HttpOnly; Secure; SameSite=Strict/);
    const pair = await sessions.startDevice(), approved = await sessions.approve(pair.code);
    const dot = await sessions.finishDevice(pair.raw);
    await assert.rejects(() => sessions.finishDevice(pair.raw), { code: 'PAIR_PENDING_OR_EXPIRED' });
    const req = { headers: { cookie: `${SESSION_COOKIE}=${dot.raw}` } };
    const principal = await sessions.authenticate(req), scoped = new ScopedRepository(repo, principal);
    assert.equal((await callAuth('approve', { code: 'AAAAAAAAAA' }, req.headers.cookie)).status, 403);
    assert.equal((await scoped.list('owner')).length, 0);
    await assert.rejects(() => scoped.job('owner', job.id), { code: 'NOT_FOUND' });
    const dotJob = await scoped.create('owner', 'dot-create-001', jobInput);
    await assert.rejects(() => scoped.package('owner', dotJob.tracks[0].id), { code: 'PAIR_UNVERIFIED' });
    assert.equal((await scoped.list('owner')).length, 1);
    assert.equal((await scoped.job('owner', dotJob.id)).id, dotJob.id);
    await assert.rejects(() => scoped.cancel('owner', dotJob.tracks[0].id), { code: 'SCOPE_DENIED' });
    await sessions.revoke(approved.grantId);
    await assert.rejects(() => sessions.authenticate(req), { code: 'AUTH_REQUIRED' });
    // Private object transport is an explicit test double; SQL and hash integrity are real.
    const bytes = Buffer.from('[00:01.000]The sea');
    const stored = await assets.put(owner, job.id, 'source_lrc', bytes);
    assert.equal((await assets.put(owner, job.id, 'source_lrc', bytes)).id, stored.id);
    assert.equal((await assets.get(owner, stored.id)).sha256, stored.sha256);
    await assert.rejects(() => assets.get({ ...owner, role: 'dot' }, stored.id), { code: 'SCOPE_DENIED' });
    await assert.rejects(() => assets.get({ ...owner, owner: 'intruder' }, stored.id), { code: 'NOT_FOUND' });
    await repo.rateLimit('owner');
    await db.exec('CREATE ROLE anon; SET ROLE anon;');
    await assert.rejects(() => db.query('SELECT * FROM eme.jobs'), /permission denied/);
    await db.exec('RESET ROLE;');
  } finally { await repo.close(); await rm(directory, { recursive: true, force: true }); }
});
