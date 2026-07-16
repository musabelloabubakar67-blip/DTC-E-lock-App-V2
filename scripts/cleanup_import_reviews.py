from __future__ import annotations

import csv
import json
import sqlite3
import sys
import uuid
from collections import Counter
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


def read_csv(path: Path) -> list[dict[str, str]]:
    with path.open("r", newline="", encoding="utf-8") as handle:
        return list(csv.DictReader(handle))


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


def ensure_actor(conn: sqlite3.Connection) -> tuple[str, str]:
    actor = one(conn, "select id, org_id from users where lower(username) = 'musa' limit 1")
    if actor:
        return actor["id"], actor["org_id"]
    actor = one(conn, "select id, org_id from users where role = 'supervisor' order by rowid limit 1")
    if actor:
        return actor["id"], actor["org_id"]
    raise RuntimeError("No supervisor/import actor found.")


def actor_for_team(conn: sqlite3.Connection, team_member: str, fallback_actor_id: str) -> str:
    username = team_member.strip().lower()
    if not username:
        return fallback_actor_id
    actor = one(conn, "select id from users where lower(username) = ? limit 1", (username,))
    return actor["id"] if actor else fallback_actor_id


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


def backup_db() -> Path:
    BACKUP_DIR.mkdir(parents=True, exist_ok=True)
    backup = BACKUP_DIR / f"dtc-elock-before-review-cleanup-{datetime.now().strftime('%Y%m%d-%H%M%S')}.sqlite"
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


def ensure_device(
    conn: sqlite3.Connection,
    *,
    org_id: str,
    device_type: str,
    serial: str,
    lifecycle_status: str,
    registered_at: int,
    actor_id: str,
    notes: str,
) -> str:
    existing = one(conn, "select id from devices where serial = ? and device_type = ? limit 1", (serial, device_type))
    if existing:
        return existing["id"]
    device_id = new_id("dev")
    conn.execute(
        """
        insert into devices (
          id, org_id, device_type, serial, lifecycle_status, registered_at, registered_by,
          import_unverified, origin, notes, created_at, updated_at
        ) values (?, ?, ?, ?, ?, ?, ?, 1, 'registered', ?, ?, ?)
        """,
        (device_id, org_id, device_type, serial, lifecycle_status, registered_at, actor_id, notes, now_ts(), now_ts()),
    )
    return device_id


def ensure_registration_from_install(conn: sqlite3.Connection, org_id: str, actor_id: str, row: dict[str, str]) -> tuple[bool, str | None]:
    mother = val(row, "mother")
    subs = [val(row, "sub_b"), val(row, "sub_c"), val(row, "sub_d")]
    if not mother or any(not sub for sub in subs) or len({mother, *subs}) != 4:
        return False, "invalid_install_kit"
    logged_at = parse_date(row.get("date") or row.get("submitted_at"), now_ts())
    mother_id = ensure_device(
        conn,
        org_id=org_id,
        device_type="mother",
        serial=mother,
        lifecycle_status="available",
        registered_at=logged_at,
        actor_id=actor_id,
        notes=f"Added from latest installation row {row.get('source_row')} to close masterlist coverage gap",
    )
    sub_ids = [
        ensure_device(
            conn,
            org_id=org_id,
            device_type="sub",
            serial=sub,
            lifecycle_status="available",
            registered_at=logged_at,
            actor_id=actor_id,
            notes=f"Added from latest installation row {row.get('source_row')} to close masterlist coverage gap",
        )
        for sub in subs
    ]
    for sub_id in sub_ids:
        existing_member = one(
            conn,
            "select mother_device_id from kit_members where sub_device_id = ? and removed_at is null limit 1",
            (sub_id,),
        )
        if existing_member and existing_member["mother_device_id"] != mother_id:
            return False, "sub_already_registered_to_other_mother"
    created = False
    if not one(conn, "select id from registration_logs where mother_device_id = ? limit 1", (mother_id,)):
        log_id = new_id("reg")
        conn.execute(
            """
            insert into registration_logs (
              id, org_id, mother_device_id, actor_user_id, logged_date, source, notes, created_at, updated_at
            ) values (?, ?, ?, ?, ?, 'import', ?, ?, ?)
            """,
            (
                log_id,
                org_id,
                mother_id,
                actor_id,
                logged_at,
                f"Added from latest installation row {row.get('source_row')} to close masterlist coverage gap",
                now_ts(),
                now_ts(),
            ),
        )
        conn.execute(
            "insert into audit_log (id, org_id, actor_user_id, entity_table, entity_id, operation, after_json, created_at) values (?, ?, ?, 'registration_logs', ?, 'import', ?, ?)",
            (new_id("aud"), org_id, actor_id, log_id, json.dumps({"mother": mother, "subs": subs, "source_row": row.get("source_row"), "cleanup": True}), now_ts()),
        )
        created = True
    for sub_id in sub_ids:
        if not one(conn, "select id from kit_members where mother_device_id = ? and sub_device_id = ? and removed_at is null", (mother_id, sub_id)):
            conn.execute(
                "insert into kit_members (id, org_id, mother_device_id, sub_device_id, added_at, created_at) values (?, ?, ?, ?, ?, ?)",
                (new_id("kit"), org_id, mother_id, sub_id, logged_at, now_ts()),
            )
    return created, None


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


