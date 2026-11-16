import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve, relative } from 'node:path';
import { correctStudioTranslation } from '../studio/correctTranslation.ts';
import { PrivateYouTube, type PrivateUploadState } from '../server/acquisition/youtubePrivate.ts';
import { removeCompletedTemporaryFiles } from '../server/acquisition/cleanup.ts';
test('original website correction converts simplified translation and preserves original source and timestamps', () => {
  const source = [{ id: 'line-1', timeMs: 0, original: '简体原文不得改動' }, { id: 'line-2', timeMs: 2360, original: 'Original stays the same' }];
  const input = source.map(line => ({ ...line, translation: '这个世界，温柔的风' }));
  const result = correctStudioTranslation(source, input);
  assert.equal(result.lines[0].original, source[0].original); assert.equal(result.lines[1].timeMs, 2360);
  assert.equal(result.lines[0].translation, '這個世界 溫柔的風');
  assert.ok(result.fixes.some(fix => fix.includes('LEGACY_TRADITIONAL')));
  assert.equal(result.originalsAndTimestampsPreserved, true);
});
test('synthetic transport only: private resumable upload recovers lost response without duplicate video session', async () => {
  const directory = mkdtempSync(join(tmpdir(), 'eme-private-protocol-'));
  assert.ok(!relative(tmpdir(), directory).startsWith('..'));
  try {
    const path = join(directory, 'synthetic.bin'), size = 9 * 1024 * 1024; writeFileSync(path, Buffer.alloc(size, 7));
    let sessions = 0, chunks = 0, probes = 0;
    const videoId = 'abcDEF12345', uploadUrl = 'https://www.googleapis.com/upload/youtube/v3/videos?upload_id=SYNTHETIC_TEST_ONLY';
    const worker = new PrivateYouTube(async (url, init) => {
      if (init?.method === 'POST' && url.includes('uploadType=resumable')) {
        sessions++; assert.equal(JSON.parse(String(init.body)).status.privacyStatus, 'private');
        return new Response('', { status: 200, headers: { Location: uploadUrl } });
      }
      if (url === uploadUrl) {
        const range = new Headers(init?.headers).get('Content-Range');
        if (range === `bytes */${size}`) { probes++; return new Response('', { status: 308, headers: { Range: `bytes=0-${8 * 1024 * 1024 - 1}` } }); }
        chunks++;
        if (chunks === 1) return new Response('', { status: 503 });
        assert.equal(range, `bytes ${8 * 1024 * 1024}-${size - 1}/${size}`);
        return Response.json({ id: videoId });
      }
      if (url.includes('thumbnails/set')) return Response.json({ items: [{ synthetic: true }] });
      return Response.json({ items: [{ id: videoId, status: { privacyStatus: 'private', uploadStatus: 'processed' }, processingDetails: { processingStatus: 'succeeded' } }] });
    });
    const state: PrivateUploadState = { jobId: 'synthetic', videoSha256: '0'.repeat(64), bytes: size, offset: 0 };
    assert.equal(await worker.upload(path, 'Synthetic protocol fixture', 'No real YouTube request', state, async () => {}), videoId);
    assert.equal(sessions, 1); assert.equal(chunks, 2); assert.equal(probes, 1);
    assert.equal((await worker.status(videoId)).complete, true);
  } finally { rmSync(directory, { recursive: true, force: true }); }
});
test('private status cannot report unlisted as success', async () => {
  const worker = new PrivateYouTube(async () => Response.json({ items: [{ id: 'abcDEF12345', status: { privacyStatus: 'unlisted', uploadStatus: 'processed' }, processingDetails: { processingStatus: 'succeeded' } }] }));
  await assert.rejects(worker.status('abcDEF12345'), /VIDEO_NOT_PRIVATE/);
});
test('verified cleanup removes only generated task directories; failed or public status retains files', () => {
  const workspace = mkdtempSync(join(tmpdir(), 'eme-cleanup-fixture-')), id = 'a'.repeat(20), request = 'b'.repeat(64);
  assert.ok(!relative(tmpdir(), workspace).startsWith('..'));
  const job = resolve(workspace, '.studio/acquisition/jobs', id), native = resolve(workspace, '.studio/mornye-external/outputs', request), legacy = join(workspace, 'legacy-project');
  for (const path of [job, native, legacy]) { mkdirSync(path, { recursive: true }); writeFileSync(join(path, 'fixture.txt'), 'synthetic only'); }
  try {
    assert.throws(() => removeCompletedTemporaryFiles(workspace, id, request, { complete: false, privacyStatus: 'private', thumbnailSet: true })); assert.equal(existsSync(job), true);
    assert.throws(() => removeCompletedTemporaryFiles(workspace, id, request, { complete: true, privacyStatus: 'public', thumbnailSet: true }));
    assert.equal(removeCompletedTemporaryFiles(workspace, id, request, { complete: true, privacyStatus: 'private', thumbnailSet: true }).temporaryFilesRemoved, true);
    assert.equal(existsSync(job), false); assert.equal(existsSync(native), false); assert.equal(existsSync(legacy), true);
  } finally { rmSync(workspace, { recursive: true, force: true }); }
});
