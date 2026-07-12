import { describe, it, expect } from 'vitest';
import { eq, and, isNull, inArray } from 'drizzle-orm';
import { createId } from '@paralleldrive/cuid2';
import {
  devices,
  truckAssignments,
  slotPairings,
  verifications,
  conflictReviews,
  movementLogs,
} from '../../db/schema';
import { createTestDb } from '../../tests/helpers/testDb';
import { seedBaseFixtures, createTruck, createDevice } from '../../tests/helpers/fixtures';
import { getTrustState, recordKitVerification } from '../verification.service';

function serialOf(db: ReturnType<typeof createTestDb>['db'], deviceId: string): string {
  return db.select({ serial: devices.serial }).from(devices).where(eq(devices.id, deviceId)).get()!.serial;
}

function installKitOnTruck(
  db: ReturnType<typeof createTestDb>['db'],
  orgId: string,
  installerId: string,
  truckId: string,
) {
  const motherId = createDevice(db, orgId, {
    type: 'mother',
    serial: `M${Math.random().toString(36).slice(2, 10)}`.toUpperCase(),
    status: 'in_service',
  });
  const subIds = [0, 1, 2].map(() =>
    createDevice(db, orgId, {
      type: 'sub',
      serial: `S${Math.random().toString(36).slice(2, 10)}`.toUpperCase(),
      status: 'in_service',
    }),
  );
  const now = Math.floor(Date.now() / 1000);
  db.insert(truckAssignments)
    .values({ id: createId(), orgId, truckId, deviceId: motherId, assignedAt: now, assignedBy: installerId })
    .run();
  subIds.forEach((subId, i) => {
    db.insert(slotPairings)
      .values({
        id: createId(),
        orgId,
        motherDeviceId: motherId,
        slot: (['B', 'C', 'D'] as const)[i],
        subDeviceId: subId,
        pairedAt: now,
        pairedBy: installerId,
      })
      .run();
  });
  return { motherId, subIds };
}

describe('verification.service — mismatch correction: wrong mother scanned on a truck', () => {
  it('closes the wrong assignment, opens the correct one, records expected vs observed, opens a conflict_review, and flips trust to verified against reality', () => {
    const { db } = createTestDb();
    const { orgId, installerId } = seedBaseFixtures(db);
    const truckId = createTruck(db, orgId, 'FZE700DI');
    const { motherId: wrongMotherId, subIds: wrongSubIds } = installKitOnTruck(db, orgId, installerId, truckId);

    // The REAL mother (already known to the system, sitting available with its own correct kit,
    // matching the same subs the scan will observe) is what's physically on the truck.
    const realMotherId = createDevice(db, orgId, {
      type: 'mother',
      serial: 'REAL-MOTHER-1',
      status: 'available',
    });
    const now = Math.floor(Date.now() / 1000);
    // The real mother gets its OWN matching subs already paired, so this test isolates the
    // mother-level correction — sub-level correction is covered by the next test.
    const realSubIds = [0, 1, 2].map(() =>
      createDevice(db, orgId, {
        type: 'sub',
        serial: `RS${Math.random().toString(36).slice(2, 10)}`.toUpperCase(),
        status: 'available',
      }),
    );
    realSubIds.forEach((subId, i) => {
      db.insert(slotPairings)
        .values({
          id: createId(),
          orgId,
          motherDeviceId: realMotherId,
          slot: (['B', 'C', 'D'] as const)[i],
          subDeviceId: subId,
          pairedAt: now,
          pairedBy: installerId,
        })
        .run();
    });

    expect(getTrustState(db, { truckId }).state).toBe('unverified');

    const result = recordKitVerification(db, {
      orgId,
      actorUserId: installerId,
      truckId,
      motherSerial: serialOf(db, realMotherId),
      motherSource: 'qr_scan',
      subs: realSubIds.map((id) => ({ serial: serialOf(db, id), source: 'qr_scan' as const })),
    });

    expect(result.matched).toBe(false);
    if (!result.matched) {
      // expected_subs_json means "what the registry claimed for THIS TRUCK before the
      // correction" — the OUTGOING (wrong) mother's prior kit, not the incoming mother's own
      // unrelated history.
      expect(result.expectedSubSerials.sort()).toEqual(wrongSubIds.map((id) => serialOf(db, id)).sort());
    }

    // The WRONG assignment (old mother) is closed.
    const oldAssignment = db
      .select()
      .from(truckAssignments)
      .where(eq(truckAssignments.deviceId, wrongMotherId))
      .get()!;
    expect(oldAssignment.removedAt).not.toBeNull();
    expect(oldAssignment.removalReason).toBe('unlogged_swap_detected');

    // The CORRECT assignment (real mother) is open on this truck.
    const newAssignment = db
      .select()
      .from(truckAssignments)
      .where(and(eq(truckAssignments.truckId, truckId), isNull(truckAssignments.removedAt)))
      .get()!;
    expect(newAssignment.deviceId).toBe(realMotherId);

    // The verifications row records the correction.
    const verificationRow = db.select().from(verifications).where(eq(verifications.id, (result as { verificationId: string }).verificationId)).get()!;
    expect(verificationRow.result).toBe('mismatch_corrected');
    expect(verificationRow.observedMaster).toBe(serialOf(db, realMotherId));

    // Exactly one conflict_review, preserving both versions.
    const reviews = db.select().from(conflictReviews).all();
    expect(reviews).toHaveLength(1);
    expect(reviews[0].kind).toBe('unlogged_swap');
    const payload = JSON.parse(reviews[0].payloadJson);
    expect(payload.observedMotherSerial).toBe(serialOf(db, realMotherId));

    // Trust flips to verified against the OBSERVED (real) mother, on this truck.
    expect(getTrustState(db, { truckId }).state).toBe('verified');
    expect(getTrustState(db, { motherDeviceId: realMotherId }).state).toBe('verified');

    const oldMotherDevice = db.select().from(devices).where(eq(devices.id, wrongMotherId)).get()!;
    expect(oldMotherDevice.lifecycleStatus).toBe('available'); // released to the pool, not fabricated a location
  });
});

