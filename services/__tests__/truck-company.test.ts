// §2/§6 Truck-serving-company: confirmed as a byproduct of EVERY install (not declared once),
// plus the rare supervisor-only secondary correction path (changeTruckCompany).
import { describe, it, expect } from 'vitest';
import { eq, and, isNull } from 'drizzle-orm';
import { createId } from '@paralleldrive/cuid2';
import {
  truckCompanyAssignments,
  truckAssignments,
  slotPairings,
  devices,
  movementLogs,
  auditLog,
} from '../../db/schema';
import { createTestDb } from '../../tests/helpers/testDb';
import { seedBaseFixtures, createTruck } from '../../tests/helpers/fixtures';
import { registerKit } from '../registration.service';
import { installKit } from '../installation.service';
import { changeTruckCompany, removeDeviceFromTruck } from '../movement.service';
import { getLookupCockpit } from '../lookup.service';
import { AuthzError } from '../../lib/errors';

function openCompanyAssignments(db: ReturnType<typeof createTestDb>['db'], truckId: string) {
  return db
    .select()
    .from(truckCompanyAssignments)
    .where(and(eq(truckCompanyAssignments.truckId, truckId), isNull(truckCompanyAssignments.removedAt)))
    .all();
}

function allCompanyAssignments(db: ReturnType<typeof createTestDb>['db'], truckId: string) {
  return db.select().from(truckCompanyAssignments).where(eq(truckCompanyAssignments.truckId, truckId)).all();
}

function makeKit(db: ReturnType<typeof createTestDb>['db'], orgId: string, installerId: string, tag: string) {
  return registerKit(db, {
    orgId,
    actorUserId: installerId,
    motherSerial: `TC-MOTHER-${tag}`,
    subSerials: [`TC-SUB-${tag}-B`, `TC-SUB-${tag}-C`, `TC-SUB-${tag}-D`],
    simNumber: `2348000000${tag}`,
  });
}

