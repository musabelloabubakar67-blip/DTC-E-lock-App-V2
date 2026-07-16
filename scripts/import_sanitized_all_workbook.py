from __future__ import annotations

import csv
import json
import shutil
import sqlite3
import sys
import uuid
from datetime import datetime
from pathlib import Path
from typing import Any


DB_PATH = Path("data/dtc-elock.sqlite")
DATA_DIR = Path("data/sanitized/all_workbook")
BACKUP_DIR = Path("data/backups")


def new_id(prefix: str) -> str:
    return f"{prefix}_{uuid.uuid4().hex}"


def now_ts() -> int:
    return int(datetime.now().timestamp())


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


def read_csv(path: Path) -> list[dict[str, str]]:
    with path.open("r", newline="", encoding="utf-8") as handle:
        return list(csv.DictReader(handle))


def one(conn: sqlite3.Connection, sql: str, args: tuple[Any, ...] = ()) -> sqlite3.Row | None:
    return conn.execute(sql, args).fetchone()


def val(row: dict[str, str], key: str) -> str:
    return (row.get(key) or "").strip().upper()


def enum_battery(value: str) -> str | None:
    raw = value.strip().lower()
    if raw in {"full", "adequate", "low", "dead"}:
        return raw
    return None


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


def ensure_actor(conn: sqlite3.Connection) -> tuple[str, str]:
    actor = one(conn, "select id, org_id from users where lower(username) = 'musa' limit 1")
    if actor:
        return actor["id"], actor["org_id"]
    actor = one(conn, "select id, org_id from users where role = 'supervisor' order by rowid limit 1")
    if actor:
        return actor["id"], actor["org_id"]
    raise RuntimeError("No supervisor/import actor found. Seed users first.")


def actor_for_team(conn: sqlite3.Connection, team_member: str, fallback_actor_id: str) -> str:
    username = team_member.strip().lower()
    if not username:
        return fallback_actor_id
    actor = one(conn, "select id from users where lower(username) = ? limit 1", (username,))
    return actor["id"] if actor else fallback_actor_id


def ensure_device(
    conn: sqlite3.Connection,
    *,
    org_id: str,
    device_type: str,
    serial: str,
    sim_number: str | None,
    lifecycle_status: str,
    registered_at: int,
    actor_id: str,
    notes: str,
) -> str:
    existing = one(conn, "select id, lifecycle_status from devices where serial = ? limit 1", (serial,))
    if existing:
        return existing["id"]
    device_id = new_id("dev")
    conn.execute(
        """
        insert into devices (
          id, org_id, device_type, serial, sim_number, lifecycle_status, registered_at,
          registered_by, import_unverified, origin, notes, created_at, updated_at
        ) values (?, ?, ?, ?, ?, ?, ?, ?, 1, 'registered', ?, ?, ?)
        """,
        (
            device_id,
            org_id,
            device_type,
            serial,
            sim_number if device_type == "mother" else None,
            lifecycle_status,
            registered_at,
            actor_id,
            notes,
            now_ts(),
            now_ts(),
        ),
    )
    return device_id


def import_registration_master(
    conn: sqlite3.Connection,
    org_id: str,
    actor_id: str,
    rows: list[dict[str, str]],
    skipped_conflicts: list[dict[str, Any]],
) -> int:
    imported = 0
    sub_counts: dict[str, int] = {}
    for row in rows:
        for key in ["sub_b", "sub_c", "sub_d"]:
            sub = val(row, key)
            if sub:
                sub_counts[sub] = sub_counts.get(sub, 0) + 1

    for row in rows:
        mother = val(row, "mother")
        subs = [val(row, "sub_b"), val(row, "sub_c"), val(row, "sub_d")]
        if not mother or any(not sub for sub in subs) or len({mother, *subs}) != 4:
            skipped_conflicts.append({"reason": "invalid_masterlist_kit", "row": row})
            continue
        duplicated_subs = [sub for sub in subs if sub_counts.get(sub, 0) > 1]
        if duplicated_subs:
            skipped_conflicts.append({"reason": "masterlist_sub_in_multiple_kits", "duplicated_subs": duplicated_subs, "row": row})
            continue
        logged_at = parse_date(row.get("date"), now_ts())
        mother_id = ensure_device(
            conn,
            org_id=org_id,
            device_type="mother",
            serial=mother,
            sim_number=val(row, "sim") or None,
            lifecycle_status="available",
            registered_at=logged_at,
            actor_id=actor_id,
            notes=f"Imported from sanitized all workbook masterlist row {row.get('source_row')}",
        )
        sub_ids = [
            ensure_device(
                conn,
                org_id=org_id,
                device_type="sub",
                serial=sub,
                sim_number=None,
                lifecycle_status="available",
                registered_at=logged_at,
                actor_id=actor_id,
                notes=f"Imported from sanitized all workbook masterlist row {row.get('source_row')}",
            )
            for sub in subs
        ]
        existing_log = one(conn, "select id from registration_logs where mother_device_id = ? and source = 'import'", (mother_id,))
        if not existing_log:
            log_id = new_id("reg")
            conn.execute(
                """
                insert into registration_logs (
                  id, org_id, mother_device_id, actor_user_id, logged_date, sim_number,
                  source, notes, created_at, updated_at
                ) values (?, ?, ?, ?, ?, ?, 'import', ?, ?, ?)
                """,
                (
                    log_id,
                    org_id,
                    mother_id,
                    actor_id,
                    logged_at,
                    val(row, "sim") or None,
                    f"Imported from sanitized all workbook masterlist row {row.get('source_row')}",
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
                    log_id,
                    json.dumps({"mother": mother, "subs": subs, "source_row": row.get("source_row")}),
                    now_ts(),
                ),
            )
            imported += 1
        for sub_id in sub_ids:
            existing_member = one(
                conn,
                "select id from kit_members where mother_device_id = ? and sub_device_id = ? and removed_at is null",
                (mother_id, sub_id),
            )
            if not existing_member:
                conn.execute(
                    "insert into kit_members (id, org_id, mother_device_id, sub_device_id, added_at, created_at) values (?, ?, ?, ?, ?, ?)",
                    (new_id("kit"), org_id, mother_id, sub_id, logged_at, now_ts()),
                )
    return imported


