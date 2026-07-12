// §7 "timelines, fault-recurrence queries" — read-only. No status changes happen here
// (that's lifecycle.service.ts's exclusive job); this file only queries.
import { and, desc, eq, isNull } from 'drizzle-orm';
import {
  auditLog,
  conflictReviews,
  devices,
  slotPairings,
  truckAssignments,
  truckCompanyAssignments,
  trucks,
  users,
} from '../db/schema';
import { getTrustState, type TrustStateResult } from './verification.service';
import type { ConflictReviewListItem } from './review.service';
import type { TruckCompany } from './installation.service';

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type DbClient = any; // drizzle db or transaction handle — identical query surface for our purposes.

export type RepairPoolItem = {
  deviceId: string;
  serial: string;
  deviceType: 'mother' | 'sub';
  enteredRepairAt: number | null;
  removalReason: string | null;
  removalNotes: string | null;
};

export type LookupCockpitQuery = {
  query: string;
  orgId: string;
};

export type LookupCockpitViewModel = {
  target: {
    kind: 'truck' | 'mother_device' | 'unknown';
    id: string | null;
    label: string;
  };
  // §2/§6: company is confirmed as a byproduct of install, not always present. `declared: false`
  // is a normal, expected state (pre-feature imports, no install yet) — render it as such, never
  // as an error or a blank/null value.
  company: { value: TruckCompany | null; declared: boolean };
  trust: TrustStateResult;
  kit: {
    mother: { id: string; serial: string } | null;
    subs: Array<{ slot: 'B' | 'C' | 'D'; id: string | null; serial: string | null }>;
    status: 'confirmed' | 'not_confirmed';
  };
  reviews: ConflictReviewListItem[];
  sync: {
    pendingCount: number;
    items: Array<{ id: string; endpoint: string; clientTs: number; status: 'pending' }>;
  };
  audit: Array<{
    id: string;
    createdAt: number;
    actorName: string | null;
    operation: string;
    entityTable: string;
    entityId: string;
    summary: string;
  }>;
};

const KIT_SLOTS = ['B', 'C', 'D'] as const;

function normalizeLookupQuery(query: string): string {
  return query.trim().toUpperCase();
}

function emptyTrust(): TrustStateResult {
  return { state: 'unverified', latestVerifiedAt: null, weakestTier: null };
}

function listOpenConflictReviewsForOrg(db: DbClient, orgId: string): ConflictReviewListItem[] {
  const rows = db
    .select()
    .from(conflictReviews)
    .where(and(eq(conflictReviews.orgId, orgId), eq(conflictReviews.status, 'open')))
    .orderBy(desc(conflictReviews.createdAt))
    .all();

  return rows.map(
    (row: {
      id: string;
      kind: ConflictReviewListItem['kind'];
      status: ConflictReviewListItem['status'];
      payloadJson: string;
      createdAt: number;
    }) => ({
      id: row.id,
      kind: row.kind,
      status: row.status,
      payload: JSON.parse(row.payloadJson),
      createdAt: row.createdAt,
    }),
  );
}

function buildAuditSummary(row: { operation: string; entityTable: string; afterJson: string }): string {
  let after: Record<string, unknown> | null = null;
  try {
    after = JSON.parse(row.afterJson) as Record<string, unknown>;
  } catch {
    after = null;
  }

  const action = typeof after?.action === 'string' ? after.action : null;
  const result = typeof after?.result === 'string' ? after.result : null;
  const kind = typeof after?.kind === 'string' ? after.kind : null;
  const status = typeof after?.status === 'string' ? after.status : null;

  if (action) return `${row.operation} ${action}`;
  if (result) return `${row.operation} ${result}`;
  if (kind) return `${row.operation} ${kind}`;
  if (status) return `${row.operation} ${status}`;
  return `${row.operation} ${row.entityTable}`;
}

function listLatestAudit(db: DbClient, orgId: string): LookupCockpitViewModel['audit'] {
  const rows = db
    .select()
    .from(auditLog)
    .where(eq(auditLog.orgId, orgId))
    .orderBy(desc(auditLog.createdAt))
    .all()
    .slice(0, 8);

  return rows.map(
    (row: {
      id: string;
      actorUserId: string;
      operation: string;
      entityTable: string;
      entityId: string;
      afterJson: string;
      createdAt: number;
    }) => {
      const actor = db.select({ displayName: users.displayName }).from(users).where(eq(users.id, row.actorUserId)).get();
      return {
        id: row.id,
        createdAt: row.createdAt,
        actorName: actor?.displayName ?? null,
        operation: row.operation,
        entityTable: row.entityTable,
        entityId: row.entityId,
        summary: buildAuditSummary(row),
      };
    },
  );
}

function getOpenSubSlots(db: DbClient, motherDeviceId: string): LookupCockpitViewModel['kit']['subs'] {
  const openPairings = db
    .select()
    .from(slotPairings)
    .where(and(eq(slotPairings.motherDeviceId, motherDeviceId), isNull(slotPairings.unpairedAt)))
    .all();

  return KIT_SLOTS.map((slot) => {
    const pairing = openPairings.find((row: { slot: 'B' | 'C' | 'D' }) => row.slot === slot);
    if (!pairing) return { slot, id: null, serial: null };

    const sub = db
      .select({ id: devices.id, serial: devices.serial })
      .from(devices)
      .where(eq(devices.id, pairing.subDeviceId))
      .get();

    return { slot, id: sub?.id ?? pairing.subDeviceId, serial: sub?.serial ?? null };
  });
}

