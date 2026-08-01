import { describe, it, expect } from 'vitest';
import { eq, isNull, and } from 'drizzle-orm';
import { slotPairings, truckAssignments, devices, installationLogs, verifications } from '../../db/schema';
import { createTestDb } from '../../tests/helpers/testDb';
import { seedBaseFixtures, createTruck } from '../../tests/helpers/fixtures';
import { registerKit } from '../registration.service';
import { backfillInstallationVerifications, installKit, listInstallationHistory, listInstallationHistoryPage, recordInstallation } from '../installation.service';

describe('installation.service', () => {
  it('assigns slots positionally (C1→B, C2→C, C3→D) and sets mother + subs in_service', () => {
    const { db } = createTestDb();
    const { orgId, installerId } = seedBaseFixtures(db);
    const truckId = createTruck(db, orgId, 'FZE800DI');

    const kit = registerKit(db, {
      orgId,
      actorUserId: installerId,
      motherSerial: '111111111111',
      subSerials: ['SUBAAAAAAAA', 'SUBBBBBBBBB', 'SUBCCCCCCCC'],
      simNumber: '2348099999999',
    });

    const result = installKit(db, {
      orgId,
      actorUserId: installerId,
      truckId,
      motherDeviceId: kit.motherDeviceId,
      subDeviceIds: kit.subDeviceIds as [string, string, string],
      company: 'mrs',
    });

    const expectedSlots = ['B', 'C', 'D'];
    for (const [index, subDeviceId] of kit.subDeviceIds.entries()) {
      const pairing = db
        .select()
        .from(slotPairings)
        .where(and(eq(slotPairings.subDeviceId, subDeviceId), isNull(slotPairings.unpairedAt)))
        .get()!;
      expect(pairing.slot).toBe(expectedSlots[index]);
      expect(pairing.motherDeviceId).toBe(kit.motherDeviceId);

      const subDevice = db.select().from(devices).where(eq(devices.id, subDeviceId)).get()!;
      expect(subDevice.lifecycleStatus).toBe('in_service');
    }

    const assignment = db
      .select()
      .from(truckAssignments)
      .where(eq(truckAssignments.id, result.assignmentId))
      .get()!;
    expect(assignment.truckId).toBe(truckId);
    expect(assignment.deviceId).toBe(kit.motherDeviceId);
    expect(assignment.removedAt).toBeNull();

    const mother = db.select().from(devices).where(eq(devices.id, kit.motherDeviceId)).get()!;
    expect(mother.lifecycleStatus).toBe('in_service');
  });

  it('lists durable installation history from installation_logs', () => {
    const { db } = createTestDb();
    const { orgId, installerId } = seedBaseFixtures(db);
    const truckId = createTruck(db, orgId, 'HIS123AB');

    const kit = registerKit(db, {
      orgId,
      actorUserId: installerId,
      motherSerial: 'HISTORY-MOTHER',
      subSerials: ['HISTORY-SUB-B', 'HISTORY-SUB-C', 'HISTORY-SUB-D'],
      simNumber: '2348011111111',
    });

    const result = installKit(db, {
      orgId,
      actorUserId: installerId,
      truckId,
      motherDeviceId: kit.motherDeviceId,
      subDeviceIds: kit.subDeviceIds as [string, string, string],
      checklist: { overallStatus: 'successful' },
      company: 'mrs',
    });

    const history = listInstallationHistory(db, orgId);

    expect(history).toEqual([
      expect.objectContaining({
        id: result.installationLogId,
        truckLabel: 'HIS123AB',
        motherSerial: 'HISTORY-MOTHER',
        subSerials: ['HISTORY-SUB-B', 'HISTORY-SUB-C', 'HISTORY-SUB-D'],
        overallStatus: 'successful',
        actorName: 'Inst',
        company: 'mrs',
      }),
    ]);
  });

  it('does not multiply historical sub-locks when duplicate snapshot pairings share a timestamp', () => {
    const { db } = createTestDb();
    const { orgId, installerId } = seedBaseFixtures(db);
    const truckId = createTruck(db, orgId, 'DUP123AB');

    const kit = registerKit(db, {
      orgId,
      actorUserId: installerId,
      motherSerial: 'DUP-MOTHER',
      subSerials: ['DUP-SUB-B', 'DUP-SUB-C', 'DUP-SUB-D'],
      simNumber: '2348033333333',
    });

    const result = installKit(db, {
      orgId,
      actorUserId: installerId,
      truckId,
      motherDeviceId: kit.motherDeviceId,
      subDeviceIds: kit.subDeviceIds as [string, string, string],
      checklist: { overallStatus: 'successful' },
      company: 'mrs',
    });

    const assignment = db.select().from(truckAssignments).where(eq(truckAssignments.id, result.assignmentId)).get()!;
    for (let duplicateIndex = 0; duplicateIndex < 2; duplicateIndex += 1) {
      for (const [index, subDeviceId] of kit.subDeviceIds.entries()) {
        db.insert(slotPairings)
          .values({
            id: `duplicate-slot-${duplicateIndex}-${index}`,
            orgId,
            motherDeviceId: kit.motherDeviceId,
            slot: (['B', 'C', 'D'] as const)[index],
            subDeviceId,
            pairedAt: assignment.assignedAt,
            pairedBy: installerId,
            unpairedAt: assignment.assignedAt,
            unpairedBy: installerId,
          })
          .run();
      }
    }

    const history = listInstallationHistory(db, orgId);

    expect(history[0]).toEqual(
      expect.objectContaining({
        id: result.installationLogId,
        subSerials: ['DUP-SUB-B', 'DUP-SUB-C', 'DUP-SUB-D'],
      }),
    );
  });

  it('records a same-kit daily install without creating a new assignment', () => {
    const { db } = createTestDb();
    const { orgId, installerId } = seedBaseFixtures(db);
    const truckId = createTruck(db, orgId, 'DAY123AB');

    const kit = registerKit(db, {
      orgId,
      actorUserId: installerId,
      motherSerial: 'DAILY-MOTHER',
      subSerials: ['DAILY-SUB-B', 'DAILY-SUB-C', 'DAILY-SUB-D'],
      simNumber: '2348022222222',
    });

    const first = installKit(db, {
      orgId,
      actorUserId: installerId,
      truckId,
      motherDeviceId: kit.motherDeviceId,
      subDeviceIds: kit.subDeviceIds as [string, string, string],
      company: 'mrs',
    });

    const daily = recordInstallation(db, {
      installMode: 'same_kit',
      orgId,
      actorUserId: installerId,
      truckId,
      motherDeviceId: kit.motherDeviceId,
      subDeviceIds: kit.subDeviceIds as [string, string, string],
      checklist: { overallStatus: 'successful', configConfirmed: 'yes' },
    });

    const openAssignments = db.select().from(truckAssignments).where(eq(truckAssignments.truckId, truckId)).all();

    expect(daily.assignmentId).toBe(first.assignmentId);
    expect(openAssignments).toHaveLength(1);
    expect(listInstallationHistory(db, orgId)).toHaveLength(2);

    const firstPage = listInstallationHistoryPage(db, orgId, { page: 0, pageSize: 1 });
    const secondPage = listInstallationHistoryPage(db, orgId, { page: 1, pageSize: 1 });
    const searchPage = listInstallationHistoryPage(db, orgId, { page: 0, pageSize: 5, query: 'DAY123AB' });
    expect(firstPage.total).toBe(2);
    expect(firstPage.items).toHaveLength(1);
    expect(secondPage.items).toHaveLength(1);
    expect(searchPage.total).toBe(2);
  });

  it('automatically verifies completed installs but not failed installs', () => {
    const { db } = createTestDb();
    const { orgId, installerId } = seedBaseFixtures(db);
    const truckId = createTruck(db, orgId, 'AUTO123AB');
    const kit = registerKit(db, {
      orgId,
      actorUserId: installerId,
      motherSerial: 'AUTO-MOTHER',
      subSerials: ['AUTO-SUB-B', 'AUTO-SUB-C', 'AUTO-SUB-D'],
      simNumber: '2348044444444',
    });

    const completed = installKit(db, {
      orgId,
      actorUserId: installerId,
      truckId,
      motherDeviceId: kit.motherDeviceId,
      subDeviceIds: kit.subDeviceIds as [string, string, string],
      company: 'mrs',
      checklist: { overallStatus: 'successful' },
      loggedDate: 1_700_000_000,
    });

    const verification = db.select().from(verifications).where(eq(verifications.id, completed.verificationId!)).get()!;
    expect(verification).toMatchObject({
      truckId,
      motherDeviceId: kit.motherDeviceId,
      result: 'match',
      weakestTier: 'manual',
      verifiedAt: 1_700_000_000,
    });
    expect(JSON.parse(verification.observedSubsJson)).toEqual([
      'AUTO-SUB-B',
      'AUTO-SUB-C',
      'AUTO-SUB-D',
    ]);

    const failed = recordInstallation(db, {
      installMode: 'same_kit',
      orgId,
      actorUserId: installerId,
      truckId,
      motherDeviceId: kit.motherDeviceId,
      subDeviceIds: kit.subDeviceIds as [string, string, string],
      checklist: { overallStatus: 'failed' },
    });
    expect(failed.verificationId).toBeNull();
    expect(db.select().from(verifications).all()).toHaveLength(1);
  });

  it('backfills confirmed app installs once and ignores dates outside the requested range', () => {
    const { db } = createTestDb();
    const { orgId, installerId, supervisorId } = seedBaseFixtures(db);
    const truckId = createTruck(db, orgId, 'BACK123AB');
    const kit = registerKit(db, {
      orgId,
      actorUserId: installerId,
      motherSerial: 'BACK-MOTHER',
      subSerials: ['BACK-SUB-B', 'BACK-SUB-C', 'BACK-SUB-D'],
      simNumber: '2348055555555',
    });
    const legacy = installKit(db, {
      orgId,
      actorUserId: installerId,
      truckId,
      motherDeviceId: kit.motherDeviceId,
      subDeviceIds: kit.subDeviceIds as [string, string, string],
      company: 'mrs',
      loggedDate: 1_700_100_000,
    });
    db.update(installationLogs)
      .set({ overallStatus: 'successful' })
      .where(eq(installationLogs.id, legacy.installationLogId))
      .run();

    const actor = { id: supervisorId, orgId, role: 'supervisor' as const };
    const preview = backfillInstallationVerifications(db, {
      actor,
      from: 1_700_000_000,
      to: 1_700_200_000,
      dryRun: true,
    });
    expect(preview).toMatchObject({ confirmedInstalls: 1, eligible: 1, created: 0 });
    expect(db.select().from(verifications).all()).toHaveLength(0);

    const applied = backfillInstallationVerifications(db, {
      actor,
      from: 1_700_000_000,
      to: 1_700_200_000,
    });
    expect(applied.created).toBe(1);
    expect(db.select().from(verifications).all()).toHaveLength(1);

    const repeated = backfillInstallationVerifications(db, {
      actor,
      from: 1_700_000_000,
      to: 1_700_200_000,
    });
    expect(repeated).toMatchObject({ eligible: 0, created: 0, alreadyVerified: 1 });

    const outsideRange = backfillInstallationVerifications(db, {
      actor,
      from: 1_700_200_001,
      to: 1_700_300_000,
      dryRun: true,
    });
    expect(outsideRange.confirmedInstalls).toBe(0);
  });
});