def issue_key(row: dict[str, str]) -> tuple[str, str]:
    return val(row, "truck"), val(row, "mother")


def clean_latest_installations() -> list[dict[str, str]]:
    latest = read_csv(DATA_DIR / "latest_installations_by_truck.csv")
    conflict_keys: set[tuple[str, str]] = set()
    for filename in [
        "latest_install_mother_missing_updated_registry.csv",
        "latest_install_mother_missing_masterlist.csv",
        "latest_install_truck_missing_registry.csv",
        "latest_install_kit_mismatches_vs_registry.csv",
    ]:
        for row in read_csv(DATA_DIR / filename):
            conflict_keys.add(issue_key(row))
    return [row for row in latest if issue_key(row) not in conflict_keys]


def ensure_truck(conn: sqlite3.Connection, org_id: str, plate: str) -> str:
    existing = one(conn, "select id from trucks where plate = ? limit 1", (plate,))
    if existing:
        return existing["id"]
    truck_id = new_id("trk")
    conn.execute(
        "insert into trucks (id, org_id, plate, is_active, created_via, created_at, updated_at) values (?, ?, ?, 1, 'import', ?, ?)",
        (truck_id, org_id, plate, now_ts(), now_ts()),
    )
    return truck_id


def device_id(conn: sqlite3.Connection, serial: str, device_type: str) -> str | None:
    row = one(conn, "select id from devices where serial = ? and device_type = ? limit 1", (serial, device_type))
    return row["id"] if row else None


def import_clean_installations(conn: sqlite3.Connection, org_id: str, fallback_actor_id: str, rows: list[dict[str, str]]) -> int:
    imported = 0
    for row in rows:
        truck_plate = val(row, "truck")
        mother = val(row, "mother")
        subs = [val(row, "sub_b"), val(row, "sub_c"), val(row, "sub_d")]
        if not truck_plate or not mother or any(not sub for sub in subs):
            continue
        mother_id = device_id(conn, mother, "mother")
        sub_ids = [device_id(conn, sub, "sub") for sub in subs]
        if not mother_id or any(sub_id is None for sub_id in sub_ids):
            continue
        truck_id = ensure_truck(conn, org_id, truck_plate)
        actor_id = actor_for_team(conn, row.get("team_member", ""), fallback_actor_id)
        logged_at = parse_date(row.get("date") or row.get("submitted_at"), now_ts())
        existing_assignment = one(
            conn,
            "select id from truck_assignments where truck_id = ? and device_id = ? and removed_at is null",
            (truck_id, mother_id),
        )
        if existing_assignment:
            continue
        if one(conn, "select id from truck_assignments where truck_id = ? and removed_at is null", (truck_id,)):
            continue
        if one(conn, "select id from truck_assignments where device_id = ? and removed_at is null", (mother_id,)):
            continue
        assignment_id = new_id("asg")
        conn.execute(
            "insert into truck_assignments (id, org_id, truck_id, device_id, assigned_at, assigned_by, created_at) values (?, ?, ?, ?, ?, ?, ?)",
            (assignment_id, org_id, truck_id, mother_id, logged_at, actor_id, now_ts()),
        )
        slots = ["B", "C", "D"]
        slot_pairing_ids: list[str] = []
        for slot, sub_id in zip(slots, sub_ids):
            assert sub_id is not None
            pairing_id = new_id("slot")
            conn.execute(
                "insert into slot_pairings (id, org_id, mother_device_id, slot, sub_device_id, paired_at, paired_by, created_at) values (?, ?, ?, ?, ?, ?, ?, ?)",
                (pairing_id, org_id, mother_id, slot, sub_id, logged_at, actor_id, now_ts()),
            )
            slot_pairing_ids.append(pairing_id)
            conn.execute("update devices set lifecycle_status = 'in_service', updated_at = ? where id = ?", (now_ts(), sub_id))
        conn.execute("update devices set lifecycle_status = 'in_service', updated_at = ? where id = ?", (now_ts(), mother_id))
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
                json.dumps({"truck": truck_plate, "mother": mother, "subs": subs, "source_row": row.get("source_row")}),
                now_ts(),
            ),
        )
        imported += 1
    return imported