describe('verification.service — mismatch correction: right mother, wrong subs', () => {
  it('closes/opens only the differing slot pairings; the unchanged sub is left completely untouched', () => {
    const { db } = createTestDb();
    const { orgId, installerId } = seedBaseFixtures(db);
    const truckId = createTruck(db, orgId, 'FZE710DI');
    const { motherId, subIds } = installKitOnTruck(db, orgId, installerId, truckId);

    const unchangedSubId = subIds[0]; // slot B — stays exactly as-is
    const correctedSubId = createDevice(db, orgId, { type: 'sub', serial: 'CORRECTED-SUB-1', status: 'available' });

    const unchangedPairingBefore = db
      .select()
      .from(slotPairings)
      .where(and(eq(slotPairings.subDeviceId, unchangedSubId), isNull(slotPairings.unpairedAt)))
      .get()!;

    const result = recordKitVerification(db, {
      orgId,
      actorUserId: installerId,
      truckId,
      motherSerial: serialOf(db, motherId),
      motherSource: 'qr_scan',
      subs: [
        { serial: serialOf(db, unchangedSubId), source: 'qr_scan' }, // still slot B, unchanged
        { serial: serialOf(db, correctedSubId), source: 'qr_scan' }, // replaces whatever was in C or D
        { serial: serialOf(db, subIds[2]), source: 'qr_scan' }, // slot D, unchanged
      ],
    });

    expect(result.matched).toBe(false);

    // Unchanged pairing (slot B) is EXACTLY as it was — same row, still open, never touched.
    const unchangedPairingAfter = db
      .select()
      .from(slotPairings)
      .where(eq(slotPairings.id, unchangedPairingBefore.id))
      .get()!;
    expect(unchangedPairingAfter.unpairedAt).toBeNull();
    expect(unchangedPairingAfter).toEqual(unchangedPairingBefore);

    // The slot D pairing for subIds[2] is also untouched.
    const slotDPairing = db
      .select()
      .from(slotPairings)
      .where(and(eq(slotPairings.subDeviceId, subIds[2]), isNull(slotPairings.unpairedAt)))
      .get()!;
    expect(slotDPairing).toBeTruthy();

    // The wrong sub (originally in slot C) is closed with unlogged_swap_detected.
    const wrongSubId = subIds[1];
    const closedPairing = db
      .select()
      .from(slotPairings)
      .where(eq(slotPairings.subDeviceId, wrongSubId))
      .get()!;
    expect(closedPairing.unpairedAt).not.toBeNull();
    expect(closedPairing.removalReason).toBe('unlogged_swap_detected');
    expect(closedPairing.disposition).toBe('available_pool');

    // The corrected sub is now paired into slot C, in_service.
    const newPairing = db
      .select()
      .from(slotPairings)
      .where(and(eq(slotPairings.subDeviceId, correctedSubId), isNull(slotPairings.unpairedAt)))
      .get()!;
    expect(newPairing.slot).toBe('C');
    const correctedDevice = db.select().from(devices).where(eq(devices.id, correctedSubId)).get()!;
    expect(correctedDevice.lifecycleStatus).toBe('in_service');
  });
});

