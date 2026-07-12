import { describe, it, expect } from 'vitest';
import { eq } from 'drizzle-orm';
import { createId } from '@paralleldrive/cuid2';
import { truckAssignments, devices } from '../../db/schema';
import { createTestDb } from '../../tests/helpers/testDb';
import { seedBaseFixtures, createTruck, createDevice } from '../../tests/helpers/fixtures';
import { removeDeviceFromTruck, decommissionDevice } from '../movement.service';

describe('movement.service — removeDeviceFromTruck state assertions', () => {
  it('closes the open assignment, sets device available, and records disposition=available_pool via lifecycle.service', () => {
    const { db } = createTestDb();
    const { orgId, installerId } = seedBaseFixtures(db);
    const truckId = createTruck(db, orgId, 'FZE140DI');
    const deviceId = createDevice(db, orgId, { type: 'mother', serial: 'RTI-1', status: 'in_service' });
    const now = Math.floor(Date.now() / 1000);
    const assignmentId = createId();
    db.insert(truckAssignments)
      .values({ id: assignmentId, orgId, truckId, deviceId, assignedAt: now, assignedBy: installerId })
      .run();

    removeDeviceFromTruck(db, {
      orgId,
      actorUserId: installerId,
      motherDeviceId: deviceId,
      reason: 'operational_swap',
    });

    const assignment = db.select().from(truckAssignments).where(eq(truckAssignments.id, assignmentId)).get()!;
    expect(assignment.removedAt).not.toBeNull();
    expect(assignment.removalReason).toBe('operational_swap');
    expect(assignment.disposition).toBe('available_pool');

    const device = db.select().from(devices).where(eq(devices.id, deviceId)).get()!;
    expect(device.lifecycleStatus).toBe('available');
  });
});

describe('movement.service — decommissionDevice state assertions', () => {
  it('closes the open assignment, sets device retired, and records disposition=retired via lifecycle.service', () => {
    const { db } = createTestDb();
    const { orgId, installerId } = seedBaseFixtures(db);
    const truckId = createTruck(db, orgId, 'FZE150DI');
    const deviceId = createDevice(db, orgId, { type: 'mother', serial: 'DECOM-1', status: 'in_service' });
    const now = Math.floor(Date.now() / 1000);
    const assignmentId = createId();
    db.insert(truckAssignments)
      .values({ id: assignmentId, orgId, truckId, deviceId, assignedAt: now, assignedBy: installerId })
      .run();

    decommissionDevice(db, { orgId, actorUserId: installerId, motherDeviceId: deviceId });

    const assignment = db.select().from(truckAssignments).where(eq(truckAssignments.id, assignmentId)).get()!;
    expect(assignment.removedAt).not.toBeNull();
    expect(assignment.removalReason).toBe('decommissioned');
    expect(assignment.disposition).toBe('retired');

    const device = db.select().from(devices).where(eq(devices.id, deviceId)).get()!;
    expect(device.lifecycleStatus).toBe('retired');
  });
});
