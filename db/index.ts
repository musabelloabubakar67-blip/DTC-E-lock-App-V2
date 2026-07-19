import Database from 'better-sqlite3';
import { drizzle } from 'drizzle-orm/better-sqlite3';
import { mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import * as schema from './schema';

const DB_PATH = process.env.DATABASE_PATH ?? './data/dtc-elock.sqlite';
mkdirSync(dirname(DB_PATH), { recursive: true });

declare global {
  // eslint-disable-next-line no-var
  var __sqlite: Database.Database | undefined;
}

const sqlite = global.__sqlite ?? new Database(DB_PATH, { timeout: 5000 });
sqlite.pragma('busy_timeout = 5000');
sqlite.pragma('journal_mode = WAL');
sqlite.pragma('foreign_keys = ON');
sqlite.pragma('synchronous = NORMAL');

if (process.env.NODE_ENV !== 'production') {
  global.__sqlite = sqlite;
}

export const db = drizzle(sqlite, { schema });
export { sqlite };
