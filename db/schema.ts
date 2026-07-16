import { sql } from 'drizzle-orm';
import {
  sqliteTable,
  text,
  integer,
  uniqueIndex,
  index,
} from 'drizzle-orm/sqlite-core';

export const organisations = sqliteTable('organisations', {
  id: text('id').primaryKey(),
  name: text('name').notNull(),
  createdAt: integer('created_at').notNull().default(sql`(unixepoch())`),
});

export const users = sqliteTable('users', {
  id: text('id').primaryKey(),
  orgId: text('org_id').notNull().references(() => organisations.id),
  username: text('username').notNull().unique(),
  displayName: text('display_name').notNull(),
  passwordHash: text('password_hash').notNull(),
  role: text('role', { enum: ['installer', 'supervisor'] }).notNull(),
  company: text('company', { enum: ['mrs', 'dangote'] }), // nullable, dormant: no access logic reads this yet
  isActive: integer('is_active').notNull().default(1),
  lastLogin: integer('last_login'),
  createdAt: integer('created_at').notNull().default(sql`(unixepoch())`),
  updatedAt: integer('updated_at').notNull().default(sql`(unixepoch())`),
});

// trucks — records, not strings. Created on first reference.
export const trucks = sqliteTable('trucks', {
  id: text('id').primaryKey(),
  orgId: text('org_id').notNull().references(() => organisations.id),
  plate: text('plate').notNull().unique(), // normalized uppercase/trim
  isActive: integer('is_active').notNull().default(1),
  createdVia: text('created_via', {
    enum: ['import', 'install', 'movement', 'manual'],
  }).notNull(),
  createdAt: integer('created_at').notNull().default(sql`(unixepoch())`),
  updatedAt: integer('updated_at').notNull().default(sql`(unixepoch())`),
});

// devices — ONE table for mother + sub locks. One identity for life.
export const devices = sqliteTable(
  'devices',
  {
    id: text('id').primaryKey(),
    orgId: text('org_id').notNull().references(() => organisations.id),
    deviceType: text('device_type', { enum: ['mother', 'sub'] }).notNull(),
    serial: text('serial').notNull().unique(), // mother: 12 digits; sub: 12 hex; normalized upper
    simNumber: text('sim_number'), // mothers; attribute only (SIM-as-entity deferred)
    lifecycleStatus: text('lifecycle_status', {
      enum: ['available', 'in_service', 'repair', 'faulty', 'retired'],
    }).notNull(),
    registeredAt: integer('registered_at'),
    registeredBy: text('registered_by').references(() => users.id),
    importUnverified: integer('import_unverified').notNull().default(0), // set for every migrated device
    ownershipStatus: text('ownership_status', { enum: ['owned', 'released_external'] }).notNull().default('owned'),
    ownershipNotes: text('ownership_notes'),
    ownershipUpdatedAt: integer('ownership_updated_at'),
    // Queryable provenance (§3 mismatch flow): 'discovered' = created inline during a
    // verification mismatch correction (an already-mounted, never-registered device found by
    // scan). Everything else — registerKit, migration import — is 'registered'.
    origin: text('origin', { enum: ['registered', 'discovered'] }).notNull().default('registered'),
    notes: text('notes'),
    createdAt: integer('created_at').notNull().default(sql`(unixepoch())`),
    updatedAt: integer('updated_at').notNull().default(sql`(unixepoch())`),
  },
  (table) => ({
    serialIdx: index('idx_devices_serial').on(table.serial),
    statusIdx: index('idx_devices_status').on(table.deviceType, table.lifecycleStatus),
  }),
);

