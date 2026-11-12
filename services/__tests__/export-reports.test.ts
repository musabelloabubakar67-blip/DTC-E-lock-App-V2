import { describe, expect, it } from 'vitest';
import { createTestDb } from '../../tests/helpers/testDb';
import { createTruck, seedBaseFixtures } from '../../tests/helpers/fixtures';
import { buildExport, listExportSummaries } from '../data-management.service';
import { installKit } from '../installation.service';
import { registerKit } from '../registration.service';

function setup() {
  const { db, sqlite } = createTestDb();
  const { orgId, supervisorId, installerId } = seedBaseFixtures(db);
  const truckId = createTruck(db, orgId, 'FZE100DI');
  const kit = registerKit(db, {
    orgId,
    actorUserId: installerId,
    motherSerial: '487068900001',
    subSerials: ['AAAAAAAAAAA1', 'AAAAAAAAAAA2', 'AAAAAAAAAAA3'],
    simNumber: '2348000000000',
  });
  installKit(db, {
    orgId,
    actorUserId: installerId,
    truckId,
    motherDeviceId: kit.motherDeviceId,
    subDeviceIds: kit.subDeviceIds as [string, string, string],
    company: 'mrs',
  });
  return {
    sqlite,
    actor: { id: supervisorId, orgId, role: 'supervisor' as const },
    installer: { id: installerId, orgId, role: 'installer' as const },
  };
}

describe('readable export reports', () => {
  it('lists reports before raw tables', () => {
    const { sqlite, actor } = setup();
    const summaries = listExportSummaries(sqlite, actor);
    expect(summaries[0]).toMatchObject({ key: 'fleet_status', kind: 'report', rowCount: 1 });
    expect(summaries.some((item) => item.kind === 'raw')).toBe(true);
  });

  it('builds fleet status with serials, plate and company instead of ids', () => {
    const { sqlite, actor } = setup();
    const { body } = buildExport(sqlite, actor, { dataset: 'fleet_status', format: 'json' });
    const [row] = JSON.parse(body);
    expect(row).toMatchObject({
      Truck: 'FZE100DI',
      Company: 'MRS',
      'Mother lock': '487068900001',
      'Sub-lock B': 'AAAAAAAAAAA1',
      'Sub-lock C': 'AAAAAAAAAAA2',
      'Sub-lock D': 'AAAAAAAAAAA3',
      'Kit status': 'Complete',
    });
    expect(row['Kit on truck since']).toMatch(/^\d{4}-\d{2}-\d{2}$/);
  });

  it('runs every report and keeps mother serials intact for Excel', () => {
    const { sqlite, actor } = setup();
    for (const key of ['fleet_status', 'installations', 'installations_today', 'installations_yesterday', 'movements', 'device_inventory', 'registrations', 'available_mothers', 'faults']) {
      expect(() => buildExport(sqlite, actor, { dataset: key, format: 'csv' })).not.toThrow();
    }
    const { body } = buildExport(sqlite, actor, { dataset: 'installations', format: 'csv' });
    expect(body).toContain('="487068900001"');
    expect(body).toContain('FZE100DI');
  });

  it('splits installations into Lagos today and yesterday', () => {
    const { sqlite, actor } = setup();
    const rowsOf = (dataset: string) => JSON.parse(buildExport(sqlite, actor, { dataset, format: 'json' }).body);
    const count = (key: string) => listExportSummaries(sqlite, actor).find((item) => item.key === key)!.rowCount;

    // The setup install was logged just now.
    expect(rowsOf('installations_today')).toHaveLength(1);
    expect(rowsOf('installations_yesterday')).toHaveLength(0);
    expect(count('installations_today')).toBe(1);

    // Move it to noon yesterday, Lagos time.
    const lagosToday = new Date(Date.now() + 3600_000).toISOString().slice(0, 10);
    const noonYesterdayLagos = Date.parse(`${lagosToday}T12:00:00+01:00`) / 1000 - 86400;
    sqlite.prepare('update installation_logs set logged_date = ?').run(noonYesterdayLagos);

    expect(rowsOf('installations_today')).toHaveLength(0);
    const [row] = rowsOf('installations_yesterday');
    expect(row).toMatchObject({ Truck: 'FZE100DI', 'Mother lock': '487068900001' });
    expect(count('installations_yesterday')).toBe(1);
    expect(rowsOf('installations')).toHaveLength(1);

    const yesterday = new Date(Date.now() + 3600_000 - 86400_000).toISOString().slice(0, 10);
    expect(buildExport(sqlite, actor, { dataset: 'installations_yesterday', format: 'csv' }).filename)
      .toBe(`dtc-installations-yesterday-${yesterday}.csv`);
  });

  it('gives installers only the daily installation reports', () => {
    const { sqlite, installer } = setup();
    expect(listExportSummaries(sqlite, installer).map((item) => item.key))
      .toEqual(['installations_today', 'installations_yesterday']);

    const [row] = JSON.parse(buildExport(sqlite, installer, { dataset: 'installations_today', format: 'json' }).body);
    expect(row).toMatchObject({ Truck: 'FZE100DI' });
    expect(() => buildExport(sqlite, installer, { dataset: 'installations_yesterday', format: 'csv' })).not.toThrow();

    for (const key of ['installations', 'fleet_status', 'devices']) {
      expect(() => buildExport(sqlite, installer, { dataset: key, format: 'csv' })).toThrow('Supervisor role required');
    }
  });
});
