// §3 Registry trust model. PASS TWO: mismatch → correct → conflict_review. Reality wins — a
// scan that disagrees with the registry corrects the registry immediately, atomically, and
// ALWAYS surfaces for supervisor review (never silently). §6's inline-registration exception
// applies ONLY here (an already-mounted, never-registered device discovered by scan) — it is
// still forbidden at install time (installation.service.ts).
import { eq, and, isNull, desc, inArray } from 'drizzle-orm';
import { createId } from '@paralleldrive/cuid2';
import {
  devices,
  trucks,
  truckAssignments,
  slotPairings,
  kitMembers,
  verifications,
  movementLogs,
  conflictReviews,
  auditLog,
} from '../db/schema';
import { BusinessError } from '../lib/errors';
import { VERIFY_DECAY_SCAN_DAYS, VERIFY_DECAY_PHOTO_DAYS } from '../constants';
import { applyRemoval, markInService } from './lifecycle.service';

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type DbClient = any; // drizzle db or transaction handle — identical query surface for our purposes.

export type TrustState = 'verified' | 'stale' | 'unverified';
export type VerificationSource = 'qr_scan' | 'photo_attestation' | 'manual';

export type TrustStateResult = {
  state: TrustState;
  latestVerifiedAt: number | null;
  weakestTier: VerificationSource | null;
};

function nowSeconds(): number {
  return Math.floor(Date.now() / 1000);
}

function decayDaysFor(tier: VerificationSource): number {
  // §3: qr_scan decays after VERIFY_DECAY_SCAN_DAYS; photo_attestation AND manual both decay
  // after VERIFY_DECAY_PHOTO_DAYS — same window, different sources, NOT the same constant name.
  return tier === 'qr_scan' ? VERIFY_DECAY_SCAN_DAYS : VERIFY_DECAY_PHOTO_DAYS;
}

/**
 * DERIVED — never a settable field (§3). Reads the latest verifications row for the given
 * mother (or the mother currently assigned to the given truck) and returns verified/stale/
 * unverified from that row's weakest_tier + decay constants. No rows ever (including every
 * migrated device, which imports with import_unverified and zero verification history) →
 * 'unverified'.
 */
export function getTrustState(
  db: DbClient,
  params: { motherDeviceId: string } | { truckId: string },
): TrustStateResult {
  let motherDeviceId: string;

  if ('motherDeviceId' in params) {
    motherDeviceId = params.motherDeviceId;
  } else {
    const openAssignment = db
      .select()
      .from(truckAssignments)
      .where(and(eq(truckAssignments.truckId, params.truckId), isNull(truckAssignments.removedAt)))
      .get();
    if (!openAssignment) {
      return { state: 'unverified', latestVerifiedAt: null, weakestTier: null };
    }
    motherDeviceId = openAssignment.deviceId;
  }

  const latest = db
    .select()
    .from(verifications)
    .where(eq(verifications.motherDeviceId, motherDeviceId))
    .orderBy(desc(verifications.verifiedAt))
    .get();

  return deriveTrustState(latest);
}

export function getTrustStatesForMothers(
  db: DbClient,
  motherDeviceIds: string[],
): Map<string, TrustStateResult> {
  const uniqueMotherIds = [...new Set(motherDeviceIds)];
  const results = new Map<string, TrustStateResult>();
  if (uniqueMotherIds.length === 0) return results;

  const rows = db
    .select()
    .from(verifications)
    .where(inArray(verifications.motherDeviceId, uniqueMotherIds))
    .orderBy(desc(verifications.verifiedAt))
    .all() as Array<{
    motherDeviceId: string;
    verifiedAt: number;
    weakestTier: VerificationSource;
  }>;

  const latestByMotherId = new Map<string, (typeof rows)[number]>();
  for (const row of rows) {
    if (!latestByMotherId.has(row.motherDeviceId)) latestByMotherId.set(row.motherDeviceId, row);
  }

  for (const motherDeviceId of uniqueMotherIds) {
    results.set(motherDeviceId, deriveTrustState(latestByMotherId.get(motherDeviceId)));
  }
  return results;
}

