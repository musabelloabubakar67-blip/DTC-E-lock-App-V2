// §4 Offline & sync, point 1: "Every write is local-first." Dexie mutation queue. The queue's
// durability is IndexedDB's job — this file adds nothing beyond schema + enqueue; it doesn't
// re-implement persistence.
//
// Registry read cache (§4 point 4) is NOT built this session — pass one is the mutation queue
// + sync engine + status indicator only.
import Dexie, { type Table } from 'dexie';
import { createId } from '@paralleldrive/cuid2';

export type QueuedMutationStatus = 'pending' | 'error';

export interface QueuedMutation {
  id: string; // client-generated (cuid2) — this IS the idempotency key the server dedupes on
  endpoint: string; // e.g. '/api/faults'
  payload: unknown;
  clientTs: number; // client-generated timestamp, for client-timestamp-order application (§4 point 3, pass two)
  // Strictly monotonic enqueue sequence number — the ORDERING authority, distinct from
  // clientTs. Date.now() has millisecond resolution; two mutations enqueued in the same
  // millisecond would tie on clientTs, and ties on a Dexie query ordered by a non-unique index
  // resolve by primary key (a cuid2), which is NOT chronologically sortable — that would let
  // order flip relative to true enqueue sequence. seq is assigned atomically (same transaction
  // as the insert) from a counter persisted in `meta`, so it survives app restart and stays
  // strictly increasing regardless of clock resolution.
  seq: number;
  status: QueuedMutationStatus;
  attempts: number;
  lastError?: string;
  createdAt: number;
}

export class OfflineDb extends Dexie {
  mutations!: Table<QueuedMutation, string>;
  meta!: Table<{ key: string; value: number }, string>;

  constructor(name = 'dtc-elock-offline') {
    super(name);
    this.version(1).stores({
      mutations: 'id, status, createdAt, seq',
      meta: 'key',
    });
  }
}

// Singleton used by the app shell / form pages. Tests construct their own named instance
// instead, so runs don't share state.
export const offlineDb = new OfflineDb();

/**
 * Local-first write (§4 point 1, §9): writes the full mutation to the queue BEFORE any network
 * call. Every mutating form except registration (online-only, §9) calls this instead of
 * fetching directly.
 *
 * The counter increment and the mutation insert happen in ONE Dexie transaction, so seq
 * assignment can't race with itself and can't half-happen — either both writes land or neither
 * does (same atomicity guarantee as a single `.add()`, just extended over the two tables).
 */
export async function enqueueMutation(
  db: OfflineDb,
  params: { endpoint: string; payload: unknown },
): Promise<QueuedMutation> {
  return db.transaction('rw', db.mutations, db.meta, async () => {
    const counter = await db.meta.get('seq');
    const nextSeq = (counter?.value ?? 0) + 1;
    await db.meta.put({ key: 'seq', value: nextSeq });

    const mutation: QueuedMutation = {
      id: createId(),
      endpoint: params.endpoint,
      payload: params.payload,
      clientTs: Date.now(),
      seq: nextSeq,
      status: 'pending',
      attempts: 0,
      createdAt: Date.now(),
    };
    await db.mutations.add(mutation);
    return mutation;
  });
}