// registration_logs — write-once birth record of a kit (mother + subs, config). No truck.
export const registrationLogs = sqliteTable('registration_logs', {
  id: text('id').primaryKey(),
  orgId: text('org_id').notNull().references(() => organisations.id),
  motherDeviceId: text('mother_device_id').notNull().references(() => devices.id),
  actorUserId: text('actor_user_id').notNull().references(() => users.id),
  loggedDate: integer('logged_date').notNull(),
  ipConfigured: text('ip_configured', { enum: ['yes', 'no'] }),
  apnConfigured: text('apn_configured', { enum: ['yes', 'no'] }),
  apnAuthSet: text('apn_auth_set', { enum: ['yes', 'no'] }),
  btWriteDone: text('bt_write_done', { enum: ['yes', 'no'] }),
  simNumber: text('sim_number'),
  source: text('source', { enum: ['app', 'import'] }).notNull().default('app'),
  notes: text('notes'),
  createdAt: integer('created_at').notNull().default(sql`(unixepoch())`),
  updatedAt: integer('updated_at').notNull().default(sql`(unixepoch())`),
});

// kit_members — UNSLOTTED registration pairing: which subs belong to a mother.
// Slots are NOT assigned here (assigned at install via slot_pairings).
export const kitMembers = sqliteTable(
  'kit_members',
  {
    id: text('id').primaryKey(),
    orgId: text('org_id').notNull().references(() => organisations.id),
    motherDeviceId: text('mother_device_id').notNull().references(() => devices.id),
    subDeviceId: text('sub_device_id').notNull().references(() => devices.id),
    addedAt: integer('added_at').notNull(),
    removedAt: integer('removed_at'), // open membership = removed_at IS NULL
    createdAt: integer('created_at').notNull().default(sql`(unixepoch())`),
  },
  (table) => ({
    uqOpenKitSub: uniqueIndex('uq_open_kit_sub')
      .on(table.subDeviceId)
      .where(sql`${table.removedAt} IS NULL`),
  }),
);

// truck_assignments — TIMELINE: mother lock on truck. Partial unique indexes guarantee
// one live mother per truck and one live truck per mother.
export const truckAssignments = sqliteTable(
  'truck_assignments',
  {
    id: text('id').primaryKey(),
    orgId: text('org_id').notNull().references(() => organisations.id),
    truckId: text('truck_id').notNull().references(() => trucks.id),
    deviceId: text('device_id').notNull().references(() => devices.id), // mother only (service-enforced)
    assignedAt: integer('assigned_at').notNull(),
    assignedBy: text('assigned_by').notNull().references(() => users.id),
    removedAt: integer('removed_at'),
    removedBy: text('removed_by').references(() => users.id),
    removalReason: text('removal_reason', {
      enum: [
        'faulty',
        'damaged',
        'operational_swap',
        'decommissioned',
        'unlogged_swap_detected',
        'other',
      ],
    }),
    disposition: text('disposition', {
      enum: ['repair_pool', 'available_pool', 'retired'],
    }),
    removalNotes: text('removal_notes'),
    createdAt: integer('created_at').notNull().default(sql`(unixepoch())`),
  },
  (table) => ({
    uqOpenAssignmentTruck: uniqueIndex('uq_open_assignment_truck')
      .on(table.truckId)
      .where(sql`${table.removedAt} IS NULL`),
    uqOpenAssignmentDevice: uniqueIndex('uq_open_assignment_device')
      .on(table.deviceId)
      .where(sql`${table.removedAt} IS NULL`),
  }),
);

// truck_company_assignments — TIMELINE, parallel to truck_assignments, independent of it.
// Which customer (MRS/Dangote) a DTC-owned truck currently serves (§2). Confirmed as a
// byproduct of every install (§6), not declared once — the table shape is the same either way,
// only the write trigger differs.
export const truckCompanyAssignments = sqliteTable(
  'truck_company_assignments',
  {
    id: text('id').primaryKey(),
    orgId: text('org_id').notNull().references(() => organisations.id),
    truckId: text('truck_id').notNull().references(() => trucks.id),
    company: text('company', { enum: ['mrs', 'dangote'] }).notNull(),
    assignedAt: integer('assigned_at').notNull(),
    assignedBy: text('assigned_by').notNull().references(() => users.id),
    removedAt: integer('removed_at'),
    removedBy: text('removed_by').references(() => users.id),
    createdAt: integer('created_at').notNull().default(sql`(unixepoch())`),
  },
  (table) => ({
    uqOpenTruckCompany: uniqueIndex('uq_open_truck_company')
      .on(table.truckId)
      .where(sql`${table.removedAt} IS NULL`),
  }),
);

