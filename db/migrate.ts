import { readdirSync, readFileSync, mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import Database from 'better-sqlite3';

const DB_PATH = process.env.DATABASE_PATH ?? './data/dtc-elock.sqlite';
mkdirSync(dirname(DB_PATH), { recursive: true });

const sqlite = new Database(DB_PATH);
sqlite.pragma('journal_mode = WAL');
sqlite.pragma('foreign_keys = ON');
sqlite.pragma('busy_timeout = 5000');
sqlite.pragma('synchronous = NORMAL');

sqlite.exec(`
  CREATE TABLE IF NOT EXISTS _migrations (
    name TEXT PRIMARY KEY,
    applied_at INTEGER NOT NULL DEFAULT (unixepoch())
  );
`);

const applied = new Set(
  sqlite.prepare('SELECT name FROM _migrations').all().map((r: any) => r.name),
);

const migrationsDir = new URL('./migrations/', import.meta.url);
const files = readdirSync(migrationsDir).filter((f) => f.endsWith('.sql')).sort();

for (const file of files) {
  if (applied.has(file)) {
    console.log(`skip (already applied): ${file}`);
    continue;
  }
  const sql = readFileSync(new URL(file, migrationsDir), 'utf8');
  const run = sqlite.transaction(() => {
    sqlite.exec(sql);
    sqlite.prepare('INSERT INTO _migrations (name) VALUES (?)').run(file);
  });
  run();
  console.log(`applied: ${file}`);
}

sqlite.close();
console.log('Migrations complete.');
