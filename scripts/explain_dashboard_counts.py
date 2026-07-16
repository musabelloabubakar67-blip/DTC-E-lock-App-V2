import json
import sqlite3


conn = sqlite3.connect("data/dtc-elock.sqlite")
conn.row_factory = sqlite3.Row

out = {
    "active_trucks": conn.execute("select count(*) from trucks where is_active = 1").fetchone()[0],
    "mothers_by_status": [
        dict(row)
        for row in conn.execute(
            """
            select lifecycle_status, count(*) as count
            from devices
            where device_type = 'mother'
            group by lifecycle_status
            order by lifecycle_status
            """
        )
    ],
    "subs_by_status": [
        dict(row)
        for row in conn.execute(
            """
            select lifecycle_status, count(*) as count
            from devices
            where device_type = 'sub'
            group by lifecycle_status
            order by lifecycle_status
            """
        )
    ],
    "open_reviews_by_reason": [
        dict(row)
        for row in conn.execute(
            """
            select coalesce(json_extract(payload_json, '$.reason'), '(unknown)') as reason, count(*) as count
            from conflict_reviews
            where status = 'open'
            group by reason
            order by count desc, reason
            """
        )
    ],
    "open_reviews_by_kind": [
        dict(row)
        for row in conn.execute(
            """
            select kind, status, count(*) as count
            from conflict_reviews
            group by kind, status
            order by kind, status
            """
        )
    ],
}

mother_counts = {row["lifecycle_status"]: row["count"] for row in out["mothers_by_status"]}
out["fleet_state_total_assets_formula"] = {
    "active_trucks": out["active_trucks"],
    "in_service_mothers": mother_counts.get("in_service", 0),
    "available_mothers": mother_counts.get("available", 0),
    "total_assets_shown": out["active_trucks"] + mother_counts.get("in_service", 0) + mother_counts.get("available", 0),
}

print(json.dumps(out, indent=2))
