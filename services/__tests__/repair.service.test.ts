import { describe, expect, it } from 'vitest';
import { and, eq, isNull } from 'drizzle-orm';
import { createId } from '@paralleldrive/cuid2';
import {
  devices,
  faultReports,
  movementLogs,
  slotPairings,
  truckAssignments,
} from '../../db/schema';
import { createTestDb } from '../../tests/helpers/testDb';
import { createDevice, createTruck, seedBaseFixtures } from '../../tests/helpers/fixtures';
import { executeRepairBatch } from '../repair.service';

function setupInstalledKit() {
  const { db } = createTestDb();
  const { orgId, installerId } = seedBaseFixtures(db);
  const truckId = createTruck(db, orgId, 'FZE700DI');
  const motherId = createDevice(db, orgId, { type: 'mother', serial: 'MOTHER-OLD-1', status: 'in_service' });
  const subIds = ['SUB-OLD-B', 'SUB-OLD-C', 'SUB-OLD-D'].map((serial) =>
    createDevice(db, orgId, { type: 'sub', serial, status: 'in_service' }),
  );
  const now = Math.floor(Date.now() / 1000);

  db.insert(truckAssignments).values({
    id: createId(),
    orgId,
    truckId,
    deviceId: motherId,
    assignedAt: now,
    assignedBy: installerId,
  }).run();
  subIds.forEach((subDeviceId, index) => {
    db.insert(slotPairings).values({
      id: createId(),
      orgId,
      motherDeviceId: motherId,
      slot: (['B', 'C', 'D'] as const)[index],
      subDeviceId,
      pairedAt: now,
      pairedBy: installerId,
    }).run();
  });

  return { db, orgId, installerId, truckId, motherId, subIds };
}

function statusOf(db: ReturnType<typeof createTestDb>['db'], deviceId: string): string {
  return db.select().from(devices).where(eq(devices.id, deviceId)).get()!.lifecycleStatus;
}

