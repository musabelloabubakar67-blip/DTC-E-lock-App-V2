// §6 Movement — all truck/device movement actions except registration/installation.
// §5 movement_logs is the event log; the mutation itself lives in truck_assignments /
// slot_pairings (the pairing/assignment tables) — this file writes both, plus an explicit
// audit_log row per action, inside one transaction each (§7 transaction pattern).
import { eq, and, isNull } from 'drizzle-orm';
import { createId } from '@paralleldrive/cuid2';
import { devices, truckAssignments, slotPairings, movementLogs, auditLog, truckCompanyAssignments } from '../db/schema';
import { BusinessError, assertNever } from '../lib/errors';
import {
  applyRemoval,
  markInService,
  applyTriage,
  type RemovalReason,
  type Disposition,
} from './lifecycle.service';
import { insertFaultReport, type CreateFaultReportInput } from './fault.service';
import { requireSupervisor, type AuthenticatedUser } from './auth.service';
import type { MovementActionFormValues } from '../lib/validations/movement';
import type { TruckCompany } from './installation.service';

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type DbClient = any; // drizzle db or transaction handle — identical query surface for our purposes.

function nowSeconds(): number {
  return Math.floor(Date.now() / 1000);
}

// Every movement action writes ONE explicit audit_log row for the movement_logs entry itself,
// in addition to whatever lifecycle.service.ts writes for the device status transition(s) it
// triggers. This makes "every movement action is audited" true regardless of which lifecycle
// calls a given action happens to make (e.g. new_assignment makes none).
function writeMovementAudit(
  tx: DbClient,
  params: { orgId: string; actorUserId: string; movementLogId: string; payload: unknown },
): void {
  tx.insert(auditLog)
    .values({
      id: createId(),
      orgId: params.orgId,
      actorUserId: params.actorUserId,
      entityTable: 'movement_logs',
      entityId: params.movementLogId,
      operation: 'create',
      afterJson: JSON.stringify(params.payload),
    })
    .run();
}

// ---------------------------------------------------------------------------
// §6 "Incoming-device conflict check (the swap rule)" — shared helper, also used by
// installation.service.ts.
// ---------------------------------------------------------------------------

export type ConflictCheckResult =
  | { action: 'proceed' }
  | { action: 'reject'; code: 'already_on_this_truck' | 'device_not_usable'; message: string }
  | { action: 'blocked'; code: 'in_service_elsewhere'; currentTruckId: string };

/**
 * §6 "look up incoming serial FIRST": unassigned+available → proceed; already on THIS
 * truck → reject; in_service on ANOTHER truck → blocked (force resolution: truck_swap or
 * source-left-device-less); repair|faulty|retired → reject.
 */
export function checkIncomingDeviceConflict(
  db: DbClient,
  params: { deviceId: string; targetTruckId: string },
): ConflictCheckResult {
  const device = db.select().from(devices).where(eq(devices.id, params.deviceId)).get();
  if (!device) throw new BusinessError(`Device ${params.deviceId} not found`);

  if (
    device.lifecycleStatus === 'repair' ||
    device.lifecycleStatus === 'faulty' ||
    device.lifecycleStatus === 'retired'
  ) {
    return {
      action: 'reject',
      code: 'device_not_usable',
      message: `Device is '${device.lifecycleStatus}'`,
    };
  }

  const openAssignment = db
    .select()
    .from(truckAssignments)
    .where(and(eq(truckAssignments.deviceId, params.deviceId), isNull(truckAssignments.removedAt)))
    .get();

  if (!openAssignment) {
    return { action: 'proceed' };
  }

  if (openAssignment.truckId === params.targetTruckId) {
    return {
      action: 'reject',
      code: 'already_on_this_truck',
      message: 'Device already assigned to this truck',
    };
  }

  return { action: 'blocked', code: 'in_service_elsewhere', currentTruckId: openAssignment.truckId };
}

/**
 * Fail-closed consumption of ConflictCheckResult: proceeds ONLY on the explicit 'proceed'
 * action; throws on every other known action, and on anything else via assertNever's
 * exhaustive switch. Shared by every caller of checkIncomingDeviceConflict (installKit,
 * replaceMotherLock, ...) so a new ConflictCheckResult variant is a single compile error here
 * rather than a silent fall-through wherever the helper happens to be consumed.
 */
