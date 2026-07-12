import { describe, it, expect } from 'vitest';
import { eq } from 'drizzle-orm';
import { auditLog, devices, movementLogs, organisations } from '../../db/schema';
import { createTestDb } from '../../tests/helpers/testDb';
import { seedBaseFixtures, createDevice } from '../../tests/helpers/fixtures';
import { listRepairPool } from '../lookup.service';
import { applyTriageMovement } from '../movement.service';
import { applyTriage } from '../lifecycle.service';
import { AuthzError } from '../../lib/errors';

describe('Triage (§7 /triage over lifecycle.service + movement.service)', () => {
  it('revive: a repair device transitions to available, writes movement_log(action=triage) + audit, and leaves the repair list', () => {
    const { db } = createTestDb();
    const { orgId, supervisorId } = seedBaseFixtures(db);
    const deviceId = createDevice(db, orgId, { type: 'mother', serial: 'TRIAGE-REVIVE-1', status: 'repair' });

    expect(listRepairPool(db, orgId).map((d) => d.deviceId)).toContain(deviceId);

    const { movementLogId } = applyTriageMovement(db, {
      orgId,
      deviceId,
      actor: { id: supervisorId, orgId, role: 'supervisor' },
      outcome: 'revived',
    });

    const device = db.select().from(devices).where(eq(devices.id, deviceId)).get()!;
    expect(device.lifecycleStatus).toBe('available');

    const log = db.select().from(movementLogs).where(eq(movementLogs.id, movementLogId)).get()!;
    expect(log.action).toBe('triage');
    expect(log.outDeviceId).toBe(deviceId);

    const auditRows = db.select().from(auditLog).where(eq(auditLog.entityId, movementLogId)).all();
    expect(auditRows.length).toBeGreaterThan(0);

    expect(listRepairPool(db, orgId).map((d) => d.deviceId)).not.toContain(deviceId);
  });

  it('declare-dead: a repair device transitions to faulty (terminal), same logging', () => {
    const { db } = createTestDb();
    const { orgId, supervisorId } = seedBaseFixtures(db);
    const deviceId = createDevice(db, orgId, { type: 'sub', serial: 'TRIAGE-DEAD-1', status: 'repair' });

    const { movementLogId } = applyTriageMovement(db, {
      orgId,
      deviceId,
      actor: { id: supervisorId, orgId, role: 'supervisor' },
      outcome: 'dead',
    });

    const device = db.select().from(devices).where(eq(devices.id, deviceId)).get()!;
    expect(device.lifecycleStatus).toBe('faulty');

    const log = db.select().from(movementLogs).where(eq(movementLogs.id, movementLogId)).get()!;
    expect(log.action).toBe('triage');

    const auditRows = db.select().from(auditLog).where(eq(auditLog.entityId, movementLogId)).all();
    expect(auditRows.length).toBeGreaterThan(0);

    expect(listRepairPool(db, orgId).map((d) => d.deviceId)).not.toContain(deviceId);
  });

  it('both triage actions throw for a non-supervisor (service-layer check)', () => {
    const { db } = createTestDb();
    const { orgId, installerId } = seedBaseFixtures(db);
    const deviceA = createDevice(db, orgId, { type: 'mother', serial: 'TRIAGE-AUTHZ-1', status: 'repair' });
    const deviceB = createDevice(db, orgId, { type: 'mother', serial: 'TRIAGE-AUTHZ-2', status: 'repair' });

    expect(() =>
      applyTriageMovement(db, {
        orgId,
        deviceId: deviceA,
        actor: { id: installerId, orgId, role: 'installer' },
        outcome: 'revived',
      }),
    ).toThrow(AuthzError);

    expect(() =>
      applyTriageMovement(db, {
        orgId,
        deviceId: deviceB,
        actor: { id: installerId, orgId, role: 'installer' },
        outcome: 'dead',
      }),
    ).toThrow(AuthzError);

    // Also confirmed directly at the lower lifecycle.service.ts layer, not just the wrapper.
    expect(() =>
      applyTriage(db, {
        deviceId: deviceA,
        actor: { id: installerId, orgId, role: 'installer' },
        outcome: 'revived',
      }),
    ).toThrow(AuthzError);
  });

  it('repair pool is scoped to the signed-in organisation', () => {
    const { db } = createTestDb();
    const { orgId } = seedBaseFixtures(db);
    const otherOrgId = 'other-org';
    db.insert(organisations).values({ id: otherOrgId, name: 'Other Org' }).run();

    const visibleDevice = createDevice(db, orgId, { type: 'mother', serial: 'TRIAGE-ORG-1', status: 'repair' });
    const hiddenDevice = createDevice(db, otherOrgId, { type: 'sub', serial: 'TRIAGE-ORG-2', status: 'repair' });

    const visibleIds = listRepairPool(db, orgId).map((device) => device.deviceId);
    expect(visibleIds).toContain(visibleDevice);
    expect(visibleIds).not.toContain(hiddenDevice);
  });
});
