import { and, eq, inArray, isNull } from 'drizzle-orm';
import { createId } from '@paralleldrive/cuid2';
import { z } from 'zod';
import {
  auditLog,
  devices,
  movementLogs,
  slotPairings,
  truckAssignments,
  trucks,
} from '../db/schema';
import { BusinessError } from '../lib/errors';
import { createFaultReportSchema } from '../lib/validations/fault';
import { installChecklistSchema } from '../lib/validations/installation';
import { createFaultReport } from './fault.service';
import { recordInstallation } from './installation.service';
import { applyRemoval } from './lifecycle.service';

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type DbClient = any;

export const nativeInstallSchema = z.object({
  installMode: z.enum(['same_kit', 'changed']).optional(),
  truckPlate: z.string().trim().min(1, 'Truck plate is required'),
  motherSerial: z.string().trim().min(1, 'Mother serial is required'),
  subSerials: z.tuple([
    z.string().trim().min(1),
    z.string().trim().min(1),
    z.string().trim().min(1),
  ]),
  company: z.enum(['mrs', 'dangote']),
  checklist: installChecklistSchema.optional(),
});

export const nativeFaultSchema = createFaultReportSchema
  .omit({ truckId: true, deviceId: true })
  .extend({
    truckPlate: z.string().trim().min(1, 'Truck plate is required'),
    deviceSerial: z.string().trim().min(1, 'Device serial is required'),
  });

type NativeInstall = z.infer<typeof nativeInstallSchema>;
type NativeFault = z.infer<typeof nativeFaultSchema>;

function writeAudit(
  tx: DbClient,
  params: {
    orgId: string;
    actorUserId: string;
    entityTable: string;
    entityId: string;
    operation: 'create' | 'transition';
    before?: unknown;
    after: unknown;
  },
): void {
  tx.insert(auditLog)
    .values({
      id: createId(),
      orgId: params.orgId,
      actorUserId: params.actorUserId,
      entityTable: params.entityTable,
      entityId: params.entityId,
      operation: params.operation,
      beforeJson: params.before === undefined ? null : JSON.stringify(params.before),
      afterJson: JSON.stringify(params.after),
    })
    .run();
}

function createInstallTruck(
  tx: DbClient,
  params: { orgId: string; actorUserId: string; plate: string },
): { id: string } {
  const id = createId();
  tx.insert(trucks)
    .values({
      id,
      orgId: params.orgId,
      plate: params.plate,
      createdVia: 'install',
    })
    .run();
  writeAudit(tx, {
    orgId: params.orgId,
    actorUserId: params.actorUserId,
    entityTable: 'trucks',
    entityId: id,
    operation: 'create',
    after: { plate: params.plate, createdVia: 'install' },
  });
  return { id };
}

function closeCurrentKitForScannedInstall(
  tx: DbClient,
  params: {
    orgId: string;
    actorUserId: string;
    truckId: string;
    incomingMotherDeviceId: string;
  },
): void {
  const assignment = tx
    .select()
    .from(truckAssignments)
    .where(and(eq(truckAssignments.truckId, params.truckId), isNull(truckAssignments.removedAt)))
    .get();
  if (!assignment) return;

  const now = Math.floor(Date.now() / 1000);
  const pairings = tx
    .select()
    .from(slotPairings)
    .where(and(eq(slotPairings.motherDeviceId, assignment.deviceId), isNull(slotPairings.unpairedAt)))
    .all() as Array<{ id: string; slot: 'B' | 'C' | 'D'; subDeviceId: string }>;

  for (const pairing of pairings) {
    const { disposition } = applyRemoval(tx, {
      deviceId: pairing.subDeviceId,
      actorUserId: params.actorUserId,
      reason: 'operational_swap',
      disposition: 'available_pool',
    });
    tx.update(slotPairings)
      .set({
        unpairedAt: now,
        unpairedBy: params.actorUserId,
        removalReason: 'operational_swap',
        disposition,
        removalNotes: 'Superseded by a scanned installation',
      })
      .where(eq(slotPairings.id, pairing.id))
      .run();

    const movementLogId = createId();
    tx.insert(movementLogs)
      .values({
        id: movementLogId,
        orgId: params.orgId,
        actorUserId: params.actorUserId,
        loggedDate: now,
        action: 'unlogged_swap_detected',
        truckId: params.truckId,
        outDeviceId: pairing.subDeviceId,
        outReason: 'operational_swap',
        outDisposition: disposition,
        slot: pairing.slot,
        notes: 'Slot released by safe install override',
      })
      .run();
    writeAudit(tx, {
      orgId: params.orgId,
      actorUserId: params.actorUserId,
      entityTable: 'movement_logs',
      entityId: movementLogId,
      operation: 'create',
      after: {
        action: 'unlogged_swap_detected',
        truckId: params.truckId,
        slot: pairing.slot,
        outDeviceId: pairing.subDeviceId,
        disposition,
        source: 'native_install_safe_override',
      },
    });
  }

  const { disposition } = applyRemoval(tx, {
    deviceId: assignment.deviceId,
    actorUserId: params.actorUserId,
    reason: 'operational_swap',
    disposition: 'available_pool',
  });
  tx.update(truckAssignments)
    .set({
      removedAt: now,
      removedBy: params.actorUserId,
      removalReason: 'operational_swap',
      disposition,
      removalNotes: 'Superseded by a scanned installation',
    })
    .where(eq(truckAssignments.id, assignment.id))
    .run();

  const movementLogId = createId();
  tx.insert(movementLogs)
    .values({
      id: movementLogId,
      orgId: params.orgId,
      actorUserId: params.actorUserId,
      loggedDate: now,
      action: assignment.deviceId === params.incomingMotherDeviceId
        ? 'unlogged_swap_detected'
        : 'mother_replacement',
      truckId: params.truckId,
      outDeviceId: assignment.deviceId,
      outReason: 'operational_swap',
      outDisposition: disposition,
      inDeviceId: params.incomingMotherDeviceId,
      notes: 'Mother assignment replaced by safe install override',
    })
    .run();
  writeAudit(tx, {
    orgId: params.orgId,
    actorUserId: params.actorUserId,
    entityTable: 'movement_logs',
    entityId: movementLogId,
    operation: 'create',
    after: {
      action: assignment.deviceId === params.incomingMotherDeviceId
        ? 'unlogged_swap_detected'
        : 'mother_replacement',
      truckId: params.truckId,
      outDeviceId: assignment.deviceId,
      inDeviceId: params.incomingMotherDeviceId,
      disposition,
      source: 'native_install_safe_override',
    },
  });
}

