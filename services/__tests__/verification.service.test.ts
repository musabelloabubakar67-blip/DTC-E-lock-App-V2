import { describe, it, expect } from 'vitest';
import { eq } from 'drizzle-orm';
import { createId } from '@paralleldrive/cuid2';
import { verifications, slotPairings, devices } from '../../db/schema';
import { createTestDb } from '../../tests/helpers/testDb';
import { seedBaseFixtures, createDevice } from '../../tests/helpers/fixtures';
import { getTrustState, recordKitVerification } from '../verification.service';

const DAY = 86400;

function insertVerification(
  db: ReturnType<typeof createTestDb>['db'],
  params: {
    orgId: string;
    motherDeviceId: string;
    verifiedBy: string;
    weakestTier: 'qr_scan' | 'photo_attestation' | 'manual';
    verifiedAt: number;
  },
) {
  db.insert(verifications)
    .values({
      id: createId(),
      orgId: params.orgId,
      motherDeviceId: params.motherDeviceId,
      source: params.weakestTier,
      result: 'match',
      observedMaster: 'X',
      observedSubsJson: '[]',
      weakestTier: params.weakestTier,
      verifiedBy: params.verifiedBy,
      verifiedAt: params.verifiedAt,
    })
    .run();
}

function serialOf(db: ReturnType<typeof createTestDb>['db'], deviceId: string): string {
  return db.select({ serial: devices.serial }).from(devices).where(eq(devices.id, deviceId)).get()!.serial;
}

function setupKit(db: ReturnType<typeof createTestDb>['db'], orgId: string, installerId: string) {
  const motherId = createDevice(db, orgId, {
    type: 'mother',
    serial: `KM${Math.random().toString(36).slice(2, 10)}`.toUpperCase(),
    status: 'in_service',
  });
  const subIds = [0, 1, 2].map(() =>
    createDevice(db, orgId, {
      type: 'sub',
      serial: `KS${Math.random().toString(36).slice(2, 10)}`.toUpperCase(),
      status: 'in_service',
    }),
  );
  const now = Math.floor(Date.now() / 1000);
  subIds.forEach((subId, i) => {
    db.insert(slotPairings)
      .values({
        id: createId(),
        orgId,
        motherDeviceId: motherId,
        slot: (['B', 'C', 'D'] as const)[i],
        subDeviceId: subId,
        pairedAt: now,
        pairedBy: installerId,
      })
      .run();
  });
  return { motherId, subIds };
}

