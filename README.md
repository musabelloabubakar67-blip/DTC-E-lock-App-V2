# DTC E-Lock Management System

Railway production setup, volume requirements, CI gates, and restore checks are documented in
[docs/RAILWAY_DEPLOYMENT.md](./docs/RAILWAY_DEPLOYMENT.md).

See [ARCHITECTURE.md](./ARCHITECTURE.md) — ground truth for this project. Do not implement
against this README if it ever disagrees with ARCHITECTURE.md; flag the conflict instead.

## Phase 0 — setup

```bash
cp .env.example .env
npm install
npm run db:migrate   # applies db/migrations/0001_init.sql
npm run db:seed       # creates the org + 10 users from config/client.config.ts
npm run build         # proves the app shell compiles and all §7 routes resolve
```

Seed users log in as `<lowercased first name>` (e.g. `uthman`, `mahmud`). Phase 0 gives every
seeded user the same temporary password, set via `SEED_USER_PASSWORD` in `.env`
(`.env.example` default: `changeme123`). Rotate per-user before real field use.

## Backup / restore

`scripts/backup.sh` and `scripts/restore.sh` require `sqlite3` and `rclone` on the host
(both present on the production VPS per ARCHITECTURE.md §4 Hosting). They are not required
for `npm run dev`/`build`/`db:migrate`/`db:seed`.

Configure an rclone remote named to match `R2_RCLONE_REMOTE` in `.env` (a real Cloudflare R2
remote in production; a local-folder remote is sufficient to rehearse the mechanics in a
non-production environment — see rclone docs for the `local` backend).

### Running a real restore test

This is the Phase 0 exit criterion: prove that a backup can actually be restored, not just
that the script runs.

```bash
# 1. Note current row counts (any table works; devices is a good one once seeded/real data exists)
sqlite3 "$DATABASE_PATH" "SELECT count(*) FROM users;"

# 2. Take a backup
./scripts/backup.sh

# 3. Destroy/rename the live DB to prove restore isn't just reading the live file
mv "$DATABASE_PATH" "$DATABASE_PATH.destroyed"
rm -f "$DATABASE_PATH-wal" "$DATABASE_PATH-shm"

# 4. Restore the most recent backup
./scripts/restore.sh latest

# 5. Verify row counts match step 1
sqlite3 "$DATABASE_PATH" "SELECT count(*) FROM users;"
```

If the count in step 5 matches step 1, restore is proven. `restore.sh` never overwrites a
live DB silently — it moves the existing file aside to `<path>.pre-restore.<timestamp>` first.

**Status as of this Phase 0 session:** `backup.sh`/`restore.sh` are written and reviewed
against §5/§4, but the real backup → destroy → restore → verify cycle above has **not** been
run in this environment (the Windows dev machine used for scaffolding lacks `rclone` and the
`sqlite3` CLI). Run the cycle above on the target VPS — or any Linux/macOS box with both
tools — before treating Phase 0 as fully exited.