function deriveTrustState(
  latest: { verifiedAt: number; weakestTier: VerificationSource } | undefined,
): TrustStateResult {

  if (!latest) {
    return { state: 'unverified', latestVerifiedAt: null, weakestTier: null };
  }

  // Deliberately conservative boundary: age strictly LESS than the window is 'verified'; age
  // exactly AT the window (e.g. a qr_scan at precisely 90.0 days) is already 'stale'. This is a
  // security/audit tool (§1) — when the age lands exactly on the line, treat it as expired
  // rather than still-good.
  const ageDays = (nowSeconds() - latest.verifiedAt) / 86400;
  const state: TrustState = ageDays < decayDaysFor(latest.weakestTier) ? 'verified' : 'stale';

  return { state, latestVerifiedAt: latest.verifiedAt, weakestTier: latest.weakestTier };
}

function normalizeSerial(serial: string): string {
  return serial.trim().toUpperCase();
}

/**
 * The registry's current sub set for a mother (§6 "Kit match"): open slot_pairings if the kit
 * is installed, else the open (unslotted) kit_members set if it's registered-but-not-installed.
 */
function getRegistrySubSerials(db: DbClient, motherDeviceId: string): string[] {
  const pairedSubIds: { subDeviceId: string }[] = db
    .select({ subDeviceId: slotPairings.subDeviceId })
    .from(slotPairings)
    .where(and(eq(slotPairings.motherDeviceId, motherDeviceId), isNull(slotPairings.unpairedAt)))
    .all();

  const subIds =
    pairedSubIds.length > 0
      ? pairedSubIds.map((r) => r.subDeviceId)
      : (
          db
            .select({ subDeviceId: kitMembers.subDeviceId })
            .from(kitMembers)
            .where(and(eq(kitMembers.motherDeviceId, motherDeviceId), isNull(kitMembers.removedAt)))
            .all() as { subDeviceId: string }[]
        ).map((r) => r.subDeviceId);

  return subIds.map((id) => {
    const device = db.select({ serial: devices.serial }).from(devices).where(eq(devices.id, id)).get();
    return device.serial as string;
  });
}

export type VerificationTier = 'qr_scan' | 'manual'; // on-site kit scan tiers; photo_attestation is the separate remote flow

export type RecordKitVerificationInput = {
  orgId: string;
  actorUserId: string; // verified_by — from session
  truckId?: string;
  motherSerial: string;
  motherSource: VerificationTier;
  subs: { serial: string; source: VerificationTier }[]; // set-membership, per §3 — order doesn't matter
};

export type RecordKitVerificationResult =
  | { matched: true; verificationId: string; weakestTier: VerificationTier }
  | {
      matched: false; // ALWAYS corrected in pass two — never a silent "reported but ignored" state.
      verificationId: string;
      conflictReviewId: string;
      weakestTier: VerificationTier;
      expectedSubSerials: string[];
      observedSubSerials: string[];
    };

function writeAudit(
  tx: DbClient,
  params: { orgId: string; actorUserId: string; entityTable: string; entityId: string; operation: 'create' | 'transition'; before?: unknown; after: unknown },
): void {
  tx.insert(auditLog)
    .values({
      id: createId(),
      orgId: params.orgId,
      actorUserId: params.actorUserId,
      entityTable: params.entityTable,
      entityId: params.entityId,
      operation: params.operation,
      beforeJson: params.before !== undefined ? JSON.stringify(params.before) : null,
      afterJson: JSON.stringify(params.after),
    })
    .run();
}

/**
 * §6: the ONE place inline registration is permitted outside the registration flow itself —
 * an already-mounted, never-registered device discovered by a verification scan. Distinct
 * from install-time inline registration, which stays forbidden (installation.service.ts).
 * Creates only the bare devices row — no registration_logs (no IP/APN/BT/sim data exists from
 * a scan event) and no kit_members (this isn't a birth-registration event; the device is
 * immediately paired by the correction that follows).
 */
