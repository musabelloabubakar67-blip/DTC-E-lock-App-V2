import 'fake-indexeddb/auto';
import { describe, it, expect } from 'vitest';
import { OfflineDb, enqueueMutation } from '../db';

describe('offline queue — survives a simulated app restart', () => {
  it('a mutation written while "offline" persists in the queue after the Dexie instance is recreated', async () => {
    const dbName = `test-restart-${Math.random().toString(36).slice(2)}`;

    // "Session 1" — app is running, writes a mutation locally. No network involved at all.
    const sessionOneDb = new OfflineDb(dbName);
    const mutation = await enqueueMutation(sessionOneDb, {
      endpoint: '/api/faults',
      payload: { description: 'sub-lock not opening' },
    });
    sessionOneDb.close();

    // "App restart" — a BRAND NEW Dexie instance, same underlying IndexedDB database name.
    // Nothing carries over in memory; only what IndexedDB itself persisted survives.
    const sessionTwoDb = new OfflineDb(dbName);
    const reloaded = await sessionTwoDb.mutations.get(mutation.id);

    expect(reloaded).toBeTruthy();
    expect(reloaded?.status).toBe('pending');
    expect(reloaded?.payload).toEqual({ description: 'sub-lock not opening' });

    sessionTwoDb.close();
  });
});

describe('offline queue — enqueue ordering is stable, including same-millisecond ties', () => {
  it('assigns strictly increasing, distinct seq numbers even when clientTs/createdAt tie', async () => {
    const dbName = `test-seq-${Math.random().toString(36).slice(2)}`;
    const db = new OfflineDb(dbName);

    const originalNow = Date.now;
    try {
      // Force two enqueues to land on the EXACT same millisecond — the scenario where a
      // createdAt/clientTs-only tiebreak would fall back to primary-key (cuid2) order, which
      // has no relationship to actual enqueue sequence.
      Date.now = () => 1_700_000_000_000;

      const first = await enqueueMutation(db, { endpoint: '/api/faults', payload: { n: 1 } });
      const second = await enqueueMutation(db, { endpoint: '/api/faults', payload: { n: 2 } });
      const third = await enqueueMutation(db, { endpoint: '/api/faults', payload: { n: 3 } });

      expect(first.clientTs).toBe(second.clientTs);
      expect(second.clientTs).toBe(third.clientTs);

      // seq is still strictly increasing and distinct, regardless of the clientTs tie.
      expect(first.seq).toBeLessThan(second.seq);
      expect(second.seq).toBeLessThan(third.seq);

      const ordered = await db.mutations.where('status').anyOf(['pending', 'error']).sortBy('seq');
      expect(ordered.map((m) => m.payload)).toEqual([{ n: 1 }, { n: 2 }, { n: 3 }]);
    } finally {
      Date.now = originalNow;
      db.close();
    }
  });

  it('seq stays monotonic across a simulated app restart', async () => {
    const dbName = `test-seq-restart-${Math.random().toString(36).slice(2)}`;

    const sessionOneDb = new OfflineDb(dbName);
    const first = await enqueueMutation(sessionOneDb, { endpoint: '/api/faults', payload: { n: 1 } });
    sessionOneDb.close();

    const sessionTwoDb = new OfflineDb(dbName);
    const second = await enqueueMutation(sessionTwoDb, { endpoint: '/api/faults', payload: { n: 2 } });

    expect(second.seq).toBeGreaterThan(first.seq); // the counter itself persisted, not just the row
    sessionTwoDb.close();
  });
});
