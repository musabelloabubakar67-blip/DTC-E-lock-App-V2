// The ONLY place devices.lifecycle_status changes (§2 device lifecycle, §6 Reason → disposition
// + Triage, §7 layer contract). No other service/route may set it directly.
//
// Every exported function here takes a `DbClient` (the caller's drizzle db or transaction handle)
// and does NOT open its own transaction — it composes into the caller's db.transaction() per the
// §7 transaction pattern: validate + compute before, all writes + audit inside, side effects after.
import { eq } from 'drizzle-orm';
import { createId } from '@paralleldrive/cuid2';
import { devices, auditLog } from '../db/schema';
import { BusinessError } from '../lib/errors';
import { requireSupervisor, type AuthenticatedUser } from './auth.service';

export type LifecycleStatus = 'available' | 'in_service' | 'repair' | 'faulty' | 'retired';

export type RemovalReason =
  | 'faulty'
  | 'damaged'
  | 'operational_swap'
  | 'decommissioned'
  | 'unlogged_swap_detected'
  | 'other';

export type Disposition = 'repair_pool' | 'available_pool' | 'retired';

// §6 "Reason → disposition (protects fault history)" — only these reasons carry a FORCED mapping.
// unlogged_swap_detected/other are not device-fault-or-pool events at this layer (handled by
// verification.service.ts / movement.service.ts respectively when those are built).
const FORCED_REASON_DISPOSITION: Partial<Record<RemovalReason, Disposition>> = {
  faulty: 'repair_pool',
  damaged: 'repair_pool',
  operational_swap: 'available_pool',
  decommissioned: 'retired',
};

const DISPOSITION_TO_STATUS: Record<Disposition, LifecycleStatus> = {
  repair_pool: 'repair',
  available_pool: 'available',
  retired: 'retired',
};

const TERMINAL_STATUSES: ReadonlySet<LifecycleStatus> = new Set(['faulty', 'retired']);

export function validateReasonDisposition(reason: RemovalReason, disposition: Disposition): void {
  const forced = FORCED_REASON_DISPOSITION[reason];
  if (forced && forced !== disposition) {
    throw new BusinessError(
      `Illegal reason→disposition mapping: '${reason}' must map to '${forced}', got '${disposition}'`,
    );
  }
}

function dispositionForReason(reason: RemovalReason, requestedDisposition?: Disposition): Disposition {
  const forced = FORCED_REASON_DISPOSITION[reason];
  if (forced) {
    if (requestedDisposition) validateReasonDisposition(reason, requestedDisposition);
    return forced;
  }
  if (!requestedDisposition) {
    throw new BusinessError(`Disposition is required for removal reason '${reason}'`);
  }
  return requestedDisposition;
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type DbClient = any; // drizzle db or transaction handle — identical query surface for our purposes.

function nowSeconds(): number {
  return Math.floor(Date.now() / 1000);
}

function writeAudit(
  tx: DbClient,
  params: { orgId: string; actorUserId: string; entityId: string; before: unknown; after: unknown },
): void {
  tx.insert(auditLog)
    .values({
      id: createId(),
      orgId: params.orgId,
      actorUserId: params.actorUserId,
      entityTable: 'devices',
      entityId: params.entityId,
      operation: 'transition',
      beforeJson: JSON.stringify(params.before),
      afterJson: JSON.stringify(params.after),
    })
    .run();
}

function loadDevice(tx: DbClient, deviceId: string) {
  const device = tx.select().from(devices).where(eq(devices.id, deviceId)).get();
  if (!device) throw new BusinessError(`Device ${deviceId} not found`);
  return device;
}

/**
 * Removal/unpairing transition: in_service → repair|available|retired.
 * Enforces §6's forced reason→disposition mapping; throws BusinessError on mismatch.
 * Composes into the caller's transaction (e.g. movement.service.ts closing a truck_assignment
 * or slot_pairing in the same transaction).
 */
export function applyRemoval(
  tx: DbClient,
  params: {
    deviceId: string;
    actorUserId: string;
    reason: RemovalReason;
    disposition?: Disposition;
  },
): { disposition: Disposition; status: LifecycleStatus } {
  const device = loadDevice(tx, params.deviceId);

  if (TERMINAL_STATUSES.has(device.lifecycleStatus as LifecycleStatus)) {
    throw new BusinessError(
      `Illegal transition: device ${params.deviceId} is terminal ('${device.lifecycleStatus}')`,
    );
  }

  const disposition = dispositionForReason(params.reason, params.disposition);
  const status = DISPOSITION_TO_STATUS[disposition];

  tx.update(devices)
    .set({ lifecycleStatus: status, updatedAt: nowSeconds() })
    .where(eq(devices.id, params.deviceId))
    .run();

  writeAudit(tx, {
    orgId: device.orgId,
    actorUserId: params.actorUserId,
    entityId: device.id,
    before: { lifecycleStatus: device.lifecycleStatus },
    after: { lifecycleStatus: status, reason: params.reason, disposition },
  });

  return { disposition, status };
}

/**
 * available → in_service, on install/pairing (§2 device lifecycle diagram).
 */
export function markInService(tx: DbClient, params: { deviceId: string; actorUserId: string }): void {
  const device = loadDevice(tx, params.deviceId);

  if (device.lifecycleStatus !== 'available') {
    throw new BusinessError(
      `Illegal transition: device ${params.deviceId} is '${device.lifecycleStatus}', must be 'available' to enter service`,
    );
  }

  tx.update(devices)
    .set({ lifecycleStatus: 'in_service', updatedAt: nowSeconds() })
    .where(eq(devices.id, params.deviceId))
    .run();

  writeAudit(tx, {
    orgId: device.orgId,
    actorUserId: params.actorUserId,
    entityId: device.id,
    before: { lifecycleStatus: device.lifecycleStatus },
    after: { lifecycleStatus: 'in_service' },
  });
}

/**
 * Triage — supervisor only (§6 Triage). repair → available (revived) | repair → faulty (dead, terminal).
 * Throws AuthzError if actor is not a supervisor (checked here, the source of truth — §4/§6).
 */
export function applyTriage(
  tx: DbClient,
  params: { deviceId: string; actor: AuthenticatedUser; outcome: 'revived' | 'dead' },
): LifecycleStatus {
  requireSupervisor(params.actor);

  const device = loadDevice(tx, params.deviceId);
  if (device.lifecycleStatus !== 'repair') {
    throw new BusinessError(
      `Triage requires status 'repair', device ${params.deviceId} is '${device.lifecycleStatus}'`,
    );
  }

  const status: LifecycleStatus = params.outcome === 'revived' ? 'available' : 'faulty';

  tx.update(devices)
    .set({ lifecycleStatus: status, updatedAt: nowSeconds() })
    .where(eq(devices.id, params.deviceId))
    .run();

  writeAudit(tx, {
    orgId: device.orgId,
    actorUserId: params.actor.id,
    entityId: device.id,
    before: { lifecycleStatus: device.lifecycleStatus },
    after: { lifecycleStatus: status, triageOutcome: params.outcome },
  });

  return status;
}