function ensureDeviceRegisteredInline(
  tx: DbClient,
  params: { orgId: string; actorUserId: string; serial: string; deviceType: 'mother' | 'sub' },
): { id: string; lifecycleStatus: string } {
  const existing = tx.select().from(devices).where(eq(devices.serial, params.serial)).get();
  if (existing) return existing;

  const id = createId();
  const now = nowSeconds();
  tx.insert(devices)
    .values({
      id,
      orgId: params.orgId,
      deviceType: params.deviceType,
      serial: params.serial,
      lifecycleStatus: 'available',
      registeredAt: now,
      registeredBy: params.actorUserId,
      origin: 'discovered',
    })
    .run();

  writeAudit(tx, {
    orgId: params.orgId,
    actorUserId: params.actorUserId,
    entityTable: 'devices',
    entityId: id,
    operation: 'create',
    after: { serial: params.serial, deviceType: params.deviceType, via: 'verification_mismatch_inline_registration' },
  });

  return { id, lifecycleStatus: 'available' };
}

/**
 * Describes where a device currently is, for a naming-the-conflict error message — not a
 * generic "already in service somewhere" failure. Mother: its open truck_assignment. Sub: the
 * mother/slot it's currently paired into, then that mother's truck.
 */
function describeDeviceLocation(tx: DbClient, deviceId: string, deviceType: 'mother' | 'sub'): string {
  if (deviceType === 'mother') {
    const assignment = tx
      .select()
      .from(truckAssignments)
      .where(and(eq(truckAssignments.deviceId, deviceId), isNull(truckAssignments.removedAt)))
      .get();
    if (!assignment) return 'an unknown location';
    const truck = tx.select({ plate: trucks.plate }).from(trucks).where(eq(trucks.id, assignment.truckId)).get();
    return truck ? `truck ${truck.plate} (${assignment.truckId})` : `truck ${assignment.truckId}`;
  }

  const pairing = tx
    .select()
    .from(slotPairings)
    .where(and(eq(slotPairings.subDeviceId, deviceId), isNull(slotPairings.unpairedAt)))
    .get();
  if (!pairing) return 'an unknown location';
  const assignment = tx
    .select()
    .from(truckAssignments)
    .where(and(eq(truckAssignments.deviceId, pairing.motherDeviceId), isNull(truckAssignments.removedAt)))
    .get();
  if (!assignment) return `mother ${pairing.motherDeviceId}, slot ${pairing.slot} (no truck currently assigned)`;
  const truck = tx.select({ plate: trucks.plate }).from(trucks).where(eq(trucks.id, assignment.truckId)).get();
  return truck
    ? `truck ${truck.plate} (${assignment.truckId}), slot ${pairing.slot}`
    : `truck ${assignment.truckId}, slot ${pairing.slot}`;
}

function pairDeviceIntoSlot(
  tx: DbClient,
  device: { id: string; lifecycleStatus: string },
  deviceType: 'mother' | 'sub',
  actorUserId: string,
): void {
  if (device.lifecycleStatus === 'available') {
    markInService(tx, { deviceId: device.id, actorUserId });
    return;
  }

  // Reached only for devices needing a NEW placement — callers filter out subs/mothers that
  // are already correctly seated before calling this. So 'in_service' here always means
  // "in service SOMEWHERE ELSE", never an idempotent same-slot re-verification. Name the
  // conflict so the operator has a path forward (resolve via truck_swap), rather than a
  // generic failure — and rather than silently taking over an active assignment, which would
  // otherwise surface only as a cryptic UNIQUE constraint failure at the DB layer.
  if (device.lifecycleStatus === 'in_service') {
    const location = describeDeviceLocation(tx, device.id, deviceType);
    throw new BusinessError(
      `Cannot pair device ${device.id} here: it is already in_service at ${location}. Resolve that conflict via truck_swap before correcting this kit.`,
    );
  }

  // repair/faulty/retired — cannot be paired at all.
  throw new BusinessError(`Cannot pair device ${device.id}: status is '${device.lifecycleStatus}'`);
}

const SLOTS = ['B', 'C', 'D'] as const;

function sameSerialSet(left: string[], right: string[]): boolean {
  const a = left.map(normalizeSerial).filter(Boolean).sort();
  const b = right.map(normalizeSerial).filter(Boolean).sort();
  return a.length === b.length && a.every((value, index) => value === b[index]);
}

