CREATE TABLE organisations (
  id TEXT PRIMARY KEY, name TEXT NOT NULL,
  created_at INTEGER NOT NULL DEFAULT (unixepoch())
);

CREATE TABLE users (
  id TEXT PRIMARY KEY,
  org_id TEXT NOT NULL REFERENCES organisations(id),
  username TEXT NOT NULL UNIQUE,
  display_name TEXT NOT NULL,
  password_hash TEXT NOT NULL,
  role TEXT NOT NULL CHECK (role IN ('installer','supervisor')),
  is_active INTEGER NOT NULL DEFAULT 1,
  last_login INTEGER,
  created_at INTEGER NOT NULL DEFAULT (unixepoch()),
  updated_at INTEGER NOT NULL DEFAULT (unixepoch())
);

-- trucks — records, not strings. Created on first reference.
CREATE TABLE trucks (
  id TEXT PRIMARY KEY,
  org_id TEXT NOT NULL REFERENCES organisations(id),
  plate TEXT NOT NULL UNIQUE,             -- normalized uppercase/trim
  is_active INTEGER NOT NULL DEFAULT 1,
  created_via TEXT NOT NULL CHECK (created_via IN ('import','install','movement','manual')),
  created_at INTEGER NOT NULL DEFAULT (unixepoch()),
  updated_at INTEGER NOT NULL DEFAULT (unixepoch())
);

-- devices — ONE table for mother + sub locks. One identity for life.
CREATE TABLE devices (
  id TEXT PRIMARY KEY,
  org_id TEXT NOT NULL REFERENCES organisations(id),
  device_type TEXT NOT NULL CHECK (device_type IN ('mother','sub')),
  serial TEXT NOT NULL UNIQUE,            -- mother: 12 digits; sub: 12 hex; normalized upper
  sim_number TEXT,                        -- mothers; attribute only (SIM-as-entity deferred)
  lifecycle_status TEXT NOT NULL CHECK (lifecycle_status IN
    ('available','in_service','repair','faulty','retired')),
  registered_at INTEGER,
  registered_by TEXT REFERENCES users(id),
  import_unverified INTEGER NOT NULL DEFAULT 0,  -- set for every migrated device
  notes TEXT,
  created_at INTEGER NOT NULL DEFAULT (unixepoch()),
  updated_at INTEGER NOT NULL DEFAULT (unixepoch())
);
CREATE INDEX idx_devices_serial ON devices(serial);
CREATE INDEX idx_devices_status ON devices(device_type, lifecycle_status);

-- registration_logs — write-once birth record of a kit (mother + subs, config). No truck.
CREATE TABLE registration_logs (
  id TEXT PRIMARY KEY,
  org_id TEXT NOT NULL REFERENCES organisations(id),
  mother_device_id TEXT NOT NULL REFERENCES devices(id),
  actor_user_id TEXT NOT NULL REFERENCES users(id),
  logged_date INTEGER NOT NULL,
  ip_configured  TEXT CHECK (ip_configured  IN ('yes','no')),
  apn_configured TEXT CHECK (apn_configured IN ('yes','no')),
  apn_auth_set   TEXT CHECK (apn_auth_set   IN ('yes','no')),
  bt_write_done  TEXT CHECK (bt_write_done  IN ('yes','no')),
  sim_number TEXT,
  source TEXT NOT NULL DEFAULT 'app' CHECK (source IN ('app','import')),
  notes TEXT,
  created_at INTEGER NOT NULL DEFAULT (unixepoch()),
  updated_at INTEGER NOT NULL DEFAULT (unixepoch())
);

