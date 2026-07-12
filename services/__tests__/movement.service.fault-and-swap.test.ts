import { describe, it, expect } from 'vitest';
import { eq } from 'drizzle-orm';
import { createId } from '@paralleldrive/cuid2';
import { truckAssignments, movementLogs, faultReports, devices } from '../../db/schema';
import { createTestDb } from '../../tests/helpers/testDb';
import { seedBaseFixtures, createTruck, createDevice } from '../../tests/helpers/fixtures';
import { registerKit } from '../registration.service';
import { installKit } from '../installation.service';
import { replaceSubLock, resolveTruckSwap } from '../movement.service';

function setupInstalledKit(db: ReturnType<typeof createTestDb>['db'], orgId: string, installerId: string, truckId: string) {
  const kit = registerKit(db, {
    orgId,
    actorUserId: installerId,
    motherSerial: `MSW${Math.random().toString(36).slice(2, 10)}`,
    subSerials: [
      `S1${Math.random().toString(36).slice(2, 10)}`,
      `S2${Math.random().toString(36).slice(2, 10)}`,
      `S3${Math.random().toString(36).slice(2, 10)}`,
    ],
    simNumber: '2348012340000',
  });
  installKit(db, {
    orgId,
    actorUserId: installerId,
    truckId,
    motherDeviceId: kit.motherDeviceId,
    subDeviceIds: kit.subDeviceIds as [string, string, string],
    company: 'mrs',
  });
  return kit;
}

describe('movement.service — replaceSubLock (§6 combined action)', () => {
  it('reason=faulty creates a linked fault_report; reason=operational_swap creates NONE', () => {
    const { db } = createTestDb();
    const { orgId, installerId } = seedBaseFixtures(db);
    const truckId = createTruck(db, orgId, 'FZE010DI');
    const kit = setupInstalledKit(db, orgId, installerId, truckId);

    const newSubForFault = createDevice(db, orgId, { type: 'sub', serial: 'REPL-FAULT-1', status: 'available' });

    const faultResult = replaceSubLock(db, {
      orgId,
      actorUserId: installerId,
      truckId,
      motherDeviceId: kit.motherDeviceId,
      slot: 'B',
      newSubDeviceId: newSubForFault,
      reason: 'faulty',
      faultDetails: {
        description: 'Sub-lock B not opening',
        locksAffected: ['B'],
      },
    });

    expect(faultResult.faultReportId).not.toBeNull();
    const linkedFault = db
      .select()
      .from(faultReports)
      .where(eq(faultReports.id, faultResult.faultReportId!))
      .get()!;
    expect(linkedFault.linkedMovementId).toBe(faultResult.movementLogId);
    expect(linkedFault.deviceId).toBe(kit.subDeviceIds[0]); // the OLD sub that came out

    // Second replace on the SAME kit, different slot, reason=operational_swap — no fault report.
    const newSubForSwap = createDevice(db, orgId, { type: 'sub', serial: 'REPL-SWAP-1', status: 'available' });

    const swapResult = replaceSubLock(db, {
      orgId,
      actorUserId: installerId,
      truckId,
      motherDeviceId: kit.motherDeviceId,
      slot: 'C',
      newSubDeviceId: newSubForSwap,
      reason: 'operational_swap',
    });

    expect(swapResult.faultReportId).toBeNull();

    const allFaultReportsForKit = db.select().from(faultReports).all();
    expect(allFaultReportsForKit).toHaveLength(1); // only the faulty one, ever
  });
});

describe('movement.service — truck_swap atomicity (reused injected-failure pattern)', () => {
  it('a failure injected mid-swap leaves BOTH trucks unchanged', () => {
    const { db } = createTestDb();
    const { orgId, installerId } = seedBaseFixtures(db);
    const truckA = createTruck(db, orgId, 'FZE020DI');
    const truckB = createTruck(db, orgId, 'FZE030DI');
    const deviceId = createDevice(db, orgId, { type: 'mother', serial: 'SWAP-ATOMIC-1', status: 'in_service' });

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

    const assignmentA = db
      .select()
      .from(truckAssignments)
      .where(eq(truckAssignments.id, originalAssignmentId))
      .get()!;
    expect(assignmentA.removedAt).toBeNull();
    expect(assignmentA.truckId).toBe(truckA);

    const anyOnTruckB = db.select().from(truckAssignments).where(eq(truckAssignments.truckId, truckB)).all();
    expect(anyOnTruckB).toHaveLength(0);

    const device = db.select().from(devices).where(eq(devices.id, deviceId)).get()!;
    expect(device.lifecycleStatus).toBe('in_service');

    const logs = db.select().from(movementLogs).where(eq(movementLogs.action, 'truck_swap')).all();
    expect(logs).toHaveLength(0);
  });
});
