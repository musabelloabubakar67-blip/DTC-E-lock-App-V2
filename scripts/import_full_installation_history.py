import csv
import json
import shutil
import sqlite3
import uuid
from datetime import datetime
from pathlib import Path
from typing import Any


DB_PATH = Path("data/dtc-elock.sqlite")
DATA_PATH = Path("data/sanitized/all_workbook/installations_normalized.csv")
BACKUP_DIR = Path("data/backups")


def new_id(prefix: str) -> str:
    return f"{prefix}_{uuid.uuid4().hex}"


def now_ts() -> int:
    return int(datetime.now().timestamp())


def val(row: dict[str, str], key: str) -> str:
    return (row.get(key) or "").strip().upper()


def parse_date(value: str | None, fallback: int) -> int:
    raw = (value or "").strip()
    if not raw:
        return fallback
    for fmt in ("%Y-%m-%d", "%Y-%m-%d %H:%M:%S", "%d/%m/%Y, %H:%M:%S"):
        try:
            return int(datetime.strptime(raw, fmt).timestamp())
        except ValueError:
            pass
    return fallback


def one(conn: sqlite3.Connection, sql: str, args: tuple[Any, ...] = ()) -> sqlite3.Row | None:
    return conn.execute(sql, args).fetchone()


def backup_db() -> Path:
    BACKUP_DIR.mkdir(parents=True, exist_ok=True)
    backup = BACKUP_DIR / f"dtc-elock-before-full-install-history-{datetime.now().strftime('%Y%m%d-%H%M%S')}.sqlite"
    shutil.copy2(DB_PATH, backup)
    return backup


def read_rows() -> list[dict[str, str]]:
    with DATA_PATH.open("r", newline="", encoding="utf-8") as handle:
        return list(csv.DictReader(handle))


def actor(conn: sqlite3.Connection) -> tuple[str, str]:
    row = one(conn, "select id, org_id from users where lower(username) = 'musa' limit 1")
    if row:
        return row["id"], row["org_id"]
    row = one(conn, "select id, org_id from users where role = 'supervisor' order by rowid limit 1")
    if not row:
        raise RuntimeError("No supervisor/import actor found.")
    return row["id"], row["org_id"]


def actor_for_team(conn: sqlite3.Connection, team_member: str, fallback_actor_id: str) -> str:
    username = team_member.strip().lower()
    if not username:
        return fallback_actor_id
    row = one(conn, "select id from users where lower(username) = ? limit 1", (username,))
    return row["id"] if row else fallback_actor_id


def enum_battery(value: str) -> str | None:
    raw = value.strip().lower()
    return raw if raw in {"full", "adequate", "low", "dead"} else None


def enum_physical_damage(value: str) -> str | None:
    raw = value.strip().lower()
    if raw in {"", "none", "no"}:
        return "none"
    if "minor" in raw:
        return "minor"
    return "significant"


def enum_overall(value: str) -> str | None:
    raw = value.strip().lower()
    if raw == "successful":
        return "successful"
    if raw in {"completed with issues", "completed_with_issues"}:
        return "completed_with_issues"
    if raw == "failed":
        return "failed"
    return None


def imported_source_rows(conn: sqlite3.Connection) -> set[str]:
    rows = conn.execute(
        """
        select after_json from audit_log
        where entity_table = 'installation_logs'
          and operation = 'import'
          and after_json like '%source_row%'
        """
    ).fetchall()
    out: set[str] = set()
    for row in rows:
        try:
            payload = json.loads(row["after_json"])
        except json.JSONDecodeError:
            continue
        source_row = str(payload.get("source_row") or "").strip()
        if source_row:
            out.add(source_row)
    return out


def ensure_truck(conn: sqlite3.Connection, org_id: str, plate: str) -> str:
    row = one(conn, "select id from trucks where plate = ? limit 1", (plate,))
    if row:
        return row["id"]
    truck_id = new_id("trk")
    conn.execute(
        "insert into trucks (id, org_id, plate, is_active, created_via, created_at, updated_at) values (?, ?, ?, 1, 'import', ?, ?)",
        (truck_id, org_id, plate, now_ts(), now_ts()),
    )
    return truck_id


def ensure_device(conn: sqlite3.Connection, org_id: str, actor_id: str, serial: str, device_type: str, logged_at: int) -> str | None:
    row = one(conn, "select id, device_type from devices where serial = ? limit 1", (serial,))
    if row:
        return row["id"] if row["device_type"] == device_type else None
    device_id = new_id("dev")
    conn.execute(
        """
        insert into devices (
          id, org_id, device_type, serial, lifecycle_status, registered_at, registered_by,
          import_unverified, origin, notes, created_at, updated_at
        ) values (?, ?, ?, ?, 'available', ?, ?, 1, 'discovered', ?, ?, ?)
        """,
        (
            device_id,
            org_id,
            device_type,
            serial,
            logged_at,
            actor_id,
            "Discovered from historical installation import",
            now_ts(),
            now_ts(),
        ),
    )
    return device_id