def import_latest_install(conn: sqlite3.Connection, org_id: str, fallback_actor_id: str, row: dict[str, str]) -> bool:
    truck_plate = val(row, "truck")
    mother = val(row, "mother")
    subs = [val(row, "sub_b"), val(row, "sub_c"), val(row, "sub_d")]
    if not truck_plate or not mother or any(not sub for sub in subs):
        return False
    mother_id = device_id(conn, mother, "mother")
    sub_ids = [device_id(conn, sub, "sub") for sub in subs]
    if not mother_id or any(sub_id is None for sub_id in sub_ids):
        return False
    if one(conn, "select id from truck_assignments where device_id = ? and removed_at is null", (mother_id,)):
        return False
    existing_truck = one(conn, "select id from trucks where plate = ? limit 1", (truck_plate,))
    if existing_truck and one(conn, "select id from truck_assignments where truck_id = ? and removed_at is null", (existing_truck["id"],)):
        return False
    truck_id = existing_truck["id"] if existing_truck else ensure_truck(conn, org_id, truck_plate)
    actor_id = actor_for_team(conn, row.get("team_member", ""), fallback_actor_id)
    logged_at = parse_date(row.get("date") or row.get("submitted_at"), now_ts())
    assignment_id = new_id("asg")
    conn.execute(
        "insert into truck_assignments (id, org_id, truck_id, device_id, assigned_at, assigned_by, created_at) values (?, ?, ?, ?, ?, ?, ?)",
        (assignment_id, org_id, truck_id, mother_id, logged_at, actor_id, now_ts()),
    )
    for slot, sub_id in zip(["B", "C", "D"], sub_ids):
        assert sub_id is not None
        conn.execute(
            "insert into slot_pairings (id, org_id, mother_device_id, slot, sub_device_id, paired_at, paired_by, created_at) values (?, ?, ?, ?, ?, ?, ?, ?)",
            (new_id("slot"), org_id, mother_id, slot, sub_id, logged_at, actor_id, now_ts()),
        )
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
        (new_id("aud"), org_id, actor_id, install_id, json.dumps({"truck": truck_plate, "mother": mother, "subs": subs, "source_row": row.get("source_row"), "cleanup": True}), now_ts()),
    )
    return True


def classify_kit_mismatches() -> tuple[set[tuple[str, str]], set[tuple[str, str]]]:
    slot_order_only: set[tuple[str, str]] = set()
    actual_serial_mismatch: set[tuple[str, str]] = set()
    for row in read_csv(DATA_DIR / "latest_install_kit_mismatches_vs_registry.csv"):
        install_subs = [row["install_sub_b"], row["install_sub_c"], row["install_sub_d"]]
        registry_subs = [row["registry_sub_b"], row["registry_sub_c"], row["registry_sub_d"]]
        key = (val(row, "truck"), val(row, "mother"))
        if sorted(install_subs) == sorted(registry_subs):
            slot_order_only.add(key)
        else:
            actual_serial_mismatch.add(key)
    return slot_order_only, actual_serial_mismatch