describe('verification.service — mismatch correction: unknown scanned device', () => {
  it('an unregistered sub discovered by scan is registered inline and ends up correctly assigned', () => {
    const { db } = createTestDb();
    const { orgId, installerId } = seedBaseFixtures(db);
    const truckId = createTruck(db, orgId, 'FZE720DI');
    const { motherId, subIds } = installKitOnTruck(db, orgId, installerId, truckId);

    const unknownSerial = 'NEVER-REGISTERED-SUB-1';
    expect(db.select().from(devices).where(eq(devices.serial, unknownSerial)).get()).toBeUndefined();

    const result = recordKitVerification(db, {
      orgId,
      actorUserId: installerId,
      truckId,
      motherSerial: serialOf(db, motherId),
      motherSource: 'qr_scan',
      subs: [
        { serial: serialOf(db, subIds[0]), source: 'qr_scan' },
        { serial: serialOf(db, subIds[1]), source: 'qr_scan' },
        { serial: unknownSerial, source: 'manual' },
      ],
    });

    expect(result.matched).toBe(false);

    const newDevice = db.select().from(devices).where(eq(devices.serial, unknownSerial)).get()!;
    expect(newDevice).toBeTruthy();
    expect(newDevice.deviceType).toBe('sub');
    expect(newDevice.lifecycleStatus).toBe('in_service'); // registered AND correctly assigned

    const pairing = db
      .select()
      .from(slotPairings)
      .where(and(eq(slotPairings.subDeviceId, newDevice.id), isNull(slotPairings.unpairedAt)))
      .get()!;
    expect(pairing.motherDeviceId).toBe(motherId);
    expect(pairing.slot).toBe('D');

    if (!result.matched) {
      expect(result.weakestTier).toBe('manual'); // the inline-registered sub was typed, not scanned
    }
  });
});

describe('verification.service — unlogged_swap_detected is excluded from fault-recurrence queries', () => {
  it('a mismatch correction never appears in a fault-reason query, even though it closed a slot_pairing', () => {
    const { db } = createTestDb();
    const { orgId, installerId } = seedBaseFixtures(db);
    const truckId = createTruck(db, orgId, 'FZE730DI');
    const { motherId, subIds } = installKitOnTruck(db, orgId, installerId, truckId);
    const correctedSubId = createDevice(db, orgId, { type: 'sub', serial: 'FAULT-EXCL-SUB', status: 'available' });

    recordKitVerification(db, {
      orgId,
      actorUserId: installerId,
      truckId,
      motherSerial: serialOf(db, motherId),
      motherSource: 'qr_scan',
      subs: [
        { serial: serialOf(db, correctedSubId), source: 'qr_scan' },
        { serial: serialOf(db, subIds[1]), source: 'qr_scan' },
        { serial: serialOf(db, subIds[2]), source: 'qr_scan' },
      ],
    });

    // The removed sub (subIds[0]) has an unlogged_swap_detected closure — reuse the same
    // fault-reason discrimination filter proven in lifecycle.service.test.ts and
    // fault.service.test.ts: only faulty|damaged count.
    const faultReasonRows = db
      .select()
      .from(slotPairings)
      .where(and(eq(slotPairings.subDeviceId, subIds[0]), inArray(slotPairings.removalReason, ['faulty', 'damaged'])))
      .all();
    expect(faultReasonRows).toHaveLength(0);

    const unloggedSwapRows = db
      .select()
      .from(slotPairings)
      .where(and(eq(slotPairings.subDeviceId, subIds[0]), eq(slotPairings.removalReason, 'unlogged_swap_detected')))
      .all();
    expect(unloggedSwapRows).toHaveLength(1); // it DID happen — just not as a fault
  });
});

