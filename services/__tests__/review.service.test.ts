import { describe, it, expect } from 'vitest';
import { eq } from 'drizzle-orm';
import { createId } from '@paralleldrive/cuid2';
import { conflictReviews, devices, truckAssignments, auditLog } from '../../db/schema';
import { createTestDb } from '../../tests/helpers/testDb';
import { seedBaseFixtures, createTruck, createDevice } from '../../tests/helpers/fixtures';
import { listOpenConflictReviews, resolveConflictReview, dismissConflictReview } from '../review.service';
import { applySyncBatch, type IncomingMutation } from '../sync.service';
import { AuthzError } from '../../lib/errors';

function openReview(
  db: ReturnType<typeof createTestDb>['db'],
  orgId: string,
  kind: 'unlogged_swap' | 'sync_conflict',
  payload: unknown,
): string {
  const id = createId();
  db.insert(conflictReviews)
    .values({ id, orgId, kind, payloadJson: JSON.stringify(payload), status: 'open' })
    .run();
  return id;
}

describe('Review (§7 /review over conflict_reviews) — resolve is acknowledgement, not re-correction', () => {
  it('resolving a conflict_review sets status=resolved, records who/when, writes audit, and leaves the registry completely unchanged', () => {
    const { db } = createTestDb();
    const { orgId, supervisorId, installerId } = seedBaseFixtures(db);
    const truckId = createTruck(db, orgId, 'FZE900RV');
    const motherId = createDevice(db, orgId, { type: 'mother', serial: 'REVIEW-MOTHER-1', status: 'in_service' });
    const now = Math.floor(Date.now() / 1000);
    const assignmentId = createId();
    db.insert(truckAssignments)
      .values({ id: assignmentId, orgId, truckId, deviceId: motherId, assignedAt: now, assignedBy: installerId })
      .run();

    const reviewId = openReview(db, orgId, 'unlogged_swap', {
      truckId,
      expectedMotherSerial: 'SOMETHING-ELSE',
      observedMotherSerial: 'REVIEW-MOTHER-1',
    });

    // Snapshot registry state BEFORE resolving.
    const deviceBefore = db.select().from(devices).where(eq(devices.id, motherId)).get()!;
    const assignmentBefore = db.select().from(truckAssignments).where(eq(truckAssignments.id, assignmentId)).get()!;

    resolveConflictReview(db, {
      reviewId,
      actor: { id: supervisorId, orgId, role: 'supervisor' },
      resolutionNotes: 'Confirmed with driver, scan was correct.',
    });

    const review = db.select().from(conflictReviews).where(eq(conflictReviews.id, reviewId)).get()!;
    expect(review.status).toBe('resolved');
    expect(review.resolvedBy).toBe(supervisorId);
    expect(review.resolvedAt).not.toBeNull();
    expect(review.resolutionNotes).toBe('Confirmed with driver, scan was correct.');

    const auditRows = db.select().from(auditLog).where(eq(auditLog.entityId, reviewId)).all();
    expect(auditRows.length).toBeGreaterThan(0);

    // The registry is EXACTLY as it was — resolve touched conflict_reviews and audit_log only.
    const deviceAfter = db.select().from(devices).where(eq(devices.id, motherId)).get()!;
    const assignmentAfter = db.select().from(truckAssignments).where(eq(truckAssignments.id, assignmentId)).get()!;
    expect(deviceAfter).toEqual(deviceBefore);
    expect(assignmentAfter).toEqual(assignmentBefore);
  });

  it('the review screen handles zero sync_conflict rows without error (offline sync does not exist yet)', () => {
    const { db } = createTestDb();
    const { orgId } = seedBaseFixtures(db);

    // Only an unlogged_swap review exists — no sync_conflict rows anywhere in the DB.
    openReview(db, orgId, 'unlogged_swap', { note: 'only kind that currently exists' });

    const reviews = listOpenConflictReviews(db);
    const syncConflicts = reviews.filter((r) => r.kind === 'sync_conflict');

    expect(syncConflicts).toEqual([]);
    expect(reviews.length).toBe(1); // the unlogged_swap one still lists fine
  });

  it('both resolve and dismiss throw for a non-supervisor', () => {
    const { db } = createTestDb();
    const { orgId, installerId } = seedBaseFixtures(db);
    const reviewA = openReview(db, orgId, 'unlogged_swap', { a: 1 });
    const reviewB = openReview(db, orgId, 'unlogged_swap', { b: 2 });

    expect(() =>
      resolveConflictReview(db, { reviewId: reviewA, actor: { id: installerId, orgId, role: 'installer' } }),
    ).toThrow(AuthzError);

    expect(() =>
      dismissConflictReview(db, { reviewId: reviewB, actor: { id: installerId, orgId, role: 'installer' } }),
    ).toThrow(AuthzError);

    // Neither attempt left the reviews in any transitioned state.
    expect(db.select().from(conflictReviews).where(eq(conflictReviews.id, reviewA)).get()!.status).toBe('open');
    expect(db.select().from(conflictReviews).where(eq(conflictReviews.id, reviewB)).get()!.status).toBe('open');
  });

  it('a sync_conflict produced by sync.service.ts actually shows up on the Review list, in the shape the page renders', () => {
    const { db } = createTestDb();
    const { orgId, installerId } = seedBaseFixtures(db);
    const truckA = createTruck(db, orgId, 'FZE900RC');
    const truckB = createTruck(db, orgId, 'FZE901RC');
    const motherId = createDevice(db, orgId, { type: 'mother', serial: 'REVIEW-SYNC-CONFLICT-1', status: 'available' });

    const mutations: IncomingMutation[] = [
      { id: 'rc-1', endpoint: '/api/movements', payload: { kind: 'new_assignment', truckId: truckA, motherDeviceId: motherId }, clientTs: 1, seq: 1 },
      { id: 'rc-2', endpoint: '/api/movements', payload: { kind: 'new_assignment', truckId: truckB, motherDeviceId: motherId }, clientTs: 2, seq: 2 },
    ];
    applySyncBatch(db, { orgId, actor: { id: installerId, orgId, role: 'installer' }, mutations });

    const openReviews = listOpenConflictReviews(db);
    const syncConflict = openReviews.find((r) => r.kind === 'sync_conflict');

    expect(syncConflict).toBeTruthy();
    // Exactly the shape review/page.tsx's PayloadSummary reads for sync_conflict.
    const payload = syncConflict!.payload as { queuedMutation: { id: string }; currentServerState: unknown; error: string };
    expect(payload.queuedMutation.id).toBe('rc-2');
    expect(payload.currentServerState).toBeTruthy();
    expect(typeof payload.error).toBe('string');
  });
});
