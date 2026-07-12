import { describe, expect, it } from 'vitest';
import { createId } from '@paralleldrive/cuid2';
import { conflictReviews } from '../../db/schema';
import { createTestDb } from '../../tests/helpers/testDb';
import { createTruck, seedBaseFixtures } from '../../tests/helpers/fixtures';
import { getDashboard } from '../dashboard.service';
import { installKit } from '../installation.service';
import { registerKit } from '../registration.service';

describe('dashboard service', () => {
  it('returns an empty operations dashboard without fake rows', () => {
    const { db } = createTestDb();
    const { orgId } = seedBaseFixtures(db);

    const view = getDashboard(db, { orgId, role: 'installer' });

    expect(view.counts.registeredKits).toBe(0);
    expect(view.counts.openReviews).toBe(0);
    expect(view.trust).toEqual({ verified: 0, stale: 0, unverified: 0, total: 0 });
    expect(view.reviews).toEqual([]);
    expect(view.repairPool).toEqual([]);
    expect(view.registrations).toEqual([]);
    expect(view.audit).toEqual([]);
  });

  it('summarizes live registration, install, trust, review, and audit data', () => {
    const { db } = createTestDb();
    const { orgId, installerId } = seedBaseFixtures(db);
    const truckId = createTruck(db, orgId, 'DASH123');
    const registered = registerKit(db, {
      orgId,
      actorUserId: installerId,
      motherSerial: 'DASH-MOTHER-1',
      subSerials: ['DASH-SUB-B', 'DASH-SUB-C', 'DASH-SUB-D'],
      simNumber: 'SIM-DASH-1',
    });

    installKit(db, {
      orgId,
      actorUserId: installerId,
      truckId,
      motherDeviceId: registered.motherDeviceId,
      subDeviceIds: registered.subDeviceIds as [string, string, string],
      company: 'mrs',
    });

    const reviewId = createId();
    db.insert(conflictReviews)
      .values({
        id: reviewId,
        orgId,
        kind: 'unlogged_swap',
        status: 'open',
        payloadJson: JSON.stringify({ truckId: 'DASH123', observedMotherSerial: 'DASH-MOTHER-1' }),
      })
      .run();

    const view = getDashboard(db, { orgId, role: 'supervisor' });

    expect(view.counts.registeredKits).toBe(1);
    expect(view.counts.inServiceMothers).toBe(1);
    expect(view.counts.openReviews).toBe(1);
    expect(view.trust.unverified).toBe(1);
    expect(view.reviews.map((review) => review.id)).toEqual([reviewId]);
    expect(view.registrations[0].motherSerial).toBe('DASH-MOTHER-1');
    expect(view.audit.length).toBeGreaterThan(0);
    expect(view.health.tone).toBe('danger');
  });
});
