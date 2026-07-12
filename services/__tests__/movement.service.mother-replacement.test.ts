import { describe, it, expect } from 'vitest';
import { eq } from 'drizzle-orm';
import { createId } from '@paralleldrive/cuid2';
import { truckAssignments, movementLogs, devices } from '../../db/schema';
import { createTestDb } from '../../tests/helpers/testDb';
import { seedBaseFixtures, createTruck, createDevice } from '../../tests/helpers/fixtures';
import { replaceMotherLock } from '../movement.service';
import { BusinessError } from '../../lib/errors';

describe('movement.service — replaceMotherLock swap-conflict check', () => {
  it('an incoming mother in_service on another truck is blocked, not silently double-assigned', () => {
    const { db } = createTestDb();
    const { orgId, installerId } = seedBaseFixtures(db);
    const truckA = createTruck(db, orgId, 'FZE110DI'); // has the mother to be replaced
    const truckB = createTruck(db, orgId, 'FZE120DI'); // already has the "incoming" mother
    const now = Math.floor(Date.now() / 1000);

    const oldMotherId = createDevice(db, orgId, { type: 'mother', serial: 'MREP-OLD-1', status: 'in_service' });
    db.insert(truckAssignments)
      .values({
        id: createId(),
        orgId,
        truckId: truckA,
        deviceId: oldMotherId,
        assignedAt: now,
        assignedBy: installerId,
      })
      .run();

    const incomingMotherId = createDevice(db, orgId, {
      type: 'mother',
      serial: 'MREP-INCOMING-1',
      status: 'in_service',
    });
    const incomingAssignmentId = createId();
    db.insert(truckAssignments)
      .values({
        id: incomingAssignmentId,
        orgId,
        truckId: truckB,
        deviceId: incomingMotherId,
        assignedAt: now,
        assignedBy: installerId,
      })
      .run();

    expect(() =>
      replaceMotherLock(db, {
        orgId,
        actorUserId: installerId,
        truckId: truckA,
        newMotherDeviceId: incomingMotherId,
        reason: 'faulty',
      }),
    ).toThrow(BusinessError);

    // Nothing moved: the incoming mother is still exactly where it started, truck A still has
    // its original (unremoved) mother — this path must NOT be able to put one device on two
    // trucks, which is exactly what would happen if the block didn't fire.
    const truckAAssignment = db
      .select()
      .from(truckAssignments)
      .where(eq(truckAssignments.truckId, truckA))
      .get()!;
    expect(truckAAssignment.deviceId).toBe(oldMotherId);
    expect(truckAAssignment.removedAt).toBeNull();

    const incomingAssignment = db
      .select()
      .from(truckAssignments)
      .where(eq(truckAssignments.id, incomingAssignmentId))
      .get()!;
    expect(incomingAssignment.removedAt).toBeNull();
    expect(incomingAssignment.truckId).toBe(truckB);

    const oldMother = db.select().from(devices).where(eq(devices.id, oldMotherId)).get()!;
    expect(oldMother.lifecycleStatus).toBe('in_service'); // untouched — the block happens before the transaction
  });
});

describe('movement.service — replaceMotherLock atomicity under failure', () => {
  it('a failure injected between the two sides leaves BOTH device states and BOTH trucks unchanged', () => {
    const { db } = createTestDb();
    const { orgId, installerId } = seedBaseFixtures(db);
    const truckId = createTruck(db, orgId, 'FZE130DI');
    const now = Math.floor(Date.now() / 1000);

    const oldMotherId = createDevice(db, orgId, { type: 'mother', serial: 'MREP-ATOMIC-OLD', status: 'in_service' });
    const originalAssignmentId = createId();
    db.insert(truckAssignments)
      .values({
        id: originalAssignmentId,
        orgId,
        truckId,
        deviceId: oldMotherId,
        assignedAt: now,
        assignedBy: installerId,
      })
      .run();

    const newMotherId = createDevice(db, orgId, { type: 'mother', serial: 'MREP-ATOMIC-NEW', status: 'available' });

    // replaceMotherLock opens its own db.transaction() internally (unlike resolveTruckSwap,
    // which takes a tx). Wrapping the outer `db` alone would NOT reach the real `tx` object
    // drizzle constructs inside transaction() — insert calls happen via `tx.insert(...)`, not
    // `db.insert(...)`. So the Proxy has to intercept `.transaction` itself, wrap the `tx` it's
    // invoked with, THEN hand that wrapped tx to the real callback.
    function makeFailAfterFirstSideProxy(realDb: typeof db) {
      let truckAssignmentInsertSeen = false;
      return new Proxy(realDb, {
        get(dbTarget, dbProp, dbReceiver) {
          if (dbProp === 'transaction') {
            const originalTransaction = Reflect.get(dbTarget, dbProp, dbReceiver) as (
              cb: (tx: unknown) => unknown,
            ) => unknown;
            return (callback: (tx: unknown) => unknown) =>
              originalTransaction.call(dbTarget, (tx: unknown) => {
                const wrappedTx = new Proxy(tx as object, {
                  get(txTarget, txProp, txReceiver) {
                    if (txProp === 'insert') {
                      return (table: unknown) => {
                        if (table === truckAssignments && !truckAssignmentInsertSeen) {
                          truckAssignmentInsertSeen = true;
                          throw new Error(
                            'INJECTED FAILURE: crash before second side of mother_replacement completes',
                          );
                        }
                        return (Reflect.get(txTarget, txProp, txReceiver) as (t: unknown) => unknown).call(
                          txTarget,
                          table,
                        );
                      };
                    }
                    const orig = Reflect.get(txTarget, txProp, txReceiver);
                    return typeof orig === 'function' ? orig.bind(txTarget) : orig;
                  },
                });
                return callback(wrappedTx);
              });
          }
          const orig = Reflect.get(dbTarget, dbProp, dbReceiver);
          return typeof orig === 'function' ? orig.bind(dbTarget) : orig;
        },
      }) as typeof db;
    }

    const failingDb = makeFailAfterFirstSideProxy(db);

    expect(() =>
      replaceMotherLock(failingDb, {
        orgId,
        actorUserId: installerId,
        truckId,
        newMotherDeviceId: newMotherId,
        reason: 'faulty',
      }),
    ).toThrow(/INJECTED FAILURE/);

    const assignment = db
      .select()
      .from(truckAssignments)
      .where(eq(truckAssignments.id, originalAssignmentId))
      .get()!;
    expect(assignment.removedAt).toBeNull();
    expect(assignment.deviceId).toBe(oldMotherId);

    const anyOtherAssignmentOnTruck = db
      .select()
      .from(truckAssignments)
      .where(eq(truckAssignments.truckId, truckId))
      .all();
    expect(anyOtherAssignmentOnTruck).toHaveLength(1); // only the original — no partial second row

    const oldMother = db.select().from(devices).where(eq(devices.id, oldMotherId)).get()!;
    expect(oldMother.lifecycleStatus).toBe('in_service'); // never transitioned to repair

    const newMother = db.select().from(devices).where(eq(devices.id, newMotherId)).get()!;
    expect(newMother.lifecycleStatus).toBe('available'); // never transitioned to in_service

    const logs = db.select().from(movementLogs).where(eq(movementLogs.action, 'mother_replacement')).all();
    expect(logs).toHaveLength(0);
  });
});
