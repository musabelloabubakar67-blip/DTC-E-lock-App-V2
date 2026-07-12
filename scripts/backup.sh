#!/usr/bin/env bash
# Backup the SQLite DB to a local staging file, then push to Cloudflare R2 via rclone.
# Usage: scripts/backup.sh
#
# Required env (see .env.example):
#   DATABASE_PATH        path to the live sqlite file (default ./data/dtc-elock.sqlite)
#   R2_RCLONE_REMOTE      rclone remote name configured for R2 (e.g. "r2")
#   R2_BUCKET              target bucket name
#   BACKUP_RETENTION_DAYS  days of backups to keep in R2 (default 30)

set -euo pipefail

DATABASE_PATH="${DATABASE_PATH:-./data/dtc-elock.sqlite}"
R2_RCLONE_REMOTE="${R2_RCLONE_REMOTE:?R2_RCLONE_REMOTE is required}"
R2_BUCKET="${R2_BUCKET:?R2_BUCKET is required}"
BACKUP_RETENTION_DAYS="${BACKUP_RETENTION_DAYS:-30}"

if [ ! -f "$DATABASE_PATH" ]; then
  echo "No database found at $DATABASE_PATH" >&2
  exit 1
fi

TIMESTAMP="$(date -u +%Y%m%dT%H%M%SZ)"
STAGE_DIR="$(mktemp -d)"
STAGE_FILE="$STAGE_DIR/dtc-elock-${TIMESTAMP}.sqlite"

# SQLite's own backup API — safe against a live WAL-mode DB, unlike a raw file copy.
sqlite3 "$DATABASE_PATH" ".backup '$STAGE_FILE'"

REMOTE_PATH="${R2_RCLONE_REMOTE}:${R2_BUCKET}/backups/dtc-elock-${TIMESTAMP}.sqlite"
rclone copyto "$STAGE_FILE" "$REMOTE_PATH"

echo "Backed up $DATABASE_PATH -> $REMOTE_PATH"

# Prune backups older than retention window.
rclone delete --min-age "${BACKUP_RETENTION_DAYS}d" "${R2_RCLONE_REMOTE}:${R2_BUCKET}/backups/"

rm -rf "$STAGE_DIR"
