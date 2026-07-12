# DTC E-Lock Management System — Architecture

> **Claude Code: read this file in full before every session.** It is the ground truth
> for this project. If a task appears to conflict with this document, stop and flag it —
> do not improvise around it. Every decision here was settled deliberately with the owner
> and validated against the real legacy data. Do not re-litigate during implementation.

---

## 1. What this system is

A field-operations and chain-of-custody system for GPS e-locks on fuel tanker trucks in
Nigeria. Each truck carries one **mother lock** (on the discharge box) and **sub-locks** in
compartment slots B, C, D. Field technicians register, install, move, and replace devices;
supervisors (Musa, Uthman) authorize overrides, triage repair hardware, and correct records.

It replaces a single-file HTML app writing to Google Sheets via Apps Script, which failed
in four documented ways this architecture must prevent:

1. **Silent data loss** — success UI rendered before/regardless of write success.
2. **Registry drift** — devices moved physically without registry updates; discovered only
   when a PIN issued for the wrong device failed at a customer station. Confirmed severe by
   the data: the "official" Registry holds 540 devices; the true fleet is **~1,106** — the
   Registry covers under half.
3. **Honor-system fields** — "Registry Updated? Yes/No", "Recurring fault? Yes/No", name
   pickers. Humans asked to attest what software should know.
4. **No history / no corrections** — append-only sheets, no per-truck/per-device timeline.

**Consequence of getting this wrong:** a PIN issued against a stale registry entry fails at
a discharge point with a loaded tanker waiting. This is a security/audit tool; the log is
the asset.

---

## 2. Core domain model — three-layer temporal identity

The single most important design decision. Everything follows from it.

```
TRUCK (permanent identity — the discharge-box position on the vehicle)
  └── occupied by a MOTHER LOCK for a span of time      (truck_assignments)
        └── each SLOT (B, C, D) occupied by a SUB-LOCK
            for a span of time                           (slot_pairings)
```

- **Trucks are the durable anchor** — NOT mother locks, because mother locks get replaced
  when faulty. The discharge-box position on the vehicle persists; devices pass through it.
- **Every device (mother or sub) has ONE identity for life** — one `devices` row through
  every removal, repair, revival, and re-pairing. History follows the device, not the slot.
  A returned sub-lock can be re-paired into **any** device/slot (validated: subs demonstrably
  move across masters in the legacy data).
- **All relationships are timelines, not columns.** "Which subs are on this mother now" is a
  query over open pairing rows, never a fixed field. Same pattern at both levels: a durable
  position, a device filling it for a span, a reason + disposition when it leaves.

### Registration vs installation — distinct events

- **Registration** = device-to-device. A mother lock is paired with sub-locks and configured
  (IP/APN/BT), sim recorded. **No truck involved.** Confirmed by the data: registration sheets
  have no truck column. Registration produces an **unslotted kit** — the subs belong to the
  mother, but slot letters (B/C/D) are NOT assigned yet.
