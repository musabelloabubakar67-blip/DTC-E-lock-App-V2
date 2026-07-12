import { describe, it, expect, vi, afterEach } from 'vitest';
import { submitRegistrationKit } from '../actions';

const validValues = {
  motherSerial: '123456789012',
  subSerials: ['AAAAAAAAAAAA', 'BBBBBBBBBBBB', 'CCCCCCCCCCCC'] as [string, string, string],
  simNumber: '2348012345678',
};

describe('register/actions — submitRegistrationKit (§9 failure must be loud)', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('a failed write (non-2xx response) never reports success', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({
        ok: false,
        status: 409,
        json: async () => ({ error: { code: 'business_error', message: 'Serial already registered' } }),
      }),
    );

    const result = await submitRegistrationKit(validValues);

    expect(result.status).toBe('error');
    if (result.status === 'error') {
      expect(result.message).toBe('Serial already registered');
    }
  });

  it('a network failure (fetch throws) never reports success', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockRejectedValue(new Error('network down')),
    );

    const result = await submitRegistrationKit(validValues);

    expect(result.status).toBe('error');
  });

  it('a 2xx response carrying an error body never reports success (checked by body shape, not HTTP status alone)', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({
        ok: true,
        status: 200,
        json: async () => ({ error: { code: 'business_error', message: 'Serial already registered' } }),
      }),
    );

    const result = await submitRegistrationKit(validValues);

    expect(result.status).toBe('error');
    if (result.status === 'error') {
      expect(result.message).toBe('Serial already registered');
    }
  });

  it('a genuinely successful write does report success (control case)', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({
        ok: true,
        status: 201,
        json: async () => ({
          data: { motherDeviceId: 'm1', subDeviceIds: ['s1', 's2', 's3'], registrationLogId: 'r1' },
        }),
      }),
    );

    const result = await submitRegistrationKit(validValues);
    expect(result.status).toBe('success');
  });

  it('registration goes straight to the server, NOT through the offline queue (§9 — the one online-only form)', async () => {
    // Unlike fault/install/movement/triage, registration must actually call fetch — a network
    // failure has to be a real, visible failure, not something a queue silently absorbs.
    const fetchSpy = vi.fn().mockRejectedValue(new Error('network down'));
    vi.stubGlobal('fetch', fetchSpy);

    const result = await submitRegistrationKit(validValues);

    expect(fetchSpy).toHaveBeenCalledTimes(1);
    expect(fetchSpy).toHaveBeenCalledWith('/api/registrations', expect.objectContaining({ method: 'POST' }));
    expect(result.status).toBe('error'); // loud failure — never silently queued as "saved"
  });
});
