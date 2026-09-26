import { and, eq, isNull } from 'drizzle-orm';
import { createId } from '@paralleldrive/cuid2';
import {
  auditLog,
  devices,
  movementLogs,
  slotPairings,
  truckAssignments,
  trucks,
} from '../db/schema';
import { BusinessError } from '../lib/errors';
import type { RepairBatchFormValues } from '../lib/validations/repair';
import { insertFaultReport } from './fault.service';
import { applyRemoval, markInService } from './lifecycle.service';

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type DbClient = any;
type Position = RepairBatchFormValues['items'][number]['position'];

type DeviceRow = {
  id: string;
  orgId: string;
  deviceType: 'mother' | 'sub';
  serial: string;
  lifecycleStatus: string;
  ownershipStatus: string;
};

export type RepairBatchResult = {
  truckId: string;
  truckPlate: string;
  kitIncomplete: boolean;
  operations: Array<{
    position: Position;
    removedSerial: string;
    replacementSerial: string | null;
    movementLogId: string;
    faultReportId: string;
  }>;
};

function normalize(value: string): string {
  return value.trim().toUpperCase();
}

function positionLabel(position: Position): string {
  return position === 'mother' ? 'Mother lock' : `Sub-lock ${position}`;
}

function writeMovementAudit(
  tx: DbClient,
  input: {
    orgId: string;
    actorUserId: string;
    movementLogId: string;
    payload: unknown;
  },
): void {
  tx.insert(auditLog)
    .values({
      id: createId(),
      orgId: input.orgId,
      actorUserId: input.actorUserId,
      entityTable: 'movement_logs',
      entityId: input.movementLogId,
      operation: 'create',
      afterJson: JSON.stringify(input.payload),
    })
    .run();
}

function writeAudit(
  tx: DbClient,
  input: { orgId: string; actorUserId: string; entityTable: string; entityId: string; operation: 'create' | 'transition'; before?: unknown; after: unknown },
): void {
  tx.insert(auditLog)
    .values({
      id: createId(),
      orgId: input.orgId,
      actorUserId: input.actorUserId,
      entityTable: input.entityTable,
      entityId: input.entityId,
      operation: input.operation,
      beforeJson: input.before === undefined ? null : JSON.stringify(input.before),
      afterJson: JSON.stringify(input.after),
    })
    .run();
}

