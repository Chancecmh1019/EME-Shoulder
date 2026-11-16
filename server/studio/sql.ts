export interface SqlConnection {
  query(sql: string, values?: unknown[]): Promise<{ rows: any[]; rowCount?: number }>;
  release(): void;
}
export interface SqlPool extends Omit<SqlConnection, 'release'> {
  connect(): Promise<SqlConnection>;
  end?(): Promise<void>;
}
/** Only static application SQL reaches this adapter; values are always parameters. */
export function statements(connection: Pick<SqlConnection, 'query'>) {
  const normalize = (row: any) => {
    if (!row) return row;
    for (const field of ['created_at', 'expires_at', 'sequence', 'window_start', 'n', 'revision', 'position', 'attempt', 'count']) if (typeof row[field] === 'string' && /^\d+$/.test(row[field])) row[field] = Number(row[field]);
    return row;
  };
  return { prepare(sql: string) {
    let index = 0;
    const query = sql.replace(/\?/g, () => `$${++index}`).replace(/\b(jobs|tracks|sources|translations|events|leases|rate_limits|pair_inputs|pair_reports)\b/g, 'eme.$1');
    return {
      async get(...values: unknown[]) { return normalize((await connection.query(query, values)).rows[0]); },
      async all(...values: unknown[]) { return (await connection.query(query, values)).rows.map(normalize); },
      async run(...values: unknown[]) { return { changes: (await connection.query(query, values)).rowCount ?? 0 }; },
    };
  } };
}