function resolveTruckIdentifier(db: DbClient, orgId: string, truckIdOrPlate?: string): { id: string; plate: string } | null {
  const raw = truckIdOrPlate?.trim();
  if (!raw) return null;
  const byId = db
    .select({ id: trucks.id, plate: trucks.plate })
    .from(trucks)
    .where(and(eq(trucks.orgId, orgId), eq(trucks.id, raw)))
    .get();
  if (byId) return byId;
  const byPlate = db
    .select({ id: trucks.id, plate: trucks.plate })
    .from(trucks)
    .where(and(eq(trucks.orgId, orgId), eq(trucks.plate, normalizeSerial(raw))))
    .get();
  return byPlate ?? null;
}

function closeMatchingImportKitMismatchReview(
  tx: DbClient,
  params: {
    orgId: string;
    actorUserId: string;
    truckId?: string;
    motherSerial: string;
    observedSubSerials: string[];
  },
): void {
  const truck = resolveTruckIdentifier(tx, params.orgId, params.truckId);
  if (!truck) return;

  const openReviews = tx
    .select()
    .from(conflictReviews)
    .where(and(eq(conflictReviews.orgId, params.orgId), eq(conflictReviews.kind, 'import_conflict'), eq(conflictReviews.status, 'open')))
    .all() as Array<{ id: string; status: string; payloadJson: string }>;

  for (const review of openReviews) {
    let payload: { reason?: string; row?: Record<string, unknown> };
    try {
      payload = JSON.parse(review.payloadJson);
    } catch {
      continue;
    }

    if (payload.reason !== 'kit_mismatch_updated_registry') continue;
    const row = payload.row ?? {};
    const reviewTruck = typeof row.truck === 'string' ? normalizeSerial(row.truck) : '';
    const reviewMother = typeof row.mother === 'string' ? normalizeSerial(row.mother) : '';
    if (reviewTruck !== normalizeSerial(truck.plate) || reviewMother !== normalizeSerial(params.motherSerial)) continue;

    const installSubs = ['install_sub_b', 'install_sub_c', 'install_sub_d'].map((key) => (typeof row[key] === 'string' ? row[key] as string : ''));
    const registrySubs = ['registry_sub_b', 'registry_sub_c', 'registry_sub_d'].map((key) => (typeof row[key] === 'string' ? row[key] as string : ''));
    const matchedInstall = sameSerialSet(params.observedSubSerials, installSubs);
    const matchedRegistry = sameSerialSet(params.observedSubSerials, registrySubs);
    if (!matchedInstall && !matchedRegistry) continue;

    const now = nowSeconds();
    const resolutionNotes = matchedInstall
      ? 'Resolved by kit verification: physical kit matched installation sheet, and active pairing was verified/corrected.'
      : 'Resolved by kit verification: physical kit matched Updated Registry; installation-sheet mismatch was reviewed.';

    tx.update(conflictReviews)
      .set({
        status: 'resolved',
        resolvedBy: params.actorUserId,
        resolvedAt: now,
        resolutionNotes,
      })
      .where(eq(conflictReviews.id, review.id))
      .run();

    writeAudit(tx, {
      orgId: params.orgId,
      actorUserId: params.actorUserId,
      entityTable: 'conflict_reviews',
      entityId: review.id,
      operation: 'transition',
      before: { status: review.status },
      after: {
        status: 'resolved',
        via: 'kit_verification',
        truck: truck.plate,
        mother: params.motherSerial,
        observedSubSerials: params.observedSubSerials,
        matched: matchedInstall ? 'installation_sheet' : 'updated_registry',
      },
    });
  }
}

/**
 * Reconciles a mother's sub kit to match what was physically observed. Closes only the slot
 * pairings that are WRONG (their current sub isn't in the observed set); pairings whose sub IS
 * in the observed set are left completely untouched. Every close/open uses
 * removal_reason='unlogged_swap_detected' via lifecycle.service — never a fault (§2, §6).
 * Writes one movement_log + audit_log row per slot actually changed.
 */