def build_allowed_latest_rows() -> tuple[list[dict[str, str]], dict[str, int]]:
    latest = read_csv(DATA_DIR / "latest_installations_by_truck.csv")
    slot_order_only, actual_serial_mismatch = classify_kit_mismatches()
    allowed = []
    skipped = Counter()
    for row in latest:
        key = (val(row, "truck"), val(row, "mother"))
        if key in actual_serial_mismatch:
            skipped["actual_serial_mismatch"] += 1
            continue
        allowed.append(row)
    return allowed, dict(skipped | Counter({"slot_order_only_allowed": len(slot_order_only)}))


def resolve_import_reviews(
    conn: sqlite3.Connection,
    actor_id: str,
    actual_serial_keys: set[tuple[str, str]],
    unresolved_masterlist_keys: set[tuple[str, str]],
) -> dict[str, int]:
    resolved = 0
    kept_open = 0
    for row in conn.execute("select id, payload_json, status from conflict_reviews where kind = 'import_conflict'").fetchall():
        payload = json.loads(row["payload_json"])
        reason = payload.get("reason")
        detail = payload.get("row") or {}
        key = (val(detail, "truck"), val(detail, "mother"))
        should_keep = (
            reason in {"invalid_masterlist_kit", "masterlist_sub_in_multiple_kits"}
            or (reason == "kit_mismatch_updated_registry" and key in actual_serial_keys)
            or (reason == "mother_missing_registration_masterlist" and key in unresolved_masterlist_keys)
        )
        if should_keep:
            kept_open += 1 if row["status"] == "open" else 0
            continue
        if row["status"] == "open":
            conn.execute(
                "update conflict_reviews set status = 'resolved', resolved_by = ?, resolved_at = ?, resolution_notes = ? where id = ?",
                (actor_id, now_ts(), "Resolved during import cleanup: coverage gap or slot-order-only mismatch accepted.", row["id"]),
            )
            resolved += 1
    return {"resolved": resolved, "kept_open": kept_open}


def counts(conn: sqlite3.Connection) -> dict[str, int]:
    tables = ["devices", "registration_logs", "kit_members", "trucks", "truck_assignments", "slot_pairings", "installation_logs", "conflict_reviews", "audit_log"]
    out = {table: int(conn.execute(f"select count(*) from {table}").fetchone()[0]) for table in tables}
    out["open_conflict_reviews"] = int(conn.execute("select count(*) from conflict_reviews where status = 'open'").fetchone()[0])
    return out


def main() -> None:
    dry_run = "--dry-run" in sys.argv
    backup = None if dry_run else backup_db()
    conn = sqlite3.connect(DB_PATH)
    conn.row_factory = sqlite3.Row
    conn.execute("pragma foreign_keys = on")
    before = counts(conn)
    actor_id, org_id = ensure_actor(conn)
    allowed_rows, classification = build_allowed_latest_rows()
    _, actual_serial_keys = classify_kit_mismatches()
    try:
        conn.execute("begin")
        added_registrations = 0
        unresolved_masterlist_keys: set[tuple[str, str]] = set()
        missing_registration_skips = Counter()
        for row in read_csv(DATA_DIR / "latest_install_mother_missing_masterlist.csv"):
            created, skip_reason = ensure_registration_from_install(conn, org_id, actor_id, row)
            if created:
                added_registrations += 1
            elif skip_reason:
                missing_registration_skips[skip_reason] += 1
                unresolved_masterlist_keys.add((val(row, "truck"), val(row, "mother")))
        imported_installations = 0
        for row in allowed_rows:
            if import_latest_install(conn, org_id, actor_id, row):
                imported_installations += 1
        review_updates = resolve_import_reviews(conn, actor_id, actual_serial_keys, unresolved_masterlist_keys)
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
        "classification": classification,
        "added_registrations_from_install_rows": added_registrations,
        "missing_registration_skips": dict(missing_registration_skips),
        "imported_additional_latest_installations": imported_installations,
        "review_updates": review_updates,
        "counts_before": before,
        "counts_after_inside_transaction": after_inside,
        "counts_after": after,
    }
    out = DATA_DIR / ("review_cleanup_dry_run_report.json" if dry_run else "review_cleanup_report.json")
    out.write_text(json.dumps(report, indent=2), encoding="utf-8")
    print(json.dumps(report, indent=2))


if __name__ == "__main__":
    main()