describe('repair.service — atomic multi-device remove/replace', () => {
  it('replaces one sub-lock, creates its fault automatically, and sends the old device to repair', () => {
    const fixture = setupInstalledKit();
    const incomingId = createDevice(fixture.db, fixture.orgId, {
      type: 'sub',
      serial: 'SUB-NEW-B',
      status: 'available',
    });

    const result = executeRepairBatch(fixture.db, {
      orgId: fixture.orgId,
      actorUserId: fixture.installerId,
      repair: {
        truck: 'FZE700DI',
        reason: 'faulty',
        description: 'Sub-lock B will not open',
        items: [{ position: 'B', replacementSerial: 'SUB-NEW-B' }],
      },
    });

    expect(result.kitIncomplete).toBe(false);
    expect(statusOf(fixture.db, fixture.subIds[0])).toBe('repair');
    expect(statusOf(fixture.db, incomingId)).toBe('in_service');
    expect(fixture.db.select().from(faultReports).all()).toHaveLength(1);
    expect(fixture.db.select().from(movementLogs).all()).toHaveLength(1);
    const openB = fixture.db.select().from(slotPairings).where(and(
      eq(slotPairings.slot, 'B'),
      isNull(slotPairings.unpairedAt),
    )).get()!;
    expect(openB.subDeviceId).toBe(incomingId);
  });

  it('can remove two devices without replacement and leaves both positions explicitly incomplete', () => {
    const fixture = setupInstalledKit();

    const result = executeRepairBatch(fixture.db, {
      orgId: fixture.orgId,
      actorUserId: fixture.installerId,
      repair: {
        truck: 'FZE700DI',
        reason: 'damaged',
        description: 'Two sub-locks were physically damaged',
        items: [{ position: 'B' }, { position: 'D' }],
      },
    });

    expect(result.kitIncomplete).toBe(true);
    expect(statusOf(fixture.db, fixture.subIds[0])).toBe('repair');
    expect(statusOf(fixture.db, fixture.subIds[2])).toBe('repair');
    const openSlots = fixture.db.select().from(slotPairings).where(isNull(slotPairings.unpairedAt)).all();
    expect(openSlots.map((row) => row.slot)).toEqual(['C']);
    expect(fixture.db.select().from(faultReports).all()).toHaveLength(2);
    expect(fixture.db.select().from(movementLogs).all()).toHaveLength(2);
  });

  it('replaces a complete kit and attaches all new sub-locks to the new mother', () => {
    const fixture = setupInstalledKit();
    const newMotherId = createDevice(fixture.db, fixture.orgId, {
      type: 'mother',
      serial: 'MOTHER-NEW-1',
      status: 'available',
    });
    const newSubIds = ['SUB-NEW-B', 'SUB-NEW-C', 'SUB-NEW-D'].map((serial) =>
      createDevice(fixture.db, fixture.orgId, { type: 'sub', serial, status: 'available' }),
    );

    const result = executeRepairBatch(fixture.db, {
      orgId: fixture.orgId,
      actorUserId: fixture.installerId,
      repair: {
        truck: 'FZE700DI',
        reason: 'faulty',
        description: 'Complete kit failed bench inspection',
        items: [
          { position: 'mother', replacementSerial: 'MOTHER-NEW-1' },
          { position: 'B', replacementSerial: 'SUB-NEW-B' },
          { position: 'C', replacementSerial: 'SUB-NEW-C' },
          { position: 'D', replacementSerial: 'SUB-NEW-D' },
        ],
      },
    });

    expect(result.kitIncomplete).toBe(false);
    const assignment = fixture.db.select().from(truckAssignments).where(and(
      eq(truckAssignments.truckId, fixture.truckId),
      isNull(truckAssignments.removedAt),
    )).get()!;
    expect(assignment.deviceId).toBe(newMotherId);
    const openPairings = fixture.db.select().from(slotPairings).where(and(
      eq(slotPairings.motherDeviceId, newMotherId),
      isNull(slotPairings.unpairedAt),
    )).all();
    expect(openPairings.map((row) => row.subDeviceId).sort()).toEqual([...newSubIds].sort());
    expect(fixture.db.select().from(faultReports).all()).toHaveLength(4);
    expect(fixture.db.select().from(movementLogs).all()).toHaveLength(4);
  });

  it('replaces only the mother and transfers the unchanged sub-locks to it', () => {
    const fixture = setupInstalledKit();
    const newMotherId = createDevice(fixture.db, fixture.orgId, {
      type: 'mother',
      serial: 'MOTHER-NEW-ONLY',
      status: 'available',
    });

    const result = executeRepairBatch(fixture.db, {
      orgId: fixture.orgId,
      actorUserId: fixture.installerId,
      repair: {
        truck: 'FZE700DI',
        reason: 'faulty',
        description: 'Mother lock is not responding',
        items: [{ position: 'mother', replacementSerial: 'MOTHER-NEW-ONLY' }],
      },
    });

    expect(result.kitIncomplete).toBe(false);
    const assignment = fixture.db.select().from(truckAssignments).where(and(
      eq(truckAssignments.truckId, fixture.truckId),
      isNull(truckAssignments.removedAt),
    )).get()!;
    expect(assignment.deviceId).toBe(newMotherId);
    const transferredPairings = fixture.db.select().from(slotPairings).where(and(
      eq(slotPairings.motherDeviceId, newMotherId),
      isNull(slotPairings.unpairedAt),
    )).all();
    expect(transferredPairings.map((row) => row.subDeviceId).sort()).toEqual([...fixture.subIds].sort());
    expect(fixture.db.select().from(faultReports).all()).toHaveLength(1);
    expect(fixture.db.select().from(movementLogs).all()).toHaveLength(1);
  });

  it('writes nothing when any replacement fails preflight validation', () => {
    const fixture = setupInstalledKit();
    createDevice(fixture.db, fixture.orgId, {
      type: 'sub',
      serial: 'SUB-NEW-B',
      status: 'available',
    });

    expect(() => executeRepairBatch(fixture.db, {
      orgId: fixture.orgId,
      actorUserId: fixture.installerId,
      repair: {
        truck: 'FZE700DI',
        reason: 'faulty',
        description: 'Attempted two-device replacement',
        items: [
          { position: 'B', replacementSerial: 'SUB-NEW-B' },
          { position: 'C', replacementSerial: 'NOT-REGISTERED' },
        ],
      },
    })).toThrow('not registered');

    expect(statusOf(fixture.db, fixture.subIds[0])).toBe('in_service');
    expect(fixture.db.select().from(faultReports).all()).toHaveLength(0);
    expect(fixture.db.select().from(movementLogs).all()).toHaveLength(0);
    expect(fixture.db.select().from(slotPairings).where(isNull(slotPairings.unpairedAt)).all()).toHaveLength(3);
  });
});
