import { createHash } from 'node:crypto';
import { StudioError } from '../../studio/lrc.ts';
import type { PostgresRepository, JobInput } from './postgres.ts';
import type { Principal } from './sessions.ts';

/** A Dot session can access only jobs attached to its grant. No assets, cancellation or source rewrites. */
export class ScopedRepository {
  constructor(private repo: PostgresRepository, readonly principal: Principal) {}
  private owner(owner: string) { if (owner !== this.principal.owner) throw new StudioError('NOT_FOUND', 404); }
  private async access(owner: string, id: string, track = false) {
    this.owner(owner);
    if (this.principal.role === 'owner') return;
    const query = track ? 'SELECT 1 FROM eme.dot_jobs d JOIN eme.tracks t ON t.job_id=d.job_id WHERE t.id=$1 AND t.owner=$2 AND d.grant_id=$3' : 'SELECT 1 FROM eme.dot_jobs d JOIN eme.jobs j ON j.id=d.job_id WHERE j.id=$1 AND j.owner=$2 AND d.grant_id=$3';
    if (!(await this.repo.pool.query(query, [id, owner, this.principal.grantId])).rows.length) throw new StudioError('NOT_FOUND', 404);
  }
  async list(owner: string) {
    this.owner(owner);
    if (this.principal.role === 'owner') return this.repo.list(owner);
    const rows = (await this.repo.pool.query('SELECT j.id,j.title,j.created_at FROM eme.jobs j JOIN eme.dot_jobs d ON d.job_id=j.id WHERE j.owner=$1 AND d.grant_id=$2 ORDER BY j.created_at DESC LIMIT 100', [owner, this.principal.grantId])).rows;
    return rows.map(r => ({ ...r, created_at: Number(r.created_at) }));
  }
  async create(owner: string, key: string, input: JobInput) {
    this.owner(owner);
    if (typeof key !== 'string' || !/^[a-zA-Z0-9_-]{8,100}$/.test(key)) throw new StudioError('INVALID_IDEMPOTENCY_KEY');
    const namespacedKey = this.principal.role === 'dot' ? createHash('sha256').update(`${this.principal.grantId}:${key}`).digest('hex') : key;
    const j = await this.repo.create(owner, namespacedKey, input);
    if (this.principal.role === 'dot') await this.repo.pool.query('INSERT INTO eme.dot_jobs VALUES($1,$2) ON CONFLICT DO NOTHING', [this.principal.grantId, j.id]);
    return j;
  }
  async job(owner: string, id: string) { await this.access(owner, id); return this.repo.job(owner, id); }
  async package(owner: string, id: string) { await this.access(owner, id, true); return this.repo.package(owner, id); }
  async result(owner: string, id: string) { await this.access(owner, id, true); return this.repo.result(owner, id); }
  async rateLimit(owner: string) { this.owner(owner); return this.repo.rateLimit(owner); }
  async submit(owner: string, id: string, key: string, input: Parameters<PostgresRepository['submit']>[3]) { await this.access(owner, id, true); return this.repo.submit(owner, id, key, input); }
  async claim(owner: string, id: string, worker: string) { await this.access(owner, id, true); return this.repo.claim(owner, id, worker); }
  async heartbeat(owner: string, id: string, token: string) { await this.access(owner, id, true); return this.repo.heartbeat(owner, id, token); }
  async replaceSource(owner: string, id: string, revision: number, source: string) { if (this.principal.role !== 'owner') throw new StudioError('SCOPE_DENIED', 403); await this.access(owner, id, true); return this.repo.replaceSource(owner, id, revision, source); }
  async cancel(owner: string, id: string) { if (this.principal.role !== 'owner') throw new StudioError('SCOPE_DENIED', 403); await this.access(owner, id, true); return this.repo.cancel(owner, id); }
}
