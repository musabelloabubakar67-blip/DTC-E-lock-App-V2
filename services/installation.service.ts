// §6 "Installation slots the kit and assigns the truck, atomically". Device-to-truck: the
// swap-conflict helper runs on the incoming mother serial FIRST, slots are assigned
// positionally (C1→B, C2→C, C3→D), device(s) go in_service, all in one transaction.
//
// Requires an already-registered `available` mother. There is deliberately NO inline
// registration at install time (§6) — registration and installation are distinct events (§2),
// and inline registration would fabricate a kit with no sub-pairing/config/sim. An unregistered
// handheld device goes through register-then-install; a device found already mounted with no
// registration record is handled by the verification mismatch flow (§3), not by this function.
import { and, desc, eq, isNull } from 'drizzle-orm';
import { createId } from '@paralleldrive/cuid2';
import {
  devices,
  truckAssignments,
  slotPairings,
  installationLogs,
  auditLog,
  trucks,
  users,
  truckCompanyAssignments,
} from '../db/schema';
import { BusinessError } from '../lib/errors';
import { checkIncomingDeviceConflict, assertConflictProceeds } from './movement.service';
import { markInService } from './lifecycle.service';

export type TruckCompany = 'mrs' | 'dangote';

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type DbClient = any; // drizzle db or transaction handle — identical query surface for our purposes.

// Positional slot assignment per the install log's fixed columns (§2, §6).
const POSITIONAL_SLOTS = ['B', 'C', 'D'] as const;

export type InstallationChecklist = {
  batteryLevel?: 'full' | 'adequate' | 'low' | 'dead';
  physicalDamage?: 'none' | 'minor' | 'significant';
  deviceResponsive?: 'yes' | 'no';
  sublocksResponsive?: 'yes' | 'no';
  configConfirmed?: 'yes' | 'no' | 'changed'; // config section RE-CHECKS registration (§6)
  configNotes?: string;
  btUnlockDone?: 'yes' | 'no';
  onlineAfter?: 'yes' | 'no' | 'intermittent';
  motherLocked?: 'yes' | 'no';
  motherSecured?: 'yes' | 'no';
  sublocksLocked?: 'all' | 'partial' | 'none';
  sublocksSecured?: 'yes' | 'no';
  overallStatus?: 'successful' | 'completed_with_issues' | 'failed';
  issuesNotes?: string;
};

export type InstallKitInput = {
  installMode?: 'same_kit' | 'changed';
  orgId: string;
  actorUserId: string;
  truckId: string;
  motherDeviceId: string;
  subDeviceIds: [string, string, string]; // positional: index 0→B, 1→C, 2→D
  loggedDate?: number;
  checklist?: InstallationChecklist;
  // §2/§6: confirmed at EVERY install (installKit only — see installKit's own doc comment).
  // Optional at the type level because recordSameKitInstallation doesn't use it; installKit
  // itself throws if it's missing, same as any other required-but-untyped-here business rule.
  company?: TruckCompany;
};

export type InstallKitResult = {
  assignmentId: string;
  slotPairingIds: string[];
  installationLogId: string;
  // Present only when this install actually wrote a new truck_company_assignments row (§6:
  // "no change" → no write → this stays null, not just omitted, so callers can tell the
  // difference between "unchanged" and "not applicable").
  truckCompanyAssignmentId: string | null;
};

export type InstallationHistoryItem = {
  id: string;
  loggedDate: number;
  truckId: string;
  truckLabel: string;
  motherSerial: string;
  subSerials: string[];
  overallStatus: InstallationChecklist['overallStatus'] | null;
  actorName: string | null;
};

export function recordInstallation(db: DbClient, input: InstallKitInput): InstallKitResult {
  if (input.installMode === 'same_kit') {
    return recordSameKitInstallation(db, input);
  }

  return installKit(db, input);
}

