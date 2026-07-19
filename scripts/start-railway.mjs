import { spawn } from 'node:child_process';
import { existsSync, renameSync, rmSync } from 'node:fs';
import Database from 'better-sqlite3';

const port = process.env.PORT ?? '3000';

validateProductionEnvironment();
promoteBootstrapDatabase();

await run(process.execPath, [
  '--env-file-if-exists=.env',
  'node_modules/tsx/dist/cli.mjs',
  'db/migrate.ts',
]);

const server = spawn(
  process.execPath,
  ['node_modules/next/dist/bin/next', 'start', '-H', '0.0.0.0', '-p', port],
  { stdio: 'inherit', env: process.env },
);

for (const signal of ['SIGINT', 'SIGTERM']) {
  process.on(signal, () => server.kill(signal));
}

server.on('exit', (code, signal) => {
  if (signal) process.kill(process.pid, signal);
  process.exit(code ?? 1);
});

function run(command, args) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, { stdio: 'inherit', env: process.env });
    child.on('error', reject);
    child.on('exit', (code, signal) => {
      if (signal) {
        reject(new Error(`Startup command terminated by ${signal}`));
      } else if (code !== 0) {
        reject(new Error(`Startup command exited with code ${code}`));
      } else {
        resolve();
      }
    });
  });
}

function validateProductionEnvironment() {
  if (process.env.NODE_ENV !== 'production') return;

  const errors = [];
  if (!process.env.DATABASE_PATH) {
    errors.push('DATABASE_PATH must point to the mounted Railway volume (for example /app/data/dtc-elock.sqlite).');
  }
  if (!process.env.NEXTAUTH_URL?.startsWith('https://')) {
    errors.push('NEXTAUTH_URL must be the public HTTPS Railway domain.');
  }
  if (!process.env.NEXTAUTH_SECRET || process.env.NEXTAUTH_SECRET.length < 32) {
    errors.push('NEXTAUTH_SECRET must be a random value of at least 32 characters.');
  }

  if (errors.length > 0) {
    throw new Error(`Production configuration is incomplete:\n- ${errors.join('\n- ')}`);
  }
}

function promoteBootstrapDatabase() {
  const bootstrapPath = process.env.DATABASE_BOOTSTRAP_PATH;
  const databasePath = process.env.DATABASE_PATH;
  if (!bootstrapPath || !databasePath || !existsSync(bootstrapPath)) return;

  const bootstrap = new Database(bootstrapPath, { readonly: true, fileMustExist: true });
  try {
    const integrity = bootstrap.pragma('integrity_check', { simple: true });
    if (integrity !== 'ok') {
      throw new Error(`Bootstrap database failed integrity_check: ${integrity}`);
    }

    const migrationTable = bootstrap
      .prepare("SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = '_migrations'")
      .get();
    if (!migrationTable) {
      throw new Error('Bootstrap database is missing the migration ledger.');
    }
  } finally {
    bootstrap.close();
  }

  if (existsSync(databasePath)) {
    const backupPath = `${databasePath}.pre-bootstrap-${new Date().toISOString().replaceAll(':', '-')}`;
    renameSync(databasePath, backupPath);
    console.log(`Preserved previous database at ${backupPath}`);
  }

  rmSync(`${databasePath}-wal`, { force: true });
  rmSync(`${databasePath}-shm`, { force: true });
  renameSync(bootstrapPath, databasePath);
  console.log(`Promoted bootstrap database to ${databasePath}`);
}