-- kit_members — UNSLOTTED registration pairing: which subs belong to a mother.
-- Slots are NOT assigned here (assigned at install via slot_pairings).
CREATE TABLE kit_members (
  id TEXT PRIMARY KEY,
  org_id TEXT NOT NULL REFERENCES organisations(id),
  mother_device_id TEXT NOT NULL REFERENCES devices(id),
  sub_device_id TEXT NOT NULL REFERENCES devices(id),
  added_at INTEGER NOT NULL,
  removed_at INTEGER,                     -- open membership = removed_at IS NULL
  created_at INTEGER NOT NULL DEFAULT (unixepoch())
);
CREATE UNIQUE INDEX uq_open_kit_sub ON kit_members(sub_device_id) WHERE removed_at IS NULL;

-- truck_assignments — TIMELINE: mother lock on truck. Partial unique indexes guarantee
-- one live mother per truck and one live truck per mother.
CREATE TABLE truck_assignments (
  id TEXT PRIMARY KEY,
  org_id TEXT NOT NULL REFERENCES organisations(id),
  truck_id TEXT NOT NULL REFERENCES trucks(id),
  device_id TEXT NOT NULL REFERENCES devices(id),   -- mother only (service-enforced)
  assigned_at INTEGER NOT NULL,
  assigned_by TEXT NOT NULL REFERENCES users(id),
  removed_at INTEGER,
  removed_by TEXT REFERENCES users(id),
  removal_reason TEXT CHECK (removal_reason IN
    ('faulty','damaged','operational_swap','decommissioned','unlogged_swap_detected','other')),
  disposition TEXT CHECK (disposition IN ('repair_pool','available_pool','retired')),
  removal_notes TEXT,
  created_at INTEGER NOT NULL DEFAULT (unixepoch())
);
CREATE UNIQUE INDEX uq_open_assignment_truck  ON truck_assignments(truck_id)  WHERE removed_at IS NULL;
CREATE UNIQUE INDEX uq_open_assignment_device ON truck_assignments(device_id) WHERE removed_at IS NULL;

-- slot_pairings — TIMELINE: which sub occupies which slot under which mother, when.
-- Created at INSTALL (slots assigned positionally: C1→B, C2→C, C3→D).
CREATE TABLE slot_pairings (
  id TEXT PRIMARY KEY,
  org_id TEXT NOT NULL REFERENCES organisations(id),
  mother_device_id TEXT NOT NULL REFERENCES devices(id),
  slot TEXT NOT NULL CHECK (slot IN ('B','C','D')),
  sub_device_id TEXT NOT NULL REFERENCES devices(id),
  paired_at INTEGER NOT NULL,
  paired_by TEXT NOT NULL REFERENCES users(id),
  unpaired_at INTEGER,
  unpaired_by TEXT REFERENCES users(id),
  removal_reason TEXT CHECK (removal_reason IN
    ('faulty','damaged','operational_swap','decommissioned','unlogged_swap_detected','other')),
  disposition TEXT CHECK (disposition IN ('repair_pool','available_pool','retired')),
  removal_notes TEXT,
  created_at INTEGER NOT NULL DEFAULT (unixepoch())
);
CREATE UNIQUE INDEX uq_open_pairing_slot ON slot_pairings(mother_device_id, slot) WHERE unpaired_at IS NULL;
CREATE UNIQUE INDEX uq_open_pairing_sub  ON slot_pairings(sub_device_id)          WHERE unpaired_at IS NULL;

-- verifications — append-only. Trust state derived from latest row + decay.
CREATE TABLE verifications (
  id TEXT PRIMARY KEY,
  org_id TEXT NOT NULL REFERENCES organisations(id),
  truck_id TEXT REFERENCES trucks(id),
  mother_device_id TEXT NOT NULL REFERENCES devices(id),
  source TEXT NOT NULL CHECK (source IN ('qr_scan','photo_attestation','manual')),
  result TEXT NOT NULL CHECK (result IN ('match','mismatch_corrected')),
  observed_master TEXT NOT NULL,
  observed_subs_json TEXT NOT NULL,       -- unordered set actually scanned/typed
  expected_subs_json TEXT,                -- registry's set, when mismatched
  weakest_tier TEXT NOT NULL CHECK (weakest_tier IN ('qr_scan','photo_attestation','manual')),
  verified_by TEXT NOT NULL REFERENCES users(id),
  verified_at INTEGER NOT NULL,
  notes TEXT,
  created_at INTEGER NOT NULL DEFAULT (unixepoch())
);
CREATE INDEX idx_verifications_truck ON verifications(truck_id, verified_at);

