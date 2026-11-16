import { cloudRuntime } from '../server/studio/runtime.ts';
import { SupabasePrivateObjects } from '../server/studio/objectStorage.ts';
import { Assets } from '../server/studio/assets.ts';

// Owner-run, explicitly enabled test against a dedicated staging project only.
if (process.env.EME_RUN_STAGING_CHECK !== '1') throw new Error('Set EME_RUN_STAGING_CHECK=1 only for the isolated staging project. This writes a small synthetic task/asset; never uploads to YouTube.');
let runtime: ReturnType<typeof cloudRuntime> | undefined;
try {
  runtime = cloudRuntime();
  const role = (await runtime.db.query("SELECT current_user name,rolsuper FROM pg_roles WHERE rolname=current_user")).rows[0];
  if (role.rolsuper || ['postgres', 'supabase_admin'].includes(role.name)) throw new Error('Use the dedicated low-privilege staging login, not the migration administrator.');
  const job = await runtime.repository.create(runtime.config.owner, 'staging-persistence-check-v1', { title: 'Staging persistence check', albumContext: 'Owner-created synthetic storage fixture; no real audio identity claim.', tracks: [{ title: 'Storage only', sourceLrc: '[00:01.000]This is an owner-created test line' }] });
  const assets = new Assets(runtime.db, new SupabasePrivateObjects(runtime.config));
  const principal = { owner: runtime.config.owner, role: 'owner' as const, expiresAt: Date.now() + 60000 };
  const asset = await assets.put(principal, job.id, 'source_lrc', Buffer.from('[00:01.000]This is an owner-created test line'));
  const readback = await assets.get(principal, asset.id);
  if (readback.sha256 !== asset.sha256) throw new Error('Hash mismatch');
  console.log(JSON.stringify({ status: 'INTEGRATION_VERIFIED_STORAGE_ONLY', jobId: job.id, assetId: asset.id, sha256: asset.sha256, next: 'Run this command again in a new process; IDs must remain identical. Then test real browser owner/Dot sessions. Translation must remain blocked without verified audio.' }, null, 2));
} catch { console.error('STAGING_CHECK_FAILED: check private bucket, low-privilege DB login, migrations, verified TLS and server-only environment settings. No secret values are printed.'); process.exitCode = 1; }
finally { await runtime?.db.end?.(); }
