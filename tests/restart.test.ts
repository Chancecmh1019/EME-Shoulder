import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { execFileSync } from 'node:child_process';
test('PostgreSQL files persist across two distinct Node processes, not hosted cloud or browser acceptance', () => {
  const path = mkdtempSync(join(tmpdir(), 'eme-process-'));
  try {
    const run = (mode: string) => JSON.parse(execFileSync(process.execPath, ['--loader', './scripts/typescript-loader.mjs', 'tests/helpers/restartPostgres.ts', path, mode], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }));
    const first = run('write'), second = run('read'); assert.equal(first.id, second.id); assert.equal(second.state, 'AUDIO_PENDING');
  } finally { rmSync(path, { recursive: true, force: true }); }
});
