import 'fake-indexeddb/auto';
import { describe, it, expect } from 'vitest';
import { eq, and, isNull } from 'drizzle-orm';
import { faultReports, syncMutations, conflictReviews, truckAssignments } from '../../db/schema';
import { createTestDb } from '../../tests/helpers/testDb';
import { seedBaseFixtures, createTruck, createDevice } from '../../tests/helpers/fixtures';
import { applySyncBatch, type IncomingMutation } from '../sync.service';
import { getTrustState } from '../verification.service';
import { slotPairings, devices, verifications } from '../../db/schema';
import { createId } from '@paralleldrive/cuid2';

function serialOf(db: ReturnType<typeof createTestDb>['db'], deviceId: string): string {
  return db.select({ serial: devices.serial }).from(devices).where(eq(devices.id, deviceId)).get()!.serial;
}

function faultMutation(id: string, seq: number, clientTs: number, payload: Record<string, unknown>): IncomingMutation {
  return { id, endpoint: '/api/faults', payload, clientTs, seq };
}

function verificationMutation(id: string, seq: number, clientTs: number, payload: Record<string, unknown>): IncomingMutation {
  return { id, endpoint: '/api/verifications', payload, clientTs, seq };
}

/**
 * Recursively wraps a drizzle db/tx so that EVERY nested `.transaction()` call (savepoints
 * included) gets the same treatment, and `.insert()` throws the first time `shouldFail` says
 * so. The verification mismatch-correction path nests: sync.service's outer db.transaction()
 * (real BEGIN) → verification.service's correctKitMismatch's db.transaction() (a SAVEPOINT on
 * top of it) — a single-level proxy (as used in earlier atomicity tests) doesn't reach that
 * second level; this one does, at arbitrary depth.
 */
function makeRecursiveFailureProxy<T extends object>(target: T, shouldFail: (table: unknown) => boolean): T {
  return new Proxy(target, {
    get(t, prop, receiver) {
      if (prop === 'transaction') {
        const orig = Reflect.get(t, prop, receiver) as (cb: (tx: unknown) => unknown) => unknown;
        return (callback: (tx: unknown) => unknown) =>
          orig.call(t, (tx: unknown) => callback(makeRecursiveFailureProxy(tx as object, shouldFail)));
      }
      if (prop === 'insert') {
        const orig = Reflect.get(t, prop, receiver) as (table: unknown) => unknown;
        return (table: unknown) => {
          if (shouldFail(table)) {
            throw new Error('INJECTED FAILURE: crash mid mismatch-correction');
          }
          return orig.call(t, table);
        };
      }
      const orig = Reflect.get(t, prop, receiver);
      return typeof orig === 'function' ? orig.bind(t) : orig;
    },
  }) as T;
}

function movementMutation(id: string, seq: number, clientTs: number, payload: Record<string, unknown>): IncomingMutation {
  return { id, endpoint: '/api/movements', payload, clientTs, seq };
}

describe('sync.service — rule A: ack implies applied', () => {
  it('dispatch throws → no applied ledger row, not acked applied, stays actionable', () => {
    const { db } = createTestDb();
    const { orgId, installerId } = seedBaseFixtures(db);
    const truckId = createTruck(db, orgId, 'FZE800SY');

    const mutation: IncomingMutation = {
      id: 'mut-throws-1',
      endpoint: '/api/installations',
      payload: { truckId, motherDeviceId: 'does-not-exist', subDeviceIds: ['a', 'b', 'c'], company: 'mrs' },
      clientTs: 1000,
      seq: 1,
    };

    const [outcome] = applySyncBatch(db, {
      orgId,
      actor: { id: installerId, orgId, role: 'installer' },
      mutations: [mutation],
    });

    expect(outcome.status).not.toBe('applied');
    expect(outcome.status).toBe('conflicted');

    const ledgerRow = db.select().from(syncMutations).where(eq(syncMutations.clientMutationId, mutation.id)).get()!;
    expect(ledgerRow.status).not.toBe('applied');
    expect(ledgerRow.status).toBe('conflicted');

    // Still actionable — it landed in conflict_reviews rather than vanishing as "done".
    const reviews = db.select().from(conflictReviews).all();
    expect(reviews).toHaveLength(1);
    expect(reviews[0].kind).toBe('sync_conflict');
  });
});

