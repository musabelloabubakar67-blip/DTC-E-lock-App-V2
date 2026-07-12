// §7 /review — supervisor screen over conflict_reviews. §3: mismatch corrections already
// applied at scan time (reality wins immediately); this service ONLY lets a supervisor
// acknowledge a review as seen. resolve/dismiss NEVER touch devices, truck_assignments,
// slot_pairings, kit_members, or verifications — that would be a re-correction/reversal, which
// is explicitly NOT what this screen does. An actual reversal of a bad correction is a
// supervisor edit via the normal audit-backed correction path, not a Review action.
import { eq } from 'drizzle-orm';
import { createId } from '@paralleldrive/cuid2';
import { conflictReviews, auditLog } from '../db/schema';
import { BusinessError } from '../lib/errors';
import { requireSupervisor, type AuthenticatedUser } from './auth.service';

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type DbClient = any; // drizzle db or transaction handle — identical query surface for our purposes.

export type ConflictReviewKind = 'sync_conflict' | 'unlogged_swap' | 'import_conflict';
export type ConflictReviewStatus = 'open' | 'resolved' | 'dismissed';

export type ConflictReviewListItem = {
  id: string;
  kind: ConflictReviewKind;
  status: ConflictReviewStatus;
  payload: unknown; // parsed payload_json — legible expected-vs-observed / both-versions
  createdAt: number;
};

/**
 * Open conflict_reviews, both kinds that can currently exist (unlogged_swap from mismatch
 * corrections; sync_conflict from offline sync, which isn't built yet). Returns an empty list
 * gracefully if there are none of a given kind — no assumption that either kind exists.
 */
export function listOpenConflictReviews(db: DbClient): ConflictReviewListItem[] {
  const rows = db.select().from(conflictReviews).where(eq(conflictReviews.status, 'open')).all();
  return rows.map(
    (row: { id: string; kind: ConflictReviewKind; status: ConflictReviewStatus; payloadJson: string; createdAt: number }) => ({
      id: row.id,
      kind: row.kind,
      status: row.status,
      payload: JSON.parse(row.payloadJson),
      createdAt: row.createdAt,
    }),
  );
}

export type TransitionConflictReviewInput = {
  reviewId: string;
  actor: AuthenticatedUser;
  resolutionNotes?: string;
};

/**
 * Shared by resolve/dismiss: supervisor-only, records who/when, writes audit — and touches
 * ONLY conflict_reviews + audit_log. No registry table appears in this transaction, on purpose.
 */
function transitionConflictReview(
  db: DbClient,
  input: TransitionConflictReviewInput,
  toStatus: 'resolved' | 'dismissed',
): void {
  requireSupervisor(input.actor);

  db.transaction((tx: DbClient) => {
    const review = tx.select().from(conflictReviews).where(eq(conflictReviews.id, input.reviewId)).get();
    if (!review) throw new BusinessError(`Conflict review ${input.reviewId} not found`);
    if (review.status !== 'open') {
      throw new BusinessError(`Conflict review ${input.reviewId} is already '${review.status}'`);
    }

    const now = Math.floor(Date.now() / 1000);

    tx.update(conflictReviews)
      .set({
        status: toStatus,
        resolvedBy: input.actor.id,
        resolvedAt: now,
        resolutionNotes: input.resolutionNotes,
      })
      .where(eq(conflictReviews.id, input.reviewId))
      .run();

    tx.insert(auditLog)
      .values({
        id: createId(),
        orgId: review.orgId,
        actorUserId: input.actor.id,
        entityTable: 'conflict_reviews',
        entityId: input.reviewId,
        operation: 'transition',
        beforeJson: JSON.stringify({ status: review.status }),
        afterJson: JSON.stringify({ status: toStatus, resolvedBy: input.actor.id, resolvedAt: now }),
      })
      .run();
  });
}

/** Acknowledgement — "reviewed and accepted." Does NOT re-apply or reverse anything. */
export function resolveConflictReview(db: DbClient, input: TransitionConflictReviewInput): void {
  transitionConflictReview(db, input, 'resolved');
}

/** Acknowledgement — "reviewed, no action needed." Does NOT re-apply or reverse anything. */
export function dismissConflictReview(db: DbClient, input: TransitionConflictReviewInput): void {
  transitionConflictReview(db, input, 'dismissed');
}
