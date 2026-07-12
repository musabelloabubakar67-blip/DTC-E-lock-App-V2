import { describe, it, expect } from 'vitest';
import { eq, isNull, and } from 'drizzle-orm';
import { createId } from '@paralleldrive/cuid2';
import { truckAssignments, movementLogs, devices } from '../../db/schema';
import { createTestDb } from '../../tests/helpers/testDb';
import { seedBaseFixtures, createTruck, createDevice } from '../../tests/helpers/fixtures';
import { checkIncomingDeviceConflict, resolveTruckSwap } from '../movement.service';

describe('movement.service — swap-conflict helper', () => {
  it('claim 4: a device in_service on another truck is blocked, and truck_swap moves both sides in one transaction', () => {
    const { db } = createTestDb();
    const { orgId, installerId } = seedBaseFixtures(db);
    const truckA = createTruck(db, orgId, 'FZE100DI');
    const truckB = createTruck(db, orgId, 'FZE200DI');
    const deviceId = createDevice(db, orgId, { type: 'mother', serial: 'M4', status: 'in_service' });

    const now = Math.floor(Date.now() / 1000);
    db.insert(truckAssignments)
      .values({
        id: createId(),
        orgId,
        truckId: truckA,
        deviceId,
        assignedAt: now,
        assignedBy: installerId,
      })
      .run();

    // Blocked: device is in_service on truck A, someone tries to bring it onto truck B.
    const conflict = checkIncomingDeviceConflict(db, { deviceId, targetTruckId: truckB });
    expect(conflict).toEqual({ action: 'blocked', code: 'in_service_elsewhere', currentTruckId: truckA });

    // Resolve via truck_swap — one transaction, both sides move.
    db.transaction((tx: typeof db) => {
      resolveTruckSwap(tx, { deviceId, toTruckId: truckB, actorUserId: installerId });
    });

    const oldAssignment = db
      .select()
      .from(truckAssignments)
      .where(eq(truckAssignments.truckId, truckA))
      .get()!;
    expect(oldAssignment.removedAt).not.toBeNull();
    expect(oldAssignment.removalReason).toBe('operational_swap');
    expect(oldAssignment.disposition).toBe('available_pool');

    const newAssignment = db
      .select()
      .from(truckAssignments)
      .where(and(eq(truckAssignments.truckId, truckB), isNull(truckAssignments.removedAt)))
      .get()!;
    expect(newAssignment).toBeTruthy();
    expect(newAssignment.deviceId).toBe(deviceId);

    const device = db.select().from(devices).where(eq(devices.id, deviceId)).get()!;
    expect(device.lifecycleStatus).toBe('in_service');

    const log = db
      .select()
      .from(movementLogs)
      .where(eq(movementLogs.action, 'truck_swap'))
      .get()!;
    expect(log).toBeTruthy();
    expect(log.truckId).toBe(truckB);
    expect(log.sourceTruckId).toBe(truckA);
    expect(log.inDeviceId).toBe(deviceId);

    // Now confirm it's usable on truck B for a fresh caller (no longer blocked/elsewhere).
    const truckC = createTruck(db, orgId, 'FZE300DI');
    const secondCheck = checkIncomingDeviceConflict(db, { deviceId, targetTruckId: truckC });
    expect(secondCheck).toEqual({ action: 'blocked', code: 'in_service_elsewhere', currentTruckId: truckB });
  });

  it('claim 5: the partial unique index physically prevents two open truck_assignments for one device', () => {
    const { db, sqlite } = createTestDb();
    const { orgId, installerId } = seedBaseFixtures(db);
    const truckA = createTruck(db, orgId, 'FZE400DI');
    const truckB = createTruck(db, orgId, 'FZE500DI');
    const deviceId = createDevice(db, orgId, { type: 'mother', serial: 'M5', status: 'in_service' });

    const now = Math.floor(Date.now() / 1000);
    db.insert(truckAssignments)
      .values({
        id: createId(),
        orgId,
        truckId: truckA,
        deviceId,
        assignedAt: now,
        assignedBy: installerId,
      })
      .run();

    // Second OPEN assignment for the same device (different truck, both removed_at IS NULL) —
    // must fail at the DB level via uq_open_assignment_device, independent of any service check.
    expect(() =>
      db
        .insert(truckAssignments)
        .values({
          id: createId(),
          orgId,
          truckId: truckB,
          deviceId,
          assignedAt: now,
          assignedBy: installerId,
        })
        .run(),
    ).toThrow(/UNIQUE constraint failed/);

    sqlite.close();
  });
});