function releaseIncomingScannedKitConflicts(
  tx: DbClient,
  params: {
    orgId: string;
    actorUserId: string;
    targetTruckId: string;
    motherDeviceId: string;
    subDeviceIds: string[];
  },
): void {
  const now = Math.floor(Date.now() / 1000);

  const releasePairing = (pairing: {
    id: string;
    motherDeviceId: string;
    subDeviceId: string;
    slot: 'B' | 'C' | 'D';
  }): void => {
    const sourceAssignment = tx
      .select({ truckId: truckAssignments.truckId })
      .from(truckAssignments)
      .where(and(eq(truckAssignments.deviceId, pairing.motherDeviceId), isNull(truckAssignments.removedAt)))
      .get() as { truckId: string } | undefined;
    const { disposition } = applyRemoval(tx, {
      deviceId: pairing.subDeviceId,
      actorUserId: params.actorUserId,
      reason: 'operational_swap',
      disposition: 'available_pool',
    });
    tx.update(slotPairings)
      .set({
        unpairedAt: now,
        unpairedBy: params.actorUserId,
        removalReason: 'operational_swap',
        disposition,
        removalNotes: 'Moved automatically by scanned installation override',
      })
      .where(eq(slotPairings.id, pairing.id))
      .run();

    const movementLogId = createId();
    tx.insert(movementLogs)
      .values({
        id: movementLogId,
        orgId: params.orgId,
        actorUserId: params.actorUserId,
        loggedDate: now,
        action: 'unlogged_swap_detected',
        truckId: sourceAssignment?.truckId ?? null,
        outDeviceId: pairing.subDeviceId,
        outReason: 'operational_swap',
        outDisposition: disposition,
        slot: pairing.slot,
        notes: 'Sub-lock moved automatically by scanned installation override',
      })
      .run();
    writeAudit(tx, {
      orgId: params.orgId,
      actorUserId: params.actorUserId,
      entityTable: 'movement_logs',
      entityId: movementLogId,
      operation: 'create',
      after: {
        action: 'unlogged_swap_detected',
        sourceTruckId: sourceAssignment?.truckId ?? null,
        targetTruckId: params.targetTruckId,
        slot: pairing.slot,
        outDeviceId: pairing.subDeviceId,
        source: 'native_install_safe_override',
      },
    });
  };

  const incomingMotherAssignment = tx
    .select()
    .from(truckAssignments)
    .where(and(eq(truckAssignments.deviceId, params.motherDeviceId), isNull(truckAssignments.removedAt)))
    .get() as { id: string; truckId: string; deviceId: string } | undefined;

  if (incomingMotherAssignment) {
    const attachedPairings = tx
      .select()
      .from(slotPairings)
      .where(and(eq(slotPairings.motherDeviceId, params.motherDeviceId), isNull(slotPairings.unpairedAt)))
      .all() as Array<{
        id: string;
        motherDeviceId: string;
        subDeviceId: string;
        slot: 'B' | 'C' | 'D';
      }>;
    attachedPairings.forEach(releasePairing);

    const { disposition } = applyRemoval(tx, {
      deviceId: params.motherDeviceId,
      actorUserId: params.actorUserId,
      reason: 'operational_swap',
      disposition: 'available_pool',
    });
    tx.update(truckAssignments)
      .set({
        removedAt: now,
        removedBy: params.actorUserId,
        removalReason: 'operational_swap',
        disposition,
        removalNotes: 'Moved automatically by scanned installation override',
      })
      .where(eq(truckAssignments.id, incomingMotherAssignment.id))
      .run();

    const movementLogId = createId();
    tx.insert(movementLogs)
      .values({
        id: movementLogId,
        orgId: params.orgId,
        actorUserId: params.actorUserId,
        loggedDate: now,
        action: 'unlogged_swap_detected',
        truckId: incomingMotherAssignment.truckId,
        outDeviceId: params.motherDeviceId,
        outReason: 'operational_swap',
        outDisposition: disposition,
        notes: 'Mother lock moved automatically by scanned installation override',
      })
      .run();
    writeAudit(tx, {
      orgId: params.orgId,
      actorUserId: params.actorUserId,
      entityTable: 'movement_logs',
      entityId: movementLogId,
      operation: 'create',
      after: {
        action: 'unlogged_swap_detected',
        sourceTruckId: incomingMotherAssignment.truckId,
        targetTruckId: params.targetTruckId,
        outDeviceId: params.motherDeviceId,
        source: 'native_install_safe_override',
      },
    });
  }

  for (const subDeviceId of params.subDeviceIds) {
    const openPairing = tx
      .select()
      .from(slotPairings)
      .where(and(eq(slotPairings.subDeviceId, subDeviceId), isNull(slotPairings.unpairedAt)))
      .get() as {
        id: string;
        motherDeviceId: string;
        subDeviceId: string;
        slot: 'B' | 'C' | 'D';
      } | undefined;
    if (openPairing) releasePairing(openPairing);
  }
}

