#!/usr/bin/env bash
# Restore the SQLite DB from a Cloudflare R2 backup.
# Usage: scripts/restore.sh <backup-filename>       (e.g. dtc-elock-20260101T000000Z.sqlite)
#        scripts/restore.sh latest                   (restores the most recent backup)
#
# Required env (see .env.example):
#   DATABASE_PATH        path to restore the live sqlite file to (default ./data/dtc-elock.sqlite)
#   R2_RCLONE_REMOTE      rclone remote name configured for R2 (e.g. "r2")
#   R2_BUCKET              source bucket name

set -euo pipefail

DATABASE_PATH="${DATABASE_PATH:-./data/dtc-elock.sqlite}"
R2_RCLONE_REMOTE="${R2_RCLONE_REMOTE:?R2_RCLONE_REMOTE is required}"
R2_BUCKET="${R2_BUCKET:?R2_BUCKET is required}"

TARGET="${1:?Usage: scripts/restore.sh <backup-filename>|latest}"

if [ "$TARGET" = "latest" ]; then
  TARGET="$(rclone lsf "${R2_RCLONE_REMOTE}:${R2_BUCKET}/backups/" | sort | tail -n 1)"
  if [ -z "$TARGET" ]; then
    echo "No backups found in ${R2_RCLONE_REMOTE}:${R2_BUCKET}/backups/" >&2
    exit 1
  fi
  echo "Latest backup: $TARGET"
fi

REMOTE_PATH="${R2_RCLONE_REMOTE}:${R2_BUCKET}/backups/${TARGET}"
STAGE_DIR="$(mktemp -d)"
STAGE_FILE="$STAGE_DIR/${TARGET}"

rclone copyto "$REMOTE_PATH" "$STAGE_FILE"

if [ -f "$DATABASE_PATH" ]; then
  MOVED_ASIDE="${DATABASE_PATH}.pre-restore.$(date -u +%Y%m%dT%H%M%SZ)"
  mv "$DATABASE_PATH" "$MOVED_ASIDE"
  echo "Existing DB moved aside to $MOVED_ASIDE"
fi
[ -f "${DATABASE_PATH}-wal" ] && rm -f "${DATABASE_PATH}-wal"
[ -f "${DATABASE_PATH}-shm" ] && rm -f "${DATABASE_PATH}-shm"

mkdir -p "$(dirname "$DATABASE_PATH")"
cp "$STAGE_FILE" "$DATABASE_PATH"

echo "Restored $REMOTE_PATH -> $DATABASE_PATH"
rm -rf "$STAGE_DIR"
