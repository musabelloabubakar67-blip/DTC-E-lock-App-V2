import { describe, it, expect } from 'vitest';
import { eq } from 'drizzle-orm';
import { truckAssignments, devices } from '../../db/schema';
import { createTestDb } from '../../tests/helpers/testDb';
import { seedBaseFixtures, createTruck, createDevice } from '../../tests/helpers/fixtures';
import { getDeviceFaultHistory } from '../fault.service';
import { applyRemoval, applyTriage } from '../lifecycle.service';

describe('fault.service — getDeviceFaultHistory', () => {
  it('a fault-history load with mixed removal history counts only the fault, not the operational_swap', () => {
    const { db } = createTestDb();
    const { orgId, supervisorId, installerId } = seedBaseFixtures(db);
    const truckId = createTruck(db, orgId, 'FZE900DI');
    const deviceId = createDevice(db, orgId, { type: 'mother', serial: 'FH1', status: 'in_service' });
    const now = Math.floor(Date.now() / 1000);

    // Cycle 1: assigned, removed for a genuine fault.
    db.insert(truckAssignments)
      .values({
        id: 'fh-ta-1',
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

    // Revived, then reinstalled (in_service) directly on the devices row — same shortcut the
    // lifecycle.service mixed-history test uses, since building a full install transaction
    // isn't needed to prove the fault-history query.
    applyTriage(db, { deviceId, actor: { id: supervisorId, orgId, role: 'supervisor' }, outcome: 'revived' });
    db.update(devices).set({ lifecycleStatus: 'in_service' }).where(eq(devices.id, deviceId)).run();

    // Cycle 2: assigned again, removed for an operational swap — same device.
    db.insert(truckAssignments)
      .values({
        id: 'fh-ta-2',
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

    const history = getDeviceFaultHistory(db, deviceId);

    expect(history.count).toBe(1);
    expect(history.mostRecentAt).toBe(now);
  });

  it('a device with zero fault-reason removals reports count 0 and mostRecentAt null', () => {
    const { db } = createTestDb();
    const { orgId } = seedBaseFixtures(db);
    const deviceId = createDevice(db, orgId, { type: 'mother', serial: 'FH2', status: 'available' });

    const history = getDeviceFaultHistory(db, deviceId);

    expect(history.count).toBe(0);
    expect(history.mostRecentAt).toBeNull();
  });
});
