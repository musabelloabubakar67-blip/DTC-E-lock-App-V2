import { describe, it, expect } from 'vitest';
import { formatSyncStatusText } from '../use-sync-status';

describe('formatSyncStatusText — the permanent sync indicator text (§4 point 5)', () => {
  it('a locally-saved-but-unsynced write reads "pending", never "saved"/"done"/"success"', () => {
    const text = formatSyncStatusText({ pendingCount: 1, lastSyncedAt: null });

    expect(text).toContain('pending');
    expect(text.toLowerCase()).not.toContain('saved');
    expect(text.toLowerCase()).not.toContain('done');
    expect(text.toLowerCase()).not.toContain('success');
  });

  it('shows "N pending · last synced X min ago" once a sync has happened', () => {
    const tenMinutesAgo = Date.now() - 10 * 60 * 1000;
    const text = formatSyncStatusText({ pendingCount: 3, lastSyncedAt: tenMinutesAgo });

    expect(text).toContain('3 pending');
    expect(text).toContain('10 min ago');
  });

  it('never synced reads honestly as "never", not a fabricated time', () => {
    const text = formatSyncStatusText({ pendingCount: 0, lastSyncedAt: null });
    expect(text).toContain('never synced');
  });
});