// The installer is physically holding the replacement, so the records bend to the scan:
// unknown serials are registered, stale pairings elsewhere are released, and a lock still
// marked for repair is returned to service. Every correction is audited.
function claimIncomingDevice(
  tx: DbClient,
  input: {
    orgId: string;
    actorUserId: string;
    serial: string;
    expectedType: 'mother' | 'sub';
    truckId: string;
    currentMotherId: string;
    truckPlate: string;
  },
): DeviceRow {
  const serial = normalize(input.serial);
  const now = Math.floor(Date.now() / 1000);
  let device = tx
    .select()
    .from(devices)
    .where(and(eq(devices.orgId, input.orgId), eq(devices.serial, serial)))
    .get() as DeviceRow | undefined;

  if (!device) {
    const id = createId();
    tx.insert(devices)
      .values({
        id,
        orgId: input.orgId,
        deviceType: input.expectedType,
        serial,
        lifecycleStatus: 'available',
        registeredAt: now,
        registeredBy: input.actorUserId,
        origin: 'discovered',
        notes: `Scanned as a repair replacement on ${input.truckPlate}; never previously registered.`,
      })
      .run();
    writeAudit(tx, {
      orgId: input.orgId,
      actorUserId: input.actorUserId,
      entityTable: 'devices',
      entityId: id,
      operation: 'create',
      after: { serial, deviceType: input.expectedType, origin: 'discovered', via: 'repair_replacement_unregistered', truckPlate: input.truckPlate },
    });
    return tx.select().from(devices).where(eq(devices.id, id)).get() as DeviceRow;
  }

  if (device.deviceType !== input.expectedType) {
    throw new BusinessError(`${serial} is a ${device.deviceType} device, not ${input.expectedType}`);
  }
  if (device.ownershipStatus !== 'owned') {
    throw new BusinessError(`Replacement device ${serial} is released externally`);
  }

  const logRelease = (sourceTruckId: string | null, slot: 'B' | 'C' | 'D' | null, disposition: string) => {
    const movementLogId = createId();
    tx.insert(movementLogs)
      .values({
        id: movementLogId,
        orgId: input.orgId,
        actorUserId: input.actorUserId,
        loggedDate: now,
        action: 'unlogged_swap_detected',
        truckId: sourceTruckId,
        outDeviceId: device!.id,
        outReason: 'operational_swap',
        outDisposition: disposition,
        slot,
        notes: `Scanned as a repair replacement on ${input.truckPlate}`,
      })
      .run();
    writeMovementAudit(tx, {
      orgId: input.orgId,
      actorUserId: input.actorUserId,
      movementLogId,
      payload: { action: 'unlogged_swap_detected', sourceTruckId, targetTruckId: input.truckId, outDeviceId: device!.id, slot, source: 'repair_replacement_scan' },
    });
  };

  if (device.deviceType === 'sub') {
    const pairing = tx
      .select()
      .from(slotPairings)
      .where(and(eq(slotPairings.subDeviceId, device.id), isNull(slotPairings.unpairedAt)))
      .get() as { id: string; motherDeviceId: string; slot: 'B' | 'C' | 'D' } | undefined;
    if (pairing) {
      if (pairing.motherDeviceId === input.currentMotherId) {
        throw new BusinessError(`Replacement sub-lock ${serial} is already on this truck in slot ${pairing.slot}`);
      }
      const source = tx
        .select({ truckId: truckAssignments.truckId })
        .from(truckAssignments)
        .where(and(eq(truckAssignments.deviceId, pairing.motherDeviceId), isNull(truckAssignments.removedAt)))
        .get() as { truckId: string } | undefined;
      const { disposition } = applyRemoval(tx, { deviceId: device.id, actorUserId: input.actorUserId, reason: 'operational_swap', disposition: 'available_pool' });
      tx.update(slotPairings)
        .set({ unpairedAt: now, unpairedBy: input.actorUserId, removalReason: 'operational_swap', disposition, removalNotes: `Scanned as a repair replacement on ${input.truckPlate}` })
        .where(eq(slotPairings.id, pairing.id))
        .run();
      logRelease(source?.truckId ?? null, pairing.slot, disposition);
    }
  } else {
    const assignment = tx
      .select()
      .from(truckAssignments)
      .where(and(eq(truckAssignments.deviceId, device.id), isNull(truckAssignments.removedAt)))
      .get() as { id: string; truckId: string } | undefined;
    if (assignment) {
      if (assignment.truckId === input.truckId) {
        throw new BusinessError(`${serial} is already installed in ${positionLabel('mother')}`);
      }
      const { disposition } = applyRemoval(tx, { deviceId: device.id, actorUserId: input.actorUserId, reason: 'operational_swap', disposition: 'available_pool' });
      tx.update(truckAssignments)
        .set({ removedAt: now, removedBy: input.actorUserId, removalReason: 'operational_swap', disposition, removalNotes: `Scanned as a repair replacement on ${input.truckPlate}` })
        .where(eq(truckAssignments.id, assignment.id))
        .run();
      logRelease(assignment.truckId, null, disposition);
    }
  }

  device = tx.select().from(devices).where(eq(devices.id, device.id)).get() as DeviceRow;
  if (device.lifecycleStatus === 'repair' || device.lifecycleStatus === 'in_service') {
    tx.update(devices)
      .set({ lifecycleStatus: 'available', updatedAt: now })
      .where(eq(devices.id, device.id))
      .run();
    writeAudit(tx, {
      orgId: input.orgId,
      actorUserId: input.actorUserId,
      entityTable: 'devices',
      entityId: device.id,
      operation: 'transition',
      before: { lifecycleStatus: device.lifecycleStatus },
      after: { lifecycleStatus: 'available', via: 'repair_replacement_scan', truckPlate: input.truckPlate },
    });
    device = { ...device, lifecycleStatus: 'available' };
  } else if (device.lifecycleStatus !== 'available') {
    throw new BusinessError(`Replacement device ${serial} is '${device.lifecycleStatus}', not available`);
  }
  return device;
}