-- installation_logs — device-to-truck mounting checklist. Config section RE-CHECKS registration.
CREATE TABLE installation_logs (
  id TEXT PRIMARY KEY,
  org_id TEXT NOT NULL REFERENCES organisations(id),
  truck_id TEXT NOT NULL REFERENCES trucks(id),
  mother_device_id TEXT NOT NULL REFERENCES devices(id),
  assignment_id TEXT NOT NULL REFERENCES truck_assignments(id),
  actor_user_id TEXT NOT NULL REFERENCES users(id),
  logged_date INTEGER NOT NULL,
  battery_level TEXT CHECK (battery_level IN ('full','adequate','low','dead')),
  physical_damage TEXT CHECK (physical_damage IN ('none','minor','significant')),
  device_responsive TEXT CHECK (device_responsive IN ('yes','no')),
  sublocks_responsive TEXT CHECK (sublocks_responsive IN ('yes','no')),
  config_confirmed TEXT CHECK (config_confirmed IN ('yes','no','changed')),
  config_notes TEXT,
  bt_unlock_done TEXT CHECK (bt_unlock_done IN ('yes','no')),
  online_after TEXT CHECK (online_after IN ('yes','no','intermittent')),
  mother_locked TEXT CHECK (mother_locked IN ('yes','no')),
  mother_secured TEXT CHECK (mother_secured IN ('yes','no')),
  sublocks_locked TEXT CHECK (sublocks_locked IN ('all','partial','none')),
  sublocks_secured TEXT CHECK (sublocks_secured IN ('yes','no')),
  overall_status TEXT CHECK (overall_status IN ('successful','completed_with_issues','failed')),
  issues_notes TEXT,
  created_at INTEGER NOT NULL DEFAULT (unixepoch()),
  updated_at INTEGER NOT NULL DEFAULT (unixepoch())
);

-- fault_reports — no "recurring?" column; recurrence is a QUERY surfaced inline.
CREATE TABLE fault_reports (
  id TEXT PRIMARY KEY,
  org_id TEXT NOT NULL REFERENCES organisations(id),
  truck_id TEXT NOT NULL REFERENCES trucks(id),
  device_id TEXT NOT NULL REFERENCES devices(id),   -- mother OR sub
  actor_user_id TEXT NOT NULL REFERENCES users(id),
  logged_date INTEGER NOT NULL,
  reported_by TEXT CHECK (reported_by IN
    ('station_manager','customer_rep','driver','team_member','self_identified')),
  fault_type TEXT CHECK (fault_type IN
    ('device_offline','dynamic_password_failed','sub_lock_not_opening','charging_failure',
     'configuration_error','hardware_damage','seal_discrepancy','other')),
  locks_affected TEXT NOT NULL,           -- JSON array
  truck_location TEXT CHECK (truck_location IN ('in_transit','customer_location','installation_point')),
  device_online TEXT CHECK (device_online IN ('yes','no','intermittent')),
  description TEXT NOT NULL,
  remote_open TEXT CHECK (remote_open IN ('success','failed','not_applicable')),
  static_pw_used TEXT CHECK (static_pw_used IN ('yes','no')),
  static_pw_auth_by TEXT REFERENCES users(id),   -- AUTHORITY: supervisor picker; NULL if N/A
  resolution TEXT CHECK (resolution IN
    ('resolved_remotely','static_password_issued','device_reconfigured','device_replaced','pending','escalated')),
  minutes_to_resolve INTEGER,
  followup_required TEXT CHECK (followup_required IN ('yes','no')),
  followup_details TEXT,
  incident_status TEXT CHECK (incident_status IN ('closed','open_pending_followup')),
  closure_by TEXT REFERENCES users(id),   -- AUTHORITY: NULL while open
  linked_movement_id TEXT REFERENCES movement_logs(id),
  notes TEXT,
  created_at INTEGER NOT NULL DEFAULT (unixepoch()),
  updated_at INTEGER NOT NULL DEFAULT (unixepoch())
);
CREATE INDEX idx_fault_device ON fault_reports(device_id, logged_date);

