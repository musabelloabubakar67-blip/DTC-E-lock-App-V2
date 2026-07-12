import 'fake-indexeddb/auto';
import { describe, it, expect, vi, afterEach } from 'vitest';
import { submitFaultReport } from '../actions';

describe('fault/actions — submitFaultReport is queue-first (§4/§9)', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('returns "queued", never "success"/"saved"/"done" — and never calls fetch at all', async () => {
    const fetchSpy = vi.fn();
    vi.stubGlobal('fetch', fetchSpy);

    const result = await submitFaultReport({
      truckId: 't1',
      deviceId: 'd1',
      locksAffected: ['B'],
      description: 'sub-lock not opening',
    });

    expect(result.status).toBe('queued');
    if (result.status === 'queued') {
      expect(result.mutationId).toBeTruthy();
    }
    // The whole point of local-first: no network call happens at submit time at all.
    expect(fetchSpy).not.toHaveBeenCalled();
  });
});
