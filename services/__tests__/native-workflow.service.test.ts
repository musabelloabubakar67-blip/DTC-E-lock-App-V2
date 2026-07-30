import { describe, expect, it } from 'vitest';
import { and, eq, isNull } from 'drizzle-orm';
import {
  conflictReviews,
  devices,
  movementLogs,
  slotPairings,
  truckAssignments,
  trucks,
} from '../../db/schema';
import { recordKitVerificationSchema } from '../../lib/validations/verification';
import { createTestDb } from '../../tests/helpers/testDb';
import { createTruck, seedBaseFixtures } from '../../tests/helpers/fixtures';
import { installKit } from '../installation.service';
import { recordNativeInstallation } from '../native-workflow.service';
import { registerKit } from '../registration.service';
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

    recordNativeInstallation(db, {
      orgId,
      actorUserId: installerId,
      payload: {
        truckPlate: 'new 101 aa',
        motherSerial: serialOf(db, kit.motherDeviceId),
        subSerials: kit.subDeviceIds.map((id) => serialOf(db, id)) as [string, string, string],
        company: 'mrs',
        installMode: 'changed',
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