def add_conflict_reviews(
    conn: sqlite3.Connection,
    org_id: str,
    actor_id: str,
    extra_conflicts: list[dict[str, Any]] | None = None,
) -> int:
    rows: list[dict[str, Any]] = []
    for filename, reason in [
        ("latest_install_mother_missing_updated_registry.csv", "mother_missing_updated_registry"),
        ("latest_install_mother_missing_masterlist.csv", "mother_missing_registration_masterlist"),
        ("latest_install_truck_missing_registry.csv", "truck_missing_updated_registry"),
        ("latest_install_kit_mismatches_vs_registry.csv", "kit_mismatch_updated_registry"),
    ]:
        for row in read_csv(DATA_DIR / filename):
            rows.append({"reason": reason, "row": row})
    rows.extend(extra_conflicts or [])
    inserted = 0
    seen: set[str] = set()
    for item in rows:
        row = item["row"]
        key = f"{item['reason']}:{val(row, 'truck')}:{val(row, 'mother')}:{row.get('source_row') or row.get('install_row')}:{','.join(item.get('duplicated_subs', []))}"
        if key in seen:
            continue
        seen.add(key)
        existing = one(
            conn,
            "select id from conflict_reviews where kind = 'import_conflict' and payload_json like ? limit 1",
            (f"%{key}%",),
        )
        if existing:
            continue
        payload = {"importKey": key, "source": "DTC E-Lock Management System - All.xlsx", **item}
        review_id = new_id("rev")
        conn.execute(
            "insert into conflict_reviews (id, org_id, kind, payload_json, status, created_at) values (?, ?, 'import_conflict', ?, 'open', ?)",
            (review_id, org_id, json.dumps(payload), now_ts()),
        )
        conn.execute(
            "insert into audit_log (id, org_id, actor_user_id, entity_table, entity_id, operation, after_json, created_at) values (?, ?, ?, 'conflict_reviews', ?, 'import', ?, ?)",
            (new_id("aud"), org_id, actor_id, review_id, json.dumps(payload), now_ts()),
        )
        inserted += 1
    return inserted


def backup_db() -> Path:
    BACKUP_DIR.mkdir(parents=True, exist_ok=True)
    backup = BACKUP_DIR / f"dtc-elock-before-all-import-{datetime.now().strftime('%Y%m%d-%H%M%S')}.sqlite"
    source = sqlite3.connect(DB_PATH)
    try:
        dest = sqlite3.connect(backup)
        try:
            source.backup(dest)
        finally:
            dest.close()
    finally:
        source.close()
    return backup


def counts(conn: sqlite3.Connection) -> dict[str, int]:
    tables = [
        "devices",
        "registration_logs",
        "kit_members",
        "trucks",
        "truck_assignments",
        "slot_pairings",
        "installation_logs",
        "conflict_reviews",
        "audit_log",
    ]
    return {table: int(conn.execute(f"select count(*) from {table}").fetchone()[0]) for table in tables}


def main() -> None:
    dry_run = "--dry-run" in sys.argv
    master = read_csv(DATA_DIR / "masterlist_normalized.csv")
    clean_installs = clean_latest_installations()

    backup = None if dry_run else backup_db()
    conn = sqlite3.connect(DB_PATH)
    conn.row_factory = sqlite3.Row
    conn.execute("pragma foreign_keys = on")
    before = counts(conn)
    actor_id, org_id = ensure_actor(conn)
    try:
        conn.execute("begin")
        skipped_master_conflicts: list[dict[str, Any]] = []
        imported_registrations = import_registration_master(conn, org_id, actor_id, master, skipped_master_conflicts)
        imported_installations = import_clean_installations(conn, org_id, actor_id, clean_installs)
        inserted_reviews = add_conflict_reviews(conn, org_id, actor_id, skipped_master_conflicts)
        after_inside = counts(conn)
        if dry_run:
            conn.rollback()
        else:
            conn.commit()
    except Exception:
        conn.rollback()
        raise
    finally:
        after = counts(conn)
        conn.close()

    report = {
        "dry_run": dry_run,
        "backup": str(backup) if backup else None,
        "input": {
            "masterlist_rows": len(master),
            "clean_latest_installations": len(clean_installs),
        },
        "imported": {
            "registration_logs": imported_registrations,
            "installation_logs": imported_installations,
            "conflict_reviews": inserted_reviews,
            "skipped_masterlist_conflicts": len(skipped_master_conflicts),
        },
        "counts_before": before,
        "counts_after_inside_transaction": after_inside,
        "counts_after": after,
    }
    out = DATA_DIR / ("import_dry_run_report.json" if dry_run else "import_report.json")
    out.write_text(json.dumps(report, indent=2), encoding="utf-8")
    print(json.dumps(report, indent=2))


if __name__ == "__main__":
    main()
