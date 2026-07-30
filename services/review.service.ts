import { createId } from '@paralleldrive/cuid2';
import { and, desc, eq } from 'drizzle-orm';
import { auditLog, conflictReviews } from '../db/schema';
import { BusinessError } from '../lib/errors';
import { requireSupervisor, type AuthenticatedUser } from './auth.service';
import { applySyncBatch, type MutationOutcome } from './sync.service';

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type DbClient = any;

export type ConflictReviewKind = 'sync_conflict' | 'unlogged_swap' | 'import_conflict';
export type ConflictReviewStatus = 'open' | 'resolved' | 'dismissed';

export type ConflictReviewPresentation = {
  title: string;
  summary: string;
  details: Array<{ label: string; value: string }>;
  recommendedAction: string;
};

export type ConflictReviewListItem = {
  id: string;
  kind: ConflictReviewKind;
  status: ConflictReviewStatus;
  payload: Record<string, unknown>;
  presentation: ConflictReviewPresentation;
  createdAt: number;
};

export function listOpenConflictReviews(db: DbClient, orgId: string): ConflictReviewListItem[] {
  const rows = db
    .select()
    .from(conflictReviews)
    .where(and(eq(conflictReviews.orgId, orgId), eq(conflictReviews.status, 'open')))
    .orderBy(desc(conflictReviews.createdAt))
    .all();

  return rows.map(
    (row: { id: string; kind: ConflictReviewKind; status: ConflictReviewStatus; payloadJson: string; createdAt: number }) => {
      const payload = parsePayload(row.payloadJson);
      return {
        id: row.id,
        kind: row.kind,
        status: row.status,
        payload,
        presentation: presentConflictReview(row.kind, payload),
        createdAt: row.createdAt,
      };
    },
  );
}

