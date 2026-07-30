import 'fake-indexeddb/auto';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { offlineDb } from '../../../../lib/offline/db';
import { submitInstallationBySerials } from '../actions';

describe('install actions', () => {
  afterEach(async () => {
    vi.unstubAllGlobals();
    await offlineDb.mutations.clear();
  });

  it('queues a new or changed assignment through the serial-based install endpoint', async () => {
    const fetchSpy = vi.fn();
    vi.stubGlobal('fetch', fetchSpy);

    const result = await submitInstallationBySerials({
      truckPlate: 'NEW101AA',
      company: 'mrs',
      motherSerial: '487068973097',
      subSerials: ['E0817BE15DA8', 'FA7951A73B03', 'D2611F865C82'],
      checklist: {
        deviceResponsive: 'yes',
        sublocksResponsive: 'yes',
        configConfirmed: 'yes',
        overallStatus: 'successful',
      },
    });

    expect(result.status).toBe('queued');
    if (result.status !== 'queued') return;

    const mutation = await offlineDb.mutations.get(result.mutationId);
    expect(mutation?.endpoint).toBe('/api/mobile/installations');
    expect(mutation?.payload).toMatchObject({
      truckPlate: 'NEW101AA',
      installMode: 'changed',
      motherSerial: '487068973097',
    });
    expect(fetchSpy).not.toHaveBeenCalled();
  });
});