export function assertConflictProceeds(conflict: ConflictCheckResult, actionLabel: string): void {
  switch (conflict.action) {
    case 'proceed':
      return;
    case 'reject':
      throw new BusinessError(`Cannot ${actionLabel}: ${conflict.message}`);
    case 'blocked':
      throw new BusinessError(
        `Cannot ${actionLabel}: device is in_service on another truck (${conflict.currentTruckId}); resolve via truck_swap first`,
      );
    default:
      assertNever(conflict, `${actionLabel} swap-conflict check`);
  }
}

// ---------------------------------------------------------------------------
// new_assignment — mother lock assigned to a truck that currently has none (no swap involved).
// ---------------------------------------------------------------------------

export type NewAssignmentInput = {
  orgId: string;
  actorUserId: string;
  truckId: string;
  motherDeviceId: string;
  loggedDate?: number;
};

export function assignMotherToTruck(
  db: DbClient,
  input: NewAssignmentInput,
): { assignmentId: string; movementLogId: string } {
  const conflict = checkIncomingDeviceConflict(db, {
    deviceId: input.motherDeviceId,
    targetTruckId: input.truckId,
  });
  assertConflictProceeds(conflict, 'assign');

  const now = Math.floor(Date.now() / 1000);
  const loggedDate = input.loggedDate ?? now;

  return db.transaction((tx: DbClient) => {
    const assignmentId = createId();
    tx.insert(truckAssignments)
      .values({
        id: assignmentId,
        orgId: input.orgId,
        truckId: input.truckId,
        deviceId: input.motherDeviceId,
        assignedAt: now,
        assignedBy: input.actorUserId,
      })
      .run();

    markInService(tx, { deviceId: input.motherDeviceId, actorUserId: input.actorUserId });

    const movementLogId = createId();
    tx.insert(movementLogs)
      .values({
        id: movementLogId,
        orgId: input.orgId,
        actorUserId: input.actorUserId,
        loggedDate,
        action: 'new_assignment',
        truckId: input.truckId,
        inDeviceId: input.motherDeviceId,
      })
      .run();

    writeMovementAudit(tx, {
      orgId: input.orgId,
      actorUserId: input.actorUserId,
      movementLogId,
      payload: { action: 'new_assignment', truckId: input.truckId, motherDeviceId: input.motherDeviceId },
    });

    return { assignmentId, movementLogId };
  });
}

// ---------------------------------------------------------------------------
// removed_to_inventory / decommissioned — close a truck_assignment with NO replacement.
// This is also swap-resolution (b): "source truck left device-less with an explicit reason".
// ---------------------------------------------------------------------------

export type RemoveDeviceFromTruckInput = {
  orgId: string;
  actorUserId: string;
  motherDeviceId: string;
  reason: RemovalReason;
  disposition?: Disposition;
  notes?: string;
  loggedDate?: number;
};

export function removeDeviceFromTruck(
  db: DbClient,
  input: RemoveDeviceFromTruckInput,
): { movementLogId: string } {
  const openAssignment = db
    .select()
    .from(truckAssignments)
    .where(and(eq(truckAssignments.deviceId, input.motherDeviceId), isNull(truckAssignments.removedAt)))
    .get();
  if (!openAssignment) {
    throw new BusinessError(`Device ${input.motherDeviceId} has no open truck assignment`);
  }

  const now = Math.floor(Date.now() / 1000);
  const loggedDate = input.loggedDate ?? now;
  const action = input.reason === 'decommissioned' ? 'decommissioned' : 'removed_to_inventory';

  return db.transaction((tx: DbClient) => {
    const { disposition } = applyRemoval(tx, {
      deviceId: input.motherDeviceId,
      actorUserId: input.actorUserId,
      reason: input.reason,
      disposition: input.disposition,
    });

    tx.update(truckAssignments)
      .set({
        removedAt: now,
        removedBy: input.actorUserId,
        removalReason: input.reason,
        disposition,
        removalNotes: input.notes,
      })
      .where(eq(truckAssignments.id, openAssignment.id))
      .run();

    const movementLogId = createId();
    tx.insert(movementLogs)
      .values({
        id: movementLogId,
        orgId: input.orgId,
        actorUserId: input.actorUserId,
        loggedDate,
        action,
        truckId: openAssignment.truckId,
        outDeviceId: input.motherDeviceId,
        outReason: input.reason === 'decommissioned' ? 'decommissioned' : input.reason,
        outDisposition: disposition,
        reasonNotes: input.notes,
      })
      .run();

    writeMovementAudit(tx, {
      orgId: input.orgId,
      actorUserId: input.actorUserId,
      movementLogId,
      payload: { action, motherDeviceId: input.motherDeviceId, reason: input.reason, disposition },
    });

    return { movementLogId };
  });
}

