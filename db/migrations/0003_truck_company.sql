-- §2/§5 Truck-serving-company: a fourth, parallel timeline. Independent of truck_assignments/
-- slot_pairings — never touches device-assignment tables.

ALTER TABLE users ADD COLUMN company TEXT CHECK (company IN ('mrs','dangote'));

-- truck_company_assignments — TIMELINE, parallel to truck_assignments, independent of it.
CREATE TABLE truck_company_assignments (
  id TEXT PRIMARY KEY,
  org_id TEXT NOT NULL REFERENCES organisations(id),
  truck_id TEXT NOT NULL REFERENCES trucks(id),
  company TEXT NOT NULL CHECK (company IN ('mrs','dangote')),
  assigned_at INTEGER NOT NULL,
  assigned_by TEXT NOT NULL REFERENCES users(id),
  removed_at INTEGER,
  removed_by TEXT REFERENCES users(id),
  created_at INTEGER NOT NULL DEFAULT (unixepoch())
);
CREATE UNIQUE INDEX uq_open_truck_company ON truck_company_assignments(truck_id) WHERE removed_at IS NULL;

-- movement_logs.action's CHECK constraint needs 'company_reassignment' added. SQLite has no
-- ALTER TABLE ... ALTER CHECK, so rebuild the table.
--
-- IMPORTANT: do NOT use "ALTER TABLE movement_logs RENAME TO ..." to do this rebuild. Empirically
-- (SQLite 3.49, verified directly against this DB rather than assumed from docs), RENAME TABLE
-- unconditionally rewrites fault_reports.linked_movement_id's FK text to the new name —
-- regardless of legacy_alter_table or foreign_keys pragma state — which permanently breaks the
-- FK once the old name is dropped. Instead: build the new shape under a temporary name, drop the
-- ORIGINAL table (never renamed, so fault_reports' FK text still says "movement_logs" verbatim),
-- then recreate it under the original name.
--
-- Dropping a table that's still an active FK parent requires either foreign_keys=OFF or
-- defer_foreign_keys=ON. The plain foreign_keys pragma is a documented no-op when toggled
-- inside an active transaction (verified directly: migrate.ts always runs each migration file
-- inside sqlite.transaction(), so foreign_keys=OFF here would silently do nothing and the DROP
-- below would still fail). defer_foreign_keys IS honored mid-transaction — it defers the FK
-- check to commit time, by which point movement_logs exists again under its original name and
-- every reference is satisfied. It resets to OFF automatically at the end of this transaction.
PRAGMA defer_foreign_keys = ON;

CREATE TABLE movement_logs_new (
  id TEXT PRIMARY KEY,
  org_id TEXT NOT NULL REFERENCES organisations(id),
  actor_user_id TEXT NOT NULL REFERENCES users(id),
  logged_date INTEGER NOT NULL,
  action TEXT NOT NULL CHECK (action IN
    ('new_assignment','mother_replacement','sub_replacement','truck_swap',
     'removed_to_inventory','decommissioned','unlogged_swap_detected','triage','company_reassignment')),
  truck_id TEXT REFERENCES trucks(id),
  out_device_id TEXT REFERENCES devices(id),
  out_reason TEXT CHECK (out_reason IN ('faulty','damaged','operational_swap','decommissioned','other')),
  out_disposition TEXT CHECK (out_disposition IN ('repair_pool','available_pool','retired')),
  in_device_id TEXT REFERENCES devices(id),
  slot TEXT CHECK (slot IN ('B','C','D')),
  source_truck_id TEXT REFERENCES trucks(id),
  reason_notes TEXT,
  notes TEXT,
  created_at INTEGER NOT NULL DEFAULT (unixepoch()),
  updated_at INTEGER NOT NULL DEFAULT (unixepoch())
);

INSERT INTO movement_logs_new SELECT * FROM movement_logs;

DROP TABLE movement_logs;

CREATE TABLE movement_logs (
  id TEXT PRIMARY KEY,
  org_id TEXT NOT NULL REFERENCES organisations(id),
  actor_user_id TEXT NOT NULL REFERENCES users(id),
  logged_date INTEGER NOT NULL,
  action TEXT NOT NULL CHECK (action IN
    ('new_assignment','mother_replacement','sub_replacement','truck_swap',
     'removed_to_inventory','decommissioned','unlogged_swap_detected','triage','company_reassignment')),
  truck_id TEXT REFERENCES trucks(id),
  out_device_id TEXT REFERENCES devices(id),
  out_reason TEXT CHECK (out_reason IN ('faulty','damaged','operational_swap','decommissioned','other')),
  out_disposition TEXT CHECK (out_disposition IN ('repair_pool','available_pool','retired')),
  in_device_id TEXT REFERENCES devices(id),
  slot TEXT CHECK (slot IN ('B','C','D')),
  source_truck_id TEXT REFERENCES trucks(id),
  reason_notes TEXT,
  notes TEXT,
  created_at INTEGER NOT NULL DEFAULT (unixepoch()),
  updated_at INTEGER NOT NULL DEFAULT (unixepoch())
);

INSERT INTO movement_logs SELECT * FROM movement_logs_new;

DROP TABLE movement_logs_new;