// slot_pairings — TIMELINE: which sub occupies which slot under which mother, when.
// Created at INSTALL (slots assigned positionally: C1→B, C2→C, C3→D).
export const slotPairings = sqliteTable(
  'slot_pairings',
  {
    id: text('id').primaryKey(),
    orgId: text('org_id').notNull().references(() => organisations.id),
    motherDeviceId: text('mother_device_id').notNull().references(() => devices.id),
    slot: text('slot', { enum: ['B', 'C', 'D'] }).notNull(),
    subDeviceId: text('sub_device_id').notNull().references(() => devices.id),
    pairedAt: integer('paired_at').notNull(),
    pairedBy: text('paired_by').notNull().references(() => users.id),
    unpairedAt: integer('unpaired_at'),
    unpairedBy: text('unpaired_by').references(() => users.id),
    removalReason: text('removal_reason', {
      enum: [
        'faulty',
        'damaged',
        'operational_swap',
        'decommissioned',
        'unlogged_swap_detected',
        'other',
      ],
    }),
    disposition: text('disposition', {
      enum: ['repair_pool', 'available_pool', 'retired'],
    }),
    removalNotes: text('removal_notes'),
    createdAt: integer('created_at').notNull().default(sql`(unixepoch())`),
  },
  (table) => ({
    uqOpenPairingSlot: uniqueIndex('uq_open_pairing_slot')
      .on(table.motherDeviceId, table.slot)
      .where(sql`${table.unpairedAt} IS NULL`),
    uqOpenPairingSub: uniqueIndex('uq_open_pairing_sub')
      .on(table.subDeviceId)
      .where(sql`${table.unpairedAt} IS NULL`),
  }),
);

// verifications — append-only. Trust state derived from latest row + decay.
export const verifications = sqliteTable(
  'verifications',
  {
    id: text('id').primaryKey(),
    orgId: text('org_id').notNull().references(() => organisations.id),
    truckId: text('truck_id').references(() => trucks.id),
    motherDeviceId: text('mother_device_id').notNull().references(() => devices.id),
    source: text('source', { enum: ['qr_scan', 'photo_attestation', 'manual'] }).notNull(),
    result: text('result', { enum: ['match', 'mismatch_corrected'] }).notNull(),
    observedMaster: text('observed_master').notNull(),
    observedSubsJson: text('observed_subs_json').notNull(), // unordered set actually scanned/typed
    expectedSubsJson: text('expected_subs_json'), // registry's set, when mismatched
    weakestTier: text('weakest_tier', {
      enum: ['qr_scan', 'photo_attestation', 'manual'],
    }).notNull(),
    verifiedBy: text('verified_by').notNull().references(() => users.id),
    verifiedAt: integer('verified_at').notNull(),
    notes: text('notes'),
    createdAt: integer('created_at').notNull().default(sql`(unixepoch())`),
  },
  (table) => ({
    truckIdx: index('idx_verifications_truck').on(table.truckId, table.verifiedAt),
  }),
);

