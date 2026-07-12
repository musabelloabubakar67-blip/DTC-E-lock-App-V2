import { describe, it, expect } from 'vitest';
import { eq } from 'drizzle-orm';
import { createId } from '@paralleldrive/cuid2';
import { devices, truckAssignments, slotPairings } from '../../db/schema';
import { createTestDb } from '../../tests/helpers/testDb';
import { seedBaseFixtures, createTruck, createDevice } from '../../tests/helpers/fixtures';
import { registerKit } from '../registration.service';
import { recordKitVerification } from '../verification.service';

function serialOf(db: ReturnType<typeof createTestDb>['db'], deviceId: string): string {
  return db.select({ serial: devices.serial }).from(devices).where(eq(devices.id, deviceId)).get()!.serial;
}

describe('devices.origin — queryable provenance', () => {
  it('a normally-registered device reads origin=registered; a scan-discovered device reads origin=discovered', () => {
    const { db } = createTestDb();
    const { orgId, installerId } = seedBaseFixtures(db);

    // Normal registration path.
    const kit = registerKit(db, {
      orgId,
      actorUserId: installerId,
      motherSerial: 'ORIGIN-MOTHER-1',
      subSerials: ['ORIGIN-SUB-1A', 'ORIGIN-SUB-1B', 'ORIGIN-SUB-1C'],
      simNumber: '2348010000000',
    });
    const registeredDevice = db.select().from(devices).where(eq(devices.id, kit.motherDeviceId)).get()!;
    expect(registeredDevice.origin).toBe('registered');

    // Scan-discovered path: an unknown sub found during a mismatch correction.
    const truckId = createTruck(db, orgId, 'FZE800DI');
    const motherId = createDevice(db, orgId, { type: 'mother', serial: 'ORIGIN-MOTHER-2', status: 'in_service' });
    const knownSubIds = [0, 1].map(() =>
      createDevice(db, orgId, {
        type: 'sub',
        serial: `ORIGIN-SUB-2-${Math.random().toString(36).slice(2, 8)}`.toUpperCase(),
        status: 'in_service',
      }),
    );
    const now = Math.floor(Date.now() / 1000);
    db.insert(truckAssignments)
      .values({ id: createId(), orgId, truckId, deviceId: motherId, assignedAt: now, assignedBy: installerId })
      .run();
    knownSubIds.forEach((subId, i) => {
      db.insert(slotPairings)
        .values({
          id: createId(),
          orgId,
          motherDeviceId: motherId,
          slot: (['B', 'C'] as const)[i],
          subDeviceId: subId,
          pairedAt: now,
          pairedBy: installerId,
        })
        .run();
    });

    const unknownSerial = 'ORIGIN-DISCOVERED-SUB';
    recordKitVerification(db, {
      orgId,
      actorUserId: installerId,
      truckId,
      motherSerial: serialOf(db, motherId),
      motherSource: 'qr_scan',
      subs: [
        { serial: serialOf(db, knownSubIds[0]), source: 'qr_scan' },
        { serial: serialOf(db, knownSubIds[1]), source: 'qr_scan' },
        { serial: unknownSerial, source: 'manual' },
      ],
    });

    const discoveredDevice = db.select().from(devices).where(eq(devices.serial, unknownSerial)).get()!;
    expect(discoveredDevice.origin).toBe('discovered');
  });
});
