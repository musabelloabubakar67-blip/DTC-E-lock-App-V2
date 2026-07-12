// §6 "Registration creates unassigned, unslotted kits" + §9 Registration UX.
// Registration is device-to-device, write-once per device, no truck involved.
// No next/server import here — services are framework-agnostic (§7 layer contract).
import { and, desc, eq, isNull } from 'drizzle-orm';
import { createId } from '@paralleldrive/cuid2';
import { devices, kitMembers, registrationLogs, auditLog, users } from '../db/schema';
import { BusinessError } from '../lib/errors';

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

export function listRegistrations(db: DbClient, orgId: string, limit = 40): RegistrationListItem[] {
  const rows = db
    .select()
    .from(registrationLogs)
    .where(eq(registrationLogs.orgId, orgId))
    .orderBy(desc(registrationLogs.loggedDate))
    .all()
    .slice(0, limit);

  return rows.map(
    (row: {
      id: string;
      motherDeviceId: string;
      actorUserId: string;
      loggedDate: number;
      simNumber: string | null;
      source: 'app' | 'import';
    }) => {
      const mother = db
        .select({ serial: devices.serial })
        .from(devices)
        .where(and(eq(devices.orgId, orgId), eq(devices.id, row.motherDeviceId)))
        .get();
      const members = db
        .select({ subDeviceId: kitMembers.subDeviceId })
        .from(kitMembers)
        .where(and(eq(kitMembers.orgId, orgId), eq(kitMembers.motherDeviceId, row.motherDeviceId), isNull(kitMembers.removedAt)))
        .all();
      const subSerials = members
        .map((member: { subDeviceId: string }) =>
          db
            .select({ serial: devices.serial })
            .from(devices)
            .where(and(eq(devices.orgId, orgId), eq(devices.id, member.subDeviceId)))
            .get(),
        )
        .map((device: { serial: string } | undefined) => device?.serial)
        .filter((serial: string | undefined): serial is string => Boolean(serial));
      const actor = db
        .select({ displayName: users.displayName })
        .from(users)
        .where(eq(users.id, row.actorUserId))
        .get();

      return {
        id: row.id,
        loggedDate: row.loggedDate,
        motherSerial: mother?.serial ?? row.motherDeviceId,
        subSerials,
        simNumber: row.simNumber,
        source: row.source,
        actorName: actor?.displayName ?? null,
      };
    },
  );
}
