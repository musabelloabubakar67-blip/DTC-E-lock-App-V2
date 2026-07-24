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
import { presentConflictReview, type ConflictReviewListItem } from './review.service';
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
    detail: string;
  }>;
};

const KIT_SLOTS = ['B', 'C', 'D'] as const;

function normalizeLookupQuery(query: string): string {
  return query.trim().toUpperCase();
}

function emptyTrust(): TrustStateResult {
  return { state: 'unverified', latestVerifiedAt: null, weakestTier: null };
}

function listOpenConflictReviewsForTarget(
  db: DbClient,
  orgId: string,
  references: Set<string>,
): ConflictReviewListItem[] {
  if (references.size === 0) return [];
  const rows = db
    .select()
    .from(conflictReviews)
    .where(and(eq(conflictReviews.orgId, orgId), eq(conflictReviews.status, 'open')))
    .orderBy(desc(conflictReviews.createdAt))
    .all();

  return rows.flatMap(
    (row: {
      id: string;
      kind: ConflictReviewListItem['kind'];
      status: ConflictReviewListItem['status'];
      payloadJson: string;
      createdAt: number;
    }) => {
      const payload = parseRecord(row.payloadJson);
      if (!recordMatchesReferences(payload, references)) return [];
      return [{
        id: row.id,
        kind: row.kind,
        status: row.status,
        payload,
        presentation: presentConflictReview(row.kind, payload),
        createdAt: row.createdAt,
      }];
    },
  );
}

function buildAuditSummary(row: { operation: string; entityTable: string; afterJson: string }): string {
  const after = parseRecord(row.afterJson);

  const action = typeof after?.action === 'string' ? after.action : null;
  const result = typeof after?.result === 'string' ? after.result : null;
  const kind = typeof after?.kind === 'string' ? after.kind : null;
  const status = typeof after?.status === 'string' ? after.status : null;

  if (row.entityTable === 'registration_logs') return 'Kit registered';
  if (row.entityTable === 'installation_logs') return 'Installation recorded';
  if (row.entityTable === 'verifications') {
    return result === 'match' ? 'Physical kit verified' : 'Physical verification updated the registry';
  }
  if (row.entityTable === 'conflict_reviews' && row.operation === 'transition') {
    return status === 'dismissed' ? 'Review marked as no action needed' : 'Review marked as reviewed';
  }
  if (row.entityTable === 'truck_company_assignments') return 'Serving company updated';
  if (action) return sentence(action);
  if (result) return sentence(result);
  if (kind) return sentence(kind);
  if (status) return sentence(status);
  return `${sentence(row.operation)} ${sentence(row.entityTable).toLowerCase()}`;
}

function buildAuditDetail(row: { entityTable: string; afterJson: string }, actorName: string | null): string {
  const after = parseRecord(row.afterJson);
  const values = [
    firstText(after.truckPlate, after.truck, after.truckLabel),
    firstText(after.motherSerial, after.mother, after.observedMotherSerial),
    firstText(after.company),
    firstText(after.reason, after.removalReason),
  ].filter(Boolean);
  const context = values.slice(0, 3).join(' / ');
  return [context, actorName ? `By ${actorName}` : ''].filter(Boolean).join(' - ') || sentence(row.entityTable);
}

function listLatestAudit(
  db: DbClient,
  orgId: string,
  references: Set<string>,
): LookupCockpitViewModel['audit'] {
  if (references.size === 0) return [];
  const rows = db
    .select()
    .from(auditLog)
    .where(eq(auditLog.orgId, orgId))
    .orderBy(desc(auditLog.createdAt))
    .all()
    .filter((row: { entityId: string; beforeJson: string; afterJson: string }) =>
      references.has(normalizeReference(row.entityId))
      || recordMatchesReferences(parseRecord(row.beforeJson), references)
      || recordMatchesReferences(parseRecord(row.afterJson), references))
    .slice(0, 20);

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
        detail: buildAuditDetail(row, actor?.displayName ?? null),
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
  if (!normalized) return { kind: 'unknown' as const, id: null, label: 'No lookup target', mother: null, truckId: null, truckLabel: null };

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
      truckLabel: truck.plate,
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
    const assignment = db
      .select({ truckId: truckAssignments.truckId })
      .from(truckAssignments)
      .where(and(eq(truckAssignments.deviceId, mother.id), isNull(truckAssignments.removedAt)))
      .get();
    const assignedTruck = assignment
      ? db.select({ plate: trucks.plate }).from(trucks).where(eq(trucks.id, assignment.truckId)).get()
      : null;
    return {
      kind: 'mother_device' as const,
      id: mother.id,
      label: mother.serial,
      mother,
      truckId: assignment?.truckId ?? null,
      truckLabel: assignedTruck?.plate ?? null,
    };
  }

  return { kind: 'unknown' as const, id: null, label: normalized, mother: null, truckId: null, truckLabel: null };
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

  const kit = buildKit(db, target.mother, trust);
  const references = buildLookupReferences(target, kit);

  return {
    target: {
      kind: target.kind,
      id: target.id,
      label: target.label,
    },
    company: target.kind === 'truck' && target.truckId ? getCurrentTruckCompany(db, target.truckId) : { value: null, declared: false },
    trust,
    kit,
    reviews: listOpenConflictReviewsForTarget(db, input.orgId, references),
    sync: { pendingCount: 0, items: [] },
    audit: listLatestAudit(db, input.orgId, references),
  };
}

function buildLookupReferences(
  target: ReturnType<typeof resolveLookupTarget>,
  kit: LookupCockpitViewModel['kit'],
): Set<string> {
  if (target.kind === 'unknown') return new Set();
  return new Set([
    target.id,
    target.label,
    target.truckId,
    target.truckLabel,
    kit.mother?.id,
    kit.mother?.serial,
    ...kit.subs.flatMap((slot) => [slot.id, slot.serial]),
  ].filter((value): value is string => Boolean(value)).map(normalizeReference));
}

function parseRecord(raw: string): Record<string, unknown> {
  try {
    const value = JSON.parse(raw);
    return value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : {};
  } catch {
    return {};
  }
}

function recordMatchesReferences(value: unknown, references: Set<string>): boolean {
  if (typeof value === 'string' || typeof value === 'number') {
    return references.has(normalizeReference(String(value)));
  }
  if (Array.isArray(value)) return value.some((item) => recordMatchesReferences(item, references));
  if (value && typeof value === 'object') {
    return Object.values(value as Record<string, unknown>).some((item) => recordMatchesReferences(item, references));
  }
  return false;
}

function normalizeReference(value: string): string {
  return value.trim().toUpperCase();
}

function firstText(...values: unknown[]): string {
  return values
    .map((value) => typeof value === 'string' || typeof value === 'number' ? String(value).trim() : '')
    .find(Boolean) ?? '';
}

function sentence(value: string): string {
  const words = value.replaceAll('_', ' ').trim();
  return words ? words[0].toUpperCase() + words.slice(1) : '';
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