function recordSameKitInstallation(db: DbClient, input: InstallKitInput): InstallKitResult {
  const mother = db.select().from(devices).where(eq(devices.id, input.motherDeviceId)).get();
  if (!mother) throw new BusinessError(`Mother device ${input.motherDeviceId} not found`);
  if (mother.deviceType !== 'mother') {
    throw new BusinessError(`Device ${input.motherDeviceId} is not a mother lock`);
  }
  if (mother.ownershipStatus === 'released_external') {
    throw new BusinessError(`Mother device ${input.motherDeviceId} has been released externally`);
  }

  const assignment = db
    .select()
    .from(truckAssignments)
    .where(
      and(
        eq(truckAssignments.truckId, input.truckId),
        eq(truckAssignments.deviceId, input.motherDeviceId),
        isNull(truckAssignments.removedAt),
      ),
    )
    .get();

  if (!assignment) {
    throw new BusinessError('Cannot record same-kit install: truck does not have this open kit assignment');
  }

  const openPairings = db
    .select()
    .from(slotPairings)
    .where(and(eq(slotPairings.motherDeviceId, input.motherDeviceId), isNull(slotPairings.unpairedAt)))
    .all() as Array<{ id: string; slot: 'B' | 'C' | 'D'; subDeviceId: string }>;

  const slotPairingIds = POSITIONAL_SLOTS.map((slot, index) => {
    const pairing = openPairings.find((row) => row.slot === slot);
    if (!pairing || pairing.subDeviceId !== input.subDeviceIds[index]) {
      throw new BusinessError(`Cannot record same-kit install: slot ${slot} no longer matches the current assignment`);
    }
    return pairing.id;
  });

  const now = Math.floor(Date.now() / 1000);
  const loggedDate = input.loggedDate ?? now;

  return db.transaction((tx: DbClient) => {
    const installationLogId = createId();
    tx.insert(installationLogs)
      .values({
        id: installationLogId,
        orgId: input.orgId,
        truckId: input.truckId,
        motherDeviceId: input.motherDeviceId,
        assignmentId: assignment.id,
        actorUserId: input.actorUserId,
        loggedDate,
        ...input.checklist,
      })
      .run();

    tx.insert(auditLog)
      .values({
        id: createId(),
        orgId: input.orgId,
        actorUserId: input.actorUserId,
        entityTable: 'installation_logs',
        entityId: installationLogId,
        operation: 'create',
        afterJson: JSON.stringify({ assignmentId: assignment.id, slotPairingIds, truckId: input.truckId, installMode: 'same_kit' }),
      })
      .run();

    return { assignmentId: assignment.id, slotPairingIds, installationLogId, truckCompanyAssignmentId: null };
  });
}

/**
 * One transaction: run the swap-conflict helper on the incoming mother serial, open
 * truck_assignment, open slot_pairings (positional), set mother + subs in_service,
 * write installation_logs + audit — AND (§2/§6) confirm the truck's serving company as a
 * byproduct of this same install, folded into the same atomic write, never a second
 * transaction.
 *
 * Validates + computes BEFORE opening the transaction, per the §7 transaction pattern.
 */