describe('sync.service — idempotent replay', () => {
  it('the same mutation ID applied twice: effect happens once, acked applied both times', () => {
    const { db } = createTestDb();
    const { orgId, installerId } = seedBaseFixtures(db);
    const truckId = createTruck(db, orgId, 'FZE801SY');
    const deviceId = createDevice(db, orgId, { type: 'mother', serial: 'SYNC-REPLAY-1', status: 'in_service' });

    const mutation = faultMutation('mut-replay-1', 1, 1000, {
      truckId,
      deviceId,
      locksAffected: ['B'],
      description: 'sub-lock not opening',
    });

    const [first] = applySyncBatch(db, { orgId, actor: { id: installerId, orgId, role: 'installer' }, mutations: [mutation] });
    const [second] = applySyncBatch(db, { orgId, actor: { id: installerId, orgId, role: 'installer' }, mutations: [mutation] });

    expect(first.status).toBe('applied');
    expect(second.status).toBe('applied'); // acked BOTH times

    const rows = db.select().from(faultReports).where(eq(faultReports.deviceId, deviceId)).all();
    expect(rows).toHaveLength(1); // effect happened ONCE
  });
});

describe('sync.service — happy path actually changes the registry', () => {
  it('a batch dispatches and the fault report genuinely exists afterward', () => {
    const { db } = createTestDb();
    const { orgId, installerId } = seedBaseFixtures(db);
    const truckId = createTruck(db, orgId, 'FZE802SY');
    const deviceId = createDevice(db, orgId, { type: 'mother', serial: 'SYNC-HAPPY-1', status: 'in_service' });

    const mutation = faultMutation('mut-happy-1', 1, 1000, {
      truckId,
      deviceId,
      locksAffected: ['B'],
      description: 'device offline',
    });

    const [outcome] = applySyncBatch(db, { orgId, actor: { id: installerId, orgId, role: 'installer' }, mutations: [mutation] });

    expect(outcome.status).toBe('applied');
    const row = db.select().from(faultReports).where(eq(faultReports.deviceId, deviceId)).get();
    expect(row).toBeTruthy();
    expect(row!.description).toBe('device offline');
  });
});

describe('sync.service — server-authoritative conflict (no last-write-wins)', () => {
  it('a device assigned to two trucks in one batch: first applies, second conflicts; the registry reflects only the winner', () => {
    const { db } = createTestDb();
    const { orgId, installerId } = seedBaseFixtures(db);
    const truckA = createTruck(db, orgId, 'FZE803SY');
    const truckB = createTruck(db, orgId, 'FZE804SY');
    const motherId = createDevice(db, orgId, { type: 'mother', serial: 'SYNC-CONFLICT-1', status: 'available' });

    const first = movementMutation('mut-conflict-1', 1, 1000, {
      kind: 'new_assignment',
      truckId: truckA,
      motherDeviceId: motherId,
    });
    const second = movementMutation('mut-conflict-2', 2, 2000, {
      kind: 'new_assignment',
      truckId: truckB,
      motherDeviceId: motherId,
    });

    const outcomes = applySyncBatch(db, {
      orgId,
      actor: { id: installerId, orgId, role: 'installer' },
      mutations: [first, second],
    });

    expect(outcomes[0].status).toBe('applied');
    expect(outcomes[1].status).toBe('conflicted');

    const reviews = db.select().from(conflictReviews).all();
    expect(reviews).toHaveLength(1);
    const payload = JSON.parse(reviews[0].payloadJson);
    expect(payload.queuedMutation.id).toBe('mut-conflict-2');
    expect(payload.currentServerState[motherId]).toBeTruthy(); // both versions preserved

    // Registry reflects ONLY the winner — device is on truck A, not truck B.
    const openAssignment = db
      .select()
      .from(truckAssignments)
      .where(eq(truckAssignments.deviceId, motherId))
      .all()
      .filter((a: { removedAt: number | null }) => a.removedAt === null);
    expect(openAssignment).toHaveLength(1);
    expect(openAssignment[0].truckId).toBe(truckA);
  });
});