export function recordNativeInstallation(
  db: DbClient,
  params: { orgId: string; actorUserId: string; payload: NativeInstall },
) {
  const truckPlate = params.payload.truckPlate.toUpperCase();
  const motherSerial = params.payload.motherSerial.toUpperCase();
  const subSerials = params.payload.subSerials.map((serial) => serial.toUpperCase()) as [string, string, string];
  return db.transaction((tx: DbClient) => {
    const truck = tx
      .select({ id: trucks.id })
      .from(trucks)
      .where(and(eq(trucks.orgId, params.orgId), eq(trucks.plate, truckPlate)))
      .get() ?? createInstallTruck(tx, {
        orgId: params.orgId,
        actorUserId: params.actorUserId,
        plate: truckPlate,
      });

    const kitDevices: { id: string; serial: string; deviceType: string }[] = tx
      .select({ id: devices.id, serial: devices.serial, deviceType: devices.deviceType })
      .from(devices)
      .where(and(eq(devices.orgId, params.orgId), inArray(devices.serial, [motherSerial, ...subSerials])))
      .all();
    const bySerial = new Map(kitDevices.map((device) => [device.serial.toUpperCase(), device]));
    const mother = bySerial.get(motherSerial);
    if (!mother || mother.deviceType !== 'mother') throw new BusinessError(`Mother lock ${motherSerial} was not found`);

    const subs = subSerials.map((serial) => {
      const device = bySerial.get(serial);
      if (!device || device.deviceType !== 'sub') throw new BusinessError(`Sub-lock ${serial} was not found`);
      return device;
    });

    if (params.payload.installMode === 'changed') {
      closeCurrentKitForScannedInstall(tx, {
        orgId: params.orgId,
        actorUserId: params.actorUserId,
        truckId: truck.id,
        incomingMotherDeviceId: mother.id,
      });
      releaseIncomingScannedKitConflicts(tx, {
        orgId: params.orgId,
        actorUserId: params.actorUserId,
        targetTruckId: truck.id,
        motherDeviceId: mother.id,
        subDeviceIds: subs.map((sub) => sub.id),
      });
    }

    return recordInstallation(tx, {
      orgId: params.orgId,
      actorUserId: params.actorUserId,
      installMode: params.payload.installMode,
      truckId: truck.id,
      motherDeviceId: mother.id,
      subDeviceIds: [subs[0].id, subs[1].id, subs[2].id],
      company: params.payload.company,
      checklist: params.payload.checklist,
    });
  });
}

export function createNativeFaultReport(
  db: DbClient,
  params: { orgId: string; actorUserId: string; payload: NativeFault },
) {
  const truckPlate = params.payload.truckPlate.toUpperCase();
  const deviceSerial = params.payload.deviceSerial.toUpperCase();
  const truck = db
    .select({ id: trucks.id })
    .from(trucks)
    .where(and(eq(trucks.orgId, params.orgId), eq(trucks.plate, truckPlate)))
    .get();
  if (!truck) throw new BusinessError(`Truck ${truckPlate} was not found`);

  const device = db
    .select({ id: devices.id })
    .from(devices)
    .where(and(eq(devices.orgId, params.orgId), eq(devices.serial, deviceSerial)))
    .get();
  if (!device) throw new BusinessError(`Device ${deviceSerial} was not found`);

  const { truckPlate: _truckPlate, deviceSerial: _deviceSerial, ...fault } = params.payload;
  return createFaultReport(db, {
    orgId: params.orgId,
    actorUserId: params.actorUserId,
    truckId: truck.id,
    deviceId: device.id,
    ...fault,
  });
}
