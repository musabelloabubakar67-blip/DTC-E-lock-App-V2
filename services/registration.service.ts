// §6 "Registration creates unassigned, unslotted kits" + §9 Registration UX.
// Registration is device-to-device, write-once per device, no truck involved.
// No next/server import here — services are framework-agnostic (§7 layer contract).
import { and, desc, eq, isNull } from 'drizzle-orm';
import { createId } from '@paralleldrive/cuid2';
import { devices, kitMembers, registrationLogs, auditLog, users } from '../db/schema';
import { BusinessError } from '../lib/errors';
import { requireSupervisor, type AuthenticatedUser } from './auth.service';

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type DbClient = any; // drizzle db or transaction handle — identical query surface for our purposes.

export type YesNo = 'yes' | 'no';

export type RegisterKitInput = {
  orgId: string;
  actorUserId: string;
  motherSerial: string;
  subSerials: [string, string, string]; // §9: mother + 3 subs are the mandatory fields
  simNumber: string;
  ipConfigured?: YesNo;
  apnConfigured?: YesNo;
  apnAuthSet?: YesNo;
  btWriteDone?: YesNo;
  loggedDate?: number;
};

export type RegisterKitResult = {
  motherDeviceId: string;
  subDeviceIds: string[];
  registrationLogId: string;
};

export type RegistrationListItem = {
  id: string;
  loggedDate: number;
  motherSerial: string;
  subSerials: string[];
  simNumber: string | null;
  source: 'app' | 'import';
  actorName: string | null;
  ownershipStatus: 'owned' | 'released_external' | 'mixed';
  ownershipNotes: string | null;
};

function normalizeSerial(serial: string): string {
  return serial.trim().toUpperCase();
}

function assertNotRegistered(db: DbClient, serial: string): void {
  const existing = db.select().from(devices).where(eq(devices.serial, serial)).get();
  if (existing) {
    throw new BusinessError('Serial already registered');
  }
}

/**
 * One transaction: upsert mother + sub devices (born 'available'), open UNSLOTTED kit_members,
 * write registration_logs + audit. No truck. Write-once per device — a serial already present
 * in `devices` (mother OR any sub) throws BusinessError('Serial already registered').
 *
 * Validates + computes BEFORE opening the transaction, per the §7 transaction pattern.
 */
export function registerKit(db: DbClient, input: RegisterKitInput): RegisterKitResult {
  const motherSerial = normalizeSerial(input.motherSerial);
  const subSerials = input.subSerials.map(normalizeSerial) as [string, string, string];

  if (new Set([motherSerial, ...subSerials]).size !== 4) {
    throw new BusinessError('Mother and sub serials must all be distinct');
  }

  assertNotRegistered(db, motherSerial);
  for (const serial of subSerials) assertNotRegistered(db, serial);

  const now = Math.floor(Date.now() / 1000);
  const loggedDate = input.loggedDate ?? now;

  return db.transaction((tx: DbClient) => {
    const motherDeviceId = createId();
    tx.insert(devices)
      .values({
        id: motherDeviceId,
        orgId: input.orgId,
        deviceType: 'mother',
        serial: motherSerial,
        simNumber: input.simNumber,
        lifecycleStatus: 'available',
        registeredAt: now,
        registeredBy: input.actorUserId,
      })
      .run();

    const subDeviceIds: string[] = [];
    for (const subSerial of subSerials) {
      const subDeviceId = createId();
      tx.insert(devices)
        .values({
          id: subDeviceId,
          orgId: input.orgId,
          deviceType: 'sub',
          serial: subSerial,
          lifecycleStatus: 'available',
          registeredAt: now,
          registeredBy: input.actorUserId,
        })
        .run();

      // UNSLOTTED — no B/C/D yet (§2, §6). Slots are assigned only at install.
      tx.insert(kitMembers)
        .values({
          id: createId(),
          orgId: input.orgId,
          motherDeviceId,
          subDeviceId,
          addedAt: now,
        })
        .run();

      subDeviceIds.push(subDeviceId);
    }

    const registrationLogId = createId();
    tx.insert(registrationLogs)
      .values({
        id: registrationLogId,
        orgId: input.orgId,
        motherDeviceId,
        actorUserId: input.actorUserId,
        loggedDate,
        ipConfigured: input.ipConfigured,
        apnConfigured: input.apnConfigured,
        apnAuthSet: input.apnAuthSet,
        btWriteDone: input.btWriteDone,
        simNumber: input.simNumber,
        source: 'app',
      })
      .run();

    tx.insert(auditLog)
      .values({
        id: createId(),
        orgId: input.orgId,
        actorUserId: input.actorUserId,
        entityTable: 'registration_logs',
        entityId: registrationLogId,
        operation: 'create',
        afterJson: JSON.stringify({ motherDeviceId, subDeviceIds, motherSerial, subSerials }),
      })
      .run();

    return { motherDeviceId, subDeviceIds, registrationLogId };
  });
}

