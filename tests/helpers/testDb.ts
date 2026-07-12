// In-memory SQLite DB for tests — applies EVERY migration in db/migrations/, in order, so
// tests run against the actual current schema (not just 0001_init.sql), including whatever
// the latest migration added.
//
// Each file is exec'd inside its own sqlite.transaction(), matching db/migrate.ts exactly —
// required so that migrations relying on PRAGMA defer_foreign_keys (deferred FK checks only
// take effect within an active transaction; the plain foreign_keys pragma is a documented
// no-op mid-transaction) behave identically here and against the real on-disk DB.
import { readdirSync, readFileSync } from 'node:fs';
import Database from 'better-sqlite3';
import { drizzle } from 'drizzle-orm/better-sqlite3';
import * as schema from '../../db/schema';

export function createTestDb() {
  const sqlite = new Database(':memory:');
  sqlite.pragma('foreign_keys = ON');

  const migrationsDir = new URL('../../db/migrations/', import.meta.url);
  const files = readdirSync(migrationsDir).filter((f) => f.endsWith('.sql')).sort();
  for (const file of files) {
    const sql = readFileSync(new URL(file, migrationsDir), 'utf8');
    sqlite.transaction(() => {
      sqlite.exec(sql);
    })();
  }

  return { sqlite, db: drizzle(sqlite, { schema }) };
}
