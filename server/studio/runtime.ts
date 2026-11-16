import { database } from './database.ts';
import { cloudConfig } from './config.ts';
import { Sessions } from './sessions.ts';
import { PostgresRepository } from './postgres.ts';
export function cloudRuntime() {
  const config = cloudConfig(), db = database();
  return { config, db, sessions: new Sessions(db, config.owner), repository: new PostgresRepository(db) };
}