describe('movement.service — swap atomicity under failure (hardening)', () => {
  it('a failure injected between the two sides of a truck_swap rolls back BOTH sides, not just the second', () => {
    const { db } = createTestDb();
    const { orgId, installerId } = seedBaseFixtures(db);
    const truckA = createTruck(db, orgId, 'FZE600DI');
    const truckB = createTruck(db, orgId, 'FZE700DI');
    const deviceId = createDevice(db, orgId, { type: 'mother', serial: 'M6', status: 'in_service' });

    const now = Math.floor(Date.now() / 1000);
    const originalAssignmentId = createId();
    db.insert(truckAssignments)
      .values({
        id: originalAssignmentId,
        orgId,
        truckId: truckA,
        deviceId,
        assignedAt: now,
        assignedBy: installerId,
      })
      .run();

    // Wrap the real tx so the SECOND side of the swap (opening the new truck_assignment on
    // truck B) throws — AFTER the first side (closing truck A's assignment + the device's
    // lifecycle transition) has already executed its writes against the tx. If the whole
    // db.transaction() isn't atomic, truck A's assignment would end up closed with no
    // replacement — a device silently vanishing from the fleet. That's the failure mode this
    // proves does NOT happen.
    function makeFailAfterFirstSideProxy(realTx: typeof db) {
      let truckAssignmentInsertSeen = false;
      return new Proxy(realTx, {
        get(target, prop, receiver) {
          if (prop === 'insert') {
            return (table: unknown) => {
              if (table === truckAssignments && !truckAssignmentInsertSeen) {
                truckAssignmentInsertSeen = true;
                throw new Error('INJECTED FAILURE: crash before second side of swap completes');
              }
              return (Reflect.get(target, prop, receiver) as (t: unknown) => unknown).call(target, table);
            };
          }
          const orig = Reflect.get(target, prop, receiver);
          return typeof orig === 'function' ? orig.bind(target) : orig;
        },
      }) as typeof db;
    }

    expect(() => {
      db.transaction((tx: typeof db) => {
        const failingTx = makeFailAfterFirstSideProxy(tx);
        resolveTruckSwap(failingTx, { deviceId, toTruckId: truckB, actorUserId: installerId });
      });
    }).toThrow(/INJECTED FAILURE/);

    // Prove full rollback: the DB must look EXACTLY as it did before the swap was attempted.
    const assignment = db
      .select()
      .from(truckAssignments)
      .where(eq(truckAssignments.id, originalAssignmentId))
      .get()!;
    expect(assignment.removedAt).toBeNull(); // still open — the "first side" write was rolled back too
    expect(assignment.truckId).toBe(truckA);

    const anyAssignmentOnTruckB = db
      .select()
      .from(truckAssignments)
      .where(eq(truckAssignments.truckId, truckB))
      .all();
    expect(anyAssignmentOnTruckB).toHaveLength(0); // no partial assignment on the destination truck

    const device = db.select().from(devices).where(eq(devices.id, deviceId)).get()!;
    expect(device.lifecycleStatus).toBe('in_service'); // never dropped to 'available' mid-swap

    const logs = db.select().from(movementLogs).where(eq(movementLogs.action, 'truck_swap')).all();
    expect(logs).toHaveLength(0); // no movement_log for a swap that never actually happened
  });
});
