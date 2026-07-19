import { describe, it, expect } from 'vitest';
import { eq } from 'drizzle-orm';
import { auditLog } from '../../db/schema';
import { createTestDb } from '../../tests/helpers/testDb';
import { seedBaseFixtures, createTruck, createDevice } from '../../tests/helpers/fixtures';
import { registerKit } from '../registration.service';
import { installKit } from '../installation.service';
import {
  assignMotherToTruck,
  removeDeviceFromTruck,
  decommissionDevice,
  replaceMotherLock,
  replaceSubLock,
  resolveTruckSwap,
  applyTriageMovement,
} from '../movement.service';

function auditRowsFor(db: ReturnType<typeof createTestDb>['db'], movementLogId: string) {
  return db
    .select()
    .from(auditLog)
    .where(eq(auditLog.entityTable, 'movement_logs'))
    .all()
    .filter((row: { entityId: string }) => row.entityId === movementLogId);
}

describe('movement.service — every action writes an audit_log row inside its transaction', () => {
  it('new_assignment', () => {
    const { db } = createTestDb();
    const { orgId, installerId } = seedBaseFixtures(db);
    const truckId = createTruck(db, orgId, 'FZE040DI');
    const kit = registerKit(db, {
      orgId,
      actorUserId: installerId,
      motherSerial: 'AUDIT-NA-1',
      subSerials: ['AUDIT-NA-1A', 'AUDIT-NA-1B', 'AUDIT-NA-1C'],
      simNumber: '2348011110000',
    });

    const { movementLogId } = assignMotherToTruck(db, {
      orgId,
      actorUserId: installerId,
      truckId,
      motherDeviceId: kit.motherDeviceId,
    });

    expect(auditRowsFor(db, movementLogId)).toHaveLength(1);
  });

  it('removed_to_inventory', () => {
    const { db } = createTestDb();
    const { orgId, installerId } = seedBaseFixtures(db);
    const truckId = createTruck(db, orgId, 'FZE050DI');
    const kit = registerKit(db, {
      orgId,
      actorUserId: installerId,
      motherSerial: 'AUDIT-RTI-1',
      subSerials: ['AUDIT-RTI-1A', 'AUDIT-RTI-1B', 'AUDIT-RTI-1C'],
      simNumber: '2348011110001',
    });
    installKit(db, {
      orgId,
      actorUserId: installerId,
      truckId,
      motherDeviceId: kit.motherDeviceId,
      subDeviceIds: kit.subDeviceIds as [string, string, string],
      company: 'mrs',
    });

    const { movementLogId } = removeDeviceFromTruck(db, {
      orgId,
      actorUserId: installerId,
      motherDeviceId: kit.motherDeviceId,
      reason: 'operational_swap',
    });

    expect(auditRowsFor(db, movementLogId)).toHaveLength(1);
  });

  it('decommissioned', () => {
    const { db } = createTestDb();
    const { orgId, installerId } = seedBaseFixtures(db);
    const truckId = createTruck(db, orgId, 'FZE060DI');
    const kit = registerKit(db, {
      orgId,
      actorUserId: installerId,
      motherSerial: 'AUDIT-DECOM-1',
      subSerials: ['AUDIT-DECOM-1A', 'AUDIT-DECOM-1B', 'AUDIT-DECOM-1C'],
      simNumber: '2348011110002',
    });
    installKit(db, {
      orgId,
      actorUserId: installerId,
      truckId,
      motherDeviceId: kit.motherDeviceId,
      subDeviceIds: kit.subDeviceIds as [string, string, string],
      company: 'mrs',
    });

    const { movementLogId } = decommissionDevice(db, {
      orgId,
      actorUserId: installerId,
      motherDeviceId: kit.motherDeviceId,
    });

    expect(auditRowsFor(db, movementLogId)).toHaveLength(1);
  });

  it('mother_replacement', () => {
    const { db } = createTestDb();
    const { orgId, installerId } = seedBaseFixtures(db);
    const truckId = createTruck(db, orgId, 'FZE070DI');
    const kit = registerKit(db, {
      orgId,
      actorUserId: installerId,
      motherSerial: 'AUDIT-MREP-1',
      subSerials: ['AUDIT-MREP-1A', 'AUDIT-MREP-1B', 'AUDIT-MREP-1C'],
      simNumber: '2348011110003',
    });
    installKit(db, {
      orgId,
      actorUserId: installerId,
      truckId,
      motherDeviceId: kit.motherDeviceId,
      subDeviceIds: kit.subDeviceIds as [string, string, string],
      company: 'mrs',
    });
    const newMotherId = createDevice(db, orgId, { type: 'mother', serial: 'AUDIT-MREP-NEW', status: 'available' });

    const { movementLogId } = replaceMotherLock(db, {
      orgId,
      actorUserId: installerId,
      truckId,
      newMotherDeviceId: newMotherId,
      reason: 'faulty',
    });

    expect(auditRowsFor(db, movementLogId)).toHaveLength(1);
  });

  it('sub_replacement', () => {
    const { db } = createTestDb();
    const { orgId, installerId } = seedBaseFixtures(db);
    const truckId = createTruck(db, orgId, 'FZE080DI');
    const kit = registerKit(db, {
      orgId,
      actorUserId: installerId,
      motherSerial: 'AUDIT-SREP-1',
      subSerials: ['AUDIT-SREP-1A', 'AUDIT-SREP-1B', 'AUDIT-SREP-1C'],
      simNumber: '2348011110004',
    });
    installKit(db, {
      orgId,
      actorUserId: installerId,
      truckId,
      motherDeviceId: kit.motherDeviceId,
      subDeviceIds: kit.subDeviceIds as [string, string, string],
      company: 'mrs',
    });
    const newSubId = createDevice(db, orgId, { type: 'sub', serial: 'AUDIT-SREP-NEW', status: 'available' });

    const { movementLogId } = replaceSubLock(db, {
      orgId,
      actorUserId: installerId,
      truckId,
      motherDeviceId: kit.motherDeviceId,
      slot: 'D',
      newSubDeviceId: newSubId,
      reason: 'operational_swap',
    });

    expect(auditRowsFor(db, movementLogId)).toHaveLength(1);
  });

  it('truck_swap', () => {
    const { db } = createTestDb();
    const { orgId, installerId } = seedBaseFixtures(db);
    const truckA = createTruck(db, orgId, 'FZE090DI');
    const truckB = createTruck(db, orgId, 'FZE091DI');
    const kit = registerKit(db, {
      orgId,
      actorUserId: installerId,
      motherSerial: 'AUDIT-SWAP-1',
      subSerials: ['AUDIT-SWAP-1A', 'AUDIT-SWAP-1B', 'AUDIT-SWAP-1C'],
      simNumber: '2348011110005',
    });
    installKit(db, {
      orgId,
      actorUserId: installerId,
      truckId: truckA,
      motherDeviceId: kit.motherDeviceId,
      subDeviceIds: kit.subDeviceIds as [string, string, string],
      company: 'mrs',
    });

    const { movementLogId } = db.transaction((tx) =>
      resolveTruckSwap(tx, { deviceId: kit.motherDeviceId, toTruckId: truckB, actorUserId: installerId }),
    );

    expect(auditRowsFor(db, movementLogId)).toHaveLength(1);
  });

  it('triage', () => {
    const { db } = createTestDb();
    const { orgId, supervisorId } = seedBaseFixtures(db);
    const deviceId = createDevice(db, orgId, { type: 'mother', serial: 'AUDIT-TRIAGE-1', status: 'repair' });

    const { movementLogId } = applyTriageMovement(db, {
      orgId,
      deviceId,
      actor: { id: supervisorId, orgId, role: 'supervisor' },
      outcome: 'revived',
    });

    expect(auditRowsFor(db, movementLogId)).toHaveLength(1);
  });
});