function buildKit(
  db: DbClient,
  mother: { id: string; serial: string } | null,
  trust: TrustStateResult,
): LookupCockpitViewModel['kit'] {
  return {
    mother,
    subs: mother ? getOpenSubSlots(db, mother.id) : KIT_SLOTS.map((slot) => ({ slot, id: null, serial: null })),
    status: trust.state === 'verified' ? 'confirmed' : 'not_confirmed',
  };
}

function resolveLookupTarget(db: DbClient, query: string, orgId: string) {
  const normalized = normalizeLookupQuery(query);
  if (!normalized) return { kind: 'unknown' as const, id: null, label: 'No lookup target', mother: null, truckId: null };

  const truck =
    db
      .select()
      .from(trucks)
      .where(and(eq(trucks.orgId, orgId), eq(trucks.plate, normalized)))
      .get() ??
    db
      .select()
      .from(trucks)
      .where(and(eq(trucks.orgId, orgId), eq(trucks.id, query.trim())))
      .get();

  if (truck) {
    const assignment = db
      .select()
      .from(truckAssignments)
      .where(and(eq(truckAssignments.truckId, truck.id), isNull(truckAssignments.removedAt)))
      .get();
    const mother = assignment
      ? db
          .select({ id: devices.id, serial: devices.serial })
          .from(devices)
          .where(and(eq(devices.orgId, orgId), eq(devices.id, assignment.deviceId), eq(devices.deviceType, 'mother')))
          .get()
      : null;

    return {
      kind: 'truck' as const,
      id: truck.id,
      label: truck.plate,
      mother: mother ?? null,
      truckId: truck.id,
    };
  }

  const mother =
    db
      .select({ id: devices.id, serial: devices.serial })
      .from(devices)
      .where(and(eq(devices.orgId, orgId), eq(devices.deviceType, 'mother'), eq(devices.serial, normalized)))
      .get() ??
    db
      .select({ id: devices.id, serial: devices.serial })
      .from(devices)
      .where(and(eq(devices.orgId, orgId), eq(devices.deviceType, 'mother'), eq(devices.id, query.trim())))
      .get();

  if (mother) {
    return {
      kind: 'mother_device' as const,
      id: mother.id,
      label: mother.serial,
      mother,
      truckId: null,
    };
  }

  return { kind: 'unknown' as const, id: null, label: normalized, mother: null, truckId: null };
}

function getCurrentTruckCompany(db: DbClient, truckId: string): { value: TruckCompany | null; declared: boolean } {
  const row = db
    .select({ company: truckCompanyAssignments.company })
    .from(truckCompanyAssignments)
    .where(and(eq(truckCompanyAssignments.truckId, truckId), isNull(truckCompanyAssignments.removedAt)))
    .get() as { company: TruckCompany } | undefined;

  return row ? { value: row.company, declared: true } : { value: null, declared: false };
}

export function getLookupCockpit(db: DbClient, input: LookupCockpitQuery): LookupCockpitViewModel {
  const target = resolveLookupTarget(db, input.query, input.orgId);
  const trust =
    target.kind === 'truck' && target.truckId
      ? getTrustState(db, { truckId: target.truckId })
      : target.mother
        ? getTrustState(db, { motherDeviceId: target.mother.id })
        : emptyTrust();

  return {
    target: {
      kind: target.kind,
      id: target.id,
      label: target.label,
    },
    company: target.kind === 'truck' && target.truckId ? getCurrentTruckCompany(db, target.truckId) : { value: null, declared: false },
    trust,
    kit: buildKit(db, target.mother, trust),
    reviews: listOpenConflictReviewsForOrg(db, input.orgId),
    sync: { pendingCount: 0, items: [] },
    audit: listLatestAudit(db, input.orgId),
  };
}

/**
 * The Triage screen's list (§7 /triage): every device with lifecycle_status='repair', with
 * enough context to act — when it entered repair and why. Context comes from the most
 * recently CLOSED truck_assignment (mothers) or slot_pairing (subs) for that device, since
 * that's the record that actually carries removal_reason/removal_notes/the closing timestamp.
 */
export function listRepairPool(db: DbClient, orgId: string): RepairPoolItem[] {
  const repairDevices = db
    .select()
    .from(devices)
    .where(and(eq(devices.orgId, orgId), eq(devices.lifecycleStatus, 'repair')))
    .all();

  return repairDevices.map((device: { id: string; serial: string; deviceType: 'mother' | 'sub' }) => {
    let enteredRepairAt: number | null = null;
    let removalReason: string | null = null;
    let removalNotes: string | null = null;

    if (device.deviceType === 'mother') {
      const lastClosed = db
        .select()
        .from(truckAssignments)
        .where(eq(truckAssignments.deviceId, device.id))
        .orderBy(desc(truckAssignments.removedAt))
        .all()[0];
      if (lastClosed?.removedAt) {
        enteredRepairAt = lastClosed.removedAt;
        removalReason = lastClosed.removalReason;
        removalNotes = lastClosed.removalNotes;
      }
    } else {
      const lastClosed = db
        .select()
        .from(slotPairings)
        .where(eq(slotPairings.subDeviceId, device.id))
        .orderBy(desc(slotPairings.unpairedAt))
        .all()[0];
      if (lastClosed?.unpairedAt) {
        enteredRepairAt = lastClosed.unpairedAt;
        removalReason = lastClosed.removalReason;
        removalNotes = lastClosed.removalNotes;
      }
    }

    return {
      deviceId: device.id,
      serial: device.serial,
      deviceType: device.deviceType,
      enteredRepairAt,
      removalReason,
      removalNotes,
    };
  });
}
