import { describe, it, expect } from 'vitest';
import { inArray, eq, and } from 'drizzle-orm';
import { truckAssignments, devices } from '../../db/schema';
import { createTestDb } from '../../tests/helpers/testDb';
import { seedBaseFixtures, createTruck, createDevice } from '../../tests/helpers/fixtures';
import { applyRemoval, applyTriage } from '../lifecycle.service';
import { AuthzError, BusinessError } from '../../lib/errors';

describe('lifecycle.service', () => {
  it('claim 1: calling a supervisor-only function as an installer throws (service layer, not UI)', () => {
    const { db } = createTestDb();
    const { orgId, installerId } = seedBaseFixtures(db);
    const deviceId = createDevice(db, orgId, { type: 'mother', serial: 'M1', status: 'repair' });

    expect(() =>
      applyTriage(db, {
        deviceId,
        actor: { id: installerId, orgId, role: 'installer' },
        outcome: 'revived',
      }),
    ).toThrow(AuthzError);
  });

  it('claim 2: a faulty removal that requests available_pool throws (illegal reason→disposition)', () => {
    const { db } = createTestDb();
    const { orgId, installerId } = seedBaseFixtures(db);
    const deviceId = createDevice(db, orgId, { type: 'mother', serial: 'M2', status: 'in_service' });

    expect(() =>
      applyRemoval(db, {
        deviceId,
        actorUserId: installerId,
        reason: 'faulty',
        disposition: 'available_pool',
      }),
    ).toThrow(BusinessError);
  });

  it('claim 3: an operational_swap removal is absent from a fault-reason recurrence query', () => {
    const { db } = createTestDb();
    const { orgId, installerId } = seedBaseFixtures(db);
    const truckId = createTruck(db, orgId, 'FZE001DI');

    const faultyDevice = createDevice(db, orgId, { type: 'mother', serial: 'M3A', status: 'in_service' });
    const swappedDevice = createDevice(db, orgId, { type: 'mother', serial: 'M3B', status: 'in_service' });

    // Simulate what movement.service.ts's transaction does when closing a truck_assignment:
    // one removed for a real fault, one removed for an operational swap.
    const now = Math.floor(Date.now() / 1000);
    db.insert(truckAssignments)
      .values({
        id: 'ta-fault',
        orgId,
        truckId,
        deviceId: faultyDevice,
        assignedAt: now,
        assignedBy: installerId,
        removedAt: now,
        removedBy: installerId,
        removalReason: 'faulty',
        disposition: 'repair_pool',
      })
      .run();
    db.insert(truckAssignments)
      .values({
        id: 'ta-swap',
        orgId,
        truckId,
        deviceId: swappedDevice,
        assignedAt: now,
        assignedBy: installerId,
        removedAt: now,
        removedBy: installerId,
        removalReason: 'operational_swap',
        disposition: 'available_pool',
      })
      .run();

    applyRemoval(db, {
      deviceId: faultyDevice,
      actorUserId: installerId,
      reason: 'faulty',
      disposition: 'repair_pool',
    });
    applyRemoval(db, {
      deviceId: swappedDevice,
      actorUserId: installerId,
      reason: 'operational_swap',
      disposition: 'available_pool',
    });

    // The fault/recurrence query: only faulty|damaged reasons count against fault history (§6).
    const faultHistory = db
      .select()
      .from(truckAssignments)
      .where(inArray(truckAssignments.removalReason, ['faulty', 'damaged']))
      .all();

    expect(faultHistory.map((r: { deviceId: string }) => r.deviceId)).toEqual([faultyDevice]);
    expect(faultHistory.map((r: { deviceId: string }) => r.deviceId)).not.toContain(swappedDevice);
  });

  it('hardening: ONE device with both a fault removal and an operational_swap removal counts once, not twice', () => {
    const { db } = createTestDb();
    const { orgId, supervisorId, installerId } = seedBaseFixtures(db);
    const truckId = createTruck(db, orgId, 'FZE002DI');
    const deviceId = createDevice(db, orgId, { type: 'mother', serial: 'M3C', status: 'in_service' });
    const now = Math.floor(Date.now() / 1000);

    // Cycle 1: assigned, then removed for a genuine fault.
    db.insert(truckAssignments)
      .values({
        id: 'ta-mixed-1',
        orgId,
        truckId,
        deviceId,
        assignedAt: now,
        assignedBy: installerId,
        removedAt: now,
        removedBy: installerId,
        removalReason: 'faulty',
        disposition: 'repair_pool',
      })
      .run();
    applyRemoval(db, { deviceId, actorUserId: installerId, reason: 'faulty', disposition: 'repair_pool' });

    // Supervisor triage revives it, then it's re-installed (available → in_service).
    applyTriage(db, { deviceId, actor: { id: supervisorId, orgId, role: 'supervisor' }, outcome: 'revived' });
    db.update(devices)
      .set({ lifecycleStatus: 'in_service' })
      .where(eq(devices.id, deviceId))
      .run();

    // Cycle 2: assigned again, this time removed for an operational swap — same device.
    db.insert(truckAssignments)
      .values({
        id: 'ta-mixed-2',
        orgId,
        truckId,
        deviceId,
        assignedAt: now,
        assignedBy: installerId,
        removedAt: now,
        removedBy: installerId,
        removalReason: 'operational_swap',
        disposition: 'available_pool',
      })
      .run();
    applyRemoval(db, {
      deviceId,
      actorUserId: installerId,
      reason: 'operational_swap',
      disposition: 'available_pool',
    });

    // The recurrence-style count for THIS device must reflect only the genuine fault, not the swap.
    const faultCountForDevice = db
      .select()
      .from(truckAssignments)
      .where(and(eq(truckAssignments.deviceId, deviceId), inArray(truckAssignments.removalReason, ['faulty', 'damaged'])))
      .all();

    expect(faultCountForDevice).toHaveLength(1);
    expect(faultCountForDevice[0].id).toBe('ta-mixed-1');
  });
});
