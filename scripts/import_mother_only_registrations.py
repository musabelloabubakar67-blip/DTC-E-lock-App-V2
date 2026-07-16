import json
import shutil
import sqlite3
import uuid
from datetime import datetime
from pathlib import Path


DB_PATH = Path("data/dtc-elock.sqlite")
BACKUP_DIR = Path("data/backups")


def new_id(prefix: str) -> str:
    return f"{prefix}_{uuid.uuid4().hex}"


def now_ts() -> int:
    return int(datetime.now().timestamp())


def parse_date(value: str | None) -> int:
    raw = (value or "").strip()
    if not raw:
        return now_ts()
    for fmt in ("%Y-%m-%d", "%d/%m/%Y, %H:%M:%S"):
        try:
            return int(datetime.strptime(raw, fmt).timestamp())
        except ValueError:
            pass
    return now_ts()


def one(conn: sqlite3.Connection, sql: str, args: tuple = ()) -> sqlite3.Row | None:
    return conn.execute(sql, args).fetchone()


def backup_db() -> Path:
    BACKUP_DIR.mkdir(parents=True, exist_ok=True)
    backup = BACKUP_DIR / f"dtc-elock-before-mother-only-import-{datetime.now().strftime('%Y%m%d-%H%M%S')}.sqlite"
    shutil.copy2(DB_PATH, backup)
    return backup


def actor(conn: sqlite3.Connection) -> tuple[str, str]:
    row = one(conn, "select id, org_id from users where lower(username) = 'musa' limit 1")
    if row:
        return row["id"], row["org_id"]
    row = one(conn, "select id, org_id from users where role = 'supervisor' order by rowid limit 1")
    if not row:
        raise RuntimeError("No supervisor/import actor found.")
    return row["id"], row["org_id"]


def is_mother_only_invalid(payload: dict) -> bool:
    if payload.get("reason") != "invalid_masterlist_kit":
        return False
    row = payload.get("row") or {}
    return bool((row.get("mother") or "").strip()) and not any((row.get(key) or "").strip() for key in ("sub_b", "sub_c", "sub_d"))


def main() -> None:
    backup = backup_db()
    conn = sqlite3.connect(DB_PATH)
    conn.row_factory = sqlite3.Row
    conn.execute("pragma foreign_keys = on")
    actor_id, org_id = actor(conn)
    imported = 0
    resolved = 0
    try:
        conn.execute("begin")
        reviews = conn.execute(
            "select id, payload_json from conflict_reviews where status = 'open' and kind = 'import_conflict'"
        ).fetchall()
        for review in reviews:
            payload = json.loads(review["payload_json"])
            if not is_mother_only_invalid(payload):
                continue
            row = payload["row"]
            mother = row["mother"].strip().upper()
            registered_at = parse_date(row.get("date"))
            device = one(conn, "select id from devices where serial = ? and device_type = 'mother'", (mother,))
            if device:
                mother_id = device["id"]
            else:
                mother_id = new_id("dev")
                conn.execute(
                    """
                    insert into devices (
                      id, org_id, device_type, serial, lifecycle_status, registered_at,
                      registered_by, import_unverified, origin, notes, created_at, updated_at
                    ) values (?, ?, 'mother', ?, 'available', ?, ?, 1, 'registered', ?, ?, ?)
                    """,
                    (
                        mother_id,
                        org_id,
                        mother,
                        registered_at,
                        actor_id,
                        f"Imported mother-only registration from masterlist row {row.get('source_row')}",
                        now_ts(),
                        now_ts(),
                    ),
                )
            if not one(conn, "select id from registration_logs where mother_device_id = ? limit 1", (mother_id,)):
                reg_id = new_id("reg")
                conn.execute(
                    """
                    insert into registration_logs (
                      id, org_id, mother_device_id, actor_user_id, logged_date,
                      source, notes, created_at, updated_at
                    ) values (?, ?, ?, ?, ?, 'import', ?, ?, ?)
                    """,
                    (
                        reg_id,
                        org_id,
                        mother_id,
                        actor_id,
                        registered_at,
                        f"Mother-only registration imported from masterlist row {row.get('source_row')}; no sub-locks listed.",
                        now_ts(),
                        now_ts(),
                    ),
                )
                conn.execute(
                    "insert into audit_log (id, org_id, actor_user_id, entity_table, entity_id, operation, after_json, created_at) values (?, ?, ?, 'registration_logs', ?, 'import', ?, ?)",
                    (
                        new_id("aud"),
                        org_id,
                        actor_id,
                        reg_id,
                        json.dumps({"mother": mother, "source_row": row.get("source_row"), "mother_only": True}),
                        now_ts(),
                    ),
                )
                imported += 1
            conn.execute(
                "update conflict_reviews set status = 'resolved', resolved_by = ?, resolved_at = ?, resolution_notes = ? where id = ?",
                (
                    actor_id,
                    now_ts(),
                    "Resolved during cleanup: row is a valid mother-only registration, not an invalid kit.",
                    review["id"],
                ),
            )
            resolved += 1
        conn.commit()
    except Exception:
        conn.rollback()
        raise
    finally:
        conn.close()
    print(json.dumps({"backup": str(backup), "imported_mother_only_registrations": imported, "resolved_reviews": resolved}, indent=2))


if __name__ == "__main__":
    main()