describe('sync.service — ordering: (clientTs, seq), not clientTs alone', () => {
  it('two same-device mutations with identical clientTs apply in seq order, regardless of array/input order', () => {
    const { db } = createTestDb();
    const { orgId, installerId } = seedBaseFixtures(db);
    const truckEarly = createTruck(db, orgId, 'FZE805SY');
    const truckLate = createTruck(db, orgId, 'FZE806SY');
    const motherId = createDevice(db, orgId, { type: 'mother', serial: 'SYNC-ORDER-1', status: 'available' });

    const SAME_CLIENT_TS = 5000;
    // seq=1 is the TRUE earlier mutation; seq=2 is later — but placed FIRST in the input array,
    // specifically to prove ordering isn't just "whatever order the array arrived in" either.
    const seqTwoMutation = movementMutation('mut-order-seq2', 2, SAME_CLIENT_TS, {
      kind: 'new_assignment',
      truckId: truckLate,
      motherDeviceId: motherId,
    });
    const seqOneMutation = movementMutation('mut-order-seq1', 1, SAME_CLIENT_TS, {
      kind: 'new_assignment',
      truckId: truckEarly,
      motherDeviceId: motherId,
    });

    // Input array order is [seq2, seq1] — the OPPOSITE of correct seq order. If the server
    // ordered by clientTs alone (a no-op sort here, since they're equal) and fell back to
    // input/array order, seq2 (truckLate) would win. It must not.
    const outcomes = applySyncBatch(db, {
      orgId,
      actor: { id: installerId, orgId, role: 'installer' },
      mutations: [seqTwoMutation, seqOneMutation],
    });

    const outcomeBySeq1 = outcomes.find((o) => o.id === 'mut-order-seq1')!;
    const outcomeBySeq2 = outcomes.find((o) => o.id === 'mut-order-seq2')!;

    expect(outcomeBySeq1.status).toBe('applied'); // applied FIRST because seq=1
    expect(outcomeBySeq2.status).toBe('conflicted'); // arrives second, device already assigned

    const openAssignment = db
      .select()
      .from(truckAssignments)
      .where(eq(truckAssignments.deviceId, motherId))
      .all()
      .filter((a: { removedAt: number | null }) => a.removedAt === null);
    expect(openAssignment).toHaveLength(1);
    expect(openAssignment[0].truckId).toBe(truckEarly); // the seq=1 truck won, not the array-first one
  });
});

describe('sync.service — end-to-end: offline queue → sync → real DB change → queue clears', () => {
  it('a fault queued offline syncs, the fault report exists in the DB, and the client queue clears', async () => {
    const { db: serverDb } = createTestDb();
    // More setup than other tests (real migrations + Dexie/fake-indexeddb together) — give it
    // headroom rather than assume a hang.

    const { orgId, installerId } = seedBaseFixtures(serverDb);
    const truckId = createTruck(serverDb, orgId, 'FZE807SY');
    const deviceId = createDevice(serverDb, orgId, { type: 'mother', serial: 'SYNC-E2E-1', status: 'in_service' });

    const { OfflineDb, enqueueMutation } = await import('../../lib/offline/db');
    const { syncPendingMutations } = await import('../../lib/offline/sync-engine');

    const clientDb = new OfflineDb(`test-e2e-${Math.random().toString(36).slice(2)}`);
    await enqueueMutation(clientDb, {
      endpoint: '/api/faults',
      payload: { truckId, deviceId, locksAffected: ['B'], description: 'sub-lock not opening' },
    });

    const originalFetch = globalThis.fetch;
    globalThis.fetch = (async (_url: string, init?: RequestInit) => {
      const body = JSON.parse(init!.body as string) as { mutations: IncomingMutation[] };
      const results = applySyncBatch(serverDb, {
        orgId,
        actor: { id: installerId, orgId, role: 'installer' },
        mutations: body.mutations,
      });
      return { ok: true, status: 200, json: async () => ({ results }) } as Response;
    }) as typeof fetch;

    try {
      const syncResult = await syncPendingMutations(clientDb);
      expect(syncResult.acked).toHaveLength(1);

      const faultRow = serverDb.select().from(faultReports).where(eq(faultReports.deviceId, deviceId)).get();
      expect(faultRow).toBeTruthy();
      expect(faultRow!.description).toBe('sub-lock not opening');

      expect(await clientDb.mutations.count()).toBe(0); // queue cleared
    } finally {
      globalThis.fetch = originalFetch;
      clientDb.close();
    }
  }, 20000);
});

