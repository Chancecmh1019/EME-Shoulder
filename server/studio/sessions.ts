import { createHash, randomBytes, randomUUID } from 'node:crypto';
import { StudioError } from '../../studio/lrc.ts';
import type { SqlPool, SqlConnection } from './sql.ts';

export interface Principal { owner: string; role: 'owner' | 'dot'; grantId?: string; expiresAt: number }
export const digest = (value: string) => createHash('sha256').update(value).digest('hex');
export const token = () => randomBytes(32).toString('base64url');
export function getCookie(req: any, name: string) {
  return String(req.headers.cookie ?? '').split(';').map(s => s.trim()).find(s => s.startsWith(`${name}=`))?.slice(name.length + 1);
}
export function setSessionCookie(res: any, name: string, value: string, seconds: number) {
  const old = res.getHeader('Set-Cookie') ?? [];
  res.setHeader('Set-Cookie', [...(Array.isArray(old) ? old : [old]), `${name}=${value}; HttpOnly; Secure; SameSite=Strict; Path=/; Max-Age=${seconds}`]);
}
export const SESSION_COOKIE = '__Host-eme_studio';
export const DEVICE_COOKIE = '__Host-eme_device';
export const LOGIN_COOKIE = '__Host-eme_login';
export async function transaction<T>(db: SqlPool, work: (c: SqlConnection) => Promise<T>) {
  const c = await db.connect();
  try { await c.query('BEGIN'); const value = await work(c); await c.query('COMMIT'); return value; }
  catch (e) { await c.query('ROLLBACK'); throw e; } finally { c.release(); }
}
export class Sessions {
  constructor(readonly db: SqlPool, readonly owner: string, private now = () => Date.now()) {}
  async budget(subject: string, limit: number, windowMs = 60000) {
    const start = Math.floor(this.now() / windowMs) * windowMs;
    const row = (await this.db.query('INSERT INTO eme.rate_limits VALUES($1,$2,1) ON CONFLICT(owner) DO UPDATE SET count=CASE WHEN rate_limits.window_start=excluded.window_start THEN rate_limits.count+1 ELSE 1 END,window_start=excluded.window_start RETURNING count', [`auth:${subject}`, start])).rows[0];
    if (Number(row.count) > limit) throw new StudioError('RATE_LIMIT', 429);
  }
  async authenticate(req: any): Promise<Principal> {
    const raw = getCookie(req, SESSION_COOKIE);
    if (!raw || !/^[A-Za-z0-9_-]{43}$/.test(raw)) throw new StudioError('AUTH_REQUIRED', 401);
    const row = (await this.db.query("SELECT s.*,g.expires_at grant_expires FROM eme.sessions s LEFT JOIN eme.dot_grants g ON s.grant_id=g.id WHERE s.token_hash=$1 AND s.owner=$2 AND s.expires_at>$3 AND s.revoked_at IS NULL AND (s.role='owner' OR (g.owner=s.owner AND g.expires_at>$3 AND g.revoked_at IS NULL))", [digest(raw), this.owner, this.now()])).rows[0];
    if (!row) throw new StudioError('AUTH_REQUIRED', 401);
    return { owner: row.owner, role: row.role, grantId: row.grant_id ?? undefined, expiresAt: Math.min(Number(row.expires_at), row.role === 'dot' ? Number(row.grant_expires) : Infinity) };
  }
  async issue(role: 'owner' | 'dot', grantId?: string, connection: Pick<SqlConnection, 'query'> = this.db) {
    const raw = token(), expiresAt = this.now() + (role === 'owner' ? 8 : 2) * 3600000;
    await connection.query('INSERT INTO eme.sessions VALUES($1,$2,$3,$4,$5,NULL,$6)', [digest(raw), this.owner, role, grantId ?? null, expiresAt, this.now()]);
    return { raw, expiresAt };
  }
  async startDevice() {
    await this.db.query('DELETE FROM eme.device_pairs WHERE expires_at<$1', [this.now()]);
    const raw = token(), code = randomBytes(5).toString('hex').toUpperCase();
    await this.db.query('INSERT INTO eme.device_pairs VALUES($1,$2,NULL,NULL,$3,NULL)', [digest(code), digest(raw), this.now() + 600000]);
    return { raw, code, expiresAt: this.now() + 600000 };
  }
  async approve(code: string) {
    if (typeof code !== 'string' || !/^[A-F0-9]{10}$/.test(code)) throw new StudioError('INVALID_PAIR_CODE', 422);
    return transaction(this.db, async c => {
      const id = randomUUID(), expiresAt = this.now() + 2 * 3600000;
      const row = (await c.query('UPDATE eme.device_pairs SET owner=$1,grant_id=$2,approved_at=$3 WHERE code_hash=$4 AND expires_at>$3 AND approved_at IS NULL RETURNING device_hash', [this.owner, id, this.now(), digest(code)])).rows[0];
      if (!row) throw new StudioError('PAIR_EXPIRED_OR_USED', 409);
      await c.query('INSERT INTO eme.dot_grants VALUES($1,$2,$3,NULL,$4)', [id, this.owner, expiresAt, this.now()]);
      await c.query('INSERT INTO eme.security_events(owner,kind,subject,created_at) VALUES($1,$2,$3,$4)', [this.owner, 'DOT_APPROVED', id, this.now()]);
      return { grantId: id, expiresAt };
    });
  }
  async finishDevice(raw?: string) {
    if (!raw || !/^[A-Za-z0-9_-]{43}$/.test(raw)) throw new StudioError('PAIR_REQUIRED', 401);
    return transaction(this.db, async c => {
      const row = (await c.query('DELETE FROM eme.device_pairs WHERE device_hash=$1 AND expires_at>$2 AND approved_at IS NOT NULL RETURNING grant_id,owner', [digest(raw), this.now()])).rows[0];
      if (!row || row.owner !== this.owner) throw new StudioError('PAIR_PENDING_OR_EXPIRED', 409);
      const grant = (await c.query('SELECT id FROM eme.dot_grants WHERE id=$1 AND owner=$2 AND expires_at>$3 AND revoked_at IS NULL', [row.grant_id, this.owner, this.now()])).rows[0];
      if (!grant) throw new StudioError('PAIR_EXPIRED_OR_USED', 409);
      return this.issue('dot', row.grant_id, c);
    });
  }
  async revoke(id: string) {
    if (typeof id !== 'string' || id.length > 100) throw new StudioError('INVALID_GRANT');
    return transaction(this.db, async c => {
      const changed = await c.query('UPDATE eme.dot_grants SET revoked_at=$1 WHERE id=$2 AND owner=$3 AND revoked_at IS NULL RETURNING id', [this.now(), id, this.owner]);
      if (changed.rows.length) await c.query('INSERT INTO eme.security_events(owner,kind,subject,created_at) VALUES($1,$2,$3,$4)', [this.owner, 'DOT_REVOKED', id, this.now()]);
      return { revoked: true };
    });
  }
}
