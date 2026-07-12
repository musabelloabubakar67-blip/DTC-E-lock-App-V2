// §4 Offline & sync, points 2–3. PASS TWO: real dispatch + server-authoritative conflict
// handling. Reuses the existing, proven business services (fault/installation/movement/
// lifecycle) — this file adds NO new business logic, only routing + the ack-and-apply ledger.
//
// Two load-bearing rules:
//   (A) An "applied" ack means APPLIED — the sync_mutations ledger row and the mutation's
//       business effect are written in ONE db.transaction(). If the service throws, NEITHER
//       exists; the client is told 'conflicted'/'rejected', never 'applied'.
//   (B) A batch applies in (clientTs, seq) order — clientTs for cross-device ordering, seq to
//       break ties between same-device mutations that share a clientTs (same millisecond).
import { eq } from 'drizzle-orm';
import { createId } from '@paralleldrive/cuid2';
import { devices, syncMutations, conflictReviews, auditLog } from '../db/schema';
import { BusinessError, AuthzError } from '../lib/errors';
import { createFaultReportSchema } from '../lib/validations/fault';
import { installKitSchema } from '../lib/validations/installation';
import { movementActionSchema } from '../lib/validations/movement';
import { recordKitVerificationSchema } from '../lib/validations/verification';
import { createFaultReport } from './fault.service';
import { recordInstallation } from './installation.service';
import { dispatchMovementAction } from './movement.service';
import { applyTriageMovement } from './movement.service';
import { recordKitVerification } from './verification.service';
import type { AuthenticatedUser } from './auth.service';

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type DbClient = any; // drizzle db or transaction handle — identical query surface for our purposes.

export type IncomingMutation = {
  id: string; // client mutation ID — the idempotency key
  endpoint: string;
  payload: unknown;
  clientTs: number;
  seq: number;
};

export type MutationOutcome =
  | { id: string; status: 'applied' }
  | { id: string; status: 'conflicted'; conflictReviewId?: string }
  | { id: string; status: 'rejected'; message: string };

/**
 * Routes a mutation's payload to its real business service by endpoint — reusing the existing,
 * already-proven services. Re-validates payload with the SAME Zod schema the live HTTP routes
 * use, since a replayed offline mutation gets no other input validation before this point.
 * actorUserId comes from `actor` (the SYNCING session), never from the payload.
 */
function dispatch(db: DbClient, orgId: string, actor: AuthenticatedUser, mutation: IncomingMutation): unknown {
  switch (mutation.endpoint) {
    case '/api/faults': {
      const parsed = createFaultReportSchema.parse(mutation.payload);
      return createFaultReport(db, { orgId, actorUserId: actor.id, ...parsed });
    }
    case '/api/installations': {
      const parsed = installKitSchema.parse(mutation.payload);
      return recordInstallation(db, { orgId, actorUserId: actor.id, ...parsed });
    }
    case '/api/movements': {
      const parsed = movementActionSchema.parse(mutation.payload);
      return dispatchMovementAction(db, { orgId, actorUserId: actor.id, action: parsed });
    }
    case '/api/triage': {
      const payload = mutation.payload as { deviceId?: unknown; outcome?: unknown };
      if (typeof payload.deviceId !== 'string' || (payload.outcome !== 'revived' && payload.outcome !== 'dead')) {
        throw new BusinessError('Invalid triage payload: deviceId and outcome ("revived"|"dead") are required');
      }
      return applyTriageMovement(db, { orgId, deviceId: payload.deviceId, actor, outcome: payload.outcome });
    }
    case '/api/verifications': {
      // recordKitVerification never throws for an ordinary mismatch — a mismatch is a
      // SUCCESSFUL application that runs its own correct → conflict_review(unlogged_swap) flow
      // internally (§3). It only throws for genuine errors (e.g. mother not found). So a
      // mismatch result here is correctly acked 'applied', not routed through THIS file's
      // sync-conflict handling — that's for a queued mutation colliding with concurrent server
      // state, a different concept from a scan disagreeing with the registry.
      const parsed = recordKitVerificationSchema.parse(mutation.payload);
      return recordKitVerification(db, { orgId, actorUserId: actor.id, ...parsed });
    }
    default:
      throw new BusinessError(`Unknown mutation endpoint: ${mutation.endpoint}`);
  }
}

// Best-effort "current server state" capture for the conflict_review payload — looks for
// common device-id-shaped fields in the mutation's own payload and snapshots their live rows,
// so a supervisor sees concretely what the queued mutation collided with.
const DEVICE_ID_FIELDS = ['deviceId', 'motherDeviceId', 'newMotherDeviceId', 'newSubDeviceId', 'subDeviceIds'];

function captureCurrentDeviceStates(db: DbClient, payload: unknown): Record<string, unknown> {
  const states: Record<string, unknown> = {};
  if (typeof payload !== 'object' || payload === null) return states;

  for (const field of DEVICE_ID_FIELDS) {
    const value = (payload as Record<string, unknown>)[field];
    const ids = Array.isArray(value) ? value : typeof value === 'string' ? [value] : [];
    for (const id of ids) {
      if (typeof id !== 'string') continue;
      const device = db.select().from(devices).where(eq(devices.id, id)).get();
      if (device) states[id] = { serial: device.serial, lifecycleStatus: device.lifecycleStatus };
    }
  }
  return states;
}