export function executeRepairBatch(
  db: DbClient,
  input: {
    orgId: string;
    actorUserId: string;
    repair: RepairBatchFormValues;
  },
): RepairBatchResult {
  const truckReference = input.repair.truck.trim();
  const truck = db
    .select({ id: trucks.id, plate: trucks.plate })
    .from(trucks)
    .where(
      and(
        eq(trucks.orgId, input.orgId),
        truckReference.startsWith('trk_')
          ? eq(trucks.id, truckReference)
          : eq(trucks.plate, normalize(truckReference)),
      ),
    )
    .get() as { id: string; plate: string } | undefined;
  if (!truck) throw new BusinessError(`Truck ${normalize(truckReference)} is not registered`);

  const currentAssignment = db
    .select()
    .from(truckAssignments)
    .where(and(eq(truckAssignments.truckId, truck.id), isNull(truckAssignments.removedAt)))
    .get();
  if (!currentAssignment) {
    throw new BusinessError(`Truck ${truck.plate} has no current kit to repair`);
  }

  const currentMother = db
    .select()
    .from(devices)
    .where(eq(devices.id, currentAssignment.deviceId))
    .get() as DeviceRow | undefined;
  if (!currentMother) throw new BusinessError('Current mother device was not found');

  const openPairings = db
    .select()
    .from(slotPairings)
    .where(
      and(
        eq(slotPairings.motherDeviceId, currentMother.id),
        isNull(slotPairings.unpairedAt),
      ),
    )
    .all() as Array<{
      id: string;
      slot: 'B' | 'C' | 'D';
      subDeviceId: string;
    }>;
  const pairingBySlot = new Map(openPairings.map((pairing) => [pairing.slot, pairing]));

  const itemByPosition = new Map(input.repair.items.map((item) => [item.position, item]));
  const outgoingByPosition = new Map<Position, DeviceRow>();
  for (const item of input.repair.items) {
    if (item.position === 'mother') {
      outgoingByPosition.set('mother', currentMother);
      continue;
    }
    const pairing = pairingBySlot.get(item.position);
    if (!pairing) throw new BusinessError(`Truck ${truck.plate} has no device in slot ${item.position}`);
    const device = db.select().from(devices).where(eq(devices.id, pairing.subDeviceId)).get() as DeviceRow | undefined;
    if (!device) throw new BusinessError(`Current sub-lock ${item.position} was not found`);
    outgoingByPosition.set(item.position, device);
  }

  const motherSelected = itemByPosition.has('mother');
  if (motherSelected && !itemByPosition.get('mother')?.replacementSerial) {
    const hasIncomingSub = input.repair.items.some(
      (item) => item.position !== 'mother' && Boolean(item.replacementSerial),
    );
    if (hasIncomingSub) {
      throw new BusinessError('Sub-lock replacements require a mother lock to remain installed');
    }
  }

  const now = Math.floor(Date.now() / 1000);
  const operations: RepairBatchResult['operations'] = [];

  return db.transaction((tx: DbClient) => {
    const incomingByPosition = new Map<Position, DeviceRow>();
    for (const item of input.repair.items) {
      if (!item.replacementSerial) continue;
      const serial = normalize(item.replacementSerial);
      if (serial === outgoingByPosition.get(item.position)?.serial.toUpperCase()) {
        throw new BusinessError(`${serial} is already installed in ${positionLabel(item.position)}`);
      }
      incomingByPosition.set(item.position, claimIncomingDevice(tx, {
        orgId: input.orgId,
        actorUserId: input.actorUserId,
        serial,
        expectedType: item.position === 'mother' ? 'mother' : 'sub',
        truckId: truck.id,
        currentMotherId: currentMother.id,
        truckPlate: truck.plate,
      }));
    }
    const incomingMother = incomingByPosition.get('mother');
    const targetMotherId = motherSelected ? incomingMother?.id ?? null : currentMother.id;

    for (const pairing of openPairings) {
      const selected = itemByPosition.has(pairing.slot);
      const transferring = motherSelected && Boolean(targetMotherId) && !selected;
      if (!selected && !transferring) continue;

      tx.update(slotPairings)
        .set({
          unpairedAt: now,
          unpairedBy: input.actorUserId,
          removalReason: selected ? input.repair.reason : 'operational_swap',
          disposition: selected ? 'repair_pool' : null,
          removalNotes: selected ? input.repair.notes : 'Transferred during mother replacement',
        })
        .where(eq(slotPairings.id, pairing.id))
        .run();

      if (selected) {
        applyRemoval(tx, {
          deviceId: pairing.subDeviceId,
          actorUserId: input.actorUserId,
          reason: input.repair.reason,
          disposition: 'repair_pool',
        });
      }
    }

    if (motherSelected) {
      applyRemoval(tx, {
        deviceId: currentMother.id,
        actorUserId: input.actorUserId,
        reason: input.repair.reason,
        disposition: 'repair_pool',
      });
      tx.update(truckAssignments)
        .set({
          removedAt: now,
          removedBy: input.actorUserId,
          removalReason: input.repair.reason,
          disposition: 'repair_pool',
          removalNotes: input.repair.notes,
        })
        .where(eq(truckAssignments.id, currentAssignment.id))
        .run();

      if (incomingMother) {
        tx.insert(truckAssignments)
          .values({
            id: createId(),
            orgId: input.orgId,
            truckId: truck.id,
            deviceId: incomingMother.id,
            assignedAt: now,
            assignedBy: input.actorUserId,
          })
          .run();
        markInService(tx, { deviceId: incomingMother.id, actorUserId: input.actorUserId });
      }
    }

    if (targetMotherId) {
      for (const pairing of openPairings) {
        const selected = itemByPosition.has(pairing.slot);
        const incoming = incomingByPosition.get(pairing.slot);
        const subDeviceId = selected ? incoming?.id : pairing.subDeviceId;
        if (!subDeviceId || (!selected && !motherSelected)) continue;

        tx.insert(slotPairings)
          .values({
            id: createId(),
            orgId: input.orgId,
            motherDeviceId: targetMotherId,
            slot: pairing.slot,
            subDeviceId,
            pairedAt: now,
            pairedBy: input.actorUserId,
          })
          .run();
        if (selected && incoming) {
          markInService(tx, { deviceId: incoming.id, actorUserId: input.actorUserId });
        }
      }
    }

    for (const item of input.repair.items) {
      const outgoing = outgoingByPosition.get(item.position)!;
      const incoming = incomingByPosition.get(item.position);
      const movementLogId = createId();
      tx.insert(movementLogs)
        .values({
          id: movementLogId,
          orgId: input.orgId,
          actorUserId: input.actorUserId,
          loggedDate: now,
          action: item.position === 'mother'
            ? incoming ? 'mother_replacement' : 'removed_to_inventory'
            : 'sub_replacement',
          truckId: truck.id,
          outDeviceId: outgoing.id,
          outReason: input.repair.reason,
          outDisposition: 'repair_pool',
          inDeviceId: incoming?.id,
          slot: item.position === 'mother' ? null : item.position,
          reasonNotes: input.repair.notes,
        })
        .run();

      const faultReportId = insertFaultReport(tx, {
        orgId: input.orgId,
        actorUserId: input.actorUserId,
        truckId: truck.id,
        deviceId: outgoing.id,
        loggedDate: now,
        faultType: input.repair.reason === 'damaged' ? 'hardware_damage' : 'other',
        locksAffected: [item.position === 'mother' ? 'MOTHER' : item.position],
        description: input.repair.description,
        resolution: incoming ? 'device_replaced' : 'pending',
        followupRequired: incoming ? 'no' : 'yes',
        incidentStatus: incoming ? 'closed' : 'open_pending_followup',
        linkedMovementId: movementLogId,
        notes: input.repair.notes,
      });

      writeMovementAudit(tx, {
        orgId: input.orgId,
        actorUserId: input.actorUserId,
        movementLogId,
        payload: {
          action: 'repair_batch',
          position: item.position,
          truckId: truck.id,
          removedDeviceId: outgoing.id,
          replacementDeviceId: incoming?.id ?? null,
          reason: input.repair.reason,
          faultReportId,
        },
      });

      operations.push({
        position: item.position,
        removedSerial: outgoing.serial,
        replacementSerial: incoming?.serial ?? null,
        movementLogId,
        faultReportId,
      });
    }

    const selectedWithoutReplacement = input.repair.items.some((item) => !item.replacementSerial);
    const existingMissingSubLock = (['B', 'C', 'D'] as const).some(
      (slot) => !pairingBySlot.has(slot) && !itemByPosition.get(slot)?.replacementSerial,
    );
    return {
      truckId: truck.id,
      truckPlate: truck.plate,
      kitIncomplete: selectedWithoutReplacement || existingMissingSubLock,
      operations,
    };
  });
}