export function installKit(db: DbClient, input: InstallKitInput): InstallKitResult {
  const mother = db.select().from(devices).where(eq(devices.id, input.motherDeviceId)).get();
  if (!mother) throw new BusinessError(`Mother device ${input.motherDeviceId} not found`);
  if (mother.deviceType !== 'mother') {
    throw new BusinessError(`Device ${input.motherDeviceId} is not a mother lock`);
  }
  if (mother.ownershipStatus === 'released_external') {
    throw new BusinessError(`Mother device ${input.motherDeviceId} has been released externally`);
  }

  if (input.subDeviceIds.length !== 3) {
    throw new BusinessError('Exactly 3 sub-lock devices are required (positional B/C/D)');
  }
  for (const subDeviceId of input.subDeviceIds) {
    const sub = db.select().from(devices).where(eq(devices.id, subDeviceId)).get();
    if (!sub) throw new BusinessError(`Sub-lock device ${subDeviceId} not found`);
    if (sub.ownershipStatus === 'released_external') {
      throw new BusinessError(`Sub-lock device ${subDeviceId} has been released externally`);
    }
  }

  // §6 "Company field is ALWAYS shown and ALWAYS required on the install form" — enforced here
  // too (defense in depth), not just by the Zod schema at the route boundary.
  if (!input.company) {
    throw new BusinessError('Serving company is required on every install');
  }

  // §6 "the swap rule" — look up incoming serial FIRST, shared helper with movement.service.ts.
  // assertConflictProceeds is fail-closed: only the explicit 'proceed' action is allowed
  // through; every other action throws, including anything outside the known union.
  const conflict = checkIncomingDeviceConflict(db, {
    deviceId: input.motherDeviceId,
    targetTruckId: input.truckId,
  });
  assertConflictProceeds(conflict, 'install');

  const now = Math.floor(Date.now() / 1000);
  const loggedDate = input.loggedDate ?? now;

  return db.transaction((tx: DbClient) => {
    // §6 "Company confirmation at installation (every install, not once)": read the truck's
    // CURRENT open span from inside THIS transaction — never trust a client "unchanged" signal,
    // and never read it outside the transaction where it could go stale before the writes below
    // commit. Compare against what the tech submitted; write only when they actually differ.
    const currentCompanyAssignment = tx
      .select()
      .from(truckCompanyAssignments)
      .where(and(eq(truckCompanyAssignments.truckId, input.truckId), isNull(truckCompanyAssignments.removedAt)))
      .get() as { id: string; company: TruckCompany } | undefined;

    let truckCompanyAssignmentId: string | null = null;
    if (!currentCompanyAssignment || currentCompanyAssignment.company !== input.company) {
      if (currentCompanyAssignment) {
        tx.update(truckCompanyAssignments)
          .set({ removedAt: now, removedBy: input.actorUserId })
          .where(eq(truckCompanyAssignments.id, currentCompanyAssignment.id))
          .run();
      }
      truckCompanyAssignmentId = createId();
      tx.insert(truckCompanyAssignments)
        .values({
          id: truckCompanyAssignmentId,
          orgId: input.orgId,
          truckId: input.truckId,
          company: input.company,
          assignedAt: now,
          assignedBy: input.actorUserId,
        })
        .run();
    }
    // Else: submitted value matches the current open span exactly — no-op read-confirm, zero
    // rows touched in truck_company_assignments.

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

    const slotPairingIds: string[] = [];
    input.subDeviceIds.forEach((subDeviceId, index) => {
      const slot = POSITIONAL_SLOTS[index];
      const slotPairingId = createId();
      tx.insert(slotPairings)
        .values({
          id: slotPairingId,
          orgId: input.orgId,
          motherDeviceId: input.motherDeviceId,
          slot,
          subDeviceId,
          pairedAt: now,
          pairedBy: input.actorUserId,
        })
        .run();
      slotPairingIds.push(slotPairingId);

      markInService(tx, { deviceId: subDeviceId, actorUserId: input.actorUserId });
    });

    markInService(tx, { deviceId: input.motherDeviceId, actorUserId: input.actorUserId });

    const installationLogId = createId();
    tx.insert(installationLogs)
      .values({
        id: installationLogId,
        orgId: input.orgId,
        truckId: input.truckId,
        motherDeviceId: input.motherDeviceId,
        assignmentId,
        actorUserId: input.actorUserId,
        loggedDate,
        ...input.checklist,
      })
      .run();

    tx.insert(auditLog)
      .values({
        id: createId(),
        orgId: input.orgId,
        actorUserId: input.actorUserId,
        entityTable: 'installation_logs',
        entityId: installationLogId,
        operation: 'create',
        afterJson: JSON.stringify({
          assignmentId,
          slotPairingIds,
          truckId: input.truckId,
          company: input.company,
          truckCompanyAssignmentId,
        }),
      })
      .run();

    return { assignmentId, slotPairingIds, installationLogId, truckCompanyAssignmentId };
  });
}

