from __future__ import annotations

import csv
import json
import re
import sys
from collections import Counter, defaultdict
from datetime import datetime
from pathlib import Path
from typing import Any

import openpyxl


WORKBOOK = Path(r"C:\Users\!admin\Downloads\DTC E-Lock Management System  - All.xlsx")
OUT_DIR = Path("data/sanitized/all_workbook")


def text(value: Any) -> str:
    if value is None:
        return ""
    if isinstance(value, float) and value.is_integer():
        return str(int(value))
    return str(value).strip()


def serial(value: Any) -> str:
    return re.sub(r"\s+", "", text(value)).upper()


def plate(value: Any) -> str:
    return re.sub(r"\s+", "", text(value)).upper()


def date_iso(value: Any) -> str:
    if value is None or value == "":
        return ""
    if isinstance(value, datetime):
        return value.date().isoformat()
    raw = text(value)
    for fmt in ("%Y-%m-%d %H:%M:%S", "%Y-%m-%d", "%d/%m/%Y", "%m/%d/%Y"):
        try:
            return datetime.strptime(raw, fmt).date().isoformat()
        except ValueError:
            pass
    return raw


def datetime_sort_key(*values: Any) -> tuple[int, str]:
    for value in values:
        if value is None or value == "":
            continue
        if isinstance(value, datetime):
            return (1, value.isoformat())
        raw = text(value)
        for fmt in ("%Y-%m-%d %H:%M:%S", "%Y-%m-%d", "%d/%m/%Y", "%m/%d/%Y"):
            try:
                return (1, datetime.strptime(raw, fmt).isoformat())
            except ValueError:
                pass
        if raw:
            return (1, raw)
    return (0, "")


def rows_by_header(ws: Any) -> list[dict[str, Any]]:
    values = list(ws.iter_rows(values_only=True))
    header_index = next(
        (idx for idx, row in enumerate(values) if any(cell is not None and text(cell) for cell in row)),
        None,
    )
    if header_index is None:
        return []
    headers = [text(cell) or f"__blank_{idx}" for idx, cell in enumerate(values[header_index])]
    result: list[dict[str, Any]] = []
    for row in values[header_index + 1 :]:
        if not any(cell is not None and text(cell) for cell in row):
            continue
        result.append({headers[idx]: row[idx] if idx < len(row) else None for idx in range(len(headers))})
    return result


def write_csv(path: Path, rows: list[dict[str, Any]]) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    if not rows:
        path.write_text("", encoding="utf-8")
        return
    headers = list(rows[0].keys())
    with path.open("w", newline="", encoding="utf-8") as handle:
        writer = csv.DictWriter(handle, fieldnames=headers)
        writer.writeheader()
        writer.writerows(rows)


def kit_key(mother: str, subs: list[str]) -> str:
    return "|".join([mother, *subs])