describe('verification.service — getTrustState decay windows', () => {
  it('no verification row → unverified', () => {
    const { db } = createTestDb();
    const { orgId } = seedBaseFixtures(db);
    const motherDeviceId = createDevice(db, orgId, { type: 'mother', serial: 'TRUST-1', status: 'in_service' });

    const result = getTrustState(db, { motherDeviceId });

    expect(result.state).toBe('unverified');
    expect(result.latestVerifiedAt).toBeNull();
  });

  it('a fresh qr_scan → verified', () => {
    const { db } = createTestDb();
    const { orgId, installerId } = seedBaseFixtures(db);
    const motherDeviceId = createDevice(db, orgId, { type: 'mother', serial: 'TRUST-2', status: 'in_service' });
    const now = Math.floor(Date.now() / 1000);
    insertVerification(db, { orgId, motherDeviceId, verifiedBy: installerId, weakestTier: 'qr_scan', verifiedAt: now });

    const result = getTrustState(db, { motherDeviceId });

    expect(result.state).toBe('verified');
  });

  it('a qr_scan dated 91 days ago → stale (90-day window exceeded)', () => {
    const { db } = createTestDb();
    const { orgId, installerId } = seedBaseFixtures(db);
    const motherDeviceId = createDevice(db, orgId, { type: 'mother', serial: 'TRUST-3', status: 'in_service' });
    const verifiedAt = Math.floor(Date.now() / 1000) - 91 * DAY;
    insertVerification(db, { orgId, motherDeviceId, verifiedBy: installerId, weakestTier: 'qr_scan', verifiedAt });

    const result = getTrustState(db, { motherDeviceId });

    expect(result.state).toBe('stale');
  });

  it('a photo_attestation/manual dated 31 days ago → stale (30-day window, different from qr_scan)', () => {
    const { db } = createTestDb();
    const { orgId, installerId } = seedBaseFixtures(db);
    const verifiedAt = Math.floor(Date.now() / 1000) - 31 * DAY;

    const photoDeviceId = createDevice(db, orgId, { type: 'mother', serial: 'TRUST-4A', status: 'in_service' });
    insertVerification(db, {
      orgId,
      motherDeviceId: photoDeviceId,
      verifiedBy: installerId,
      weakestTier: 'photo_attestation',
      verifiedAt,
    });
    expect(getTrustState(db, { motherDeviceId: photoDeviceId }).state).toBe('stale');

    const manualDeviceId = createDevice(db, orgId, { type: 'mother', serial: 'TRUST-4B', status: 'in_service' });
    insertVerification(db, {
      orgId,
      motherDeviceId: manualDeviceId,
      verifiedBy: installerId,
      weakestTier: 'manual',
      verifiedAt,
    });
    expect(getTrustState(db, { motherDeviceId: manualDeviceId }).state).toBe('stale');

    // Proves the windows genuinely differ: the SAME 31-day-old age is still 'verified' under
    // the 90-day qr_scan window but 'stale' under the 30-day photo/manual window.
    const qrDeviceId = createDevice(db, orgId, { type: 'mother', serial: 'TRUST-4C', status: 'in_service' });
    insertVerification(db, {
      orgId,
      motherDeviceId: qrDeviceId,
      verifiedBy: installerId,
      weakestTier: 'qr_scan',
      verifiedAt,
    });
    expect(getTrustState(db, { motherDeviceId: qrDeviceId }).state).toBe('verified');
  });

  it('exact-boundary: a qr_scan dated exactly 90 days ago is stale (conservative — the line itself is expired)', () => {
    const { db } = createTestDb();
    const { orgId, installerId } = seedBaseFixtures(db);
    const motherDeviceId = createDevice(db, orgId, { type: 'mother', serial: 'TRUST-6A', status: 'in_service' });
    const verifiedAt = Math.floor(Date.now() / 1000) - 90 * DAY;
    insertVerification(db, { orgId, motherDeviceId, verifiedBy: installerId, weakestTier: 'qr_scan', verifiedAt });

    expect(getTrustState(db, { motherDeviceId }).state).toBe('stale');
  });

  it('exact-boundary: a photo_attestation/manual dated exactly 30 days ago is stale (same conservative rule)', () => {
    const { db } = createTestDb();
    const { orgId, installerId } = seedBaseFixtures(db);
    const verifiedAt = Math.floor(Date.now() / 1000) - 30 * DAY;

    const photoDeviceId = createDevice(db, orgId, { type: 'mother', serial: 'TRUST-6B', status: 'in_service' });
    insertVerification(db, {
      orgId,
      motherDeviceId: photoDeviceId,
      verifiedBy: installerId,
      weakestTier: 'photo_attestation',
      verifiedAt,
    });
    expect(getTrustState(db, { motherDeviceId: photoDeviceId }).state).toBe('stale');

    const manualDeviceId = createDevice(db, orgId, { type: 'mother', serial: 'TRUST-6C', status: 'in_service' });
    insertVerification(db, {
      orgId,
      motherDeviceId: manualDeviceId,
      verifiedBy: installerId,
      weakestTier: 'manual',
      verifiedAt,
    });
    expect(getTrustState(db, { motherDeviceId: manualDeviceId }).state).toBe('stale');
  });

  it('an import_unverified device with no verification row reads unverified', () => {
    const { db } = createTestDb();
    const { orgId } = seedBaseFixtures(db);
    const motherDeviceId = createDevice(db, orgId, { type: 'mother', serial: 'TRUST-5', status: 'in_service' });
    // Mirror a migrated device (§3: every migrated device imports import_unverified=1).
    db.update(devices).set({ importUnverified: 1 }).where(eq(devices.id, motherDeviceId)).run();

    const result = getTrustState(db, { motherDeviceId });

    expect(result.state).toBe('unverified');
  });
});

describe('verification.service — recordKitVerification happy path (pass one)', () => {
  it('a kit scanned with one manual sub records weakest_tier=manual even if mother + other subs were qr_scan', () => {
    const { db } = createTestDb();
    const { orgId, installerId } = seedBaseFixtures(db);
    const { motherId, subIds } = setupKit(db, orgId, installerId);

    const result = recordKitVerification(db, {
      orgId,
      actorUserId: installerId,
      motherSerial: serialOf(db, motherId),
      motherSource: 'qr_scan',
      subs: [
        { serial: serialOf(db, subIds[0]), source: 'qr_scan' },
        { serial: serialOf(db, subIds[1]), source: 'manual' },
        { serial: serialOf(db, subIds[2]), source: 'qr_scan' },
      ],
    });

    expect(result.matched).toBe(true);
    if (result.matched) {
      expect(result.weakestTier).toBe('manual');
    }
  });

  it('a matching kit records result=match and flips trust to verified', () => {
    const { db } = createTestDb();
    const { orgId, installerId } = seedBaseFixtures(db);
    const { motherId, subIds } = setupKit(db, orgId, installerId);

    expect(getTrustState(db, { motherDeviceId: motherId }).state).toBe('unverified');

    const matchResult = recordKitVerification(db, {
      orgId,
      actorUserId: installerId,
      motherSerial: serialOf(db, motherId),
      motherSource: 'qr_scan',
      subs: subIds.map((id) => ({ serial: serialOf(db, id), source: 'qr_scan' as const })),
    });
    expect(matchResult.matched).toBe(true);
    expect(getTrustState(db, { motherDeviceId: motherId }).state).toBe('verified');

    const verificationRowsAfterMatch = db.select().from(verifications).all();
    expect(verificationRowsAfterMatch).toHaveLength(1);
  });
});

// Pass two's mismatch → correct → conflict_review flow has its own dedicated test file:
// verification.service.mismatch.test.ts
