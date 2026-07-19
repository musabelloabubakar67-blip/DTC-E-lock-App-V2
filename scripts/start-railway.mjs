import { spawn } from 'node:child_process';

const port = process.env.PORT ?? '3000';

validateProductionEnvironment();

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
