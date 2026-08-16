import { describe, expect, it } from 'vitest';
import { and, eq, isNull } from 'drizzle-orm';
import {
  auditLog,
  conflictReviews,
  devices,
  kitMembers,
  movementLogs,
  slotPairings,
  truckAssignments,
  trucks,
  verifications,
} from '../../db/schema';
import { recordKitVerificationSchema } from '../../lib/validations/verification';
import { createTestDb } from '../../tests/helpers/testDb';
import { createTruck, seedBaseFixtures } from '../../tests/helpers/fixtures';
import { installKit } from '../installation.service';
import { recordNativeInstallation } from '../native-workflow.service';
import { registerIncompleteKit, registerKit } from '../registration.service';
import { listOpenConflictReviews } from '../review.service';
import { applySyncBatch } from '../sync.service';

function registerTestKit(
  db: ReturnType<typeof createTestDb>['db'],
  orgId: string,
  installerId: string,
  tag: string,
) {
  return registerKit(db, {
    orgId,
    actorUserId: installerId,
    motherSerial: `${tag}-MOTHER`,
    subSerials: [`${tag}-SUB-B`, `${tag}-SUB-C`, `${tag}-SUB-D`],
    simNumber: `23480${tag.length}0000000`,
  });
}

function serialOf(db: ReturnType<typeof createTestDb>['db'], deviceId: string): string {
  return db.select({ serial: devices.serial }).from(devices).where(eq(devices.id, deviceId)).get()!.serial;
}