/** Thin wrapper: decommissioning is removal with reason forced to 'decommissioned' → retired. */
export function decommissionDevice(
  db: DbClient,
  input: Omit<RemoveDeviceFromTruckInput, 'reason' | 'disposition'>,
): { movementLogId: string } {
  return removeDeviceFromTruck(db, { ...input, reason: 'decommissioned', disposition: 'retired' });
}

// ---------------------------------------------------------------------------
// mother_replacement — close old mother's assignment, open new mother's assignment, same truck.
// ---------------------------------------------------------------------------

export type ReplaceMotherLockInput = {
  orgId: string;
  actorUserId: string;
  truckId: string;
  newMotherDeviceId: string;
  reason: RemovalReason; // why the OLD mother left
  disposition?: Disposition;
  notes?: string;
  loggedDate?: number;
};

export function replaceMotherLock(
  db: DbClient,
  input: ReplaceMotherLockInput,
): { movementLogId: string; newAssignmentId: string } {
  const openAssignment = db
    .select()
    .from(truckAssignments)
    .where(and(eq(truckAssignments.truckId, input.truckId), isNull(truckAssignments.removedAt)))
    .get();
  if (!openAssignment) {
    throw new BusinessError(`Truck ${input.truckId} has no current mother assignment to replace`);
  }

  const conflict = checkIncomingDeviceConflict(db, {
    deviceId: input.newMotherDeviceId,
    targetTruckId: input.truckId,
  });
  assertConflictProceeds(conflict, 'replace mother lock');

  const now = Math.floor(Date.now() / 1000);
  const loggedDate = input.loggedDate ?? now;
  const oldMotherDeviceId = openAssignment.deviceId;

  return db.transaction((tx: DbClient) => {
    const { disposition } = applyRemoval(tx, {
      deviceId: oldMotherDeviceId,
      actorUserId: input.actorUserId,
      reason: input.reason,
      disposition: input.disposition,
    });

    tx.update(truckAssignments)
      .set({
        removedAt: now,
        removedBy: input.actorUserId,
        removalReason: input.reason,
        disposition,
        removalNotes: input.notes,
      })
      .where(eq(truckAssignments.id, openAssignment.id))
      .run();

    const newAssignmentId = createId();
    tx.insert(truckAssignments)
      .values({
        id: newAssignmentId,
        orgId: input.orgId,
        truckId: input.truckId,
        deviceId: input.newMotherDeviceId,
        assignedAt: now,
        assignedBy: input.actorUserId,
      })
      .run();

    markInService(tx, { deviceId: input.newMotherDeviceId, actorUserId: input.actorUserId });

    const movementLogId = createId();
    tx.insert(movementLogs)
      .values({
        id: movementLogId,
        orgId: input.orgId,
        actorUserId: input.actorUserId,
        loggedDate,
        action: 'mother_replacement',
        truckId: input.truckId,
        outDeviceId: oldMotherDeviceId,
        outReason: input.reason === 'decommissioned' ? 'decommissioned' : input.reason,
        outDisposition: disposition,
        inDeviceId: input.newMotherDeviceId,
        reasonNotes: input.notes,
      })
      .run();

    writeMovementAudit(tx, {
      orgId: input.orgId,
      actorUserId: input.actorUserId,
      movementLogId,
      payload: {
        action: 'mother_replacement',
        oldMotherDeviceId,
        newMotherDeviceId: input.newMotherDeviceId,
        reason: input.reason,
        disposition,
      },
    });

    return { movementLogId, newAssignmentId };
  });
}

// ---------------------------------------------------------------------------
// sub_replacement — §6 "ONE action, both sides". Close old slot_pairing, open new, write
// movement_log; IF reason is faulty|damaged, ALSO create a linked fault_report. Non-fault
// reasons (e.g. operational_swap) write NO fault report.
// ---------------------------------------------------------------------------

export type ReplaceSubLockInput = {
  orgId: string;
  actorUserId: string;
  truckId: string; // for the fault_report, if one is created
  motherDeviceId: string;
  slot: 'B' | 'C' | 'D';
  newSubDeviceId: string;
  reason: RemovalReason;
  disposition?: Disposition;
  notes?: string;
  loggedDate?: number;
  // Required when reason is faulty|damaged — becomes the linked fault_report (§6).
  faultDetails?: Omit<
    CreateFaultReportInput,
    'orgId' | 'actorUserId' | 'truckId' | 'deviceId' | 'loggedDate' | 'linkedMovementId'
  >;
};

