// §4 Offline & sync, point 5: "Permanent sync indicator... N pending · last synced X min ago.
// The single most important UI element. Never a toast." formatSyncStatusText is a pure
// function (testable without rendering React) — the component just calls it.
'use client';

import { useEffect, useState } from 'react';
import { offlineDb } from './db';

export type SyncStatus = {
  pendingCount: number;
  lastSyncedAt: number | null;
};

export function formatSyncStatusText(status: SyncStatus): string {
  const pendingPart = `${status.pendingCount} pending`;
  if (status.lastSyncedAt === null) {
    return `${pendingPart} · never synced`;
  }
  const minutesAgo = Math.floor((Date.now() - status.lastSyncedAt) / 60000);
  const syncedPart = minutesAgo <= 0 ? 'last synced just now' : `last synced ${minutesAgo} min ago`;
  return `${pendingPart} · ${syncedPart}`;
}

export function useSyncStatus(pollMs = 3000): SyncStatus {
  const [status, setStatus] = useState<SyncStatus>({ pendingCount: 0, lastSyncedAt: null });

  useEffect(() => {
    let cancelled = false;

    async function refresh() {
      const [pendingCount, meta] = await Promise.all([
        offlineDb.mutations.count(),
        offlineDb.meta.get('lastSyncedAt'),
      ]);
      if (!cancelled) {
        setStatus({ pendingCount, lastSyncedAt: meta?.value ?? null });
      }
    }

    void refresh();
    const interval = setInterval(refresh, pollMs);
    return () => {
      cancelled = true;
      clearInterval(interval);
    };
  }, [pollMs]);

  return status;
}

/**
 * Real browser connectivity state (navigator.onLine + the online/offline events) — NOT
 * derived from sync status. A device can be online with a full queue, or offline with an
 * empty one; conflating the two is exactly the kind of dishonest status this app exists to
 * avoid. Defaults to `true` on the server/before mount so SSR doesn't flash "offline".
 */
export function useOnlineStatus(): boolean {
  const [online, setOnline] = useState(true);

  useEffect(() => {
    setOnline(navigator.onLine);
    const handleOnline = () => setOnline(true);
    const handleOffline = () => setOnline(false);
    window.addEventListener('online', handleOnline);
    window.addEventListener('offline', handleOffline);
    return () => {
      window.removeEventListener('online', handleOnline);
      window.removeEventListener('offline', handleOffline);
    };
  }, []);

  return online;
}