def main() -> None:
    workbook = Path(sys.argv[1]) if len(sys.argv) > 1 else WORKBOOK
    wb = openpyxl.load_workbook(workbook, read_only=True, data_only=True)

    master_rows = rows_by_header(wb["Registeration Masterlist"])
    registry_rows = rows_by_header(wb["Updated Registry"])
    install_rows = rows_by_header(wb["Installations"])

    master: list[dict[str, Any]] = []
    registry: list[dict[str, Any]] = []
    installations: list[dict[str, Any]] = []

    for idx, row in enumerate(master_rows, start=2):
        subs = [serial(row.get("Sub Lock 1")), serial(row.get("Sub Lock 2")), serial(row.get("Sub Lock 3"))]
        mother = serial(row.get("Master Lock"))
        master.append(
            {
                "source_row": idx,
                "mother": mother,
                "sim": serial(row.get("Sim Card")),
                "sub_b": subs[0],
                "sub_c": subs[1],
                "sub_d": subs[2],
                "date": date_iso(row.get("Date")),
                "kit_key": kit_key(mother, subs),
            }
        )

    for idx, row in enumerate(registry_rows, start=2):
        subs = [serial(row.get("SUB LOCK B")), serial(row.get("SUB LOCK C")), serial(row.get("SUB LOCK D"))]
        mother = serial(row.get("MASTER LOCK"))
        registry.append(
            {
                "source_row": idx,
                "truck": plate(row.get("TRUCK NUMBER")),
                "mother": mother,
                "sim": serial(row.get("SIM CARD")),
                "sub_b": subs[0],
                "sub_c": subs[1],
                "sub_d": subs[2],
                "date": date_iso(row.get("DATE")),
                "status": text(row.get("DEVICE STATUS")).title(),
                "notes": text(row.get("Notes")),
                "kit_key": kit_key(mother, subs),
            }
        )

    for idx, row in enumerate(install_rows, start=2):
        subs = [
            serial(row.get("Sub Lock C1 Serial Number")),
            serial(row.get("Sub Lock C2 Serial Number")),
            serial(row.get("Sub Lock C3 Serial Number")),
        ]
        mother = serial(row.get("Mother Lock Serial Number"))
        installations.append(
            {
                "source_row": idx,
                "submitted_at": date_iso(row.get("Column 1")),
                "date": date_iso(row.get("Date")),
                "_sort_key": datetime_sort_key(row.get("Column 1"), row.get("Date"), idx),
                "team_member": text(row.get("Team Member Name")),
                "truck": plate(row.get("Truck Number")),
                "mother": mother,
                "sub_b": subs[0],
                "sub_c": subs[1],
                "sub_d": subs[2],
                "battery_level": text(row.get("Battery Level")),
                "physical_damage": text(row.get("Physical Damage Observed")),
                "overall_status": text(row.get("Overall Installation Status")),
                "issues": text(row.get("Issues Noted(if any)")),
                "kit_key": kit_key(mother, subs),
            }
        )

    master_mothers = {row["mother"] for row in master if row["mother"]}
    registry_mothers = {row["mother"] for row in registry if row["mother"]}
    registry_assigned_trucks = {row["truck"] for row in registry if row["truck"] and row["status"].lower() == "active"}
    registry_any_trucks = {row["truck"] for row in registry if row["truck"]}
    registry_by_mother = {row["mother"]: row for row in registry if row["mother"]}
    master_by_mother = {row["mother"]: row for row in master if row["mother"]}

    install_mothers = {row["mother"] for row in installations if row["mother"]}
    install_trucks = {row["truck"] for row in installations if row["truck"]}

    installed_missing_registry_mother = [
        row for row in installations if row["mother"] and row["mother"] not in registry_mothers
    ]
    installed_missing_master_mother = [
        row for row in installations if row["mother"] and row["mother"] not in master_mothers
    ]
    installed_truck_missing_registry = [
        row for row in installations if row["truck"] and row["truck"] not in registry_any_trucks
    ]
    installed_truck_not_active_registry = [
        row
        for row in installations
        if row["truck"] and row["truck"] not in registry_assigned_trucks
    ]

    installed_kit_mismatches: list[dict[str, Any]] = []
    for row in installations:
        reg = registry_by_mother.get(row["mother"])
        if not reg:
            continue
        install_subs = [row["sub_b"], row["sub_c"], row["sub_d"]]
        registry_subs = [reg["sub_b"], reg["sub_c"], reg["sub_d"]]
        if install_subs != registry_subs:
            installed_kit_mismatches.append(
                {
                    "install_row": row["source_row"],
                    "registry_row": reg["source_row"],
                    "truck": row["truck"],
                    "mother": row["mother"],
                    "install_sub_b": row["sub_b"],
                    "install_sub_c": row["sub_c"],
                    "install_sub_d": row["sub_d"],
                    "registry_sub_b": reg["sub_b"],
                    "registry_sub_c": reg["sub_c"],
                    "registry_sub_d": reg["sub_d"],
                }
            )

    duplicate_install_mother = [
        {"mother": mother, "count": count}
        for mother, count in Counter(row["mother"] for row in installations if row["mother"]).items()
        if count > 1
    ]
    duplicate_install_truck = [
        {"truck": truck, "count": count}
        for truck, count in Counter(row["truck"] for row in installations if row["truck"]).items()
        if count > 1
    ]

    latest_install_by_truck: dict[str, dict[str, Any]] = {}
    for row in installations:
        if not row["truck"]:
            continue
        current = latest_install_by_truck.get(row["truck"])
        if current is None or row["_sort_key"] > current["_sort_key"]:
            latest_install_by_truck[row["truck"]] = row

    latest_install_rows = [{k: v for k, v in row.items() if k != "_sort_key"} for row in latest_install_by_truck.values()]
    latest_missing_registry_mother = [
        row for row in latest_install_rows if row["mother"] and row["mother"] not in registry_mothers
    ]
    latest_missing_master_mother = [
        row for row in latest_install_rows if row["mother"] and row["mother"] not in master_mothers
    ]
    latest_truck_missing_registry = [
        row for row in latest_install_rows if row["truck"] and row["truck"] not in registry_any_trucks
    ]
    latest_truck_not_active_registry = [
        row for row in latest_install_rows if row["truck"] and row["truck"] not in registry_assigned_trucks
    ]
    latest_kit_mismatches: list[dict[str, Any]] = []
    for row in latest_install_rows:
        reg = registry_by_mother.get(row["mother"])
        if not reg:
            continue
        install_subs = [row["sub_b"], row["sub_c"], row["sub_d"]]
        registry_subs = [reg["sub_b"], reg["sub_c"], reg["sub_d"]]
        if install_subs != registry_subs:
            latest_kit_mismatches.append(
                {
                    "install_row": row["source_row"],
                    "registry_row": reg["source_row"],
                    "truck": row["truck"],
                    "mother": row["mother"],
                    "install_sub_b": row["sub_b"],
                    "install_sub_c": row["sub_c"],
                    "install_sub_d": row["sub_d"],
                    "registry_sub_b": reg["sub_b"],
                    "registry_sub_c": reg["sub_c"],
                    "registry_sub_d": reg["sub_d"],
                }
            )

    registry_status_counts = Counter(row["status"] or "(blank)" for row in registry)
    install_status_counts = Counter(row["overall_status"] or "(blank)" for row in installations)

    summary = {
        "workbook": str(workbook),
        "sheets": {
            "registration_masterlist_rows": len(master),
            "updated_registry_rows": len(registry),
            "installations_rows": len(installations),
        },
        "unique_counts": {
            "master_mothers": len(master_mothers),
            "registry_mothers": len(registry_mothers),
            "installation_mothers": len(install_mothers),
            "registry_trucks_any_status": len(registry_any_trucks),
            "registry_trucks_active": len(registry_assigned_trucks),
            "installation_trucks": len(install_trucks),
        },
        "registry_status_counts": dict(registry_status_counts),
        "installation_status_counts": dict(install_status_counts),
        "issues": {
            "installation_rows_with_mother_missing_from_updated_registry": len(installed_missing_registry_mother),
            "installation_rows_with_mother_missing_from_masterlist": len(installed_missing_master_mother),
            "installation_rows_with_truck_missing_from_registry": len(installed_truck_missing_registry),
            "installation_rows_with_truck_not_active_in_registry": len(installed_truck_not_active_registry),
            "installation_rows_where_subs_differ_from_registry_for_same_mother": len(installed_kit_mismatches),
            "duplicate_installation_mothers": len(duplicate_install_mother),
            "duplicate_installation_trucks": len(duplicate_install_truck),
        },
        "latest_install_per_truck_issues": {
            "latest_install_trucks": len(latest_install_rows),
            "latest_rows_with_mother_missing_from_updated_registry": len(latest_missing_registry_mother),
            "latest_rows_with_mother_missing_from_masterlist": len(latest_missing_master_mother),
            "latest_rows_with_truck_missing_from_registry": len(latest_truck_missing_registry),
            "latest_rows_with_truck_not_active_in_registry": len(latest_truck_not_active_registry),
            "latest_rows_where_subs_differ_from_registry_for_same_mother": len(latest_kit_mismatches),
        },
    }

    OUT_DIR.mkdir(parents=True, exist_ok=True)
    (OUT_DIR / "summary.json").write_text(json.dumps(summary, indent=2), encoding="utf-8")
    write_csv(OUT_DIR / "masterlist_normalized.csv", master)
    write_csv(OUT_DIR / "updated_registry_normalized.csv", registry)
    write_csv(OUT_DIR / "installations_normalized.csv", [{k: v for k, v in row.items() if k != "_sort_key"} for row in installations])
    write_csv(OUT_DIR / "install_mother_missing_updated_registry.csv", installed_missing_registry_mother)
    write_csv(OUT_DIR / "install_mother_missing_masterlist.csv", installed_missing_master_mother)
    write_csv(OUT_DIR / "install_truck_missing_registry.csv", installed_truck_missing_registry)
    write_csv(OUT_DIR / "install_truck_not_active_registry.csv", installed_truck_not_active_registry)
    write_csv(OUT_DIR / "install_kit_mismatches_vs_registry.csv", installed_kit_mismatches)
    write_csv(OUT_DIR / "duplicate_installation_mothers.csv", duplicate_install_mother)
    write_csv(OUT_DIR / "duplicate_installation_trucks.csv", duplicate_install_truck)
    write_csv(OUT_DIR / "latest_installations_by_truck.csv", latest_install_rows)
    write_csv(OUT_DIR / "latest_install_mother_missing_updated_registry.csv", latest_missing_registry_mother)
    write_csv(OUT_DIR / "latest_install_mother_missing_masterlist.csv", latest_missing_master_mother)
    write_csv(OUT_DIR / "latest_install_truck_missing_registry.csv", latest_truck_missing_registry)
    write_csv(OUT_DIR / "latest_install_truck_not_active_registry.csv", latest_truck_not_active_registry)
    write_csv(OUT_DIR / "latest_install_kit_mismatches_vs_registry.csv", latest_kit_mismatches)

    print(json.dumps(summary, indent=2))


if __name__ == "__main__":
    main()
