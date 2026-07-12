// Client-side logic for triage/page.tsx.
// §4/§9: triage is queue-first like every mutating action except registration. One
// consequence, honestly faced rather than hidden: the repair-pool GET below still reads the
// live server state directly (the offline registry snapshot cache, §4 point 4, isn't built
// this session) — so a queued-but-not-yet-synced triage action won't be reflected by a server
// refetch until pass two wires /api/sync to actually dispatch mutations. The page compensates
// with a client-side "pending" filter rather than pretending a GET proves the action landed.
import { offlineDb, enqueueMutation } from '../../../lib/offline/db';

export type RepairPoolItem = {
  deviceId: string;
  serial: string;
  deviceType: 'mother' | 'sub';
  enteredRepairAt: number | null;
  removalReason: string | null;
  removalNotes: string | null;
};

export async function fetchRepairPool(): Promise<RepairPoolItem[]> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 2500);

  try {
    const response = await fetch('/api/triage', { signal: controller.signal });
    if (!response.ok) return [];
    const body = await response.json().catch(() => null);
    return body?.data ?? [];
  } catch {
    return [];
  } finally {
    clearTimeout(timeout);
  }
}

export type SubmitTriageResult =
  | { status: 'queued'; mutationId: string } // saved on device, pending sync
  | { status: 'error'; message: string };

export async function submitTriage(deviceId: string, outcome: 'revived' | 'dead'): Promise<SubmitTriageResult> {
  try {
    const mutation = await enqueueMutation(offlineDb, {
      endpoint: '/api/triage',
      payload: { deviceId, outcome },
    });
    return { status: 'queued', mutationId: mutation.id };
  } catch {
    return { status: 'error', message: 'Could not save on this device' };
  }
}
