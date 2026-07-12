import 'fake-indexeddb/auto';
import { describe, it, expect, vi, afterEach } from 'vitest';
import { OfflineDb, enqueueMutation } from '../db';
import { syncPendingMutations } from '../sync-engine';

function freshDb(): OfflineDb {
  return new OfflineDb(`test-sync-${Math.random().toString(36).slice(2)}`);
}

describe('sync-engine — confirm-before-clear', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('a mutation is NOT cleared when the server response is lost (fetch throws) — it stays queued for retry', async () => {
    const db = freshDb();
    const mutation = await enqueueMutation(db, { endpoint: '/api/faults', payload: { a: 1 } });

    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('network down')));

    const result = await syncPendingMutations(db);

    expect(result.acked).toEqual([]);
    expect(result.stillPending).toEqual([mutation.id]);
    expect(result.reachedServer).toBe(false);

    const stillThere = await db.mutations.get(mutation.id);
    expect(stillThere).toBeTruthy();
    expect(stillThere?.status).toBe('pending');
  });

  it('a mutation is NOT cleared when the server errors (non-2xx) — it stays queued, not vanished', async () => {
    const db = freshDb();
    const mutation = await enqueueMutation(db, { endpoint: '/api/faults', payload: { a: 1 } });

    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({ ok: false, status: 500, json: async () => ({ error: 'boom' }) }),
    );

    const result = await syncPendingMutations(db);

    expect(result.acked).toEqual([]);
    expect(result.stillPending).toEqual([mutation.id]);

    const stillThere = await db.mutations.get(mutation.id);
    expect(stillThere).toBeTruthy();
  });

  it('a mutation IS cleared once the server explicitly acks its ID', async () => {
    const db = freshDb();
    const mutation = await enqueueMutation(db, { endpoint: '/api/faults', payload: { a: 1 } });

    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({
        ok: true,
        status: 200,
        json: async () => ({ results: [{ id: mutation.id, status: 'applied' }] }),
      }),
    );

    const result = await syncPendingMutations(db);

    expect(result.acked).toEqual([mutation.id]);
    expect(result.stillPending).toEqual([]);
    expect(await db.mutations.get(mutation.id)).toBeUndefined();
  });
});

describe('sync-engine — retry safety', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('retrying an unacked mutation across multiple failed sync attempts never duplicates it and never crashes', async () => {
    const db = freshDb();
    const mutation = await enqueueMutation(db, { endpoint: '/api/faults', payload: { a: 1 } });

    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('network down')));

    await syncPendingMutations(db);
    await syncPendingMutations(db);
    await syncPendingMutations(db);

    const rows = await db.mutations.where('id').equals(mutation.id).toArray();
    expect(rows).toHaveLength(1); // never duplicated across three retries
    expect(rows[0].attempts).toBe(3);

    // Now the server finally acks it — same mutation ID as every prior (failed) attempt sent.
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({
        ok: true,
        status: 200,
        json: async () => ({ results: [{ id: mutation.id, status: 'applied' }] }),
      }),
    );

    const finalResult = await syncPendingMutations(db);
    expect(finalResult.acked).toEqual([mutation.id]);
    expect(await db.mutations.count()).toBe(0);
  });

  it('an empty queue syncs safely (no crash, nothing pushed) — the client can always call this without fear', async () => {
    const db = freshDb();
    const result = await syncPendingMutations(db);
    expect(result.pushed).toBe(0);
    expect(result.acked).toEqual([]);
  });
});
