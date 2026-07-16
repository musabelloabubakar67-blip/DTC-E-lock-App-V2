import { and, desc, eq, isNull } from 'drizzle-orm';
import {
  auditLog,
  conflictReviews,
  devices,
  registrationLogs,
  truckAssignments,
  trucks,
  users,
} from '../db/schema';
import { getTrustState } from './verification.service';
import { listRegistrations, type RegistrationListItem } from './registration.service';
import { listRepairPool, type RepairPoolItem } from './lookup.service';
import type { ConflictReviewListItem } from './review.service';

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type DbClient = any;

export type DashboardViewModel = {
  role: 'installer' | 'supervisor';
  health: {
    tone: 'ok' | 'warning' | 'danger';
    title: string;
    detail: string;
  };
  counts: {
    registeredKits: number;
    openReviews: number;
    pendingRepair: number;
    availableMothers: number;
    inServiceMothers: number;
    faultyDevices: number;
    retiredDevices: number;
    trucks: number;
  };
  trust: {
    verified: number;
    stale: number;
    unverified: number;
    total: number;
  };
  reviews: ConflictReviewListItem[];
  repairPool: RepairPoolItem[];
  registrations: RegistrationListItem[];
  audit: Array<{
    id: string;
    createdAt: number;
    actorName: string | null;
    operation: string;
    entityTable: string;
    summary: string;
  }>;
};

export function getDashboard(db: DbClient, input: { orgId: string; role: 'installer' | 'supervisor' }): DashboardViewModel {
  const allDevices = db.select().from(devices).where(eq(devices.orgId, input.orgId)).all() as Array<{
    id: string;
    deviceType: 'mother' | 'sub';
    lifecycleStatus: 'available' | 'in_service' | 'repair' | 'faulty' | 'retired';
    ownershipStatus: 'owned' | 'released_external';
  }>;
  const allTrucks = db
    .select({ id: trucks.id })
    .from(trucks)
    .innerJoin(truckAssignments, eq(truckAssignments.truckId, trucks.id))
    .where(and(eq(trucks.orgId, input.orgId), eq(trucks.isActive, 1), isNull(truckAssignments.removedAt)))
    .all() as Array<{ id: string }>;
  const reviews = listOpenReviewsForOrg(db, input.orgId);
  const repairPool = listRepairPool(db, input.orgId);
  const registrations = listRegistrations(db, input.orgId, 6);
  const trust = buildTrustSummary(db, allTrucks);
  const registeredKits = (
    db
      .select({ id: registrationLogs.id })
      .from(registrationLogs)
      .where(eq(registrationLogs.orgId, input.orgId))
      .all() as Array<{ id: string }>
  ).length;

  const counts = {
    registeredKits,
    openReviews: reviews.length,
    pendingRepair: repairPool.length,
    availableMothers: allDevices.filter((device) => device.deviceType === 'mother' && device.lifecycleStatus === 'available' && device.ownershipStatus === 'owned').length,
    inServiceMothers: allDevices.filter((device) => device.deviceType === 'mother' && device.lifecycleStatus === 'in_service').length,
    faultyDevices: allDevices.filter((device) => device.lifecycleStatus === 'faulty').length,
    retiredDevices: allDevices.filter((device) => device.lifecycleStatus === 'retired').length,
    trucks: allTrucks.length,
  };

  return {
    role: input.role,
    health: buildHealth({ reviews, repairPool, trust }),
    counts,
    trust,
    reviews: reviews.slice(0, 5),
    repairPool: repairPool.slice(0, 5),
    registrations,
    audit: listLatestAudit(db, input.orgId, 8),
  };
}

function buildTrustSummary(db: DbClient, activeTrucks: Array<{ id: string }>): DashboardViewModel['trust'] {
  const summary = { verified: 0, stale: 0, unverified: 0, total: activeTrucks.length };
  for (const truck of activeTrucks) {
    const trust = getTrustState(db, { truckId: truck.id });
    summary[trust.state] += 1;
  }
  return summary;
}

function buildHealth(input: {
  reviews: ConflictReviewListItem[];
  repairPool: RepairPoolItem[];
  trust: DashboardViewModel['trust'];
}): DashboardViewModel['health'] {
  const trustIssues = input.trust.stale + input.trust.unverified;
  if (input.reviews.length > 0) {
    return {
      tone: 'danger',
      title: `${input.reviews.length} open review${input.reviews.length === 1 ? '' : 's'}`,
      detail: 'Supervisor attention is needed before the registry can be treated as settled.',
    };
  }
  if (trustIssues > 0) {
    return {
      tone: 'warning',
      title: `${trustIssues} truck${trustIssues === 1 ? '' : 's'} need verification`,
      detail: 'Run lookup and kit verification before relying on those assignments.',
    };
  }
  if (input.repairPool.length > 0) {
    return {
      tone: 'warning',
      title: `${input.repairPool.length} device${input.repairPool.length === 1 ? '' : 's'} in repair`,
      detail: 'Triage the repair pool to return revived locks or mark dead hardware.',
    };
  }
  return {
    tone: 'ok',
    title: 'Operations clear',
    detail: 'No open reviews, no trust warnings, and no repair-pool devices are waiting.',
  };
}

function listOpenReviewsForOrg(db: DbClient, orgId: string): ConflictReviewListItem[] {
  const rows = db
    .select()
    .from(conflictReviews)
    .where(and(eq(conflictReviews.orgId, orgId), eq(conflictReviews.status, 'open')))
    .orderBy(desc(conflictReviews.createdAt))
    .all() as Array<{
    id: string;
    kind: ConflictReviewListItem['kind'];
    status: ConflictReviewListItem['status'];
    payloadJson: string;
    createdAt: number;
  }>;

  return rows.map((row) => ({
    id: row.id,
    kind: row.kind,
    status: row.status,
    payload: JSON.parse(row.payloadJson),
    createdAt: row.createdAt,
  }));
}

function listLatestAudit(db: DbClient, orgId: string, limit: number): DashboardViewModel['audit'] {
  const rows = (
    db
      .select()
      .from(auditLog)
      .where(eq(auditLog.orgId, orgId))
      .orderBy(desc(auditLog.createdAt))
      .all() as Array<{
      id: string;
      actorUserId: string;
      operation: string;
      entityTable: string;
      afterJson: string;
      createdAt: number;
    }>
  ).slice(0, limit);

  return rows.map((row) => {
    const actor = db.select({ displayName: users.displayName }).from(users).where(eq(users.id, row.actorUserId)).get() as
      | { displayName: string }
      | undefined;
    return {
      id: row.id,
      createdAt: row.createdAt,
      actorName: actor?.displayName ?? null,
      operation: row.operation,
      entityTable: row.entityTable,
      summary: buildAuditSummary(row),
    };
  });
}

function buildAuditSummary(row: { operation: string; entityTable: string; afterJson: string }): string {
  let after: Record<string, unknown> | null = null;
  try {
    after = JSON.parse(row.afterJson) as Record<string, unknown>;
  } catch {
    after = null;
  }

  const action = typeof after?.action === 'string' ? after.action : null;
  const result = typeof after?.result === 'string' ? after.result : null;
  const status = typeof after?.status === 'string' ? after.status : null;
  const motherSerial = typeof after?.motherSerial === 'string' ? after.motherSerial : null;

  if (motherSerial) return `${row.operation} kit ${motherSerial}`;
  if (action) return `${row.operation} ${action}`;
  if (result) return `${row.operation} ${result}`;
  if (status) return `${row.operation} ${status}`;
  return `${row.operation} ${row.entityTable}`;
}