describe('native installation workflow', () => {
  it('creates a new truck from an unknown plate and records its first assignment', () => {
    const { db } = createTestDb();
    const { orgId, installerId } = seedBaseFixtures(db);
    const kit = registerTestKit(db, orgId, installerId, 'NEW');

    const result = recordNativeInstallation(db, {
      orgId,
      actorUserId: installerId,
      payload: {
        truckPlate: 'new 101 aa',
        motherSerial: serialOf(db, kit.motherDeviceId),
        subSerials: kit.subDeviceIds.map((id) => serialOf(db, id)) as [string, string, string],
        company: 'mrs',
        installMode: 'changed',
        checklist: { overallStatus: 'successful' },
      },
    });

    const truck = db.select().from(trucks).where(eq(trucks.plate, 'NEW 101 AA')).get()!;
    expect(truck.createdVia).toBe('install');
    expect(
      db
        .select()
        .from(truckAssignments)
        .where(and(eq(truckAssignments.truckId, truck.id), isNull(truckAssignments.removedAt)))
        .get()!.deviceId,
    ).toBe(kit.motherDeviceId);
    expect(result.verificationId).toBeTruthy();
    expect(db.select().from(verifications).where(eq(verifications.truckId, truck.id)).all()).toHaveLength(1);
  });

  it('completes an incomplete registered kit from its missing physical scan and installs atomically', () => {
    const { db } = createTestDb();
    const { orgId, supervisorId, installerId } = seedBaseFixtures(db);
    const partial = registerIncompleteKit(db, {
      actor: { id: supervisorId, orgId, role: 'supervisor' },
      motherSerial: 'PARTIAL-MOTHER',
      subSerials: ['PARTIAL-SUB-B', 'PARTIAL-SUB-C'],
      notes: 'Third sub-lock was not captured in the source registration file',
    });

    const result = recordNativeInstallation(db, {
      orgId,
      actorUserId: installerId,
      payload: {
        truckPlate: 'FZE 185 DI',
        motherSerial: 'partial-mother',
        subSerials: ['partial-sub-b', 'partial-sub-c', 'partial-sub-d'],
        company: 'mrs',
        installMode: 'changed',
        checklist: { overallStatus: 'successful' },
      },
    });

    const added = db.select().from(devices).where(eq(devices.serial, 'PARTIAL-SUB-D')).get()!;
    const truck = db.select().from(trucks).where(eq(trucks.plate, 'FZE 185 DI')).get()!;
    expect(result.completedRegistrationSubSerials).toEqual(['PARTIAL-SUB-D']);
    expect(added).toMatchObject({
      deviceType: 'sub',
      origin: 'discovered',
      lifecycleStatus: 'in_service',
      registeredBy: installerId,
    });
    expect(
      db
        .select()
        .from(kitMembers)
        .where(and(eq(kitMembers.motherDeviceId, partial.motherDeviceId), isNull(kitMembers.removedAt)))
        .all(),
    ).toHaveLength(3);
    expect(
      db
        .select()
        .from(slotPairings)
        .where(and(eq(slotPairings.motherDeviceId, partial.motherDeviceId), isNull(slotPairings.unpairedAt)))
        .all(),
    ).toHaveLength(3);
    expect(
      db
        .select()
        .from(truckAssignments)
        .where(and(eq(truckAssignments.truckId, truck.id), isNull(truckAssignments.removedAt)))
        .get()!.deviceId,
    ).toBe(partial.motherDeviceId);
    expect(result.verificationId).toBeTruthy();
    expect(
      db
        .select()
        .from(auditLog)
        .where(and(eq(auditLog.entityTable, 'registration_logs'), eq(auditLog.operation, 'correct')))
        .all()
        .some((row) => JSON.parse(row.afterJson).via === 'incomplete_kit_installation'),
    ).toBe(true);
    expect(db.select().from(conflictReviews).all()).toHaveLength(0);
  });

  it('kit-change install with a never-registered sub-lock: bare-registers it and installs, without requiring the mother\'s already-complete registered kit to reconcile', () => {
    const { db } = createTestDb();
    const { orgId, installerId } = seedBaseFixtures(db);
    const kit = registerTestKit(db, orgId, installerId, 'FULL');
    const motherSerial = serialOf(db, kit.motherDeviceId);
    const subB = serialOf(db, kit.subDeviceIds[0]);
    const subC = serialOf(db, kit.subDeviceIds[1]);

    const result = recordNativeInstallation(db, {
      orgId,
      actorUserId: installerId,
      payload: {
        truckPlate: 'FZE 900 SW',
        motherSerial,
        subSerials: [subB, subC, 'NEVERSEEN0001'],
        company: 'mrs',
        installMode: 'changed',
        checklist: { overallStatus: 'successful' },
      },
    });

    expect(result.completedRegistrationSubSerials).toEqual(['NEVERSEEN0001']);
    const newDevice = db.select().from(devices).where(eq(devices.serial, 'NEVERSEEN0001')).get()!;
    expect(newDevice).toMatchObject({ deviceType: 'sub', origin: 'discovered', lifecycleStatus: 'in_service' });

    // The mother's OWN registered kit_members is untouched — still the original 3 subs, unaware
    // of the swap. Registration bookkeeping and physical install are deliberately decoupled.
    const openMembers = db
      .select({ subDeviceId: kitMembers.subDeviceId })
      .from(kitMembers)
      .where(and(eq(kitMembers.motherDeviceId, kit.motherDeviceId), isNull(kitMembers.removedAt)))
      .all()
      .map((row) => row.subDeviceId);
    expect(openMembers.sort()).toEqual([...kit.subDeviceIds].sort());

    // But the truck's actual slot_pairings reflect physical reality: the new device is in service.
    const truck = db.select().from(trucks).where(eq(trucks.plate, 'FZE 900 SW')).get()!;
    const pairedSubIds = db
      .select({ subDeviceId: slotPairings.subDeviceId })
      .from(slotPairings)
      .where(and(eq(slotPairings.motherDeviceId, kit.motherDeviceId), isNull(slotPairings.unpairedAt)))
      .all()
      .map((row) => row.subDeviceId);
    expect(pairedSubIds).toContain(newDevice.id);
    expect(db.select().from(truckAssignments).where(eq(truckAssignments.truckId, truck.id)).all()).toHaveLength(1);
  });

  it('rejects a registered sub-lock from another kit without writing a partial install', () => {
    const { db } = createTestDb();
    const { orgId, supervisorId, installerId } = seedBaseFixtures(db);
    const partial = registerIncompleteKit(db, {
      actor: { id: supervisorId, orgId, role: 'supervisor' },
      motherSerial: 'TARGET-MOTHER',
      subSerials: ['TARGET-SUB-B', 'TARGET-SUB-C'],
    });
    registerTestKit(db, orgId, installerId, 'OTHER');

    expect(() => recordNativeInstallation(db, {
      orgId,
      actorUserId: installerId,
      payload: {
        truckPlate: 'BLOCK101',
        motherSerial: 'TARGET-MOTHER',
        subSerials: ['TARGET-SUB-B', 'TARGET-SUB-C', 'OTHER-SUB-B'],
        company: 'mrs',
        installMode: 'changed',
      },
    })).toThrow(
      'Sub-lock OTHER-SUB-B is registered to kit OTHER-MOTHER and cannot complete kit TARGET-MOTHER',
    );

    expect(db.select().from(trucks).where(eq(trucks.plate, 'BLOCK101')).all()).toHaveLength(0);
    expect(
      db
        .select()
        .from(kitMembers)
        .where(and(eq(kitMembers.motherDeviceId, partial.motherDeviceId), isNull(kitMembers.removedAt)))
        .all(),
    ).toHaveLength(2);
    expect(db.select().from(truckAssignments).all()).toHaveLength(0);
  });

  it('applies a scanned changed kit without creating a review', () => {
    const { db } = createTestDb();
    const { orgId, installerId } = seedBaseFixtures(db);
    const truckId = createTruck(db, orgId, 'SAFE101AA');
    const oldKit = registerTestKit(db, orgId, installerId, 'OLD');
    const newKit = registerTestKit(db, orgId, installerId, 'NEXT');

    installKit(db, {
      orgId,
      actorUserId: installerId,
      truckId,
      motherDeviceId: oldKit.motherDeviceId,
      subDeviceIds: oldKit.subDeviceIds as [string, string, string],
      company: 'mrs',
    });

    const [outcome] = applySyncBatch(db, {
      orgId,
      actor: { id: installerId, orgId, role: 'installer' },
      mutations: [{
        id: 'native-safe-override',
        endpoint: '/api/mobile/installations',
        clientTs: Date.now(),
        seq: 1,
        payload: {
          truckPlate: 'SAFE101AA',
          motherSerial: serialOf(db, newKit.motherDeviceId),
          subSerials: newKit.subDeviceIds.map((id) => serialOf(db, id)),
          company: 'mrs',
          installMode: 'changed',
          checklist: {
            deviceResponsive: 'yes',
            sublocksResponsive: 'yes',
            configConfirmed: 'yes',
            overallStatus: 'successful',
          },
        },
      }],
    });

    expect(outcome.status).toBe('applied');
    expect(db.select().from(conflictReviews).all()).toHaveLength(0);

    const openAssignment = db
      .select()
      .from(truckAssignments)
      .where(and(eq(truckAssignments.truckId, truckId), isNull(truckAssignments.removedAt)))
      .get()!;
    expect(openAssignment.deviceId).toBe(newKit.motherDeviceId);

    for (const deviceId of [oldKit.motherDeviceId, ...oldKit.subDeviceIds]) {
      expect(db.select().from(devices).where(eq(devices.id, deviceId)).get()!.lifecycleStatus).toBe('available');
    }
    for (const deviceId of [newKit.motherDeviceId, ...newKit.subDeviceIds]) {
      expect(db.select().from(devices).where(eq(devices.id, deviceId)).get()!.lifecycleStatus).toBe('in_service');
    }

    expect(
      db
        .select()
        .from(slotPairings)
        .where(and(eq(slotPairings.motherDeviceId, oldKit.motherDeviceId), isNull(slotPairings.unpairedAt)))
        .all(),
    ).toHaveLength(0);
    expect(db.select().from(movementLogs).all().length).toBeGreaterThanOrEqual(4);
  });

  it('moves a scanned kit from a stale source truck and completes a new truck assignment', () => {
    const { db } = createTestDb();
    const { orgId, installerId } = seedBaseFixtures(db);
    const sourceTruckId = createTruck(db, orgId, 'SOURCE101');
    const kit = registerTestKit(db, orgId, installerId, 'MOVED');

    installKit(db, {
      orgId,
      actorUserId: installerId,
      truckId: sourceTruckId,
      motherDeviceId: kit.motherDeviceId,
      subDeviceIds: kit.subDeviceIds as [string, string, string],
      company: 'mrs',
    });

    recordNativeInstallation(db, {
      orgId,
      actorUserId: installerId,
      payload: {
        truckPlate: 'FZE656DI',
        motherSerial: serialOf(db, kit.motherDeviceId),
        subSerials: kit.subDeviceIds.map((id) => serialOf(db, id)) as [string, string, string],
        company: 'mrs',
        installMode: 'changed',
      },
    });

    const targetTruck = db.select().from(trucks).where(eq(trucks.plate, 'FZE656DI')).get()!;
    expect(
      db
        .select()
        .from(truckAssignments)
        .where(and(eq(truckAssignments.truckId, sourceTruckId), isNull(truckAssignments.removedAt)))
        .all(),
    ).toHaveLength(0);
    expect(
      db
        .select()
        .from(truckAssignments)
        .where(and(eq(truckAssignments.truckId, targetTruck.id), isNull(truckAssignments.removedAt)))
        .get()!.deviceId,
    ).toBe(kit.motherDeviceId);
    expect(
      db
        .select()
        .from(slotPairings)
        .where(and(eq(slotPairings.motherDeviceId, kit.motherDeviceId), isNull(slotPairings.unpairedAt)))
        .all(),
    ).toHaveLength(3);
    expect(db.select().from(conflictReviews).all()).toHaveLength(0);
  });

  it('applies remove-only repairs through native sync and explains rejected replacements', () => {
    const { db } = createTestDb();
    const { orgId, installerId } = seedBaseFixtures(db);
    const truckId = createTruck(db, orgId, 'FZE785DA');
    const kit = registerTestKit(db, orgId, installerId, 'REPAIR');

    installKit(db, {
      orgId,
      actorUserId: installerId,
      truckId,
      motherDeviceId: kit.motherDeviceId,
      subDeviceIds: kit.subDeviceIds as [string, string, string],
      company: 'mrs',
    });

    const [removeOutcome] = applySyncBatch(db, {
      orgId,
      actor: { id: installerId, orgId, role: 'installer' },
      mutations: [{
        id: 'native-remove-only',
        endpoint: '/api/repairs',
        clientTs: Date.now(),
        seq: 1,
        payload: {
          truck: 'FZE785DA',
          reason: 'faulty',
          description: 'Sub-lock B failed in service',
          items: [{ position: 'B' }],
        },
      }],
    });

    expect(removeOutcome.status).toBe('applied');
    expect(db.select().from(devices).where(eq(devices.id, kit.subDeviceIds[0])).get()!.lifecycleStatus).toBe('repair');
    expect(
      db
        .select()
        .from(slotPairings)
        .where(and(eq(slotPairings.subDeviceId, kit.subDeviceIds[0]), isNull(slotPairings.unpairedAt)))
        .all(),
    ).toHaveLength(0);

    const [replacementOutcome] = applySyncBatch(db, {
      orgId,
      actor: { id: installerId, orgId, role: 'installer' },
      mutations: [{
        id: 'native-bad-replacement',
        endpoint: '/api/repairs',
        clientTs: Date.now() + 1,
        seq: 2,
        payload: {
          truck: 'FZE785DA',
          reason: 'faulty',
          description: 'Replace failed sub-lock C',
          items: [{ position: 'C', replacementSerial: 'NOT-REGISTERED' }],
        },
      }],
    });

    expect(replacementOutcome).toMatchObject({
      status: 'conflicted',
      message: 'Replacement device NOT-REGISTERED is not registered',
    });
    const review = listOpenConflictReviews(db, orgId)[0];
    expect(review.presentation.title).toBe('Repair for FZE785DA was not applied');
    expect(review.presentation.details).toContainEqual({
      label: 'Requested operations',
      value: 'Sub-lock C: replace with NOT-REGISTERED',
    });
    expect(review.presentation.details).toContainEqual({
      label: 'Why it failed',
      value: 'Replacement device NOT-REGISTERED is not registered',
    });
  });
});

describe('verification validation', () => {
  it('requires a truck plate for every verification', () => {
    const withoutTruck = recordKitVerificationSchema.safeParse({
      motherSerial: 'VERIFY-MOTHER',
      motherSource: 'qr_scan',
      subs: [{ serial: 'VERIFY-SUB-B', source: 'qr_scan' }],
    });
    const withTruck = recordKitVerificationSchema.safeParse({
      truckId: 'FZE998DI',
      motherSerial: 'VERIFY-MOTHER',
      motherSource: 'qr_scan',
      subs: [{ serial: 'VERIFY-SUB-B', source: 'qr_scan' }],
    });

    expect(withoutTruck.success).toBe(false);
    expect(withTruck.success).toBe(true);
  });
});