function recordConflict(
  db: DbClient,
  orgId: string,
  actor: AuthenticatedUser,
  mutation: IncomingMutation,
  error: BusinessError,
): MutationOutcome {
  return db.transaction((tx: DbClient) => {
    tx.insert(syncMutations)
      .values({
        clientMutationId: mutation.id,
        orgId,
        userId: actor.id,
        kind: mutation.endpoint,
        status: 'conflicted',
        clientTs: mutation.clientTs,
      })
      .run();

    const conflictReviewId = createId();
    tx.insert(conflictReviews)
      .values({
        id: conflictReviewId,
        orgId,
        kind: 'sync_conflict',
        payloadJson: JSON.stringify({
          queuedMutation: {
            id: mutation.id,
            endpoint: mutation.endpoint,
            payload: mutation.payload,
            clientTs: mutation.clientTs,
            seq: mutation.seq,
          },
          currentServerState: captureCurrentDeviceStates(tx, mutation.payload),
          error: error.message,
        }),
        status: 'open',
      })
      .run();

    tx.insert(auditLog)
      .values({
        id: createId(),
        orgId,
        actorUserId: actor.id,
        entityTable: 'sync_mutations',
        entityId: mutation.id,
        operation: 'create',
        afterJson: JSON.stringify({ status: 'conflicted', conflictReviewId, error: error.message }),
      })
      .run();

    return { id: mutation.id, status: 'conflicted', conflictReviewId } as const;
  });
}

function recordRejected(
  db: DbClient,
  orgId: string,
  actor: AuthenticatedUser,
  mutation: IncomingMutation,
  message: string,
): MutationOutcome {
  return db.transaction((tx: DbClient) => {
    tx.insert(syncMutations)
      .values({
        clientMutationId: mutation.id,
        orgId,
        userId: actor.id,
        kind: mutation.endpoint,
        status: 'rejected',
        clientTs: mutation.clientTs,
      })
      .run();

    tx.insert(auditLog)
      .values({
        id: createId(),
        orgId,
        actorUserId: actor.id,
        entityTable: 'sync_mutations',
        entityId: mutation.id,
        operation: 'create',
        afterJson: JSON.stringify({ status: 'rejected', message }),
      })
      .run();

    return { id: mutation.id, status: 'rejected', message } as const;
  });
}

/**
 * Applies ONE mutation. Idempotent: if this client mutation ID is already in the ledger, re-ack
 * its recorded outcome WITHOUT re-running dispatch — never re-applies.
 *
 * Rule A: dispatch + the 'applied' ledger row are written in the SAME transaction. If dispatch
 * throws, that transaction never commits — there is no path where an 'applied' row exists
 * without the business effect alongside it (or vice versa).
 */
function applyOneMutation(
  db: DbClient,
  orgId: string,
  actor: AuthenticatedUser,
  mutation: IncomingMutation,
): MutationOutcome {
  const existing = db
    .select()
    .from(syncMutations)
    .where(eq(syncMutations.clientMutationId, mutation.id))
    .get();

  if (existing) {
    // Already recorded — ack again with whatever the ledger already says, WITHOUT re-running
    // dispatch. sync_mutations doesn't store a back-reference to its conflict_reviews row, so a
    // replayed 'conflicted' ack omits conflictReviewId — the client already received it (or can
    // find it on /review) the first time; a replay's only job is confirming the status again.
    if (existing.status === 'applied') return { id: mutation.id, status: 'applied' };
    if (existing.status === 'rejected') return { id: mutation.id, status: 'rejected', message: 'Previously rejected' };
    return { id: mutation.id, status: 'conflicted' };
  }

  try {
    return db.transaction((tx: DbClient) => {
      dispatch(tx, orgId, actor, mutation);

      tx.insert(syncMutations)
        .values({
          clientMutationId: mutation.id,
          orgId,
          userId: actor.id,
          kind: mutation.endpoint,
          status: 'applied',
          clientTs: mutation.clientTs,
        })
        .run();

      return { id: mutation.id, status: 'applied' } as const;
    });
  } catch (error) {
    if (error instanceof AuthzError) {
      return recordRejected(db, orgId, actor, mutation, error.message);
    }
    if (error instanceof BusinessError) {
      return recordConflict(db, orgId, actor, mutation, error);
    }
    throw error; // genuinely unexpected — let the caller 500, don't mask a real bug as a conflict
  }
}

/**
 * Applies a batch of mutations in (clientTs, seq) order (rule B) and returns one outcome per
 * mutation, in the SAME order they were received (not sorted) so the caller can zip them back
 * to client mutation IDs unambiguously.
 */
export function applySyncBatch(
  db: DbClient,
  params: { orgId: string; actor: AuthenticatedUser; mutations: IncomingMutation[] },
): MutationOutcome[] {
  const ordered = [...params.mutations].sort((a, b) => a.clientTs - b.clientTs || a.seq - b.seq);

  const outcomeById = new Map<string, MutationOutcome>();
  for (const mutation of ordered) {
    outcomeById.set(mutation.id, applyOneMutation(db, params.orgId, params.actor, mutation));
  }

  return params.mutations.map((m) => outcomeById.get(m.id)!);
}