// installation_logs — device-to-truck mounting checklist. Config section RE-CHECKS registration.
export const installationLogs = sqliteTable('installation_logs', {
  id: text('id').primaryKey(),
  orgId: text('org_id').notNull().references(() => organisations.id),
  truckId: text('truck_id').notNull().references(() => trucks.id),
  motherDeviceId: text('mother_device_id').notNull().references(() => devices.id),
  assignmentId: text('assignment_id').notNull().references(() => truckAssignments.id),
  actorUserId: text('actor_user_id').notNull().references(() => users.id),
  loggedDate: integer('logged_date').notNull(),
  batteryLevel: text('battery_level', { enum: ['full', 'adequate', 'low', 'dead'] }),
  physicalDamage: text('physical_damage', { enum: ['none', 'minor', 'significant'] }),
  deviceResponsive: text('device_responsive', { enum: ['yes', 'no'] }),
  sublocksResponsive: text('sublocks_responsive', { enum: ['yes', 'no'] }),
  configConfirmed: text('config_confirmed', { enum: ['yes', 'no', 'changed'] }),
  configNotes: text('config_notes'),
  btUnlockDone: text('bt_unlock_done', { enum: ['yes', 'no'] }),
  onlineAfter: text('online_after', { enum: ['yes', 'no', 'intermittent'] }),
  motherLocked: text('mother_locked', { enum: ['yes', 'no'] }),
  motherSecured: text('mother_secured', { enum: ['yes', 'no'] }),
  sublocksLocked: text('sublocks_locked', { enum: ['all', 'partial', 'none'] }),
  sublocksSecured: text('sublocks_secured', { enum: ['yes', 'no'] }),
  overallStatus: text('overall_status', {
    enum: ['successful', 'completed_with_issues', 'failed'],
  }),
  issuesNotes: text('issues_notes'),
  createdAt: integer('created_at').notNull().default(sql`(unixepoch())`),
  updatedAt: integer('updated_at').notNull().default(sql`(unixepoch())`),
});

// fault_reports — no "recurring?" column; recurrence is a QUERY surfaced inline.
export const faultReports = sqliteTable(
  'fault_reports',
  {
    id: text('id').primaryKey(),
    orgId: text('org_id').notNull().references(() => organisations.id),
    truckId: text('truck_id').notNull().references(() => trucks.id),
    deviceId: text('device_id').notNull().references(() => devices.id), // mother OR sub
    actorUserId: text('actor_user_id').notNull().references(() => users.id),
    loggedDate: integer('logged_date').notNull(),
    reportedBy: text('reported_by', {
      enum: ['station_manager', 'customer_rep', 'driver', 'team_member', 'self_identified'],
    }),
    faultType: text('fault_type', {
      enum: [
        'device_offline',
        'dynamic_password_failed',
        'sub_lock_not_opening',
        'charging_failure',
        'configuration_error',
        'hardware_damage',
        'seal_discrepancy',
        'other',
      ],
    }),
    locksAffected: text('locks_affected').notNull(), // JSON array
    truckLocation: text('truck_location', {
      enum: ['in_transit', 'customer_location', 'installation_point'],
    }),
    deviceOnline: text('device_online', { enum: ['yes', 'no', 'intermittent'] }),
    description: text('description').notNull(),
    remoteOpen: text('remote_open', { enum: ['success', 'failed', 'not_applicable'] }),
    staticPwUsed: text('static_pw_used', { enum: ['yes', 'no'] }),
    staticPwAuthBy: text('static_pw_auth_by').references(() => users.id), // AUTHORITY: supervisor picker; NULL if N/A
    resolution: text('resolution', {
      enum: [
        'resolved_remotely',
        'static_password_issued',
        'device_reconfigured',
        'device_replaced',
        'pending',
        'escalated',
      ],
    }),
    minutesToResolve: integer('minutes_to_resolve'),
    followupRequired: text('followup_required', { enum: ['yes', 'no'] }),
    followupDetails: text('followup_details'),
    incidentStatus: text('incident_status', { enum: ['closed', 'open_pending_followup'] }),
    closureBy: text('closure_by').references(() => users.id), // AUTHORITY: NULL while open
    linkedMovementId: text('linked_movement_id').references((): any => movementLogs.id),
    notes: text('notes'),
    createdAt: integer('created_at').notNull().default(sql`(unixepoch())`),
    updatedAt: integer('updated_at').notNull().default(sql`(unixepoch())`),
  },
  (table) => ({
    deviceIdx: index('idx_fault_device').on(table.deviceId, table.loggedDate),
  }),
);

