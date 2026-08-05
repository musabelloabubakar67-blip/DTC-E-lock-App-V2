import { and, eq, inArray, isNull } from 'drizzle-orm';
import { createId } from '@paralleldrive/cuid2';
import { z } from 'zod';
import {
  auditLog,
  devices,
  kitMembers,
  movementLogs,
  registrationLogs,
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
}).superRefine((value, ctx) => {
  const serials = [value.motherSerial, ...value.subSerials]
    .map((serial) => serial.trim().toUpperCase());
  if (new Set(serials).size !== serials.length) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      message: 'Mother and sub-lock serials must all be distinct',
      path: ['subSerials'],
    });
  }
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
    operation: 'create' | 'correct' | 'transition';
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

type ScannedDevice = {
  id: string;
  orgId: string;
  serial: string;
  deviceType: string;
};

function resolveIncompleteRegisteredKit(
  tx: DbClient,
  params: {
    orgId: string;
    actorUserId: string;
    mother: ScannedDevice;
    subSerials: [string, string, string];
    bySerial: Map<string, ScannedDevice>;
  },
): { subs: ScannedDevice[]; addedSubSerials: string[] } {
  const memberships = tx
    .select({ id: kitMembers.id, subDeviceId: kitMembers.subDeviceId })
    .from(kitMembers)
    .where(and(
      eq(kitMembers.orgId, params.orgId),
      eq(kitMembers.motherDeviceId, params.mother.id),
      isNull(kitMembers.removedAt),
    ))
    .all() as Array<{ id: string; subDeviceId: string }>;
  const memberIds = new Set(memberships.map((membership) => membership.subDeviceId));
  const knownSubs: ScannedDevice[] = [];
  const unknownSerials: string[] = [];

  for (const serial of params.subSerials) {
    const device = params.bySerial.get(serial);
    if (!device) {
      unknownSerials.push(serial);
      continue;
    }
    if (device.orgId !== params.orgId) {
      throw new BusinessError(`Sub-lock ${serial} is registered to another organisation`);
    }
    if (device.deviceType !== 'sub') {
      throw new BusinessError(`Serial ${serial} is registered as a mother lock, not a sub-lock`);
    }
    knownSubs.push(device);
  }

  // Preserve the existing safe-override behavior for complete registered kits: replacements and
  // historical kit movement can legitimately make physical slot membership differ from birth
  // registration membership. Strict membership matching applies only while completing an
  // incomplete registration.
  if (unknownSerials.length === 0 && memberships.length >= 3) {
    return { subs: knownSubs, addedSubSerials: [] };
  }

  const registration = tx
    .select({ id: registrationLogs.id })
    .from(registrationLogs)
    .where(and(
      eq(registrationLogs.orgId, params.orgId),
      eq(registrationLogs.motherDeviceId, params.mother.id),
    ))
    .get() as { id: string } | undefined;
  if (!registration && unknownSerials.length === 0) {
    return { subs: knownSubs, addedSubSerials: [] };
  }
  if (!registration || memberships.length >= 3) {
    throw new BusinessError(
      unknownSerials.length > 0
        ? `Sub-lock ${unknownSerials[0]} was not found. Kit ${params.mother.serial} is not an incomplete registration`
        : `Kit ${params.mother.serial} is not an incomplete registration`,
    );
  }

  for (const device of knownSubs) {
    if (memberIds.has(device.id)) continue;
    const otherMembership = tx
      .select({ motherDeviceId: kitMembers.motherDeviceId })
      .from(kitMembers)
      .where(and(eq(kitMembers.subDeviceId, device.id), isNull(kitMembers.removedAt)))
      .get() as { motherDeviceId: string } | undefined;
    const otherMother = otherMembership
      ? tx.select({ serial: devices.serial }).from(devices).where(eq(devices.id, otherMembership.motherDeviceId)).get()
      : undefined;
    if (otherMother) {
      throw new BusinessError(
        `Sub-lock ${device.serial} is registered to kit ${otherMother.serial} and cannot complete kit ${params.mother.serial}`,
      );
    }
    throw new BusinessError(
      `Sub-lock ${device.serial} is already registered and is not part of incomplete kit ${params.mother.serial}`,
    );
  }

  const missingSlots = 3 - memberships.length;
  if (unknownSerials.length !== missingSlots || knownSubs.length !== memberships.length) {
    throw new BusinessError(
      `Kit ${params.mother.serial} has ${memberships.length} registered sub-lock(s). Scan those same sub-locks and exactly ${missingSlots} missing physical sub-lock(s) to complete it`,
    );
  }

  const now = Math.floor(Date.now() / 1000);
  const addedSubs: ScannedDevice[] = [];
  for (const serial of unknownSerials) {
    const device: ScannedDevice = {
      id: createId(),
      orgId: params.orgId,
      serial,
      deviceType: 'sub',
    };
    tx.insert(devices)
      .values({
        id: device.id,
        orgId: params.orgId,
        deviceType: 'sub',
        serial,
        lifecycleStatus: 'available',
        registeredAt: now,
        registeredBy: params.actorUserId,
        origin: 'discovered',
        notes: `Physically scanned while completing incomplete kit ${params.mother.serial} during installation`,
      })
      .run();
    writeAudit(tx, {
      orgId: params.orgId,
      actorUserId: params.actorUserId,
      entityTable: 'devices',
      entityId: device.id,
      operation: 'create',
      after: {
        serial,
        deviceType: 'sub',
        lifecycleStatus: 'available',
        origin: 'discovered',
        via: 'incomplete_kit_installation',
        motherSerial: params.mother.serial,
      },
    });

    const membershipId = createId();
    tx.insert(kitMembers)
      .values({
        id: membershipId,
        orgId: params.orgId,
        motherDeviceId: params.mother.id,
        subDeviceId: device.id,
        addedAt: now,
      })
      .run();
    writeAudit(tx, {
      orgId: params.orgId,
      actorUserId: params.actorUserId,
      entityTable: 'kit_members',
      entityId: membershipId,
      operation: 'create',
      after: {
        motherDeviceId: params.mother.id,
        motherSerial: params.mother.serial,
        subDeviceId: device.id,
        subSerial: serial,
        via: 'incomplete_kit_installation',
      },
    });
    addedSubs.push(device);
  }

  writeAudit(tx, {
    orgId: params.orgId,
    actorUserId: params.actorUserId,
    entityTable: 'registration_logs',
    entityId: registration.id,
    operation: 'correct',
    before: { complete: false, registeredSubCount: memberships.length },
    after: {
      complete: true,
      registeredSubCount: 3,
      addedSubSerials: unknownSerials,
      via: 'incomplete_kit_installation',
    },
  });

  const addedBySerial = new Map(addedSubs.map((device) => [device.serial, device]));
  return {
    subs: params.subSerials.map((serial) => params.bySerial.get(serial) ?? addedBySerial.get(serial)!),
    addedSubSerials: unknownSerials,
  };
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
  if (new Set([motherSerial, ...subSerials]).size !== 4) {
    throw new BusinessError('Mother and sub-lock serials must all be distinct');
  }
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

    const kitDevices: ScannedDevice[] = tx
      .select({ id: devices.id, orgId: devices.orgId, serial: devices.serial, deviceType: devices.deviceType })
      .from(devices)
      .where(inArray(devices.serial, [motherSerial, ...subSerials]))
      .all();
    const bySerial = new Map(kitDevices.map((device) => [device.serial.toUpperCase(), device]));
    const mother = bySerial.get(motherSerial);
    if (!mother || mother.orgId !== params.orgId || mother.deviceType !== 'mother') {
      throw new BusinessError(`Mother lock ${motherSerial} was not found`);
    }

    const completedKit = resolveIncompleteRegisteredKit(tx, {
      orgId: params.orgId,
      actorUserId: params.actorUserId,
      mother,
      subSerials,
      bySerial,
    });
    const subs = completedKit.subs;

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

    const result = recordInstallation(tx, {
      orgId: params.orgId,
      actorUserId: params.actorUserId,
      installMode: params.payload.installMode,
      truckId: truck.id,
      motherDeviceId: mother.id,
      subDeviceIds: [subs[0].id, subs[1].id, subs[2].id],
      company: params.payload.company,
      checklist: params.payload.checklist,
    });
    return { ...result, completedRegistrationSubSerials: completedKit.addedSubSerials };
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