// Recursive single-level-of-nesting failure proxy — installKit's company write and the rest of
// the install share ONE db.transaction() (no nested SAVEPOINT here, unlike verification's
// mismatch-correction), so the single-level proxy already used for movement.service atomicity
// tests (mother-replacement) is sufficient; reused verbatim in shape.
function makeFailAfterTableProxy(realDb: ReturnType<typeof createTestDb>['db'], failOnTable: unknown) {
  let seen = false;
  return new Proxy(realDb, {
    get(dbTarget, dbProp, dbReceiver) {
      if (dbProp === 'transaction') {
        const originalTransaction = Reflect.get(dbTarget, dbProp, dbReceiver) as (cb: (tx: unknown) => unknown) => unknown;
        return (callback: (tx: unknown) => unknown) =>
          originalTransaction.call(dbTarget, (tx: unknown) => {
            const wrappedTx = new Proxy(tx as object, {
              get(txTarget, txProp, txReceiver) {
                if (txProp === 'insert') {
                  return (table: unknown) => {
                    if (table === failOnTable && !seen) {
                      seen = true;
                      throw new Error('INJECTED FAILURE: crash after company write, before install completes');
                    }
                    return (Reflect.get(txTarget, txProp, txReceiver) as (t: unknown) => unknown).call(txTarget, table);
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
  }) as typeof realDb;
}

describe('installKit — company MATCHES current record: zero rows written', () => {
  it('submitting the same company as the current open span writes nothing new to truck_company_assignments', () => {
    const { db } = createTestDb();
    const { orgId, installerId } = seedBaseFixtures(db);
    const truckId = createTruck(db, orgId, 'TCM100AA');
    const kit1 = makeKit(db, orgId, installerId, 'M1');

    installKit(db, {
      orgId,
      actorUserId: installerId,
      truckId,
      motherDeviceId: kit1.motherDeviceId,
      subDeviceIds: kit1.subDeviceIds as [string, string, string],
      company: 'mrs',
    });

    const beforeCount = allCompanyAssignments(db, truckId).length;
    const openBefore = openCompanyAssignments(db, truckId);
    expect(openBefore).toHaveLength(1);
    expect(openBefore[0].company).toBe('mrs');
    const openId = openBefore[0].id;

    // The mother lock is swapped out and a genuinely new kit goes on later, submitting the
    // SAME company again — freeing the truck first, same as any real mother-lock replacement.
    removeDeviceFromTruck(db, { orgId, actorUserId: installerId, motherDeviceId: kit1.motherDeviceId, reason: 'operational_swap' });
    const kit2 = makeKit(db, orgId, installerId, 'M2');
    installKit(db, {
      orgId,
      actorUserId: installerId,
      truckId,
      motherDeviceId: kit2.motherDeviceId,
      subDeviceIds: kit2.subDeviceIds as [string, string, string],
      company: 'mrs',
    });

    const afterCount = allCompanyAssignments(db, truckId).length;
    expect(afterCount).toBe(beforeCount); // literally zero new rows — not just "no error"

    const openAfter = openCompanyAssignments(db, truckId);
    expect(openAfter).toHaveLength(1);
    expect(openAfter[0].id).toBe(openId); // the SAME row — never touched, not closed-and-reopened
    expect(openAfter[0].removedAt).toBeNull();
  });
});

describe('installKit — company DIFFERS from current record: atomic close+open', () => {
  it('a company change on install closes the old span and opens a new one, atomically with the rest of the install', () => {
    const { db } = createTestDb();
    const { orgId, installerId } = seedBaseFixtures(db);
    const truckId = createTruck(db, orgId, 'TCD100AA');
    const kit1 = makeKit(db, orgId, installerId, 'D1');

    installKit(db, {
      orgId,
      actorUserId: installerId,
      truckId,
      motherDeviceId: kit1.motherDeviceId,
      subDeviceIds: kit1.subDeviceIds as [string, string, string],
      company: 'mrs',
    });

    const originalOpen = openCompanyAssignments(db, truckId)[0];
    expect(originalOpen.company).toBe('mrs');

    removeDeviceFromTruck(db, { orgId, actorUserId: installerId, motherDeviceId: kit1.motherDeviceId, reason: 'operational_swap' });
    const kit2 = makeKit(db, orgId, installerId, 'D2');
    const result = installKit(db, {
      orgId,
      actorUserId: installerId,
      truckId,
      motherDeviceId: kit2.motherDeviceId,
      subDeviceIds: kit2.subDeviceIds as [string, string, string],
      company: 'dangote',
    });

    expect(result.truckCompanyAssignmentId).toBeTruthy();

    const rows = allCompanyAssignments(db, truckId);
    expect(rows).toHaveLength(2);

    const closed = rows.find((r: { id: string }) => r.id === originalOpen.id)!;
    expect(closed.removedAt).not.toBeNull();
    expect(closed.removedBy).toBe(installerId);

    const open = openCompanyAssignments(db, truckId);
    expect(open).toHaveLength(1);
    expect(open[0].company).toBe('dangote');
    expect(open[0].id).toBe(result.truckCompanyAssignmentId);

    // Atomic with the rest of the install — the truck_assignment for kit2's mother exists too.
    const motherAssignment = db
      .select()
      .from(truckAssignments)
      .where(and(eq(truckAssignments.truckId, truckId), isNull(truckAssignments.removedAt)))
      .get()!;
    expect(motherAssignment.deviceId).toBe(kit2.motherDeviceId);
  });

  it('a first install on a truck with no prior company opens a new span (none → given counts as a change)', () => {
    const { db } = createTestDb();
    const { orgId, installerId } = seedBaseFixtures(db);
    const truckId = createTruck(db, orgId, 'TCD200AA');
    const kit = makeKit(db, orgId, installerId, 'D3');

    expect(openCompanyAssignments(db, truckId)).toHaveLength(0);

    const result = installKit(db, {
      orgId,
      actorUserId: installerId,
      truckId,
      motherDeviceId: kit.motherDeviceId,
      subDeviceIds: kit.subDeviceIds as [string, string, string],
      company: 'dangote',
    });

    expect(result.truckCompanyAssignmentId).toBeTruthy();
    const open = openCompanyAssignments(db, truckId);
    expect(open).toHaveLength(1);
    expect(open[0].company).toBe('dangote');
  });
});

describe('installKit — stale-client defense: server compares against ITS OWN current read, never a client-trusted value', () => {
  it('a company change made by another install between form-load and this submit is what the server actually compares against', () => {
    const { db } = createTestDb();
    const { orgId, installerId } = seedBaseFixtures(db);
    const truckId = createTruck(db, orgId, 'TCS100AA');
    const kit1 = makeKit(db, orgId, installerId, 'S1');

    // Tech A loads the install form: truck has no company yet, so the form would show blank.
    installKit(db, {
      orgId,
      actorUserId: installerId,
      truckId,
      motherDeviceId: kit1.motherDeviceId,
      subDeviceIds: kit1.subDeviceIds as [string, string, string],
      company: 'mrs',
    });
    // Simulates: after tech A's form loaded (reading "no company"/stale view), but BEFORE tech
    // A's submit reaches the server, another install on the SAME truck already changed the
    // server's current state to 'mrs' (above). Tech A's client still thinks the truck is
    // undeclared and submits 'dangote' as if setting it fresh.
    removeDeviceFromTruck(db, { orgId, actorUserId: installerId, motherDeviceId: kit1.motherDeviceId, reason: 'operational_swap' });
    const kit2 = makeKit(db, orgId, installerId, 'S2');

    const result = installKit(db, {
      orgId,
      actorUserId: installerId,
      truckId,
      motherDeviceId: kit2.motherDeviceId,
      subDeviceIds: kit2.subDeviceIds as [string, string, string],
      company: 'dangote', // submitted as if truck were undeclared, per tech A's stale view
    });

    // The server did NOT trust that stale premise — it read the CURRENT row (mrs, from the
    // install that landed first) and correctly detected a real change (mrs -> dangote), closing
    // that row rather than either (a) blindly inserting a second open row (which would violate
    // uq_open_truck_company) or (b) silently no-op'ing because the client's own belief was
    // "unset".
    expect(result.truckCompanyAssignmentId).toBeTruthy();
    const rows = allCompanyAssignments(db, truckId);
    expect(rows).toHaveLength(2);
    const open = openCompanyAssignments(db, truckId);
    expect(open).toHaveLength(1); // never two open rows — the unique index would have caught it too
    expect(open[0].company).toBe('dangote');
    const closed = rows.find((r: { removedAt: number | null }) => r.removedAt !== null)!;
    expect(closed.company).toBe('mrs');
  });

  it('a stale client re-submitting the value that is ALREADY current (because it was set by another install in between) correctly no-ops', () => {
    const { db } = createTestDb();
    const { orgId, installerId } = seedBaseFixtures(db);
    const truckId = createTruck(db, orgId, 'TCS200AA');
    const kit1 = makeKit(db, orgId, installerId, 'S3');

    // Truck starts undeclared. Tech A's form loads showing blank.
    // Meanwhile another install (kit2) already declares it 'dangote' before tech A submits.
    const kit2 = makeKit(db, orgId, installerId, 'S4');
    installKit(db, {
      orgId,
      actorUserId: installerId,
      truckId,
      motherDeviceId: kit2.motherDeviceId,
      subDeviceIds: kit2.subDeviceIds as [string, string, string],
      company: 'dangote',
    });
    const settledOpen = openCompanyAssignments(db, truckId)[0];

    removeDeviceFromTruck(db, { orgId, actorUserId: installerId, motherDeviceId: kit2.motherDeviceId, reason: 'operational_swap' });
    const kit1Result = installKit(db, {
      orgId,
      actorUserId: installerId,
      truckId,
      motherDeviceId: kit1.motherDeviceId,
      subDeviceIds: kit1.subDeviceIds as [string, string, string],
      company: 'dangote', // tech A happens to submit the value that's ALREADY current now
    });

    // No write at all — the server's own current read matched what was submitted.
    expect(kit1Result.truckCompanyAssignmentId).toBeNull();
    const rows = allCompanyAssignments(db, truckId);
    expect(rows).toHaveLength(1);
    expect(rows[0].id).toBe(settledOpen.id);
    expect(rows[0].removedAt).toBeNull();
  });
});

describe('changeTruckCompany — supervisor-only', () => {
  it('throws for a non-supervisor (service-layer check, not UI-only)', () => {
    const { db } = createTestDb();
    const { orgId, installerId } = seedBaseFixtures(db);
    const truckId = createTruck(db, orgId, 'TCA100AA');

    expect(() =>
      changeTruckCompany(db, {
        orgId,
        truckId,
        company: 'mrs',
        actor: { id: installerId, orgId, role: 'installer' },
      }),
    ).toThrow(AuthzError);

    // Nothing was written — the check runs before any DB mutation.
    expect(allCompanyAssignments(db, truckId)).toHaveLength(0);
  });

  it('closes the open span and opens a new one, one transaction, with movement_log + audit', () => {
    const { db } = createTestDb();
    const { orgId, supervisorId, installerId } = seedBaseFixtures(db);
    const truckId = createTruck(db, orgId, 'TCA200AA');
    const kit = makeKit(db, orgId, installerId, 'A1');

    installKit(db, {
      orgId,
      actorUserId: installerId,
      truckId,
      motherDeviceId: kit.motherDeviceId,
      subDeviceIds: kit.subDeviceIds as [string, string, string],
      company: 'mrs',
    });
    const originalOpen = openCompanyAssignments(db, truckId)[0];

    const result = changeTruckCompany(db, {
      orgId,
      truckId,
      company: 'dangote',
      notes: 'back-office correction',
      actor: { id: supervisorId, orgId, role: 'supervisor' },
    });

    const rows = allCompanyAssignments(db, truckId);
    expect(rows).toHaveLength(2);
    const closed = rows.find((r: { id: string }) => r.id === originalOpen.id)!;
    expect(closed.removedAt).not.toBeNull();
    expect(closed.removedBy).toBe(supervisorId);

    const open = openCompanyAssignments(db, truckId);
    expect(open).toHaveLength(1);
    expect(open[0].id).toBe(result.truckCompanyAssignmentId);
    expect(open[0].company).toBe('dangote');
    expect(open[0].assignedBy).toBe(supervisorId);

    const movementLog = db.select().from(movementLogs).where(eq(movementLogs.id, result.movementLogId)).get()!;
    expect(movementLog.action).toBe('company_reassignment');
    expect(movementLog.truckId).toBe(truckId);

    const auditRows = db
      .select()
      .from(auditLog)
      .where(and(eq(auditLog.entityTable, 'movement_logs'), eq(auditLog.entityId, result.movementLogId)))
      .all();
    expect(auditRows).toHaveLength(1);
    const payload = JSON.parse(auditRows[0].afterJson);
    expect(payload).toMatchObject({ action: 'company_reassignment', truckId, fromCompany: 'mrs', toCompany: 'dangote' });
  });

  it('works correctly even with no prior company on record (fromCompany null)', () => {
    const { db } = createTestDb();
    const { orgId, supervisorId } = seedBaseFixtures(db);
    const truckId = createTruck(db, orgId, 'TCA300AA');

    const result = changeTruckCompany(db, {
      orgId,
      truckId,
      company: 'mrs',
      actor: { id: supervisorId, orgId, role: 'supervisor' },
    });

    expect(openCompanyAssignments(db, truckId)).toHaveLength(1);
    const auditRows = db
      .select()
      .from(auditLog)
      .where(and(eq(auditLog.entityTable, 'movement_logs'), eq(auditLog.entityId, result.movementLogId)))
      .all();
    const payload = JSON.parse(auditRows[0].afterJson);
    expect(payload.fromCompany).toBeNull();
  });
});

describe('installKit — atomicity: a failure injected during the company-write-on-diff path leaves NEITHER applied', () => {
  it('an injected failure after the company write, before the rest of the install completes, rolls back BOTH', () => {
    const { db } = createTestDb();
    const { orgId, installerId } = seedBaseFixtures(db);
    const truckId = createTruck(db, orgId, 'TCX100AA');
    const kit1 = makeKit(db, orgId, installerId, 'X1');

    installKit(db, {
      orgId,
      actorUserId: installerId,
      truckId,
      motherDeviceId: kit1.motherDeviceId,
      subDeviceIds: kit1.subDeviceIds as [string, string, string],
      company: 'mrs',
    });
    const originalOpen = openCompanyAssignments(db, truckId)[0];

    const kit2 = makeKit(db, orgId, installerId, 'X2');

    // Fail on the FIRST insert into truck_assignments — which happens AFTER the company
    // close+open writes in installKit's transaction. If atomicity holds, the company writes
    // (already executed) must roll back too, not just the truck_assignments insert that
    // actually threw.
    const failingDb = makeFailAfterTableProxy(db, truckAssignments);

    expect(() =>
      installKit(failingDb, {
        orgId,
        actorUserId: installerId,
        truckId,
        motherDeviceId: kit2.motherDeviceId,
        subDeviceIds: kit2.subDeviceIds as [string, string, string],
        company: 'dangote', // a genuine change, not a no-op — this is what should have written
      }),
    ).toThrow(/INJECTED FAILURE/);

    // Company: still exactly the original row, still open, never closed.
    const rows = allCompanyAssignments(db, truckId);
    expect(rows).toHaveLength(1);
    expect(rows[0].id).toBe(originalOpen.id);
    expect(rows[0].removedAt).toBeNull();
    expect(rows[0].company).toBe('mrs');

    // Install: kit2's mother never got assigned/paired — the rest of the install rolled back too.
    const openAssignment = db
      .select()
      .from(truckAssignments)
      .where(and(eq(truckAssignments.truckId, truckId), isNull(truckAssignments.removedAt)))
      .get()!;
    expect(openAssignment.deviceId).toBe(kit1.motherDeviceId); // still the FIRST install's mother

    const kit2MotherAfter = db.select().from(devices).where(eq(devices.id, kit2.motherDeviceId)).get()!;
    expect(kit2MotherAfter.lifecycleStatus).toBe('available'); // never transitioned

    const anyPairingForKit2Sub = db
      .select()
      .from(slotPairings)
      .where(eq(slotPairings.subDeviceId, kit2.subDeviceIds[0]))
      .all();
    expect(anyPairingForKit2Sub).toHaveLength(0); // never opened
  });
});

describe('lookup — a truck with no company yet reads as "not yet declared", not an error or blank', () => {
  it('a truck with no install/company at all shows declared: false, value: null', () => {
    const { db } = createTestDb();
    const { orgId } = seedBaseFixtures(db);
    createTruck(db, orgId, 'TCN100AA');

    const view = getLookupCockpit(db, { orgId, query: 'TCN100AA' });

    expect(view.target.kind).toBe('truck');
    expect(view.company).toEqual({ value: null, declared: false });
  });

  it('a truck WITH a company on record reads declared: true with the value', () => {
    const { db } = createTestDb();
    const { orgId, installerId } = seedBaseFixtures(db);
    const truckId = createTruck(db, orgId, 'TCN200AA');
    const kit = makeKit(db, orgId, installerId, 'N1');

    installKit(db, {
      orgId,
      actorUserId: installerId,
      truckId,
      motherDeviceId: kit.motherDeviceId,
      subDeviceIds: kit.subDeviceIds as [string, string, string],
      company: 'dangote',
    });

    const view = getLookupCockpit(db, { orgId, query: 'TCN200AA' });
    expect(view.company).toEqual({ value: 'dangote', declared: true });
  });
});