// movement_logs — event log of every assignment/pairing mutation (the mutation itself lives
// in truck_assignments / slot_pairings / kit_members). No "registry updated?" column.
export const movementLogs = sqliteTable('movement_logs', {
  id: text('id').primaryKey(),
  orgId: text('org_id').notNull().references(() => organisations.id),
  actorUserId: text('actor_user_id').notNull().references(() => users.id),
  loggedDate: integer('logged_date').notNull(),
  action: text('action', {
    enum: [
      'new_assignment',
      'mother_replacement',
      'sub_replacement',
      'truck_swap',
      'removed_to_inventory',
      'decommissioned',
      'unlogged_swap_detected',
      'triage',
      'company_reassignment',
    ],
  }).notNull(),
  truckId: text('truck_id').references(() => trucks.id),
  outDeviceId: text('out_device_id').references(() => devices.id),
  outReason: text('out_reason', {
    enum: ['faulty', 'damaged', 'operational_swap', 'decommissioned', 'other'],
  }),
  outDisposition: text('out_disposition', {
    enum: ['repair_pool', 'available_pool', 'retired'],
  }),
  inDeviceId: text('in_device_id').references(() => devices.id),
  slot: text('slot', { enum: ['B', 'C', 'D'] }),
  sourceTruckId: text('source_truck_id').references(() => trucks.id), // truck_swap: where the incoming device came from
  reasonNotes: text('reason_notes'),
  notes: text('notes'),
  createdAt: integer('created_at').notNull().default(sql`(unixepoch())`),
  updatedAt: integer('updated_at').notNull().default(sql`(unixepoch())`),
});

export const conflictReviews = sqliteTable('conflict_reviews', {
  id: text('id').primaryKey(),
  orgId: text('org_id').notNull().references(() => organisations.id),
  kind: text('kind', {
    enum: ['sync_conflict', 'unlogged_swap', 'import_conflict'],
  }).notNull(),
  payloadJson: text('payload_json').notNull(), // both versions / expected-vs-observed, NO asserted cause
  status: text('status', { enum: ['open', 'resolved', 'dismissed'] })
    .notNull()
    .default('open'),
  resolvedBy: text('resolved_by').references(() => users.id),
  resolvedAt: integer('resolved_at'),
  resolutionNotes: text('resolution_notes'),
  createdAt: integer('created_at').notNull().default(sql`(unixepoch())`),
});

// audit_log — APPEND-ONLY. Written inside every mutation's transaction. No UPDATE/DELETE ever.
export const auditLog = sqliteTable(
  'audit_log',
  {
    id: text('id').primaryKey(),
    orgId: text('org_id').notNull().references(() => organisations.id),
    actorUserId: text('actor_user_id').notNull().references(() => users.id),
    entityTable: text('entity_table').notNull(),
    entityId: text('entity_id').notNull(),
    operation: text('operation', {
      enum: ['create', 'correct', 'transition', 'import'],
    }).notNull(),
    beforeJson: text('before_json'),
    afterJson: text('after_json').notNull(),
    clientTs: integer('client_ts'),
    createdAt: integer('created_at').notNull().default(sql`(unixepoch())`),
  },
  (table) => ({
    entityIdx: index('idx_audit_entity').on(table.entityTable, table.entityId),
  }),
);

// sync_mutations — server-side idempotency ledger for offline sync
export const syncMutations = sqliteTable('sync_mutations', {
  clientMutationId: text('client_mutation_id').primaryKey(),
  orgId: text('org_id').notNull().references(() => organisations.id),
  userId: text('user_id').notNull().references(() => users.id),
  kind: text('kind').notNull(),
  status: text('status', { enum: ['applied', 'conflicted', 'rejected'] }).notNull(),
  clientTs: integer('client_ts').notNull(),
  appliedAt: integer('applied_at').notNull().default(sql`(unixepoch())`),
});