export function presentConflictReview(
  kind: ConflictReviewKind,
  payload: Record<string, unknown>,
): ConflictReviewPresentation {
  if (kind === 'unlogged_swap') {
    const truck = firstText(payload.truckLabel, payload.truckId) || 'the selected truck';
    return {
      title: 'Physical kit differed from the registry',
      summary: `A verification found different lock serials on ${displayTruck(truck)}. The registry was updated to match the physical scan and this review records that correction.`,
      details: compactDetails([
        ['Truck', displayTruck(truck)],
        ['Previously recorded mother', text(payload.expectedMotherSerial) || 'None recorded'],
        ['Scanned mother', text(payload.observedMotherSerial)],
        ['Previously recorded sub-locks', list(payload.expectedSubSerials)],
        ['Scanned sub-locks', list(payload.observedSubSerials)],
      ]),
      recommendedAction: 'Confirm the physical scan was correct, then mark the review as reviewed. Use "No action needed" only when no follow-up is required.',
    };
  }

  if (kind === 'sync_conflict') {
    const queued = object(payload.queuedMutation);
    const endpoint = text(queued.endpoint);
    const operation = object(queued.payload);
    const reason = text(payload.error) || 'The server could not apply this saved change';

    if (endpoint === '/api/mobile/installations') {
      const truck = text(operation.truckPlate) || 'Unknown truck';
      return {
        title: `Installation for ${truck} was not recorded`,
        summary: `The scanned installation for ${truck} reached the server, but the assignment was not changed. ${reason}`,
        details: compactDetails([
          ['Truck', truck],
          ['Install type', text(operation.installMode) === 'changed' ? 'Kit change / override' : 'Installation'],
          ['Serving company', text(operation.company).toUpperCase()],
          ['Scanned mother', text(operation.motherSerial)],
          ['Scanned sub-locks', list(operation.subSerials)],
          ['Why it failed', reason],
        ]),
        recommendedAction: 'Check that all four scanned locks are registered and owned by DTC, then repeat Install. A kit-change scan will now move those locks from stale assignments automatically.',
      };
    }

    if (endpoint === '/api/repairs') {
      const truck = text(operation.truck) || 'Unknown truck';
      return {
        title: `Repair for ${truck} was not applied`,
        summary: `The remove/replace operation reached the server, but the installed kit was left unchanged. ${reason}`,
        details: compactDetails([
          ['Truck', truck],
          ['Requested operations', repairOperationList(operation.items)],
          ['Reason selected', sentence(text(operation.reason))],
          ['Fault description', text(operation.description)],
          ['Why it failed', reason],
        ]),
        recommendedAction: 'Reload the truck in Repairs and confirm the current serials. For replacement, the new lock must be registered, owned by DTC and available. Repeat the operation after correcting the stated problem.',
      };
    }

    if (endpoint === '/api/verifications') {
      return {
        title: `Verification for ${text(operation.truckId) || 'a truck'} was not recorded`,
        summary: `The physical-kit verification reached the server but could not be applied. ${reason}`,
        details: compactDetails([
          ['Truck', text(operation.truckId)],
          ['Scanned mother', text(operation.motherSerial)],
          ['Why it failed', reason],
        ]),
        recommendedAction: 'Reload the truck and repeat the physical verification using the current truck plate and all four lock serials.',
      };
    }

    return {
      title: 'Offline change could not be applied',
      summary: `A saved field operation reached the server but was not applied. ${reason}`,
      details: compactDetails([
        ['Operation', endpoint || 'Offline change'],
        ['Reason', reason],
        ['Saved on device', text(queued.clientTs)],
      ]),
      recommendedAction: 'Check the current truck or kit state, repeat the intended action if it is still required, then mark this review as reviewed.',
    };
  }

  const reason = text(payload.reason);
  const row = object(payload.row);
  if (reason === 'kit_mismatch_updated_registry') {
    const truck = text(row.truck);
    return {
      title: 'Installation history differs from the registered kit',
      summary: `The historical installation entry${truck ? ` for ${truck}` : ''} lists a different kit from the current registration record. Slot order alone is not treated as a problem.`,
      details: compactDetails([
        ['Truck', truck],
        ['Mother lock', text(row.mother)],
        ['Installation sub-locks', joinRowSubs(row, 'install_sub_')],
        ['Registered sub-locks', joinRowSubs(row, 'registry_sub_')],
        ['Installation source row', text(row.install_row)],
        ['Registry source row', text(row.registry_row)],
      ]),
      recommendedAction: 'Verify the physical kit. If it matches the current registry, mark the review as reviewed; otherwise use the normal install or verification workflow to correct the record.',
    };
  }
  if (reason === 'invalid_masterlist_kit') {
    const subs = rowSubs(row);
    return {
      title: subs.length === 0 ? 'Mother-only registration record' : 'Incomplete registration record',
      summary: subs.length === 0
        ? 'This source row registered only a mother lock. Mother-only registration can be valid, but the record should be checked before treating it as a complete kit.'
        : `This source row contains ${subs.length} of the three expected sub-locks.`,
      details: compactDetails([
        ['Mother lock', text(row.mother)],
        ['Sub-locks listed', subs.join(', ') || 'None'],
        ['SIM', text(row.sim)],
        ['Source row', text(row.source_row)],
      ]),
      recommendedAction: 'Confirm whether this was intentionally registered as mother-only. Complete the kit through Register only if more devices actually belong to it.',
    };
  }
  if (reason === 'masterlist_sub_in_multiple_kits') {
    return {
      title: 'Sub-lock appears in more than one registered kit',
      summary: 'At least one sub-lock serial is assigned to multiple registration kits. One device cannot belong to two current kits.',
      details: compactDetails([
        ['Mother lock', text(row.mother)],
        ['Duplicated sub-locks', list(payload.duplicated_subs)],
        ['Kit sub-locks', rowSubs(row).join(', ')],
        ['Source row', text(row.source_row)],
      ]),
      recommendedAction: 'Check the physical kits and keep the sub-lock with the correct mother. Correct the other registration before marking this review as reviewed.',
    };
  }
  if (reason === 'mother_missing_registration_masterlist') {
    return {
      title: 'Installed mother is missing from registration records',
      summary: 'An installation uses a mother lock that was not found in the registration masterlist. One or more listed sub-locks may already belong to another kit.',
      details: compactDetails([
        ['Truck', text(row.truck)],
        ['Mother lock', text(row.mother)],
        ['Sub-locks', rowSubs(row).join(', ')],
        ['Installer', text(row.team_member)],
        ['Installation source row', text(row.source_row)],
      ]),
      recommendedAction: 'Confirm the physical kit, then register the missing mother only with the devices that truly belong to it.',
    };
  }

  return {
    title: 'Data conflict needs review',
    summary: reason ? sentence(reason) : 'Two records disagree and need a supervisor decision.',
    details: compactDetails(Object.entries(row).map(([key, value]) => [sentence(key), valueText(value)])),
    recommendedAction: 'Check the source record and current physical state before marking this review as reviewed.',
  };
}

export type TransitionConflictReviewInput = {
  reviewId: string;
  actor: AuthenticatedUser;
  resolutionNotes?: string;
};