-- movement_logs — event log of every assignment/pairing mutation (the mutation itself lives
-- in truck_assignments / slot_pairings / kit_members). No "registry updated?" column.
CREATE TABLE movement_logs (
  id TEXT PRIMARY KEY,
  org_id TEXT NOT NULL REFERENCES organisations(id),
  actor_user_id TEXT NOT NULL REFERENCES users(id),
  logged_date INTEGER NOT NULL,
  action TEXT NOT NULL CHECK (action IN
    ('new_assignment','mother_replacement','sub_replacement','truck_swap',
     'removed_to_inventory','decommissioned','unlogged_swap_detected','triage')),
  truck_id TEXT REFERENCES trucks(id),
  out_device_id TEXT REFERENCES devices(id),
  out_reason TEXT CHECK (out_reason IN ('faulty','damaged','operational_swap','decommissioned','other')),
  out_disposition TEXT CHECK (out_disposition IN ('repair_pool','available_pool','retired')),
  in_device_id TEXT REFERENCES devices(id),
  slot TEXT CHECK (slot IN ('B','C','D')),
  source_truck_id TEXT REFERENCES trucks(id),   -- truck_swap: where the incoming device came from
  reason_notes TEXT,
  notes TEXT,
  created_at INTEGER NOT NULL DEFAULT (unixepoch()),
  updated_at INTEGER NOT NULL DEFAULT (unixepoch())
);

CREATE TABLE conflict_reviews (
  id TEXT PRIMARY KEY,
  org_id TEXT NOT NULL REFERENCES organisations(id),
  kind TEXT NOT NULL CHECK (kind IN ('sync_conflict','unlogged_swap','import_conflict')),
  payload_json TEXT NOT NULL,             -- both versions / expected-vs-observed, NO asserted cause
  status TEXT NOT NULL DEFAULT 'open' CHECK (status IN ('open','resolved','dismissed')),
  resolved_by TEXT REFERENCES users(id),
  resolved_at INTEGER,
  resolution_notes TEXT,
  created_at INTEGER NOT NULL DEFAULT (unixepoch())
);

-- audit_log — APPEND-ONLY. Written inside every mutation's transaction. No UPDATE/DELETE ever.
CREATE TABLE audit_log (
  id TEXT PRIMARY KEY,
  org_id TEXT NOT NULL REFERENCES organisations(id),
  actor_user_id TEXT NOT NULL REFERENCES users(id),
  entity_table TEXT NOT NULL,
  entity_id TEXT NOT NULL,
  operation TEXT NOT NULL CHECK (operation IN ('create','correct','transition','import')),
  before_json TEXT,
  after_json TEXT NOT NULL,
  client_ts INTEGER,
  created_at INTEGER NOT NULL DEFAULT (unixepoch())
);
CREATE INDEX idx_audit_entity ON audit_log(entity_table, entity_id);

-- sync_mutations — server-side idempotency ledger for offline sync
CREATE TABLE sync_mutations (
  client_mutation_id TEXT PRIMARY KEY,
  org_id TEXT NOT NULL REFERENCES organisations(id),
  user_id TEXT NOT NULL REFERENCES users(id),
  kind TEXT NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('applied','conflicted','rejected')),
  client_ts INTEGER NOT NULL,
  applied_at INTEGER NOT NULL DEFAULT (unixepoch())
);