function reconcileSubPairings(
  tx: DbClient,
  params: {
    orgId: string;
    actorUserId: string;
    truckId?: string;
    motherDeviceId: string;
    observedSubs: { serial: string; source: VerificationTier }[];
  },
): void {
  const now = nowSeconds();

  const currentPairings: {
    id: string;
    slot: 'B' | 'C' | 'D';
    subDeviceId: string;
  }[] = tx
    .select()
    .from(slotPairings)
    .where(and(eq(slotPairings.motherDeviceId, params.motherDeviceId), isNull(slotPairings.unpairedAt)))
    .all();

  const currentSerialByDeviceId = new Map<string, string>();
  for (const pairing of currentPairings) {
    const device = tx.select({ serial: devices.serial }).from(devices).where(eq(devices.id, pairing.subDeviceId)).get();
    currentSerialByDeviceId.set(pairing.subDeviceId, device.serial);
  }

  const observedSerials = params.observedSubs.map((s) => normalizeSerial(s.serial));
  const observedSourceBySerial = new Map(params.observedSubs.map((s) => [normalizeSerial(s.serial), s.source]));
  const observedSet = new Set(observedSerials);

  const currentBySlot = new Map(currentPairings.map((p) => [p.slot, p]));

  // Slots whose CURRENT occupant is already correctly observed — leave entirely untouched.
  const keptSerials = new Set<string>();
  for (const pairing of currentPairings) {
    const serial = currentSerialByDeviceId.get(pairing.subDeviceId)!;
    if (observedSet.has(serial)) keptSerials.add(serial);
  }

  const slotsNeedingCorrection = SLOTS.filter((slot) => {
    const pairing = currentBySlot.get(slot);
    if (!pairing) return true; // no current occupant — vacant, may need filling
    const serial = currentSerialByDeviceId.get(pairing.subDeviceId)!;
    return !observedSet.has(serial); // wrong occupant
  });

  // Newly-observed subs not already correctly seated somewhere else.
  const newSubsToPlace = observedSerials.filter((s) => !keptSerials.has(s));

  for (const slot of slotsNeedingCorrection) {
    const pairing = currentBySlot.get(slot);
    if (pairing) {
      const { disposition } = applyRemoval(tx, {
        deviceId: pairing.subDeviceId,
        actorUserId: params.actorUserId,
        reason: 'unlogged_swap_detected',
        disposition: 'available_pool', // reality-unknown whereabouts pending its own future verification
      });

      tx.update(slotPairings)
        .set({
          unpairedAt: now,
          unpairedBy: params.actorUserId,
          removalReason: 'unlogged_swap_detected',
          disposition,
        })
        .where(eq(slotPairings.id, pairing.id))
        .run();

      const movementLogId = createId();
      tx.insert(movementLogs)
        .values({
          id: movementLogId,
          orgId: params.orgId,
          actorUserId: params.actorUserId,
          loggedDate: now,
          action: 'unlogged_swap_detected',
          truckId: params.truckId ?? null,
          outDeviceId: pairing.subDeviceId,
          // NOTE: movement_logs.out_reason's CHECK constraint does NOT include
          // 'unlogged_swap_detected' — leave it unset; `action` alone carries the meaning.
          outDisposition: disposition,
          slot,
        })
        .run();

      writeAudit(tx, {
        orgId: params.orgId,
        actorUserId: params.actorUserId,
        entityTable: 'movement_logs',
        entityId: movementLogId,
        operation: 'create',
        after: { action: 'unlogged_swap_detected', slot, outDeviceId: pairing.subDeviceId },
      });
    }
  }

  slotsNeedingCorrection.forEach((slot, i) => {
    const serial = newSubsToPlace[i];
    if (!serial) return; // fewer observed subs than vacated slots — partial scan, leave vacant

    const source = observedSourceBySerial.get(serial)!;
    void source; // per-device tier isn't separately persisted (only the kit's weakest_tier is)

    const device = ensureDeviceRegisteredInline(tx, {
      orgId: params.orgId,
      actorUserId: params.actorUserId,
      serial,
      deviceType: 'sub',
    });
    pairDeviceIntoSlot(tx, device, 'sub', params.actorUserId);

    const pairingId = createId();
    tx.insert(slotPairings)
      .values({
        id: pairingId,
        orgId: params.orgId,
        motherDeviceId: params.motherDeviceId,
        slot,
        subDeviceId: device.id,
        pairedAt: now,
        pairedBy: params.actorUserId,
      })
      .run();

    const movementLogId = createId();
    tx.insert(movementLogs)
      .values({
        id: movementLogId,
        orgId: params.orgId,
        actorUserId: params.actorUserId,
        loggedDate: now,
        action: 'unlogged_swap_detected',
        truckId: params.truckId ?? null,
        inDeviceId: device.id,
        slot,
      })
      .run();

    writeAudit(tx, {
      orgId: params.orgId,
      actorUserId: params.actorUserId,
      entityTable: 'movement_logs',
      entityId: movementLogId,
      operation: 'create',
      after: { action: 'unlogged_swap_detected', slot, inDeviceId: device.id },
    });
  });
}

