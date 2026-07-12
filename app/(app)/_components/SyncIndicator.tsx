'use client';

// PERMANENT sync indicator (§4 point 5) — unchanged logic from prior sessions, styling only.
// Never a toast, never conditional on pendingCount > 0. Also owns the sync-engine bootstrap
// effect (moved here from layout.tsx verbatim — same lifecycle, this is just where the client
// boundary now lives since the layout itself is a server component).
import { useEffect } from 'react';
import { useSyncStatus, formatSyncStatusText } from '../../../lib/offline/use-sync-status';
import { startSyncEngine } from '../../../lib/offline/sync-engine';
import { offlineDb } from '../../../lib/offline/db';

export default function SyncIndicator() {
  const status = useSyncStatus();

  useEffect(() => {
    return startSyncEngine(offlineDb);
  }, []);

  return (
    <div className="sync-indicator" data-testid="sync-indicator" data-pending={status.pendingCount > 0}>
      {formatSyncStatusText(status)}
    </div>
  );
}