export function listRegistrations(db: DbClient, orgId: string, limit?: number): RegistrationListItem[] {
  const rows = (
    db
      .select()
      .from(registrationLogs)
      .where(eq(registrationLogs.orgId, orgId))
      .orderBy(desc(registrationLogs.loggedDate))
      .all() as Array<{
      id: string;
      motherDeviceId: string;
      actorUserId: string;
      loggedDate: number;
      simNumber: string | null;
      source: 'app' | 'import';
    }>
  );
  const visibleRows = typeof limit === 'number' ? rows.slice(0, limit) : rows;

  const deviceRows = db
    .select({ id: devices.id, serial: devices.serial, ownershipStatus: devices.ownershipStatus, ownershipNotes: devices.ownershipNotes })
    .from(devices)
    .where(eq(devices.orgId, orgId))
    .all() as Array<{ id: string; serial: string; ownershipStatus: 'owned' | 'released_external'; ownershipNotes: string | null }>;
  const serialByDeviceId = new Map(deviceRows.map((device) => [device.id, device.serial]));
  const ownershipByDeviceId = new Map(deviceRows.map((device) => [device.id, device.ownershipStatus]));
  const ownershipNotesByDeviceId = new Map(deviceRows.map((device) => [device.id, device.ownershipNotes]));

  const memberRows = db
    .select({ motherDeviceId: kitMembers.motherDeviceId, subDeviceId: kitMembers.subDeviceId })
    .from(kitMembers)
    .where(and(eq(kitMembers.orgId, orgId), isNull(kitMembers.removedAt)))
    .all() as Array<{ motherDeviceId: string; subDeviceId: string }>;
  const subIdsByMotherId = new Map<string, string[]>();
  for (const member of memberRows) {
    const current = subIdsByMotherId.get(member.motherDeviceId) ?? [];
    current.push(member.subDeviceId);
    subIdsByMotherId.set(member.motherDeviceId, current);
  }

  const userRows = db
    .select({ id: users.id, displayName: users.displayName })
    .from(users)
    .where(eq(users.orgId, orgId))
    .all() as Array<{ id: string; displayName: string }>;
  const actorNameById = new Map(userRows.map((user) => [user.id, user.displayName]));

  return visibleRows.map((row) => {
    const subIds = subIdsByMotherId.get(row.motherDeviceId) ?? [];
    const kitDeviceIds = [row.motherDeviceId, ...subIds];
    const ownershipSet = new Set(kitDeviceIds.map((deviceId) => ownershipByDeviceId.get(deviceId) ?? 'owned'));
    const ownershipStatus = ownershipSet.size === 1 ? [...ownershipSet][0] : 'mixed';
    return {
      id: row.id,
      loggedDate: row.loggedDate,
      motherSerial: serialByDeviceId.get(row.motherDeviceId) ?? row.motherDeviceId,
      subSerials: subIds
      .map((subDeviceId) => serialByDeviceId.get(subDeviceId))
      .filter((serial: string | undefined): serial is string => Boolean(serial)),
      simNumber: row.simNumber,
      source: row.source,
      actorName: actorNameById.get(row.actorUserId) ?? null,
      ownershipStatus,
      ownershipNotes: ownershipNotesByDeviceId.get(row.motherDeviceId) ?? null,
    };
  });
}

