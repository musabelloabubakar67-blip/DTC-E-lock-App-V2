// §5 fault_reports, §4 "Fields the login model deletes" (no recurring? input — recurrence is a
// QUERY surfaced inline, never asked). §6 "Sub-lock replacement" composes insertFaultReport
// directly into its own transaction; the Fault form uses createFaultReport standalone.
import { eq, and, inArray } from 'drizzle-orm';
import { createId } from '@paralleldrive/cuid2';
import { faultReports, truckAssignments, slotPairings, auditLog, users } from '../db/schema';
import { BusinessError } from '../lib/errors';

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type DbClient = any; // drizzle db or transaction handle — identical query surface for our purposes.

// Only these removal reasons count against fault history (§6 Reason → disposition) — the same
// filter proven discriminating in lifecycle.service.test.ts's mixed-history test. operational_swap
// (and everything else) is excluded — reused here, not reinvented.
const FAULT_REASONS: ('faulty' | 'damaged')[] = ['faulty', 'damaged'];

export type FaultHistorySummary = {
  count: number;
  mostRecentAt: number | null; // unix seconds
};

/**
 * A device's fault history for the inline "N prior faults, most recent X days ago" display
 * (§4). Queries the removal reason recorded on the device's OWN table — truck_assignments for
 * a mother, slot_pairings for a sub — since that's where every fault-driven removal is recorded
 * regardless of which action closed it (not every fault removal necessarily produces a
 * standalone fault_reports row, e.g. a mother_replacement for cause).
 */
export function getDeviceFaultHistory(db: DbClient, deviceId: string): FaultHistorySummary {
  const fromAssignments: { removedAt: number | null }[] = db
    .select({ removedAt: truckAssignments.removedAt })
    .from(truckAssignments)
    .where(and(eq(truckAssignments.deviceId, deviceId), inArray(truckAssignments.removalReason, FAULT_REASONS)))
    .all();

  const fromPairings: { removedAt: number | null }[] = db
    .select({ removedAt: slotPairings.unpairedAt })
    .from(slotPairings)
    .where(and(eq(slotPairings.subDeviceId, deviceId), inArray(slotPairings.removalReason, FAULT_REASONS)))
    .all();

  const dates = [...fromAssignments, ...fromPairings]
    .map((r) => r.removedAt)
    .filter((d): d is number => d != null);

  return {
    count: dates.length,
    mostRecentAt: dates.length ? Math.max(...dates) : null,
  };
}

export type YesNo = 'yes' | 'no';

export type CreateFaultReportInput = {
  orgId: string;
  actorUserId: string;
  truckId: string;
  deviceId: string; // mother OR sub
  loggedDate?: number;
  reportedBy?: 'station_manager' | 'customer_rep' | 'driver' | 'team_member' | 'self_identified';
  faultType?:
    | 'device_offline'
    | 'dynamic_password_failed'
    | 'sub_lock_not_opening'
    | 'charging_failure'
    | 'configuration_error'
    | 'hardware_damage'
    | 'seal_discrepancy'
    | 'other';
  locksAffected: string[]; // stored as JSON array
  truckLocation?: 'in_transit' | 'customer_location' | 'installation_point';
  deviceOnline?: 'yes' | 'no' | 'intermittent';
  description: string;
  remoteOpen?: 'success' | 'failed' | 'not_applicable';
  staticPwUsed?: YesNo;
  staticPwAuthBy?: string | null; // AUTHORITY: supervisor picker, nullable, never the session user
  resolution?:
    | 'resolved_remotely'
    | 'static_password_issued'
    | 'device_reconfigured'
    | 'device_replaced'
    | 'pending'
    | 'escalated';
  minutesToResolve?: number;
  followupRequired?: YesNo;
  followupDetails?: string;
  incidentStatus?: 'closed' | 'open_pending_followup';
  closureBy?: string | null; // AUTHORITY: supervisor picker, nullable while open
  linkedMovementId?: string;
  notes?: string;
};

function assertSupervisorPicker(db: DbClient, userId: string | null | undefined, fieldName: string): void {
  if (!userId) return; // nullable — N/A is valid
  const user = db.select().from(users).where(eq(users.id, userId)).get();
  if (!user || user.role !== 'supervisor') {
    throw new BusinessError(`${fieldName} must reference a user with role='supervisor'`);
  }
}

/**
 * Inserts the fault_report + its audit_log row. Does NOT open a transaction — composes into
 * the caller's (either createFaultReport's own transaction below, or movement.service.ts's
 * sub-replacement transaction when reason is faulty|damaged, linked via linked_movement_id).
 */
export function insertFaultReport(tx: DbClient, input: CreateFaultReportInput & { id?: string }): string {
  const id = input.id ?? createId();
  const now = Math.floor(Date.now() / 1000);

  tx.insert(faultReports)
    .values({
      id,
      orgId: input.orgId,
      truckId: input.truckId,
      deviceId: input.deviceId,
      actorUserId: input.actorUserId,
      loggedDate: input.loggedDate ?? now,
      reportedBy: input.reportedBy,
      faultType: input.faultType,
      locksAffected: JSON.stringify(input.locksAffected),
      truckLocation: input.truckLocation,
      deviceOnline: input.deviceOnline,
      description: input.description,
      remoteOpen: input.remoteOpen,
      staticPwUsed: input.staticPwUsed,
      staticPwAuthBy: input.staticPwAuthBy ?? null,
      resolution: input.resolution,
      minutesToResolve: input.minutesToResolve,
      followupRequired: input.followupRequired,
      followupDetails: input.followupDetails,
      incidentStatus: input.incidentStatus,
      closureBy: input.closureBy ?? null,
      linkedMovementId: input.linkedMovementId,
      notes: input.notes,
    })
    .run();

  tx.insert(auditLog)
    .values({
      id: createId(),
      orgId: input.orgId,
      actorUserId: input.actorUserId,
      entityTable: 'fault_reports',
      entityId: id,
      operation: 'create',
      afterJson: JSON.stringify({ deviceId: input.deviceId, truckId: input.truckId }),
    })
    .run();

  return id;
}

/**
 * Standalone Fault form submit: validates authority pickers BEFORE opening the transaction
 * (§7 pattern), then opens its own transaction around insertFaultReport.
 */
export function createFaultReport(db: DbClient, input: CreateFaultReportInput): string {
  assertSupervisorPicker(db, input.staticPwAuthBy, 'static_pw_auth_by');
  assertSupervisorPicker(db, input.closureBy, 'closure_by');

  return db.transaction((tx: DbClient) => insertFaultReport(tx, input));
}
