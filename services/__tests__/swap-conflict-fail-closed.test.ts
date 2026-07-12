import { describe, it, expect } from 'vitest';
import { assertConflictProceeds, type ConflictCheckResult } from '../movement.service';
import { BusinessError } from '../../lib/errors';

// Simulates a conflict action outside ConflictCheckResult's current union — the scenario a
// fail-open if-chain would silently let through. All three real call sites (installKit,
// replaceMotherLock, assignMotherToTruck) route through this single shared guard, so proving
// the guard itself is fail-closed proves all of them are, without needing to reach into each
// call site's internals (which same-module vi.spyOn can't do — self-calls within
// movement.service.ts bypass the exported binding entirely).
const UNKNOWN_CONFLICT_RESULT = { action: 'some_future_action_nobody_handles' } as unknown as ConflictCheckResult;

describe('assertConflictProceeds fails closed', () => {
  it('proceeds silently on the explicit "proceed" action', () => {
    expect(() => assertConflictProceeds({ action: 'proceed' }, 'test')).not.toThrow();
  });

  it('throws on "reject"', () => {
    expect(() =>
      assertConflictProceeds({ action: 'reject', code: 'device_not_usable', message: 'nope' }, 'test'),
    ).toThrow(BusinessError);
  });

  it('throws on "blocked"', () => {
    expect(() =>
      assertConflictProceeds({ action: 'blocked', code: 'in_service_elsewhere', currentTruckId: 't1' }, 'test'),
    ).toThrow(BusinessError);
  });

  it('throws on an action outside the known union, rather than silently proceeding', () => {
    expect(() => assertConflictProceeds(UNKNOWN_CONFLICT_RESULT, 'test')).toThrow(/Unhandled case/);
  });
});