/**
 * The mismatch → correct → conflict_review flow (§3, §6). ONE transaction: optionally swaps
 * the mother assignment (if the scanned mother differs from the truck's recorded one),
 * reconciles the sub kit to observed reality, appends the verifications row
 * (result='mismatch_corrected'), and opens exactly one conflict_review. Never a fault — every
 * removal here uses reason='unlogged_swap_detected'.
 */
function correctKitMismatch(
  db: DbClient,
  input: RecordKitVerificationInput,
  ctx: {
    observedMotherSerial: string;
    existingMotherDevice: { id: string; serial: string; lifecycleStatus: string } | null;
    expectedMotherDeviceId: string | null;
    truckOpenAssignment: { id: string; truckId: string; deviceId: string } | null;
  },
): RecordKitVerificationResult {
  const now = nowSeconds();

  return db.transaction((tx: DbClient) => {
    let finalMotherDevice: { id: string; lifecycleStatus: string };
    let expectedMotherSerial: string | null = null;
    // expected_subs_json ALWAYS means "what the registry claimed for THIS truck/mother before
    // the correction" — on a mother-swap that's the OUTGOING mother's prior kit (what was
    // wrongly recorded as being on this truck), never the incoming mother's own unrelated
    // history. Captured BEFORE any writes in this transaction, from whichever mother was
    // on-record before correction.
    let priorMotherIdForExpectedSubs: string;

    const motherIsWrong =
      Boolean(ctx.truckOpenAssignment) &&
      (!ctx.existingMotherDevice || ctx.existingMotherDevice.id !== ctx.expectedMotherDeviceId);

    if (motherIsWrong) {
      const oldAssignment = ctx.truckOpenAssignment!;
      const oldMotherDevice = tx.select().from(devices).where(eq(devices.id, oldAssignment.deviceId)).get();
      expectedMotherSerial = oldMotherDevice.serial;
      priorMotherIdForExpectedSubs = oldAssignment.deviceId;

      finalMotherDevice = ctx.existingMotherDevice
        ? ctx.existingMotherDevice
        : ensureDeviceRegisteredInline(tx, {
            orgId: input.orgId,
            actorUserId: input.actorUserId,
            serial: ctx.observedMotherSerial,
            deviceType: 'mother',
          });

      // Close the WRONG assignment — reality shows a different mother is actually here.
      const { disposition } = applyRemoval(tx, {
        deviceId: oldAssignment.deviceId,
        actorUserId: input.actorUserId,
        reason: 'unlogged_swap_detected',
        disposition: 'available_pool',
      });
      tx.update(truckAssignments)
        .set({
          removedAt: now,
          removedBy: input.actorUserId,
          removalReason: 'unlogged_swap_detected',
          disposition,
        })
        .where(eq(truckAssignments.id, oldAssignment.id))
        .run();

      // Open the CORRECT assignment for the observed mother. Conservative: refuse to silently
      // take over a device that's legitimately in_service elsewhere — that's a materially
      // different, riskier operation than correcting registry drift on THIS truck.
      pairDeviceIntoSlot(tx, finalMotherDevice, 'mother', input.actorUserId);
      const newAssignmentId = createId();
      tx.insert(truckAssignments)
        .values({
          id: newAssignmentId,
          orgId: input.orgId,
          truckId: oldAssignment.truckId,
          deviceId: finalMotherDevice.id,
          assignedAt: now,
          assignedBy: input.actorUserId,
        })
        .run();

      const movementLogId = createId();
      tx.insert(movementLogs)
        .values({
          id: movementLogId,
          orgId: input.orgId,
          actorUserId: input.actorUserId,
          loggedDate: now,
          action: 'unlogged_swap_detected',
          truckId: oldAssignment.truckId,
          outDeviceId: oldAssignment.deviceId,
          outDisposition: disposition,
          inDeviceId: finalMotherDevice.id,
        })
        .run();

      writeAudit(tx, {
        orgId: input.orgId,
        actorUserId: input.actorUserId,
        entityTable: 'movement_logs',
        entityId: movementLogId,
        operation: 'create',
        after: {
          action: 'unlogged_swap_detected',
          truckId: oldAssignment.truckId,
          outDeviceId: oldAssignment.deviceId,
          inDeviceId: finalMotherDevice.id,
        },
      });
    } else {
      // Mother is correct (or no truck context) — only the sub kit can be wrong.
      finalMotherDevice =
        ctx.existingMotherDevice ??
        ensureDeviceRegisteredInline(tx, {
          orgId: input.orgId,
          actorUserId: input.actorUserId,
          serial: ctx.observedMotherSerial,
          deviceType: 'mother',
        });
      priorMotherIdForExpectedSubs = finalMotherDevice.id;
    }

    const expectedSubSerials = getRegistrySubSerials(tx, priorMotherIdForExpectedSubs);

    reconcileSubPairings(tx, {
      orgId: input.orgId,
      actorUserId: input.actorUserId,
      truckId: input.truckId,
      motherDeviceId: finalMotherDevice.id,
      observedSubs: input.subs,
    });

    const observedSubSerials = input.subs.map((s) => normalizeSerial(s.serial));
    const tiers: VerificationTier[] = [input.motherSource, ...input.subs.map((s) => s.source)];
    const weakestTier: VerificationTier = tiers.includes('manual') ? 'manual' : 'qr_scan';

    const verificationId = createId();
    tx.insert(verifications)
      .values({
        id: verificationId,
        orgId: input.orgId,
        truckId: input.truckId ?? null,
        motherDeviceId: finalMotherDevice.id,
        source: weakestTier,
        result: 'mismatch_corrected',
        observedMaster: ctx.observedMotherSerial,
        observedSubsJson: JSON.stringify(observedSubSerials),
        expectedSubsJson: JSON.stringify(expectedSubSerials),
        weakestTier,
        verifiedBy: input.actorUserId,
        verifiedAt: now,
      })
      .run();

    writeAudit(tx, {
      orgId: input.orgId,
      actorUserId: input.actorUserId,
      entityTable: 'verifications',
      entityId: verificationId,
      operation: 'create',
      after: {
        result: 'mismatch_corrected',
        motherDeviceId: finalMotherDevice.id,
        expectedMotherSerial,
        observedMotherSerial: ctx.observedMotherSerial,
        expectedSubSerials,
        observedSubSerials,
        weakestTier,
      },
    });

    closeMatchingImportKitMismatchReview(tx, {
      orgId: input.orgId,
      actorUserId: input.actorUserId,
      truckId: input.truckId,
      motherSerial: ctx.observedMotherSerial,
      observedSubSerials,
    });

    // Reality wins and the correction applies immediately, but it is NEVER silent — always
    // surfaces for supervisor review, with no asserted cause (§3, matching the import_conflict
    // convention in §4/§8: preserve both versions, let a human decide what happened).
    const conflictReviewId = createId();
    const truckForPayload = resolveTruckIdentifier(tx, input.orgId, input.truckId);
    tx.insert(conflictReviews)
      .values({
        id: conflictReviewId,
        orgId: input.orgId,
        kind: 'unlogged_swap',
        payloadJson: JSON.stringify({
          truckId: input.truckId ?? null,
          truckLabel: truckForPayload?.plate ?? null,
          expectedMotherSerial,
          observedMotherSerial: ctx.observedMotherSerial,
          expectedSubSerials,
          observedSubSerials,
        }),
        status: 'open',
      })
      .run();

    writeAudit(tx, {
      orgId: input.orgId,
      actorUserId: input.actorUserId,
      entityTable: 'conflict_reviews',
      entityId: conflictReviewId,
      operation: 'create',
      after: { kind: 'unlogged_swap', verificationId },
    });

    return {
      matched: false,
      verificationId,
      conflictReviewId,
      weakestTier,
      expectedSubSerials,
      observedSubSerials,
    } as const;
  });
}