describe('sync.service — dispatches /api/verifications (previously wired to nothing at all)', () => {
  it('a queued kit-scan mutation applies through the sync path and flips trust to verified', () => {
    const { db } = createTestDb();
    const { orgId, installerId } = seedBaseFixtures(db);
    const truckId = createTruck(db, orgId, 'FZE900SY');

    const motherId = createDevice(db, orgId, { type: 'mother', serial: 'SYNC-VERIFY-1', status: 'in_service' });
    const subIds = [0, 1, 2].map(() =>
      createDevice(db, orgId, { type: 'sub', serial: `SYNC-VERIFY-SUB-${Math.random().toString(36).slice(2, 8)}`.toUpperCase(), status: 'in_service' }),
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

    expect(getTrustState(db, { motherDeviceId: motherId }).state).toBe('unverified');

    const mutation: IncomingMutation = {
      id: 'mut-verify-1',
      endpoint: '/api/verifications',
      payload: {
        truckId,
        motherSerial: serialOf(db, motherId),
        motherSource: 'qr_scan',
        subs: subIds.map((id) => ({ serial: serialOf(db, id), source: 'qr_scan' as const })),
      },
      clientTs: 1000,
      seq: 1,
    };

    const [outcome] = applySyncBatch(db, {
      orgId,
      actor: { id: installerId, orgId, role: 'installer' },
      mutations: [mutation],
    });

    expect(outcome.status).toBe('applied');
    expect(getTrustState(db, { motherDeviceId: motherId }).state).toBe('verified');
    expect(db.select().from(verifications).all()).toHaveLength(1);
  });
});

describe('sync.service — mismatch-correction atomicity through the REAL /api/sync path', () => {
  it('a failure injected mid-correction leaves the registry fully unchanged, opens no conflict_review, leaves no applied ledger row, and the client mutation stays actionable', async () => {
    const { db: serverDb } = createTestDb();
    const { orgId, installerId } = seedBaseFixtures(serverDb);
    const truckId = createTruck(serverDb, orgId, 'FZE910SY');

    const motherId = createDevice(serverDb, orgId, { type: 'mother', serial: 'ATOMIC-VERIFY-MOTHER', status: 'in_service' });
    const wrongSubId = createDevice(serverDb, orgId, { type: 'sub', serial: 'ATOMIC-VERIFY-WRONG', status: 'in_service' });
    const unchangedSubIds = [
      createDevice(serverDb, orgId, { type: 'sub', serial: 'ATOMIC-VERIFY-UNCH-1', status: 'in_service' }),
      createDevice(serverDb, orgId, { type: 'sub', serial: 'ATOMIC-VERIFY-UNCH-2', status: 'in_service' }),
    ];
    const correctedSubId = createDevice(serverDb, orgId, { type: 'sub', serial: 'ATOMIC-VERIFY-CORRECTED', status: 'available' });

    const now = Math.floor(Date.now() / 1000);
    serverDb.insert(truckAssignments)
      .values({ id: createId(), orgId, truckId, deviceId: motherId, assignedAt: now, assignedBy: installerId })
      .run();
    const wrongPairingId = createId();
    serverDb.insert(slotPairings)
      .values({ id: wrongPairingId, orgId, motherDeviceId: motherId, slot: 'B', subDeviceId: wrongSubId, pairedAt: now, pairedBy: installerId })
      .run();
    unchangedSubIds.forEach((subId, i) => {
      serverDb.insert(slotPairings)
        .values({ id: createId(), orgId, motherDeviceId: motherId, slot: (['C', 'D'] as const)[i], subDeviceId: subId, pairedAt: now, pairedBy: installerId })
        .run();
    });

    const { OfflineDb, enqueueMutation } = await import('../../lib/offline/db');
    const { syncPendingMutations } = await import('../../lib/offline/sync-engine');

    const clientDb = new OfflineDb(`test-atomic-verify-${Math.random().toString(36).slice(2)}`);
    await enqueueMutation(clientDb, {
      endpoint: '/api/verifications',
      payload: {
        truckId,
        motherSerial: serialOf(serverDb, motherId),
        motherSource: 'qr_scan',
        subs: [
          { serial: serialOf(serverDb, correctedSubId), source: 'qr_scan' }, // replaces the wrong one
          { serial: serialOf(serverDb, unchangedSubIds[0]), source: 'qr_scan' },
          { serial: serialOf(serverDb, unchangedSubIds[1]), source: 'qr_scan' },
        ],
      },
    });

    // Fail on the FIRST insert into `verifications` — the LAST write correctKitMismatch makes,
    // after reconcileSubPairings has already closed the wrong pairing and opened the new one.
    // If atomicity holds, THOSE writes must roll back too, not just the verifications insert.
    const failingServerDb = makeRecursiveFailureProxy(serverDb, (table) => table === verifications);

    const originalFetch = globalThis.fetch;
    globalThis.fetch = (async (_url: string, init?: RequestInit) => {
      const body = JSON.parse(init!.body as string) as { mutations: IncomingMutation[] };
      try {
        const results = applySyncBatch(failingServerDb, {
          orgId,
          actor: { id: installerId, orgId, role: 'installer' },
          mutations: body.mutations,
        });
        return { ok: true, status: 200, json: async () => ({ results }) } as Response;
      } catch {
        // Mirrors app/api/sync/route.ts's catch-all: an unexpected throw becomes a 500 with no
        // results array — the client acks nothing.
        return { ok: false, status: 500, json: async () => ({ error: { code: 'internal_error' } }) } as Response;
      }
    }) as typeof fetch;

    try {
      const syncResult = await syncPendingMutations(clientDb);

      // Client side: nothing acked, mutation still queued — actionable, not silently cleared.
      expect(syncResult.acked).toEqual([]);
      expect(syncResult.stillPending).toHaveLength(1);
      expect(await clientDb.mutations.count()).toBe(1);

      // Server side: the registry is EXACTLY as it was — no partial pairing close/open.
      const wrongPairingAfter = serverDb.select().from(slotPairings).where(eq(slotPairings.id, wrongPairingId)).get()!;
      expect(wrongPairingAfter.unpairedAt).toBeNull();
      expect(wrongPairingAfter.subDeviceId).toBe(wrongSubId);

      const anyPairingForCorrectedSub = serverDb
        .select()
        .from(slotPairings)
        .where(eq(slotPairings.subDeviceId, correctedSubId))
        .all();
      expect(anyPairingForCorrectedSub).toHaveLength(0); // never opened

      const correctedDeviceAfter = serverDb.select().from(devices).where(eq(devices.id, correctedSubId)).get()!;
      expect(correctedDeviceAfter.lifecycleStatus).toBe('available'); // never transitioned

      const wrongSubDeviceAfter = serverDb.select().from(devices).where(eq(devices.id, wrongSubId)).get()!;
      expect(wrongSubDeviceAfter.lifecycleStatus).toBe('in_service'); // never removed

      expect(serverDb.select().from(verifications).all()).toHaveLength(0);
      expect(serverDb.select().from(conflictReviews).all()).toHaveLength(0);

      // No applied (or any) ledger row for this mutation ID — the outer transaction (ledger
      // insert + dispatch) rolled back as one unit.
      const mutationId = (await clientDb.mutations.toArray())[0].id;
      const ledgerRow = serverDb.select().from(syncMutations).where(eq(syncMutations.clientMutationId, mutationId)).get();
      expect(ledgerRow).toBeUndefined();
    } finally {
      globalThis.fetch = originalFetch;
      clientDb.close();
    }
  }, 20000);
});

describe('sync.service — two racing mismatch corrections for one truck', () => {
  it('outcome (b): sequential corrections against a truck both apply, each converging reality to its own observed state', () => {
    const { db } = createTestDb();
    const { orgId, installerId } = seedBaseFixtures(db);
    const truckId = createTruck(db, orgId, 'FZE920SY');
    const now = Math.floor(Date.now() / 1000);

    const motherX = createDevice(db, orgId, { type: 'mother', serial: 'RACE-MOTHER-X', status: 'in_service' });
    db.insert(truckAssignments)
      .values({ id: createId(), orgId, truckId, deviceId: motherX, assignedAt: now, assignedBy: installerId })
      .run();

    // Two candidate "real" mothers, each already carrying its own matching sub-kit, neither
    // in_service anywhere — both are legitimately available to be corrected onto this truck.
    const motherY = createDevice(db, orgId, { type: 'mother', serial: 'RACE-MOTHER-Y', status: 'available' });
    const motherZ = createDevice(db, orgId, { type: 'mother', serial: 'RACE-MOTHER-Z', status: 'available' });
    for (const [mother, tag] of [[motherY, 'Y'], [motherZ, 'Z']] as const) {
      (['B', 'C', 'D'] as const).forEach((slot) => {
        const subId = createDevice(db, orgId, { type: 'sub', serial: `RACE-SUB-${tag}-${slot}`, status: 'available' });
        db.insert(slotPairings)
          .values({ id: createId(), orgId, motherDeviceId: mother, slot, subDeviceId: subId, pairedAt: now, pairedBy: installerId })
          .run();
      });
    }

    function subsFor(motherId: string) {
      return db
        .select({ serial: devices.serial })
        .from(slotPairings)
        .innerJoin(devices, eq(devices.id, slotPairings.subDeviceId))
        .where(eq(slotPairings.motherDeviceId, motherId))
        .all()
        .map((r: { serial: string }) => ({ serial: r.serial, source: 'qr_scan' as const }));
    }

    const mutationToY = verificationMutation('race-1', 1, 1000, {
      truckId,
      motherSerial: serialOf(db, motherY),
      motherSource: 'qr_scan',
      subs: subsFor(motherY),
    });
    const mutationToZ = verificationMutation('race-2', 2, 2000, {
      truckId,
      motherSerial: serialOf(db, motherZ),
      motherSource: 'qr_scan',
      subs: subsFor(motherZ),
    });

    const outcomes = applySyncBatch(db, {
      orgId,
      actor: { id: installerId, orgId, role: 'installer' },
      mutations: [mutationToY, mutationToZ],
    });

    // Both applied — the second correction is against whatever is CURRENT at the time it's
    // processed (Y, just corrected in), not a stale precondition captured before the batch.
    // Re-applying a correction against live state is what makes this safe: nothing here trusts
    // an expected-state snapshot that could go stale mid-batch.
    expect(outcomes[0].status).toBe('applied');
    expect(outcomes[1].status).toBe('applied');

    const finalAssignment = db
      .select()
      .from(truckAssignments)
      .where(and(eq(truckAssignments.truckId, truckId), isNull(truckAssignments.removedAt)))
      .get()!;
    expect(finalAssignment.deviceId).toBe(motherZ); // the LAST correction won, as reality dictates

    // Both X and Y were displaced along the way and are safely back in the pool.
    expect(db.select().from(devices).where(eq(devices.id, motherX)).get()!.lifecycleStatus).toBe('available');
    expect(db.select().from(devices).where(eq(devices.id, motherY)).get()!.lifecycleStatus).toBe('available');
    expect(db.select().from(devices).where(eq(devices.id, motherZ)).get()!.lifecycleStatus).toBe('in_service');

    // TWO distinct unlogged_swap reviews — one per genuine correction, never merged/skipped.
    const reviews = db.select().from(conflictReviews).all();
    expect(reviews).toHaveLength(2);
    expect(reviews.every((r: { kind: string }) => r.kind === 'unlogged_swap')).toBe(true);
  });

  it('outcome (a): a second correction that cannot be resolved automatically (observed device already in_service elsewhere) is routed to conflicted + sync_conflict — not a second unlogged_swap stacked on the first', () => {
    const { db } = createTestDb();
    const { orgId, installerId } = seedBaseFixtures(db);
    const truckId = createTruck(db, orgId, 'FZE921SY');
    const otherTruckId = createTruck(db, orgId, 'FZE922SY');
    const now = Math.floor(Date.now() / 1000);

    const motherX = createDevice(db, orgId, { type: 'mother', serial: 'RACE2-MOTHER-X', status: 'in_service' });
    db.insert(truckAssignments)
      .values({ id: createId(), orgId, truckId, deviceId: motherX, assignedAt: now, assignedBy: installerId })
      .run();

    const motherY = createDevice(db, orgId, { type: 'mother', serial: 'RACE2-MOTHER-Y', status: 'available' });
    const motherYSubs = (['B', 'C', 'D'] as const).map((slot) => {
      const subId = createDevice(db, orgId, { type: 'sub', serial: `RACE2-SUB-Y-${slot}`, status: 'available' });
      db.insert(slotPairings)
        .values({ id: createId(), orgId, motherDeviceId: motherY, slot, subDeviceId: subId, pairedAt: now, pairedBy: installerId })
        .run();
      return subId;
    });

    // Mother W is genuinely, legitimately in_service on a DIFFERENT truck already — the second
    // mutation's claimed "reality" is simply wrong/unresolvable automatically, not a case
    // reality-wins can silently paper over.
    const motherW = createDevice(db, orgId, { type: 'mother', serial: 'RACE2-MOTHER-W', status: 'in_service' });
    db.insert(truckAssignments)
      .values({ id: createId(), orgId, truckId: otherTruckId, deviceId: motherW, assignedAt: now, assignedBy: installerId })
      .run();
    const motherWSubId = createDevice(db, orgId, { type: 'sub', serial: 'RACE2-SUB-W-B', status: 'in_service' });
    db.insert(slotPairings)
      .values({ id: createId(), orgId, motherDeviceId: motherW, slot: 'B', subDeviceId: motherWSubId, pairedAt: now, pairedBy: installerId })
      .run();

    const mutationToY = verificationMutation('race2-1', 1, 1000, {
      truckId,
      motherSerial: serialOf(db, motherY),
      motherSource: 'qr_scan',
      subs: motherYSubs.map((id) => ({ serial: serialOf(db, id), source: 'qr_scan' as const })),
    });
    const mutationToW = verificationMutation('race2-2', 2, 2000, {
      truckId,
      motherSerial: serialOf(db, motherW),
      motherSource: 'qr_scan',
      subs: [{ serial: serialOf(db, motherWSubId), source: 'qr_scan' }],
    });

    const outcomes = applySyncBatch(db, {
      orgId,
      actor: { id: installerId, orgId, role: 'installer' },
      mutations: [mutationToY, mutationToW],
    });

    expect(outcomes[0].status).toBe('applied');
    expect(outcomes[1].status).toBe('conflicted');
    if (outcomes[1].status === 'conflicted') {
      expect(outcomes[1].conflictReviewId).toBeTruthy();
    }

    // Truck still has Y (mutation 1's correction) — mutation 2 never touched the assignment.
    const finalAssignment = db
      .select()
      .from(truckAssignments)
      .where(and(eq(truckAssignments.truckId, truckId), isNull(truckAssignments.removedAt)))
      .get()!;
    expect(finalAssignment.deviceId).toBe(motherY);

    // Mother W is untouched — still exactly where it legitimately was.
    const wAssignment = db
      .select()
      .from(truckAssignments)
      .where(and(eq(truckAssignments.deviceId, motherW), isNull(truckAssignments.removedAt)))
      .get()!;
    expect(wAssignment.truckId).toBe(otherTruckId);

    // Exactly ONE unlogged_swap (from mutation 1) and ONE sync_conflict (from mutation 2's
    // failure) — mutation 2 did NOT stack a second silent unlogged_swap correction.
    const reviews = db.select().from(conflictReviews).all();
    expect(reviews).toHaveLength(2);
    expect(reviews.filter((r: { kind: string }) => r.kind === 'unlogged_swap')).toHaveLength(1);
    expect(reviews.filter((r: { kind: string }) => r.kind === 'sync_conflict')).toHaveLength(1);

    const ledgerRowForMutation2 = db
      .select()
      .from(syncMutations)
      .where(eq(syncMutations.clientMutationId, 'race2-2'))
      .get()!;
    expect(ledgerRowForMutation2.status).toBe('conflicted'); // never 'applied'
  });

  it('converged correction becomes a match: two corrections observing the SAME new reality (Y) — the first corrects, the second finds the registry already agrees', () => {
    const { db } = createTestDb();
    const { orgId, installerId } = seedBaseFixtures(db);
    const truckId = createTruck(db, orgId, 'FZE923SY');
    const now = Math.floor(Date.now() / 1000);

    const motherX = createDevice(db, orgId, { type: 'mother', serial: 'RACE3-MOTHER-X', status: 'in_service' });
    db.insert(truckAssignments)
      .values({ id: createId(), orgId, truckId, deviceId: motherX, assignedAt: now, assignedBy: installerId })
      .run();

    const motherY = createDevice(db, orgId, { type: 'mother', serial: 'RACE3-MOTHER-Y', status: 'available' });
    const motherYSubs = (['B', 'C', 'D'] as const).map((slot) => {
      const subId = createDevice(db, orgId, { type: 'sub', serial: `RACE3-SUB-Y-${slot}`, status: 'available' });
      db.insert(slotPairings)
        .values({ id: createId(), orgId, motherDeviceId: motherY, slot, subDeviceId: subId, pairedAt: now, pairedBy: installerId })
        .run();
      return subId;
    });

    const subsPayload = motherYSubs.map((id) => ({ serial: serialOf(db, id), source: 'qr_scan' as const }));

    // Two offline sessions, both independently scanning the SAME real-world state (mother Y on
    // this truck, with its own kit) — not two DIFFERENT observed realities like the racing test.
    const mutation1 = verificationMutation('converge-1', 1, 1000, {
      truckId,
      motherSerial: serialOf(db, motherY),
      motherSource: 'qr_scan',
      subs: subsPayload,
    });
    const mutation2 = verificationMutation('converge-2', 2, 2000, {
      truckId,
      motherSerial: serialOf(db, motherY),
      motherSource: 'qr_scan',
      subs: subsPayload,
    });

    const outcomes = applySyncBatch(db, {
      orgId,
      actor: { id: installerId, orgId, role: 'installer' },
      mutations: [mutation1, mutation2],
    });

    expect(outcomes[0].status).toBe('applied');
    expect(outcomes[1].status).toBe('applied');

    // Exactly one mismatch_corrected + one unlogged_swap review — from mutation 1 only.
    const allVerifications = db.select().from(verifications).all();
    expect(allVerifications).toHaveLength(2);
    expect(allVerifications.filter((v: { result: string }) => v.result === 'mismatch_corrected')).toHaveLength(1);
    expect(allVerifications.filter((v: { result: string }) => v.result === 'match')).toHaveLength(1);

    const reviews = db.select().from(conflictReviews).all();
    expect(reviews).toHaveLength(1); // NOT two — the second correction never ran
    expect(reviews[0].kind).toBe('unlogged_swap');

    // No redundant pairing churn: mutation 2 wrote a bare match row, never touched slot_pairings.
    const secondVerification = allVerifications.find((v: { result: string }) => v.result === 'match')!;
    expect(secondVerification.expectedSubsJson).toBeNull(); // match rows never set expected_subs_json — only corrections do

    // Trust reflects the second (later) verification, refreshed rather than re-corrected.
    expect(getTrustState(db, { motherDeviceId: motherY }).state).toBe('verified');
    expect(getTrustState(db, { motherDeviceId: motherY }).latestVerifiedAt).toBe(secondVerification.verifiedAt);

    // Registry settled on Y after mutation 1; mutation 2 changed nothing further.
    const finalAssignment = db
      .select()
      .from(truckAssignments)
      .where(and(eq(truckAssignments.truckId, truckId), isNull(truckAssignments.removedAt)))
      .get()!;
    expect(finalAssignment.deviceId).toBe(motherY);
    const finalPairings = db
      .select()
      .from(slotPairings)
      .where(and(eq(slotPairings.motherDeviceId, motherY), isNull(slotPairings.unpairedAt)))
      .all();
    expect(finalPairings).toHaveLength(3); // still exactly the original 3 — no churn from mutation 2
  });
});