export type ReplaceSubLockResult = {
  movementLogId: string;
  newPairingId: string;
  faultReportId: string | null;
};

const FAULT_REASONS: ReadonlySet<RemovalReason> = new Set(['faulty', 'damaged']);

export function replaceSubLock(db: DbClient, input: ReplaceSubLockInput): ReplaceSubLockResult {
  const openPairing = db
    .select()
    .from(slotPairings)
    .where(
      and(
        eq(slotPairings.motherDeviceId, input.motherDeviceId),
        eq(slotPairings.slot, input.slot),
        isNull(slotPairings.unpairedAt),
      ),
    )
    .get();
  if (!openPairing) {
    throw new BusinessError(`No open pairing in slot ${input.slot} for mother ${input.motherDeviceId}`);
  }

  const isFaultReason = FAULT_REASONS.has(input.reason);
  if (isFaultReason && !input.faultDetails) {
    throw new BusinessError('faultDetails is required when reason is faulty|damaged');
  }

  const incoming = db.select().from(devices).where(eq(devices.id, input.newSubDeviceId)).get();
  if (!incoming) throw new BusinessError(`Sub device ${input.newSubDeviceId} not found`);
  if (incoming.lifecycleStatus !== 'available') {
    throw new BusinessError(`Incoming sub device is '${incoming.lifecycleStatus}', must be 'available'`);
  }
  const incomingOpenPairing = db
    .select()
    .from(slotPairings)
    .where(and(eq(slotPairings.subDeviceId, input.newSubDeviceId), isNull(slotPairings.unpairedAt)))
    .get();
  if (incomingOpenPairing) {
    throw new BusinessError('Incoming sub device is already paired into another slot');
  }

  const now = Math.floor(Date.now() / 1000);
  const loggedDate = input.loggedDate ?? now;
  const oldSubDeviceId = openPairing.subDeviceId;

  return db.transaction((tx: DbClient) => {
    const { disposition } = applyRemoval(tx, {
      deviceId: oldSubDeviceId,
      actorUserId: input.actorUserId,
      reason: input.reason,
      disposition: input.disposition,
    });

    tx.update(slotPairings)
      .set({
        unpairedAt: now,
        unpairedBy: input.actorUserId,
        removalReason: input.reason,
        disposition,
        removalNotes: input.notes,
      })
      .where(eq(slotPairings.id, openPairing.id))
      .run();

    const newPairingId = createId();
    tx.insert(slotPairings)
      .values({
        id: newPairingId,
        orgId: input.orgId,
        motherDeviceId: input.motherDeviceId,
        slot: input.slot,
        subDeviceId: input.newSubDeviceId,
        pairedAt: now,
        pairedBy: input.actorUserId,
      })
      .run();

    markInService(tx, { deviceId: input.newSubDeviceId, actorUserId: input.actorUserId });

    const movementLogId = createId();
    tx.insert(movementLogs)
      .values({
        id: movementLogId,
        orgId: input.orgId,
        actorUserId: input.actorUserId,
        loggedDate,
        action: 'sub_replacement',
        truckId: input.truckId,
        outDeviceId: oldSubDeviceId,
        outReason: input.reason === 'decommissioned' ? 'decommissioned' : input.reason,
        outDisposition: disposition,
        inDeviceId: input.newSubDeviceId,
        slot: input.slot,
        reasonNotes: input.notes,
      })
      .run();

    // §6: IF reason is faulty|damaged, ALSO create the fault_report, linked via
    // linked_movement_id. Non-fault reasons (operational_swap etc.) write NO fault report —
    // this is the rule that keeps healthy swaps out of fault history.
    let faultReportId: string | null = null;
    if (isFaultReason) {
      faultReportId = insertFaultReport(tx, {
        ...input.faultDetails!,
        orgId: input.orgId,
        actorUserId: input.actorUserId,
        truckId: input.truckId,
        deviceId: oldSubDeviceId,
        loggedDate,
        linkedMovementId: movementLogId,
      });
    }

    writeMovementAudit(tx, {
      orgId: input.orgId,
      actorUserId: input.actorUserId,
      movementLogId,
      payload: {
        action: 'sub_replacement',
        oldSubDeviceId,
        newSubDeviceId: input.newSubDeviceId,
        reason: input.reason,
        disposition,
        faultReportId,
      },
    });

    return { movementLogId, newPairingId, faultReportId };
  });
}