/**
 * Kit verification (§3, §6). MATCH → appends a verifications row (result='match') and audit,
 * no other writes. MISMATCH → full correction (§ correctKitMismatch): reality wins, applied
 * atomically, always surfaced via exactly one conflict_review. Never returns a "detected but
 * ignored" result — pass one's placeholder behavior is gone.
 */
export function recordKitVerification(
  db: DbClient,
  input: RecordKitVerificationInput,
): RecordKitVerificationResult {
  const truck = resolveTruckIdentifier(db, input.orgId, input.truckId);
  const normalizedInput = truck ? { ...input, truckId: truck.id } : input;
  const motherSerial = normalizeSerial(input.motherSerial);

  const existingMotherDevice = db
    .select()
    .from(devices)
    .where(and(eq(devices.serial, motherSerial), eq(devices.deviceType, 'mother')))
    .get();

  let expectedMotherDeviceId: string | null = null;
  let truckOpenAssignment: { id: string; truckId: string; deviceId: string } | null = null;

  if (normalizedInput.truckId) {
    truckOpenAssignment =
      db
        .select()
        .from(truckAssignments)
        .where(and(eq(truckAssignments.truckId, normalizedInput.truckId), isNull(truckAssignments.removedAt)))
        .get() ?? null;
    expectedMotherDeviceId = truckOpenAssignment?.deviceId ?? null;
  }

  const motherMismatch =
    Boolean(truckOpenAssignment) &&
    (!existingMotherDevice || existingMotherDevice.id !== expectedMotherDeviceId);

  if (motherMismatch) {
    return correctKitMismatch(db, normalizedInput, {
      observedMotherSerial: motherSerial,
      existingMotherDevice: existingMotherDevice ?? null,
      expectedMotherDeviceId,
      truckOpenAssignment,
    });
  }

  const motherDeviceIdForCheck = expectedMotherDeviceId ?? existingMotherDevice?.id;
  if (!motherDeviceIdForCheck) {
    throw new BusinessError(`Mother device with serial ${motherSerial} not found`);
  }

  const expectedSubSerials = getRegistrySubSerials(db, motherDeviceIdForCheck);
  const observedSubSerials = input.subs.map((s) => normalizeSerial(s.serial));

  const expectedSet = new Set(expectedSubSerials);
  const observedSet = new Set(observedSubSerials);
  const subsMatch =
    expectedSet.size === observedSet.size && [...expectedSet].every((s) => observedSet.has(s));

  if (!subsMatch) {
    return correctKitMismatch(db, normalizedInput, {
      observedMotherSerial: motherSerial,
      existingMotherDevice: existingMotherDevice ?? null,
      expectedMotherDeviceId,
      truckOpenAssignment,
    });
  }

  const tiers: VerificationTier[] = [input.motherSource, ...input.subs.map((s) => s.source)];
  const weakestTier: VerificationTier = tiers.includes('manual') ? 'manual' : 'qr_scan';
  const now = nowSeconds();

  return db.transaction((tx: DbClient) => {
    const id = createId();
    tx.insert(verifications)
      .values({
        id,
        orgId: input.orgId,
        truckId: normalizedInput.truckId ?? null,
        motherDeviceId: motherDeviceIdForCheck,
        source: weakestTier,
        result: 'match',
        observedMaster: motherSerial,
        observedSubsJson: JSON.stringify(observedSubSerials),
        weakestTier,
        verifiedBy: input.actorUserId,
        verifiedAt: now,
      })
      .run();

    writeAudit(tx, {
      orgId: input.orgId,
      actorUserId: input.actorUserId,
      entityTable: 'verifications',
      entityId: id,
      operation: 'create',
      after: { motherDeviceId: motherDeviceIdForCheck, result: 'match', weakestTier },
    });

    closeMatchingImportKitMismatchReview(tx, {
      orgId: input.orgId,
      actorUserId: input.actorUserId,
      truckId: normalizedInput.truckId,
      motherSerial,
      observedSubSerials,
    });

    return { matched: true, verificationId: id, weakestTier } as const;
  });
}
