// §4 Offline & sync, point 2: pushes queued mutations to POST /api/sync on reconnect + on-focus
// + periodic retry with backoff. Idempotent by client mutation ID — the client must be able to
// re-send without fear, and must NOT clear a mutation from the queue until the server confirms
// (acks) its specific mutation ID. /api/sync (via services/sync.service.ts) does real dispatch
// to the business services plus server-authoritative conflict handling — 'applied' means
// applied, not merely received; see sync.service.ts for the ack-and-apply transaction.
import type { OfflineDb } from './db';

export type SyncResult = {
  pushed: number;
  acked: string[];
  stillPending: string[];
  reachedServer: boolean;
};

/**
 * CONFIRM-BEFORE-CLEAR. Only mutation IDs the server explicitly acked (`status: 'applied'`)
 * are deleted from the local queue. A lost/errored response, or a response that simply omits
 * an ID, acks nothing for that ID — it stays queued for the next retry. Never assumes success
 * from "the request didn't throw."
 */
export async function syncPendingMutations(db: OfflineDb, endpoint = '/api/sync'): Promise<SyncResult> {
  // Ordered by seq, NOT createdAt/clientTs — seq is the strictly monotonic tiebreaker (see
  // db.ts) that stays correct even for two mutations enqueued in the same millisecond.
  const pending = await db.mutations.where('status').anyOf(['pending', 'error']).sortBy('seq');

  if (pending.length === 0) {
    await db.meta.put({ key: 'lastSyncedAt', value: Date.now() }); // nothing queued = trivially in sync
    return { pushed: 0, acked: [], stillPending: [], reachedServer: true };
  }

  // seq travels WITH clientTs — the server orders a batch by (clientTs, seq) (rule B): clientTs
  // for cross-device ordering, seq to disambiguate same-device mutations that tied on clientTs.
  const batch = pending.map((m) => ({ id: m.id, endpoint: m.endpoint, payload: m.payload, clientTs: m.clientTs, seq: m.seq }));

  let ackedIds: string[] = [];
  let reachedServer = false;

  try {
    const response = await fetch(endpoint, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ mutations: batch }),
    });

    if (response.ok) {
      reachedServer = true;
      const body = await response.json().catch(() => null);
      const results: { id: string; status: string }[] = body?.results ?? [];
      ackedIds = results.filter((r) => r.status === 'applied').map((r) => r.id);
    }
    // A non-ok response acks nothing — every pending mutation stays queued.
  } catch {
    // Network error / server unreachable — nothing acked, nothing cleared. The queue is
    // untouched and will be retried on the next trigger (online, focus, or backoff tick).
  }

  if (ackedIds.length > 0) {
    await db.mutations.bulkDelete(ackedIds);
  }

  const stillPendingIds = pending.map((m) => m.id).filter((id) => !ackedIds.includes(id));
  if (stillPendingIds.length > 0) {
    await db.mutations
      .where('id')
      .anyOf(stillPendingIds)
      .modify((m: { attempts: number }) => {
        m.attempts += 1;
      });
  }

  if (reachedServer) {
    await db.meta.put({ key: 'lastSyncedAt', value: Date.now() });
  }

  return { pushed: batch.length, acked: ackedIds, stillPending: stillPendingIds, reachedServer };
}

const BASE_BACKOFF_MS = 5000;
const MAX_BACKOFF_MS = 60000;

/**
 * Wires the sync engine into the browser: fires on the `online` event, on window focus, and on
 * a periodic backoff timer (grows while the queue isn't draining, resets to base once it does).
 * Returns a teardown function.
 */
export function startSyncEngine(db: OfflineDb, endpoint = '/api/sync'): () => void {
  let backoffMs = BASE_BACKOFF_MS;
  let timer: ReturnType<typeof setTimeout> | null = null;
  let stopped = false;

  async function tick() {
    if (stopped) return;
    const result = await syncPendingMutations(db, endpoint);
    backoffMs = result.stillPending.length > 0 ? Math.min(backoffMs * 2, MAX_BACKOFF_MS) : BASE_BACKOFF_MS;
    if (!stopped) timer = setTimeout(tick, backoffMs);
  }

  function trigger() {
    void syncPendingMutations(db, endpoint);
  }

  window.addEventListener('online', trigger);
  window.addEventListener('focus', trigger);
  timer = setTimeout(tick, backoffMs);

  return () => {
    stopped = true;
    window.removeEventListener('online', trigger);
    window.removeEventListener('focus', trigger);
    if (timer) clearTimeout(timer);
  };
}