export function listInstallationHistory(db: DbClient, orgId: string, limit?: number): InstallationHistoryItem[] {
  const rows = (
    db
      .select()
      .from(installationLogs)
      .where(eq(installationLogs.orgId, orgId))
      .orderBy(desc(installationLogs.loggedDate))
      .all() as Array<{
      id: string;
      truckId: string;
      motherDeviceId: string;
      assignmentId: string;
      actorUserId: string;
      loggedDate: number;
      overallStatus: InstallationChecklist['overallStatus'] | null;
    }>
  );
  const visibleRows = typeof limit === 'number' ? rows.slice(0, limit) : rows;

  const truckRows = db
    .select({ id: trucks.id, plate: trucks.plate })
    .from(trucks)
    .where(eq(trucks.orgId, orgId))
    .all() as Array<{ id: string; plate: string }>;
  const plateByTruckId = new Map(truckRows.map((truck) => [truck.id, truck.plate]));

  const deviceRows = db
    .select({ id: devices.id, serial: devices.serial })
    .from(devices)
    .where(eq(devices.orgId, orgId))
    .all() as Array<{ id: string; serial: string }>;
  const serialByDeviceId = new Map(deviceRows.map((device) => [device.id, device.serial]));

  const assignmentRows = db
    .select({ id: truckAssignments.id, assignedAt: truckAssignments.assignedAt })
    .from(truckAssignments)
    .where(eq(truckAssignments.orgId, orgId))
    .all() as Array<{ id: string; assignedAt: number }>;
  const assignedAtByAssignmentId = new Map(assignmentRows.map((assignment) => [assignment.id, assignment.assignedAt]));

  const slotRows = db
    .select({ motherDeviceId: slotPairings.motherDeviceId, pairedAt: slotPairings.pairedAt, subDeviceId: slotPairings.subDeviceId })
    .from(slotPairings)
    .where(eq(slotPairings.orgId, orgId))
    .all() as Array<{ motherDeviceId: string; pairedAt: number; subDeviceId: string }>;
  const subIdsByMotherAndPairedAt = new Map<string, string[]>();
  for (const slot of slotRows) {
    const key = `${slot.motherDeviceId}:${slot.pairedAt}`;
    const current = subIdsByMotherAndPairedAt.get(key) ?? [];
    current.push(slot.subDeviceId);
    subIdsByMotherAndPairedAt.set(key, current);
  }

  const auditRows = db
    .select({ entityId: auditLog.entityId, afterJson: auditLog.afterJson })
    .from(auditLog)
    .where(and(eq(auditLog.orgId, orgId), eq(auditLog.entityTable, 'installation_logs')))
    .all() as Array<{ entityId: string; afterJson: string }>;
  const sourceSubsByInstallId = new Map<string, string[]>();
  for (const audit of auditRows) {
    const subs = parseInstallSourceSubs(audit.afterJson);
    if (subs.length > 0 && !sourceSubsByInstallId.has(audit.entityId)) {
      sourceSubsByInstallId.set(audit.entityId, subs);
    }
  }

  const userRows = db
    .select({ id: users.id, displayName: users.displayName })
    .from(users)
    .where(eq(users.orgId, orgId))
    .all() as Array<{ id: string; displayName: string }>;
  const actorNameById = new Map(userRows.map((user) => [user.id, user.displayName]));

  return visibleRows.map((row) => {
    const pairedAt = assignedAtByAssignmentId.get(row.assignmentId) ?? row.loggedDate;
    const reconstructedSubSerials = (subIdsByMotherAndPairedAt.get(`${row.motherDeviceId}:${pairedAt}`) ?? [])
      .map((subDeviceId) => serialByDeviceId.get(subDeviceId))
      .filter((serial: string | undefined): serial is string => Boolean(serial));
    const subSerials = sourceSubsByInstallId.get(row.id) ?? uniqueStrings(reconstructedSubSerials);

    return {
      id: row.id,
      loggedDate: row.loggedDate,
      truckId: row.truckId,
      truckLabel: plateByTruckId.get(row.truckId) ?? row.truckId,
      motherSerial: serialByDeviceId.get(row.motherDeviceId) ?? row.motherDeviceId,
      subSerials,
      overallStatus: row.overallStatus,
      actorName: actorNameById.get(row.actorUserId) ?? null,
    };
  });
}

function parseInstallSourceSubs(afterJson: string): string[] {
  try {
    const payload = JSON.parse(afterJson) as { subs?: unknown };
    if (!Array.isArray(payload.subs)) return [];
    return uniqueStrings(payload.subs.filter((value): value is string => typeof value === 'string').map((value) => value.trim()).filter(Boolean));
  } catch {
    return [];
  }
}

function uniqueStrings(values: string[]): string[] {
  const seen = new Set<string>();
  const result: string[] = [];
  for (const value of values) {
    if (seen.has(value)) continue;
    seen.add(value);
    result.push(value);
  }
  return result;
}