// ---------------------------------------------------------------------------
// truck_swap — resolution (a) of the swap rule: moves BOTH sides in ONE transaction.
// ---------------------------------------------------------------------------

export function resolveTruckSwap(
  tx: DbClient,
  params: { deviceId: string; toTruckId: string; actorUserId: string },
): { movementLogId: string } {
  const openAssignment = tx
    .select()
    .from(truckAssignments)
    .where(and(eq(truckAssignments.deviceId, params.deviceId), isNull(truckAssignments.removedAt)))
    .get();
  if (!openAssignment) {
    throw new BusinessError(`Device ${params.deviceId} has no open assignment to swap from`);
  }

  // Entry assertion: this function is exported and reachable directly, without going through
  // checkIncomingDeviceConflict/assertConflictProceeds first — re-assert here that the
  // destination truck is actually free, so a direct/misused call fails with a clear
  // BusinessError instead of a raw UNIQUE constraint violation from uq_open_assignment_truck.
  const destinationOpenAssignment = tx
    .select()
    .from(truckAssignments)
    .where(and(eq(truckAssignments.truckId, params.toTruckId), isNull(truckAssignments.removedAt)))
    .get();
  if (destinationOpenAssignment) {
    throw new BusinessError(
      `Cannot swap: truck ${params.toTruckId} already has an open assignment (device ${destinationOpenAssignment.deviceId})`,
    );
  }

  const fromTruckId = openAssignment.truckId;
  const now = Math.floor(Date.now() / 1000);

  tx.update(truckAssignments)
    .set({
      removedAt: now,
      removedBy: params.actorUserId,
      removalReason: 'operational_swap',
      disposition: 'available_pool',
    })
    .where(eq(truckAssignments.id, openAssignment.id))
    .run();

  applyRemoval(tx, {
    deviceId: params.deviceId,
    actorUserId: params.actorUserId,
    reason: 'operational_swap',
    disposition: 'available_pool',
  });

  tx.insert(truckAssignments)
    .values({
      id: createId(),
      orgId: openAssignment.orgId,
      truckId: params.toTruckId,
      deviceId: params.deviceId,
      assignedAt: now,
      assignedBy: params.actorUserId,
    })
    .run();

  markInService(tx, { deviceId: params.deviceId, actorUserId: params.actorUserId });

  const movementLogId = createId();
  tx.insert(movementLogs)
    .values({
      id: movementLogId,
      orgId: openAssignment.orgId,
      actorUserId: params.actorUserId,
      loggedDate: now,
      action: 'truck_swap',
      truckId: params.toTruckId,
      inDeviceId: params.deviceId,
      sourceTruckId: fromTruckId,
    })
    .run();

  writeMovementAudit(tx, {
    orgId: openAssignment.orgId,
    actorUserId: params.actorUserId,
    movementLogId,
    payload: { action: 'truck_swap', deviceId: params.deviceId, fromTruckId, toTruckId: params.toTruckId },
  });

  return { movementLogId };
}

// ---------------------------------------------------------------------------
// triage — supervisor only. Wraps lifecycle.service's status transition with the
// movement_log(action='triage') write §6 requires.
// ---------------------------------------------------------------------------

export function applyTriageMovement(
  db: DbClient,
  params: { orgId: string; deviceId: string; actor: AuthenticatedUser; outcome: 'revived' | 'dead' },
): { movementLogId: string } {
  const loggedDate = nowSeconds();

  return db.transaction((tx: DbClient) => {
    applyTriage(tx, { deviceId: params.deviceId, actor: params.actor, outcome: params.outcome });

    const movementLogId = createId();
    tx.insert(movementLogs)
      .values({
        id: movementLogId,
        orgId: params.orgId,
        actorUserId: params.actor.id,
        loggedDate,
        action: 'triage',
        outDeviceId: params.deviceId,
      })
      .run();

    writeMovementAudit(tx, {
      orgId: params.orgId,
      actorUserId: params.actor.id,
      movementLogId,
      payload: { action: 'triage', deviceId: params.deviceId, outcome: params.outcome },
    });

    return { movementLogId };
  });
}

// ---------------------------------------------------------------------------
// changeTruckCompany — §6 "Truck company reassignment (rare, secondary correction path —
// supervisor only)". NOT how company changes normally happen (that's installKit confirming it
// as a byproduct of every install) — this is the out-of-band correction for the back office.
// ---------------------------------------------------------------------------