function transitionConflictReview(
  db: DbClient,
  input: TransitionConflictReviewInput,
  toStatus: 'resolved' | 'dismissed',
): void {
  requireSupervisor(input.actor);

  db.transaction((tx: DbClient) => {
    const review = tx
      .select()
      .from(conflictReviews)
      .where(and(eq(conflictReviews.id, input.reviewId), eq(conflictReviews.orgId, input.actor.orgId)))
      .get();
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
      .where(and(eq(conflictReviews.id, input.reviewId), eq(conflictReviews.orgId, input.actor.orgId)))
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

export function resolveConflictReview(db: DbClient, input: TransitionConflictReviewInput): void {
  transitionConflictReview(db, input, 'resolved');
}

export function dismissConflictReview(db: DbClient, input: TransitionConflictReviewInput): void {
  transitionConflictReview(db, input, 'dismissed');
}

export function retryConflictReview(
  db: DbClient,
  input: TransitionConflictReviewInput,
): MutationOutcome {
  requireSupervisor(input.actor);

  const review = db
    .select()
    .from(conflictReviews)
    .where(and(eq(conflictReviews.id, input.reviewId), eq(conflictReviews.orgId, input.actor.orgId)))
    .get() as { kind: ConflictReviewKind; status: ConflictReviewStatus; payloadJson: string } | undefined;
  if (!review) throw new BusinessError(`Conflict review ${input.reviewId} not found`);
  if (review.status !== 'open') throw new BusinessError(`Conflict review ${input.reviewId} is already '${review.status}'`);
  if (review.kind !== 'sync_conflict') throw new BusinessError('Only failed synced operations can be retried');

  const queued = object(parsePayload(review.payloadJson).queuedMutation);
  const endpoint = text(queued.endpoint);
  const payload = queued.payload;
  if (!endpoint || !payload || typeof payload !== 'object') {
    throw new BusinessError('This review does not contain a complete operation to retry');
  }

  const [outcome] = applySyncBatch(db, {
    orgId: input.actor.orgId,
    actor: input.actor,
    mutations: [{
      id: `${text(queued.id) || input.reviewId}:retry:${createId()}`,
      endpoint,
      payload,
      clientTs: Date.now(),
      seq: 1,
    }],
  });

  if (outcome.status === 'rejected') {
    throw new BusinessError(outcome.message);
  }

  const automaticNote = outcome.status === 'applied'
    ? 'The saved field operation was retried and applied successfully.'
    : `The retry still could not be applied: ${outcome.message}`;
  transitionConflictReview(db, {
    ...input,
    resolutionNotes: [input.resolutionNotes?.trim(), automaticNote].filter(Boolean).join(' '),
  }, 'resolved');
  return outcome;
}

function parsePayload(raw: string): Record<string, unknown> {
  try {
    const value = JSON.parse(raw);
    return value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : {};
  } catch {
    return {};
  }
}

function text(value: unknown): string {
  return typeof value === 'string' || typeof value === 'number' ? String(value).trim() : '';
}

function firstText(...values: unknown[]): string {
  return values.map(text).find(Boolean) ?? '';
}

function object(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : {};
}

function list(value: unknown): string {
  return Array.isArray(value) ? value.map(text).filter(Boolean).join(', ') : '';
}

function repairOperationList(value: unknown): string {
  if (!Array.isArray(value)) return '';
  return value
    .map((entry) => {
      const item = object(entry);
      const position = text(item.position);
      if (!position) return '';
      const label = position === 'mother' ? 'Mother lock' : `Sub-lock ${position}`;
      const replacement = text(item.replacementSerial);
      return replacement ? `${label}: replace with ${replacement}` : `${label}: remove only`;
    })
    .filter(Boolean)
    .join('; ');
}

function rowSubs(row: Record<string, unknown>): string[] {
  return ['sub_b', 'sub_c', 'sub_d'].map((key) => text(row[key])).filter(Boolean);
}

function joinRowSubs(row: Record<string, unknown>, prefix: string): string {
  return ['b', 'c', 'd'].map((slot) => text(row[`${prefix}${slot}`])).filter(Boolean).join(', ');
}

function compactDetails(rows: Array<[string, string]>): Array<{ label: string; value: string }> {
  return rows.filter(([, value]) => Boolean(value)).map(([label, value]) => ({ label, value }));
}

function sentence(value: string): string {
  const words = value.replaceAll('_', ' ').trim();
  return words ? words[0].toUpperCase() + words.slice(1) : '';
}

function valueText(value: unknown): string {
  if (Array.isArray(value)) return value.map(text).filter(Boolean).join(', ');
  if (value && typeof value === 'object') return JSON.stringify(value);
  return text(value);
}

function displayTruck(value: string): string {
  return value.startsWith('trk_') ? 'the affected truck' : value;
}