- **Installation** = device-to-truck. The kit is mounted on a truck and **slots are assigned
  positionally** (C1→B, C2→C, C3→D, per the install log's fixed columns).
- Registration is **write-once per device**. The current registry is a **derived projection**
  over the registration event + all subsequent movement events — never a separately-maintained
  mutable kit list. There is no sync between them and no back-reference to keep in step.

### Device lifecycle (one state machine, both device types)

```
   registration ──► available ◄─────────────── triage: revived (supervisor)
                       │  ▲                            │
        paired/install │  │ operational_swap           │
                       ▼  │ (healthy)                   │
                    in_service ──── faulty/damaged ──► repair ──► triage: dead ──► faulty
                       │                                             (terminal)
              decommissioned ─────────────────────────────────────► retired (terminal)
```

**Fixed rules (enforced in `lifecycle.service.ts` only — no caller sets status directly):**
- Removal always records **two independent axes**:
  - `removal_reason` — WHY it left: `faulty | damaged | operational_swap | decommissioned | unlogged_swap_detected | other`
  - `disposition` — WHERE it went: `repair_pool | available_pool | retired`
- Reason → disposition mapping is enforced, not free:
  - `faulty | damaged` → **must** go to `repair_pool` (mandatory intake for anything suspect;
    matches legacy reality — "Under Repair" existed as a status distinct from "Faulty").
  - `operational_swap` (healthy device swapped for operational reasons, e.g. field config
    unavailable) → `available_pool`. **Never counts against fault history.**
  - `decommissioned` → `retired`.
- **Triage** = supervisor-only: `repair → available` (revived) or `repair → faulty` (dead).
- **Revival is movement, not re-registration** — for BOTH mother and sub locks. A revived
  device re-enters service under its same identity and may pair into a different configuration
  than it left. No re-registration event is created. (Owner does not report on re-kittings; the
  discrete re-kitting event view is deliberately not built.)
- `faulty` and `retired` are terminal.

### Truck-serving-company — confirmed as a byproduct of every install, not declared once

DTC owns every truck outright; MRS and Dangote are the customers a truck currently serves,
not owners. "Which company" is closed to exactly these two (DTC is jointly owned by both
companies' principals — no third customer is realistic, so this is a plain enum).

This is a **timeline parallel to, and independent of, the device-assignment stack** — it
does not touch `truck_assignments` or `slot_pairings`. A truck's serving company and its
mounted hardware are orthogonal facts tracked the same way (open/closed spans) but the
company span is written from a different trigger.

- **Confirmed at EVERY installation, not just the first — the same byproduct-of-work
  pattern as kit verification (§3).** The back office does not reliably know which company
  a truck currently serves; the tech standing at the truck does. Rather than declare once
  and rely on a rare, separate correction action to keep it current, every install shows
  the truck's current company (if any) and the tech confirms or changes it as part of the
  normal install flow.
  - If it matches what's on record: nothing new is written — a no-op read-confirm.
  - If it's absent or different: the open `truck_company_assignments` span (if any) closes
    and a new one opens, in the SAME atomic transaction as the rest of the installation.
    **The install IS the interchange event.** There is no separate "reassignment happened"
    step to remember — it falls out of the tech doing their normal job.
- **Inherits offline support for free**, because installation already rides the queue-first
  mutation path (§4) — unlike registration, which is online-only. Company travels with the
  install mutation; no separate design or sync path needed for it.
- **The standalone supervisor-only change action still exists, but demoted to a rare,
  secondary correction path** — for the back office to fix a data-entry error, or to
  declare a change administratively ahead of the next install actually happening. It is
  NOT the primary mechanism. Most company changes happen silently through install and
  never touch this path at all.
- **No verification/trust-decay machinery applies.** Company is a declared administrative
  fact, not a physically-observed one — no kit-scan, no decay.
- **Expected transitional state:** a truck with no install yet (pre-feature imports) shows
  "not yet declared" on lookup — a normal, expected state, not an error.

---

## 3. Registry trust model — verification as a byproduct of work

The migrated data is known-incomplete and known-drifted. No import can make wrong data right;
the system refuses to trust any migrated assignment until confirmed against physical reality.

- **Every migrated device imports `unverified`** (all ~1,106). Trust is earned post-launch.
- **Verification is a byproduct, never a campaign.** Any time a tech interacts with a truck
  (install, fault, movement, depot lookup) the app prompts a **kit scan**: mother lock + the
  three sub-locks. Sub QRs ARE reachable in the field (owner-confirmed), so kit-scan is the
  field standard, not mother-only.
- **Kit match logic is set-membership, not slot-ordered.** Scanned sub serials, as an
  unordered set, compared to the registry's sub set for that mother. Equal → match. The owner
  explicitly does not need slot-position verification — only "do these subs match".
- **Partial kit scan is allowed.** If a sub QR won't scan, the tech types the serial off the
  legible physical label (owner-confirmed labels are legible). That entry is tagged `manual`
  (lower confidence). Kit trust = the **weakest tier present**: a kit with one typed sub is
  `manual`-tier, not full-scan-tier. Rationale: the legacy drift came from unverified manual
  records; the tiering exists to not reintroduce that.
- **Verification confidence tiers**, source-tagged per device in the kit:
  - `qr_scan` — machine-read. High. Decays to `stale` after `VERIFY_DECAY_SCAN_DAYS` (90).
  - `photo_attestation` — remote: customer photographs the serial, supervisor reads the sub
    pairing off the lock vendor's native app (which reads hardware directly — an independent
    source of truth) and enters it. Medium. Decays after `VERIFY_DECAY_PHOTO_DAYS` (30).
  - `manual` — typed off a physical label on-site. Medium. Decays same as photo (30).
- **Trust state is DERIVED** (`verified | stale | unverified`) from the latest verification
  event + decay constants. Never a settable field.
- **Mismatch is a first-class event.** Scan ≠ registry → append verification
  (`result='mismatch_corrected'`), close the wrong assignment/pairing
  (`reason='unlogged_swap_detected'` — never counted as a device fault), open the correct one
  (registering an unknown device inline), write a `movement_log`, open a `conflict_review`.
  Reality wins; the discrepancy is preserved.
- **PIN issuance is OUTSIDE this app** (it happens in the lock vendor's native app), so this
  system cannot gate it. Its defense is the **lookup screen**: an `unverified`/`stale` record
  renders a prominent "NOT CONFIRMED — verify before use" banner instead of presenting the
  serial as authoritative. A warning at point-of-use, not a lock. When a supervisor completes
  a remote photo-attestation, that IS the registry reconciliation — captured automatically,
  never a separate "now update the registry" step.

---

## 4. Technical decisions

### Stack

| Concern | Choice | Why |
|---|---|---|
| Framework | Next.js 14 App Router (one deployable) | UI + API in one repo; Claude Code navigates it reliably |
| Database | SQLite via better-sqlite3 + Drizzle | Full ACID transactions — movement swaps NEED atomicity Sheets never had; single file; trivial backup; Postgres upgrade path. ~1,106 devices is trivially within SQLite's ceiling |
| Auth | NextAuth credentials, bcrypt | Individual logins; roles `installer` / `supervisor`. 30-day session (field tool, personal devices; re-login friction is a field hazard). Server-verified — nothing like the old client-side string check |
| Offline store | IndexedDB via Dexie | Mutation queue + registry read cache |
| PWA → APK | Service worker + manifest, later wrapped TWA (Bubblewrap) | One codebase; installable now, real APK later |
| QR | jsQR + torch via `applyConstraints({advanced:[{torch:true}]})` | Torch button renders ONLY if `getCapabilities().torch` (feature-detect; iOS Safari often lacks it). Manual serial entry sits beside every scan button, always visible |
| Hosting | Single VPS, PM2 + Nginx + Let's Encrypt | NOT Vercel — serverless has no persistent FS for SQLite |
| Backup | Daily cron: SQLite → Cloudflare R2, 30-day retention | Non-negotiable; runs before any real data enters |
| Google Sheets | Retired at cutover; optional read-only mirror later | Never a database, never in a transaction path |

**Deliberate override — offline is V1, not V2.** Connectivity is location-dependent, the #1
historical bug is silent write loss, and offline-first is the *structural fix*: a record
written locally before any network call cannot be lost to a bad connection. Trade-off: sync
complexity in V1. Scope is contained — mutation queue + registry snapshot, not peer-sync.

### Offline & sync

1. **Every write is local-first.** Client generates the record ID (cuid2), writes the full
   mutation to the Dexie queue, UI confirms "saved on device, pending sync" — honestly.
2. **Sync engine** pushes queued mutations in order to `POST /api/sync` (batched) on
   reconnect + periodic retry + on-focus. Idempotent by client mutation ID.
3. **Server-authoritative conflict handling.** Mutations apply in client-timestamp order. A
   registry mutation that contradicts current server state does NOT silently apply — it lands
   in `conflict_reviews`, both versions preserved. No last-write-wins on chain-of-custody data.
4. **Reads offline** against a Dexie-cached registry snapshot, stamped `lastSyncedAt`.
5. **Permanent sync indicator** in the shell: `N pending · last synced X min ago`. The single
   most important UI element. Never a toast.

### Corrections — overwrite UX, history underneath

- Log tables are editable **by supervisors only**. Editing feels like overwrite.
- Every mutation writes an `audit_log` row **inside the same transaction**, with
  `before_json`/`after_json`, actor, timestamp. `audit_log` is append-only — no UPDATE, no
  DELETE, ever. This is what makes "overwrite" safe.
- Installers are create-only. Enforced in the **service layer** (per-op role check), not just
  routes or UI.

### Fields the login model deletes

- All "Team Member / Logged By" pickers → `actor_user_id` from session.
- "Registry Updated? Yes/No" → gone; the registry updates as a consequence of the action.
- "Recurring fault? Yes/No" → gone (legacy data proves it was noise: all No/Unknown). The
  fault form **shows** the device's actual fault history inline before anything is filled in.
- **Authority fields survive** but change shape: "Static Password Authorized By" and "Closure
  Confirmed By" record who *granted permission* (often not the form-filler) → explicit pickers
  populated from `users WHERE role='supervisor'`, never a hardcoded name list.

### Truck identity — no plate inference, ever

Near-identical plates are **not** assumed to be the same truck. In a fleet of `FZE###DI/DR`
plates, near-collisions are real trucks, not typos. The system therefore:
- **Never auto-merges or reclassifies** plates by string similarity — at import or at runtime.
- On import, a Registry-vs-install truck disagreement is a plain `import_conflict` review item
  showing both plates and both source dates, **with no asserted cause** — the supervisor
  decides whether it is one mistyped truck or two real trucks and a genuine swap.
- **No plate-similarity check exists anywhere** — not at import, not at runtime, not as a
  "did you mean" prompt. A new plate is created exactly as typed. Two similar plates are two
  real trucks. If a genuine typo occurs, it is corrected the same way any other record is: a
  supervisor edit, audit-logged. The system never guesses that two plates are one truck.

---

## 5. Database schema

Rules: TEXT cuid2 ids; INTEGER unix-epoch timestamps; no hard deletes (terminal statuses /
`is_active`); CHECK constraints on every status enum; `org_id` on every table (multi-tenant
seed, no tenant UI). **Ignored legacy columns are never stored:** Device Unique ID, Master
Seal Card, Master Unseal Card, Notes, decorative "Recorded" status.

```sql
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
  company TEXT CHECK (company IN ('mrs','dangote')),   -- nullable, dormant: no access
                                                          -- logic reads this today; reserved
                                                          -- for future per-company user scoping
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
-- Registration transaction also upserts the mother + sub devices and records the UNSLOTTED
-- kit membership (kit_members). Devices are born lifecycle_status='available'.

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

-- truck_company_assignments — TIMELINE, parallel to truck_assignments, independent of it.
-- Which customer (MRS/Dangote) a DTC-owned truck currently serves. Partial unique index
-- guarantees one open company span per truck, same pattern as every other timeline here.
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
```

---

## 6. Business rules (implement exactly; invent nothing)

### Registration creates unassigned, unslotted kits
Trigger: registration submit. Logic: one transaction — upsert mother + sub devices, open
`kit_members` (UNSLOTTED — no B/C/D yet), set all `lifecycle_status='available'`, write
`registration_logs` + audit. No truck. Registration is write-once per device.
Enforced in: `registration.service.ts`. Error: `BusinessError('Serial already registered')`.

### Installation slots the kit and assigns the truck, atomically
Trigger: installation submit. Logic: mother must exist `available`. An unregistered device is
NEVER handled by inline registration at install time — registration and installation are
distinct events (§2) and inline registration would fabricate a kit with no sub-pairing, no
config, no sim, none of which installation collects. The correct path for an unregistered
handheld device is register-then-install (two steps); for a device discovered already mounted
on a truck with no registration record, it is the verification mismatch flow (§3), which
registers the unknown device inline as part of correcting the record, not as part of install.
One transaction: open `truck_assignment`, open `slot_pairings` (C1→B, C2→C, C3→D), set device
`in_service`, write `installation_logs` + audit. Config section RE-CHECKS registration values
(display + confirm/flag `changed`) — never re-asked as new.
Enforced in: `installation.service.ts`.

### Company confirmation at installation (every install, not once)
Trigger: EVERY installation submit, not just the first on a truck. Logic: as part of the
same `installKit` transaction, read the truck's current open `truck_company_assignments`
row (if any) and compare it to the company the tech confirms/selects on the install form.
- **Company field is ALWAYS shown and ALWAYS required on the install form** — pre-filled
  with the current value if one exists, blank if not. The tech confirms it (leaves it) or
  changes it.
- **No change (confirms existing value, or none existed and none is meaningfully "new"
  vs. blank):** no write to `truck_company_assignments`.
- **Change (differs from current, or none existed and a value is now given):** within the
  SAME transaction as the rest of the install — close the old open span (`removed_at`,
  `removed_by` = actor), open a new one (`assigned_at` = now, `assigned_by` = actor). This
  is the install transaction extended, not a second transaction.
- The server does not trust a client-only "no change" signal for anything beyond UI
  convenience — it always compares the submitted value against the current server-side
  open span before deciding whether to write. A stale client read must not silently
  overwrite a company that changed via another path since the form loaded.
Enforced in: `installation.service.ts` (extends `installKit`).

### Truck company reassignment (rare, secondary correction path — supervisor only)
Trigger: an explicit out-of-band correction, separate from installation. Used only when the
back office needs to fix a record ahead of or outside the normal install-driven flow — this
is NOT how company changes normally happen; most happen silently through install above.
Logic: supervisor-only. One transaction: close the open `truck_company_assignments` row,
open a new one, write `movement_log(action='company_reassignment')` + audit.
Enforced in: `movement.service.ts` (`requireSupervisor()`).

### Incoming-device conflict check (the swap rule)
Trigger: any assign/pair (install, movement, sub-replace). Logic: look up incoming serial
FIRST. Unassigned+available → proceed. Already on THIS truck/slot → reject. `in_service` on
ANOTHER truck → block, force resolution: (a) `truck_swap` moves both sides in one transaction
recording `source_truck_id`, or (b) source truck left device-less with an explicit reason +
flagged needing a device. Whole resolution = ONE transaction. `repair|faulty|retired` → reject.
(Partial unique indexes also physically prevent two open assignments for one device.)
Enforced in: `movement.service.ts` (shared helper, used by installation too).

### Reason → disposition (protects fault history)
Trigger: any removal/unpairing. Logic: `faulty|damaged` → MUST `repair_pool`, status `repair`.
`operational_swap` → `available_pool`, status `available`, **excluded from all fault/recurrence
queries**. `decommissioned` → `retired`.
Enforced in: `lifecycle.service.ts` (the ONLY place status changes). Error on illegal mapping.

### Sub-lock replacement = ONE action, both sides
Trigger: "Replace sub-lock". Logic: one transaction — close old `slot_pairing` (reason +
disposition), open new, write `movement_log`; IF reason `faulty|damaged`, also create the
`fault_report` and link via `linked_movement_id`. Non-fault reasons write NO fault report.
Enforced in: `movement.service.ts`.

### Triage — supervisor only
Trigger: triage on a `repair` device. Logic: `repair→available` (revived) or `repair→faulty`
(terminal). Writes `movement_log(action='triage')` + audit. Role checked in service.
Error: `AuthzError('Triage requires supervisor role')`.

### Kit verification + mismatch
Trigger: kit scan during any truck interaction, or supervisor photo-attestation. Logic: compare
scanned sub SET to registry sub SET for the mother. Match → append verification (weakest_tier =
weakest of the devices in the kit; a typed sub makes the kit `manual`). Mismatch → one
transaction: append verification (`mismatch_corrected`), close wrong assignment/pairings
(`unlogged_swap_detected`, never a fault), open correct ones (register unknown inline), write
`movement_log`, open `conflict_review`. Reality wins.
Enforced in: `verification.service.ts`.

### Trust state derived + displayed loudly
Logic: latest verification per truck/mother → `verified` if within its source's decay window
(`qr_scan` 90d, `photo_attestation`/`manual` 30d), else `stale`; none → `unverified`. Lookup +
PIN-relevant screens render non-verified as a prominent warning banner.
Enforced in: `verification.service.ts` (`getTrustState()`), consumed by UI.

### Corrections — supervisor only, audit-backed
Trigger: edit of any existing log. Logic: supervisors only; UPDATE + append `audit_log`
(`operation='correct'`, before/after) in one transaction. Installers: create-only.
Enforced in: shared `requireSupervisor()` in every service's `correct*`.

### Sync conflict
Trigger: applying a queued mutation whose preconditions no longer hold. Logic: do NOT apply;
store in `conflict_reviews` (`sync_conflict`) with payload + current state; tell client "1 item
needs review". Never silently drop, never last-write-wins.
Enforced in: `sync.service.ts`.

### Actor & authority
Logic: `actor_user_id` always from session, never client-supplied (routes strip it). Authority
fields = explicit `role='supervisor'` selections.

---

## 7. File structure

```
project/
├── ARCHITECTURE.md
├── config/client.config.ts        ← org name, accent, decay constants, toggles
├── app/
│   ├── (auth)/login/page.tsx
│   ├── (app)/
│   │   ├── layout.tsx             ← auth guard + nav + PERMANENT sync indicator
│   │   ├── page.tsx
│   │   ├── register/page.tsx      ← mobile scan-driven, online-only, one-kit-at-a-time (§9)
│   │   ├── install/page.tsx       ← registry lookup + inline new-device + config re-check
│   │   ├── fault/page.tsx         ← inline device fault history
│   │   ├── movement/page.tsx      ← sub-replace + swap-conflict resolution
│   │   ├── lookup/page.tsx        ← trust banner + full timeline
│   │   ├── verify/page.tsx        ← kit scan (mother + subs, source-tagged) — §3 byproduct-of-work verification
│   │   ├── triage/page.tsx        ← supervisor: repair pool
│   │   ├── review/page.tsx        ← supervisor: conflict_reviews + stale list
│   │   └── _components/{AppShell.tsx,Nav.tsx,SyncIndicator.tsx,ProductUI.tsx} ← shared shell + UI kit
│   └── api/
│       ├── auth/[...nextauth]/route.ts
│       ├── sync/route.ts
│       ├── registry/route.ts      ← snapshot for offline cache
│       ├── lookup-cockpit/route.ts ← richer view model backing lookup/page.tsx
│       ├── trust-state/route.ts
│       ├── devices/fault-history/route.ts
│       ├── users/supervisors/route.ts
│       └── [module]/route.ts      ← thin: Zod validate → service → JSON
├── services/                      ← ALL business logic
│   ├── auth.service.ts            ← requireAuthenticated/requireSupervisor — source of truth for role checks
│   ├── registration.service.ts
│   ├── installation.service.ts
│   ├── movement.service.ts        ← dispatchMovementAction, changeTruckCompany
│   ├── fault.service.ts
│   ├── lifecycle.service.ts       ← ONLY place device status transitions happen
│   ├── verification.service.ts
│   ├── sync.service.ts
│   ├── lookup.service.ts          ← timelines, fault-recurrence queries, repair pool listing
│   ├── review.service.ts          ← supervisor conflict_review resolve/dismiss — acknowledgement only, never touches the registry
│   ├── dashboard.service.ts       ← home screen view model: health/counts/trust summary, latest audit, open reviews
│   └── audit.service.ts
├── db/
│   ├── index.ts                   ← singleton better-sqlite3
│   ├── schema.ts                  ← Drizzle: all tables, nowhere else
│   └── migrations/
├── lib/
│   ├── auth.ts
│   ├── offline/{db.ts,sync-engine.ts,use-sync-status.ts}
│   ├── qr/{scanner.tsx,torch.ts}  ← CameraScanner + torch feature-detect; ProductUI's ScanInputRow composes this into the form control, always beside always-visible manual entry
│   └── validations/               ← Zod, shared by routes + forms
├── types/index.ts
├── constants/index.ts             ← enums, VERIFY_DECAY_SCAN_DAYS=90, VERIFY_DECAY_PHOTO_DAYS=30
├── public/{manifest.json,sw}
└── scripts/
    ├── seed.ts                    ← org + 10 known users (roles) from config
    ├── import-sheets.mjs          ← THE migration audit engine (§8) — already written & run
    ├── import-commit.ts           ← turns resolved audit output into DB inserts (step 2)
    └── backup.sh                  ← sqlite → R2, daily cron
```

Layer contract (defects, not preferences): a route with SQL is a defect; a service importing
`next/server` is a defect; a status change outside `lifecycle.service.ts` is a defect.
Transaction pattern: validate + compute BEFORE `db.transaction()`; all related writes + audit
INSIDE; side effects (cache refresh, mirror) AFTER.

---

## 8. Migration — three-source reconciliation (validated against real data)

There is **no single source of truth.** The real fleet is Registry (540) ∪ person-tabs (1,057)
∪ install-log (375) = **~1,106 distinct devices**. The Registry covers under half. The audit
engine (`scripts/import-sheets.mjs`, already written and run against the real CSVs) proves it:

**Dry-run findings on the actual sheets:**
- 1,106 devices; 586 in >1 source; **519 person-tab-only**; 1 install-only.
- Assignment resolution: 273 registry+install AGREE; **8 disagree**; 150 registry trucks with
  NO install evidence; **583 registered-never-installed → inventory**; 1 pure orphan.
- Real historical mother-lock swaps derivable from install replay ≈ **17** (of 284
  multiply-installed trucks, 267 kept the same mother — re-configs, not swaps).
- 27 devices whose current sub-kit ≠ 3 subs — swaps caught at different moments by different
  sheets; import `unverified` with the union preserved for a kit-scan to resolve.
- Serials clean: 0 malformed masters, 0 malformed subs, 0 duplicate masters.

**Merge rules (keyed on master serial; columns mapped BY HEADER NAME per file — positions
differ across person-tabs):**
1. **Person-tabs = primary registration + sub-kit** (they hold the ~566 devices Registry lacks).
2. **Registry = authoritative for current truck/status/sim** where present. Status maps
   Active→in_service, Unassigned→available, Faulty→faulty, Under Repair→repair.
3. **Install log = slots (positional C1/C2/C3) + newest-install truck default.** Replay newest
   per truck. `Faulty Subs` column → ONE closed faulty pairing per device (deeper history was
   overwritten and is unrecoverable — do not fabricate it).
4. **Assignment tiebreak:** newest-install truck wins the DEFAULT value; any Registry-vs-install
   disagreement (and any registry truck with no install evidence) imports **`unverified`**,
   preserved as a plain `import_conflict` review showing both plates and both source dates,
   **with no asserted cause** — a supervisor decides whether it is one mistyped truck or two
   real trucks and a genuine swap. Similar-looking plates are NOT assumed to be typos (§4,
   Truck identity). Newest-install wins the value, never the trust.
5. **Ignored columns** (Device Unique ID, seal/unseal cards, notes, decorative status) are
   read-and-skipped, never stored.
6. **Every migrated device imports `unverified`.** It heals via byproduct kit-scan post-launch.

**Cutover:** backup proven FIRST → run `import-commit.ts` → freeze Sheets (revoke Apps Script
endpoint, mark read-only "ARCHIVE") → team switches. **Parallel-running is rejected** — dual
entry is how the registry drifted; the old app keeps lying about save success. Keep the frozen
sheets as rollback reference for 2 weeks.

---

## 9. Registration UX (the migration only sticks if this beats a Google tab)

Registration moves into the app from go-live (owner confirmed). Six people currently register
into six private tabs *because it was frictionless.* If in-app registration is more annoying
than opening a personal sheet, the tabs survive in the shadows as a seventh source. Win
condition is not "registration exists in the app" — it is "the tabs stop being opened."

- **Mobile, scan-driven, one kit at a time.** Registration happens on a phone, not a laptop.
  The flow is: scan (or type) the mother serial, scan the three subs, add the kit to a running
  on-screen list, repeat. NOT a spreadsheet-style multi-row form. Minimal mandatory fields
  (mother serial + 3 subs + sim); config flags (IP/APN/BT) optional here, confirmed at install.
- **Online-only — the ONE form that is not offline-first.** Registration happens at a location
  with reliable connectivity (owner-confirmed), so the write-loss gap never opens and the
  offline queue would be dead weight. Registration writes straight to the server: no Dexie
  queue, no sync reconciliation, no cached-lookup path.
- **Failure must be loud.** This is the one carry-over from the offline forms and it is
  non-negotiable: if the write fails, it fails visibly and the record is NOT shown as saved.
  The original system's core bug was a success screen that rendered before/despite a failed
  write. Online-only registration must never repeat it — a failed write shows an error and a
  retry, never "registered."

---

## 10. API surface (thin; all logic in services)

As actually implemented (this section previously listed the pre-implementation design and had
drifted from reality — corrected here; keep it current, this doc is ground truth):

```
POST /api/sync                     any        — batched offline mutations; per-item applied|conflicted|rejected (sync.service.ts)
GET  /api/registry                 any        — snapshot for offline cache
GET  /api/lookup-cockpit           any        — richer lookup view model (trust + timeline-ish context) backing lookup/page.tsx
GET  /api/trust-state              any        — getTrustState() by motherDeviceId or truckId
GET  /api/devices/fault-history    any        — recurrence by ?deviceId= (excludes operational_swap removals)
GET  /api/users/supervisors        any        — role='supervisor' users, for authority pickers (§4)
POST /api/registrations            any        — register kit (online-only, §9 — NOT queued)
POST /api/installations            any        — installKit / recordInstallation (installMode: 'new' | 'same_kit')
POST /api/movements                any        — dispatchMovementAction: all actions incl. sub-replace, truck-swap
POST /api/faults                   any
POST /api/verifications            any        — kit scan (mother + subs, source-tagged qr_scan|manual); match or full mismatch-correction, both are a successful apply
GET  /api/triage                   any        — repair pool listing
POST /api/triage                   supervisor  — revive | declare dead
GET  /api/reviews                  any        — open conflict_reviews
POST /api/reviews                  supervisor — resolve | dismiss (acknowledgement only, §3)
```

Not yet built, and not to be assumed to exist: `GET /api/trucks/:plate/timeline`,
`GET /api/devices/:serial/timeline`, a generic `PATCH /api/{logs}/:id` corrections endpoint,
and:
```
POST /api/trucks/:id/company   supervisor  — changeTruckCompany (reassignment only;
                                              install-time declaration happens inside
                                              POST /api/installations, not here)
```

Error shape `{ error: { code, message, field? } }`. Pagination on every list. Role enforced in
services, mirrored (not solely) in routes.

---

## 11. Phased build plan

### Phase 0 — infrastructure (before any feature)
Next.js scaffold per §7 · Drizzle schema + migration 001 (§5) · `seed.ts` (org + 10 users) ·
**backup script tested with a real restore** · `import-sheets.mjs` dry-run clean on the real
export (already achieved).
Exit: fresh clone → seeded working shell; backup/restore proven.

### Phase 1 — V1 working system
1. Auth + sessions + role middleware + service-layer `requireSupervisor()`.
2. `lifecycle.service.ts` + swap-conflict helper (everything depends on these two).
3. Registration (batch, low-friction) → Installation (lookup, inline new-device, config
   re-check, slot assignment) → Movement (all actions, one-transaction swap, combined
   sub-replace) → Fault (inline history) → Lookup (trust banner + timelines).
4. Verification: kit-scan-on-interaction, partial/manual fallback, mismatch flow, photo
   attestation, derived trust.
5. Triage + Review (supervisor).
6. **Offline:** Dexie queue + registry snapshot + sync engine + `/api/sync` + permanent
   indicator. (Deliberate V1, not V2 — the structural fix for silent loss.)
7. QR scanner + feature-detected torch + always-visible manual entry.
8. Run `import-commit.ts` on resolved audit output; validate; cut over.
Exit criteria: a tech on airplane mode can register, install, replace a sub, log a fault;
all sync on reconnect with correct statuses + audit rows; a forced conflict lands in review;
an unverified truck shows the banner; installer cannot edit; supervisor edit writes audit.

### V1.1 — 4–6 weeks post-launch
TWA → signed APK (Bubblewrap) · WhatsApp share regenerated from records · stale-verification
dashboard with decay countdown · CSV export · optional read-only Sheets mirror.

### V2 — when earned
Photo attachments on faults/installs · push for open conflicts · SIM as first-class entity
(schema tolerates it) · richer repair-flow (charge-test results) · multi-org UI (schema ready).

### Deferred, with triggers
- **SIM entity:** attribute now; promote when SIMs demonstrably move between devices.
- **Variable slot count:** all legacy data is 3 slots; build per-device count only when a
  non-3-compartment truck appears.
- **Sub-lock charge-test tracking:** revisit if revived-device failure rates become a question
  triage can't answer.

---

## 12. Delivery checklist (V1 not done until every box ticks)

- [ ] Backup tested with a real restore before any production data
- [ ] Auth + roles enforced in the service layer (verified by direct API call as installer)
- [ ] Full happy path: register → install → fault → replace sub → timeline shows all of it
- [ ] Airplane-mode: writes queue, survive app restart, sync on reconnect
- [ ] Forced sync conflict lands in conflict_reviews, not silently applied
- [ ] Kit mismatch scan → verification + closed/opened pairings + movement_log + review item
- [ ] `operational_swap` removals absent from fault-recurrence queries (test explicitly)
- [ ] No UPDATE/DELETE path on audit_log exists
- [ ] No plate-similarity logic anywhere (import OR runtime); all 8 truck disagreements surface
      as plain import_conflict reviews with both values and no asserted cause; new plates create
      exactly as typed
- [ ] Registration is online-only and mobile scan-driven; a failed registration write shows an
      error + retry and never displays "registered"
- [ ] Old Apps Script endpoint revoked at cutover; sheets frozen as archive
- [ ] Torch button absent (not broken) where unsupported; manual entry beside every scan
- [ ] `.env.example` complete; `seed.ts` builds a working system from empty DB
- [ ] Registration flow demonstrably faster than opening a Google tab (owner sign-off)