export function setRegistrationOwnership(
  db: DbClient,
  input: {
    registrationId: string;
    actor: AuthenticatedUser;
    ownershipStatus: 'owned' | 'released_external';
    notes?: string;
  },
): { deviceIds: string[]; ownershipStatus: 'owned' | 'released_external' } {
  const result = setRegistrationsOwnership(db, {
    registrationIds: [input.registrationId],
    actor: input.actor,
    ownershipStatus: input.ownershipStatus,
    notes: input.notes,
  });
  return { deviceIds: result.deviceIds, ownershipStatus: result.ownershipStatus };
}

export function setRegistrationsOwnership(
  db: DbClient,
  input: {
    registrationIds: string[];
    actor: AuthenticatedUser;
    ownershipStatus: 'owned' | 'released_external';
    notes?: string;
  },
): { registrationIds: string[]; deviceIds: string[]; ownershipStatus: 'owned' | 'released_external' } {
  requireSupervisor(input.actor);

  const registrationIds = [...new Set(input.registrationIds.map((id) => id.trim()).filter(Boolean))];
  if (registrationIds.length === 0) throw new BusinessError('Select at least one registration');

  const devicesByRegistration = new Map<string, string[]>();
  for (const registrationId of registrationIds) {
    const registration = db
      .select()
      .from(registrationLogs)
      .where(and(eq(registrationLogs.id, registrationId), eq(registrationLogs.orgId, input.actor.orgId)))
      .get() as { id: string; motherDeviceId: string } | undefined;
    if (!registration) throw new BusinessError(`Registration ${registrationId} not found`);

    const members = db
      .select({ subDeviceId: kitMembers.subDeviceId })
      .from(kitMembers)
      .where(and(eq(kitMembers.orgId, input.actor.orgId), eq(kitMembers.motherDeviceId, registration.motherDeviceId), isNull(kitMembers.removedAt)))
      .all() as Array<{ subDeviceId: string }>;
    devicesByRegistration.set(registrationId, [registration.motherDeviceId, ...members.map((member) => member.subDeviceId)]);
  }

  const deviceIds = [...new Set([...devicesByRegistration.values()].flat())];

  if (input.ownershipStatus === 'released_external') {
    const inService = deviceIds
      .map((deviceId) => db.select({ id: devices.id, serial: devices.serial, lifecycleStatus: devices.lifecycleStatus }).from(devices).where(eq(devices.id, deviceId)).get())
      .filter((device: { id: string; serial: string; lifecycleStatus: string } | undefined) => device?.lifecycleStatus === 'in_service');
    if (inService.length > 0) {
      throw new BusinessError(`Cannot release kit while device ${inService[0].serial} is in service`);
    }
  }

  const now = Math.floor(Date.now() / 1000);
  db.transaction((tx: DbClient) => {
    for (const deviceId of deviceIds) {
      const before = tx.select().from(devices).where(eq(devices.id, deviceId)).get();
      tx.update(devices)
        .set({
          ownershipStatus: input.ownershipStatus,
          ownershipNotes: input.notes ?? null,
          ownershipUpdatedAt: now,
          updatedAt: now,
        })
        .where(eq(devices.id, deviceId))
        .run();
      tx.insert(auditLog)
        .values({
          id: createId(),
          orgId: input.actor.orgId,
          actorUserId: input.actor.id,
          entityTable: 'devices',
          entityId: deviceId,
          operation: 'transition',
          beforeJson: JSON.stringify({ ownershipStatus: before?.ownershipStatus ?? 'owned' }),
          afterJson: JSON.stringify({ ownershipStatus: input.ownershipStatus, registrationIds, notes: input.notes ?? null }),
        })
        .run();
    }
  });

  return { registrationIds, deviceIds, ownershipStatus: input.ownershipStatus };
}