export type ChangeTruckCompanyInput = {
  orgId: string;
  truckId: string;
  company: TruckCompany;
  actor: AuthenticatedUser;
  notes?: string;
  loggedDate?: number;
};

export function changeTruckCompany(
  db: DbClient,
  input: ChangeTruckCompanyInput,
): { movementLogId: string; truckCompanyAssignmentId: string } {
  requireSupervisor(input.actor);

  const currentAssignment = db
    .select()
    .from(truckCompanyAssignments)
    .where(and(eq(truckCompanyAssignments.truckId, input.truckId), isNull(truckCompanyAssignments.removedAt)))
    .get() as { id: string; company: TruckCompany } | undefined;

  const now = nowSeconds();
  const loggedDate = input.loggedDate ?? now;

  return db.transaction((tx: DbClient) => {
    if (currentAssignment) {
      tx.update(truckCompanyAssignments)
        .set({ removedAt: now, removedBy: input.actor.id })
        .where(eq(truckCompanyAssignments.id, currentAssignment.id))
        .run();
    }

    const truckCompanyAssignmentId = createId();
    tx.insert(truckCompanyAssignments)
      .values({
        id: truckCompanyAssignmentId,
        orgId: input.orgId,
        truckId: input.truckId,
        company: input.company,
        assignedAt: now,
        assignedBy: input.actor.id,
      })
      .run();

    const movementLogId = createId();
    tx.insert(movementLogs)
      .values({
        id: movementLogId,
        orgId: input.orgId,
        actorUserId: input.actor.id,
        loggedDate,
        action: 'company_reassignment',
        truckId: input.truckId,
        reasonNotes: input.notes,
      })
      .run();

    writeMovementAudit(tx, {
      orgId: input.orgId,
      actorUserId: input.actor.id,
      movementLogId,
      payload: {
        action: 'company_reassignment',
        truckId: input.truckId,
        fromCompany: currentAssignment?.company ?? null,
        toCompany: input.company,
      },
    });

    return { movementLogId, truckCompanyAssignmentId };
  });
}

// ---------------------------------------------------------------------------
// dispatchMovementAction — the ONE place that maps a validated MovementActionFormValues onto
// the matching function above. Both app/api/movements/route.ts and sync.service.ts (offline
// replay) call this instead of duplicating the switch — "services already exist, reuse them."
// ---------------------------------------------------------------------------

export function dispatchMovementAction(
  db: DbClient,
  params: { orgId: string; actorUserId: string; action: MovementActionFormValues },
): unknown {
  const { action, orgId, actorUserId } = params;

  switch (action.kind) {
    case 'new_assignment':
      return assignMotherToTruck(db, {
        orgId,
        actorUserId,
        truckId: action.truckId,
        motherDeviceId: action.motherDeviceId,
      });
    case 'removed_to_inventory':
      return removeDeviceFromTruck(db, {
        orgId,
        actorUserId,
        motherDeviceId: action.motherDeviceId,
        reason: action.reason,
        disposition: action.disposition,
        notes: action.notes,
      });
    case 'decommissioned':
      return decommissionDevice(db, {
        orgId,
        actorUserId,
        motherDeviceId: action.motherDeviceId,
        notes: action.notes,
      });
    case 'mother_replacement':
      return replaceMotherLock(db, {
        orgId,
        actorUserId,
        truckId: action.truckId,
        newMotherDeviceId: action.newMotherDeviceId,
        reason: action.reason,
        disposition: action.disposition,
        notes: action.notes,
      });
    case 'sub_replacement':
      return replaceSubLock(db, {
        orgId,
        actorUserId,
        truckId: action.truckId,
        motherDeviceId: action.motherDeviceId,
        slot: action.slot,
        newSubDeviceId: action.newSubDeviceId,
        reason: action.reason,
        disposition: action.disposition,
        notes: action.notes,
        faultDetails: action.faultDetails,
      });
    case 'truck_swap':
      // resolveTruckSwap composes into a caller transaction — db.transaction() here becomes a
      // nested SAVEPOINT when db is already a transaction handle (e.g. sync.service.ts's outer
      // ack-and-apply transaction), which drizzle's better-sqlite3 driver supports natively.
      return db.transaction((tx: DbClient) =>
        resolveTruckSwap(tx, { deviceId: action.deviceId, toTruckId: action.toTruckId, actorUserId }),
      );
    default:
      return assertNever(action, 'dispatchMovementAction');
  }
}