describe('verification.service — mismatch correction atomicity', () => {
  it('a failure injected mid-correction rolls back the ENTIRE correction: registry unchanged, no conflict_review, no partial assignment', () => {
    const { db } = createTestDb();
    const { orgId, installerId } = seedBaseFixtures(db);
    const truckId = createTruck(db, orgId, 'FZE740DI');
    const { motherId: wrongMotherId } = installKitOnTruck(db, orgId, installerId, truckId);
    const realMotherId = createDevice(db, orgId, { type: 'mother', serial: 'ATOMIC-REAL-MOTHER', status: 'available' });
    const now = Math.floor(Date.now() / 1000);
    const realSubIds = [0, 1, 2].map(() =>
      createDevice(db, orgId, {
        type: 'sub',
        serial: `ATOMIC-SUB-${Math.random().toString(36).slice(2, 8)}`.toUpperCase(),
        status: 'available',
      }),
    );
    realSubIds.forEach((subId, i) => {
      db.insert(slotPairings)
        .values({
          id: createId(),
          orgId,
          motherDeviceId: realMotherId,
          slot: (['B', 'C', 'D'] as const)[i],
          subDeviceId: subId,
          pairedAt: now,
          pairedBy: installerId,
        })
        .run();
    });

    // Wrap db.transaction so the SECOND insert into truckAssignments (opening the corrected
    // assignment) throws — after the first side (closing the wrong assignment) has already
    // executed its writes against the tx. Same pattern as the truck_swap/mother_replacement
    // atomicity tests.
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
                          throw new Error('INJECTED FAILURE: crash before correction completes');
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
      recordKitVerification(failingDb, {
        orgId,
        actorUserId: installerId,
        truckId,
        motherSerial: serialOf(db, realMotherId),
        motherSource: 'qr_scan',
        subs: realSubIds.map((id) => ({ serial: serialOf(db, id), source: 'qr_scan' as const })),
      }),
    ).toThrow(/INJECTED FAILURE/);

    // Registry exactly as it was: wrong assignment still open, no new assignment for real mother.
    const wrongAssignment = db
      .select()
      .from(truckAssignments)
      .where(eq(truckAssignments.deviceId, wrongMotherId))
      .get()!;
    expect(wrongAssignment.removedAt).toBeNull();

    const anyRealMotherAssignment = db
      .select()
      .from(truckAssignments)
      .where(eq(truckAssignments.deviceId, realMotherId))
      .all();
    expect(anyRealMotherAssignment).toHaveLength(0);

    expect(db.select().from(verifications).all()).toHaveLength(0);
    expect(db.select().from(conflictReviews).all()).toHaveLength(0);
    expect(db.select().from(movementLogs).where(eq(movementLogs.action, 'unlogged_swap_detected')).all()).toHaveLength(0);

    const realMotherDevice = db.select().from(devices).where(eq(devices.id, realMotherId)).get()!;
    expect(realMotherDevice.lifecycleStatus).toBe('available'); // never transitioned
  });
});

describe('verification.service — every mismatch correction opens exactly one conflict_review', () => {
  it('a mother-level correction and a sub-level correction each open exactly one conflict_review, never zero or more than one', () => {
    const { db } = createTestDb();
    const { orgId, installerId } = seedBaseFixtures(db);

    // Mother-level correction.
    const truckA = createTruck(db, orgId, 'FZE750DI');
    const { motherId: wrongMotherA } = installKitOnTruck(db, orgId, installerId, truckA);
    void wrongMotherA;
    const realMotherA = createDevice(db, orgId, { type: 'mother', serial: 'CR-A-REAL-MOTHER', status: 'available' });
    const now = Math.floor(Date.now() / 1000);
    const realSubsA = [0, 1, 2].map(() =>
      createDevice(db, orgId, { type: 'sub', serial: `CR-A-SUB-${Math.random().toString(36).slice(2, 8)}`.toUpperCase(), status: 'available' }),
    );
    realSubsA.forEach((subId, i) => {
      db.insert(slotPairings)
        .values({ id: createId(), orgId, motherDeviceId: realMotherA, slot: (['B', 'C', 'D'] as const)[i], subDeviceId: subId, pairedAt: now, pairedBy: installerId })
        .run();
    });

    recordKitVerification(db, {
      orgId,
      actorUserId: installerId,
      truckId: truckA,
      motherSerial: serialOf(db, realMotherA),
      motherSource: 'qr_scan',
      subs: realSubsA.map((id) => ({ serial: serialOf(db, id), source: 'qr_scan' as const })),
    });

    expect(db.select().from(conflictReviews).all()).toHaveLength(1);

    // Sub-level correction on a SEPARATE truck.
    const truckB = createTruck(db, orgId, 'FZE760DI');
    const { motherId: motherB, subIds: subIdsB } = installKitOnTruck(db, orgId, installerId, truckB);
    const correctedSubB = createDevice(db, orgId, { type: 'sub', serial: 'CR-B-CORRECTED', status: 'available' });

    recordKitVerification(db, {
      orgId,
      actorUserId: installerId,
      truckId: truckB,
      motherSerial: serialOf(db, motherB),
      motherSource: 'qr_scan',
      subs: [
        { serial: serialOf(db, correctedSubB), source: 'qr_scan' },
        { serial: serialOf(db, subIdsB[1]), source: 'qr_scan' },
        { serial: serialOf(db, subIdsB[2]), source: 'qr_scan' },
      ],
    });

    // Exactly two total now — one per correction, never zero, never doubled.
    expect(db.select().from(conflictReviews).all()).toHaveLength(2);
  });
});
