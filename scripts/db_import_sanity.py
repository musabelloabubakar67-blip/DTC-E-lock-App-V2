import json
import sqlite3


conn = sqlite3.connect("data/dtc-elock.sqlite")
conn.row_factory = sqlite3.Row

out = {
    "devices_by_status": [
        dict(row)
        for row in conn.execute(
            """
            select device_type, lifecycle_status, count(*) as count
            from devices
            group by device_type, lifecycle_status
            order by device_type, lifecycle_status
            """
        )
    ],
    "open_assignments": conn.execute("select count(*) from truck_assignments where removed_at is null").fetchone()[0],
    "open_pairings": conn.execute("select count(*) from slot_pairings where unpaired_at is null").fetchone()[0],
    "open_conflict_reviews": conn.execute("select count(*) from conflict_reviews where status = 'open'").fetchone()[0],
    "registration_logs": conn.execute("select count(*) from registration_logs").fetchone()[0],
    "installation_logs": conn.execute("select count(*) from installation_logs").fetchone()[0],
}

print(json.dumps(out, indent=2))