def import_row(conn: sqlite3.Connection, org_id: str, fallback_actor_id: str, row: dict[str, str]) -> str:
    truck_plate = val(row, "truck")
    mother = val(row, "mother")
    subs = [val(row, "sub_b"), val(row, "sub_c"), val(row, "sub_d")]
    if not truck_plate or not mother:
        return "missing_truck_or_mother"
    if any(not sub for sub in subs):
        return "missing_sub"
    if len({mother, *subs}) != 4:
        return "duplicate_serial_in_row"

    actor_id = actor_for_team(conn, row.get("team_member", ""), fallback_actor_id)
    logged_at = parse_date(row.get("date") or row.get("submitted_at"), now_ts())
    truck_id = ensure_truck(conn, org_id, truck_plate)
    mother_id = ensure_device(conn, org_id, actor_id, mother, "mother", logged_at)
    sub_ids = [ensure_device(conn, org_id, actor_id, sub, "sub", logged_at) for sub in subs]
    if not mother_id or any(sub_id is None for sub_id in sub_ids):
        return "serial_type_conflict"

    assignment_id = new_id("asg")
    conn.execute(
        """
        insert into truck_assignments (
          id, org_id, truck_id, device_id, assigned_at, assigned_by, removed_at, removed_by,
          removal_reason, disposition, removal_notes, created_at
        ) values (?, ?, ?, ?, ?, ?, ?, ?, 'other', 'available_pool', ?, ?)
        """,
        (
            assignment_id,
            org_id,
            truck_id,
            mother_id,
            logged_at,
            actor_id,
            logged_at,
            actor_id,
            "Historical installation snapshot; closed so current assignment state is unaffected.",
            now_ts(),
        ),
    )
    for slot, sub_id in zip(["B", "C", "D"], sub_ids):
        assert sub_id is not None
        conn.execute(
            """
            insert into slot_pairings (
              id, org_id, mother_device_id, slot, sub_device_id, paired_at, paired_by,
              unpaired_at, unpaired_by, removal_reason, disposition, created_at
            ) values (?, ?, ?, ?, ?, ?, ?, ?, ?, 'other', 'available_pool', ?)
            """,
            (new_id("slot"), org_id, mother_id, slot, sub_id, logged_at, actor_id, logged_at, actor_id, now_ts()),
        )

    install_id = new_id("ins")
    conn.execute(
        """
        insert into installation_logs (
          id, org_id, truck_id, mother_device_id, assignment_id, actor_user_id, logged_date,
          battery_level, physical_damage, overall_status, issues_notes, created_at, updated_at
        ) values (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        """,
        (
            install_id,
            org_id,
            truck_id,
            mother_id,
            assignment_id,
            actor_id,
            logged_at,
            enum_battery(row.get("battery_level", "")),
            enum_physical_damage(row.get("physical_damage", "")),
            enum_overall(row.get("overall_status", "")),
            row.get("issues") or None,
            now_ts(),
            now_ts(),
        ),
    )
    conn.execute(
        "insert into audit_log (id, org_id, actor_user_id, entity_table, entity_id, operation, after_json, created_at) values (?, ?, ?, 'installation_logs', ?, 'import', ?, ?)",
        (
            new_id("aud"),
            org_id,
            actor_id,
            install_id,
            json.dumps({"truck": truck_plate, "mother": mother, "subs": subs, "source_row": row.get("source_row"), "historical_snapshot": True}),
            now_ts(),
        ),
    )
    return "imported"


def main() -> None:
    backup = backup_db()
    rows = read_rows()
    conn = sqlite3.connect(DB_PATH)
    conn.row_factory = sqlite3.Row
    conn.execute("pragma foreign_keys = on")
    fallback_actor_id, org_id = actor(conn)
    existing_source_rows = imported_source_rows(conn)
    counts: dict[str, int] = {}
    try:
        conn.execute("begin")
        for row in rows:
            source_row = str(row.get("source_row") or "").strip()
            if source_row and source_row in existing_source_rows:
                counts["already_imported"] = counts.get("already_imported", 0) + 1
                continue
            status = import_row(conn, org_id, fallback_actor_id, row)
            counts[status] = counts.get(status, 0) + 1
        conn.commit()
    except Exception:
        conn.rollback()
        raise
    finally:
        final_counts = {
            "installation_logs": conn.execute("select count(*) from installation_logs").fetchone()[0],
            "open_assignments": conn.execute("select count(*) from truck_assignments where removed_at is null").fetchone()[0],
            "open_pairings": conn.execute("select count(*) from slot_pairings where unpaired_at is null").fetchone()[0],
        }
        conn.close()
    print(json.dumps({"backup": str(backup), "source_rows": len(rows), "results": counts, "final_counts": final_counts}, indent=2))


if __name__ == "__main__":
    main()
