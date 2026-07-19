# Railway deployment

This application uses SQLite. On Railway it must run as **one service replica** with a
persistent volume. More replicas would open independent SQLite files and split the data.

## 1. Create the service

1. Create a Railway project from the GitHub repository.
2. Attach a persistent volume to the web service at `/app/data`.
3. Keep the service replica count at `1`.
4. Railway reads `railway.json`, builds with `npm run build`, runs migrations at startup,
   then starts Next.js on Railway's assigned `PORT`.

Migrations intentionally run in the start command. Railway volumes are not mounted during
builds or pre-deploy commands, so a pre-deploy migration would target the wrong filesystem.

## 2. Configure variables

Set these Railway service variables:

```text
DATABASE_PATH=/app/data/dtc-elock.sqlite
NEXTAUTH_URL=https://YOUR-PUBLIC-DOMAIN
NEXTAUTH_SECRET=AT-LEAST-32-RANDOM-CHARACTERS
```

Generate `NEXTAUTH_SECRET` locally with:

```powershell
node -e "console.log(require('crypto').randomBytes(32).toString('base64url'))"
```

Do not set `SEED_USER_PASSWORD` or run `db:seed` against production. The imported production
database should be copied into the mounted volume through an explicit migration/import job.

## 3. Gate deployments

In Railway's GitHub deployment settings, enable **Wait for CI**. The repository CI checks:

- exact dependency installation with `npm ci`
- migrations against a disposable SQLite database
- TypeScript
- all Vitest tests
- the production Next.js build
- high-severity production dependency advisories

## 4. Backups and recovery

Enable Railway volume backups at daily, weekly, and monthly intervals. Keep the existing R2
backup path as an off-platform copy; deleting a Railway environment or volume can also remove
its attached backup history.

Before launch, complete a restore drill into a separate Railway service or a local copy:

1. Record key row counts (`users`, `devices`, `registration_kits`, `install_events`).
2. Restore the backup to a new volume or temporary database path.
3. Start the app and verify `/api/health` returns `200`.
4. Compare the row counts and manually open Dashboard, Register, Install, and Review.
5. Record the restore date, backup identifier, duration, and result.

## 5. Monitoring and scaling

Railway's `/api/health` check protects deployments; it is not continuous uptime monitoring.
Add an external HTTPS monitor for `/api/health` and alert on failures. Application logs are
written to Railway's service logs; add a hosted error tracker before broad rollout if automatic
stack-trace grouping and alerts are required.

SQLite is appropriate for the current single-service operational workload. Move to PostgreSQL
before enabling horizontal replicas, multi-region writes, or sustained high write concurrency.

## 6. Security baseline and edge protection

The application enforces secure production cookies, seven-day sessions, active-user and
account-version checks on every authenticated request, login throttling, role checks in the
service layer, validation at API boundaries, and hardened response headers. Password or role
changes revoke existing sessions.

The login limiter is deliberately process-local because this SQLite deployment is restricted to
one replica. It resets when the service restarts. Before exposing the service broadly, place the
Railway domain behind Cloudflare (or another edge provider) and add an IP-level login rule there
for restart-independent abuse protection. Do not cache authenticated pages or `/api/*`; only
static Next.js assets should be cached at the edge.
