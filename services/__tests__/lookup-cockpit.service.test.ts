import { describe, expect, it } from 'vitest';
import { createId } from '@paralleldrive/cuid2';
import { conflictReviews, organisations, verifications } from '../../db/schema';
import { createTestDb } from '../../tests/helpers/testDb';
import { createDevice, createTruck, seedBaseFixtures } from '../../tests/helpers/fixtures';
import { installKit } from '../installation.service';
import { getLookupCockpit } from '../lookup.service';

function insertVerification(
  db: ReturnType<typeof createTestDb>['db'],
  params: { orgId: string; motherDeviceId: string; verifiedBy: string; verifiedAt?: number },
) {
  db.insert(verifications)
    .values({
      id: createId(),
      orgId: params.orgId,
      motherDeviceId: params.motherDeviceId,
      source: 'qr_scan',
      result: 'match',
      observedMaster: 'M',
      observedSubsJson: '[]',
      weakestTier: 'qr_scan',
      verifiedBy: params.verifiedBy,
      verifiedAt: params.verifiedAt ?? Math.floor(Date.now() / 1000),
    })
    .run();
}

describe('lookup cockpit view model', () => {
  it('unknown lookup query returns an empty cockpit state without fake rows', () => {
    const { db } = createTestDb();
    const { orgId } = seedBaseFixtures(db);

    const view = getLookupCockpit(db, { orgId, query: 'missing-target' });

    expect(view.target).toEqual({ kind: 'unknown', id: null, label: 'MISSING-TARGET' });
    expect(view.trust.state).toBe('unverified');
    expect(view.kit.mother).toBeNull();
    expect(view.kit.subs).toEqual([
      { slot: 'B', id: null, serial: null },
      { slot: 'C', id: null, serial: null },
      { slot: 'D', id: null, serial: null },
    ]);
    expect(view.reviews).toEqual([]);
    expect(view.sync).toEqual({ pendingCount: 0, items: [] });
    expect(view.audit).toEqual([]);
  });

  it('mother-device lookup returns trust state and kit rows', () => {
    const { db } = createTestDb();
    const { orgId, installerId } = seedBaseFixtures(db);
    const motherId = createDevice(db, orgId, { type: 'mother', serial: 'LOOKUP-MOTHER-1', status: 'in_service' });
    insertVerification(db, { orgId, motherDeviceId: motherId, verifiedBy: installerId });

    const view = getLookupCockpit(db, { orgId, query: 'LOOKUP-MOTHER-1' });

    expect(view.target.kind).toBe('mother_device');
    expect(view.kit.mother).toEqual({ id: motherId, serial: 'LOOKUP-MOTHER-1' });
    expect(view.trust.state).toBe('verified');
    expect(view.kit.subs.map((slot) => slot.slot)).toEqual(['B', 'C', 'D']);
  });

  it('truck lookup resolves current mother assignment and sub slots', () => {
    const { db } = createTestDb();
    const { orgId, installerId } = seedBaseFixtures(db);
    const truckId = createTruck(db, orgId, 'KMA123XA');
    const motherId = createDevice(db, orgId, { type: 'mother', serial: 'LOOKUP-MOTHER-2', status: 'available' });
    const subIds = [
      createDevice(db, orgId, { type: 'sub', serial: 'LOOKUP-SUB-B', status: 'available' }),
      createDevice(db, orgId, { type: 'sub', serial: 'LOOKUP-SUB-C', status: 'available' }),
      createDevice(db, orgId, { type: 'sub', serial: 'LOOKUP-SUB-D', status: 'available' }),
    ] as [string, string, string];

    installKit(db, {
      orgId,
      actorUserId: installerId,
      truckId,
      motherDeviceId: motherId,
      subDeviceIds: subIds,
      company: 'mrs',
    });

    const view = getLookupCockpit(db, { orgId, query: 'KMA123XA' });

    expect(view.target).toEqual({ kind: 'truck', id: truckId, label: 'KMA123XA' });
    expect(view.kit.mother).toEqual({ id: motherId, serial: 'LOOKUP-MOTHER-2' });
    expect(view.kit.subs).toEqual([
      { slot: 'B', id: subIds[0], serial: 'LOOKUP-SUB-B' },
      { slot: 'C', id: subIds[1], serial: 'LOOKUP-SUB-C' },
      { slot: 'D', id: subIds[2], serial: 'LOOKUP-SUB-D' },
    ]);
  });

  it('open conflict reviews appear in the cockpit view model for the same org only', () => {
    const { db } = createTestDb();
    const { orgId } = seedBaseFixtures(db);
    const otherOrgId = createId();
    const reviewId = createId();

    db.insert(organisations).values({ id: otherOrgId, name: 'Other Org' }).run();

    db.insert(conflictReviews)
      .values({
        id: reviewId,
        orgId,
        kind: 'unlogged_swap',
        payloadJson: JSON.stringify({ truckId: 'T1', observedMotherSerial: 'M1' }),
        status: 'open',
      })
      .run();
    db.insert(conflictReviews)
      .values({
        id: createId(),
        orgId: otherOrgId,
        kind: 'unlogged_swap',
        payloadJson: JSON.stringify({ truckId: 'T2', observedMotherSerial: 'M2' }),
        status: 'open',
      })
      .run();

    const view = getLookupCockpit(db, { orgId, query: '' });

    expect(view.reviews.map((review) => review.id)).toEqual([reviewId]);
  });

  it('missing audit and sync data render as empty arrays, not production demo rows', () => {
    const { db } = createTestDb();
    const { orgId } = seedBaseFixtures(db);

    const view = getLookupCockpit(db, { orgId, query: '' });

    expect(view.sync.pendingCount).toBe(0);
    expect(view.sync.items).toEqual([]);
    expect(view.audit).toEqual([]);
  });
});
