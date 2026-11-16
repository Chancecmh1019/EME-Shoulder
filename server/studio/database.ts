import { Pool } from 'pg';
import { cloudConfig } from './config.ts';
import type { SqlPool } from './sql.ts';

let pool: SqlPool | undefined;
export function database(): SqlPool {
  if (pool) return pool;
  const { databaseUrl } = cloudConfig(), url = new URL(databaseUrl);
  if (!['postgres:', 'postgresql:'].includes(url.protocol)) throw new Error('Invalid database configuration');
  // Prevent URL parameters from overriding certificate verification.
  for (const name of ['sslmode', 'sslcert', 'sslkey', 'sslrootcert']) url.searchParams.delete(name);
  const ca = process.env.DATABASE_CA_CERT?.replace(/\\n/g, '\n');
  pool = new Pool({ connectionString: url.toString(), ssl: { rejectUnauthorized: true, ...(ca ? { ca } : {}) }, max: 2, idleTimeoutMillis: 10000, connectionTimeoutMillis: 10000, statement_timeout: 15000, application_name: 'eme-studio-staging', allowExitOnIdle: true }) as unknown as SqlPool;
  // Pool background errors must never print connection strings or raw SQL.
  (pool as unknown as Pool).on('error', () => {});
  return pool;
}
