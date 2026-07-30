// Client-side logic for fault/page.tsx: load fault history + supervisor list, submit the form.
// §4/§9: Fault is queue-first (NOT registration, which stays online-only). The local Dexie
// write happens BEFORE any network call, and the result the caller gets back reflects only
// that local write — it must never claim "saved"/"logged" as if the server has it.
import type { CreateFaultReportFormValues } from '../../../lib/validations/fault';
import type { RepairBatchFormValues } from '../../../lib/validations/repair';
import { offlineDb, enqueueMutation } from '../../../lib/offline/db';

export type FaultHistorySummary = { count: number; mostRecentAt: number | null };

export async function fetchFaultHistory(deviceId: string): Promise<FaultHistorySummary | null> {
  const response = await fetch(`/api/devices/fault-history?deviceId=${encodeURIComponent(deviceId)}`);
  if (!response.ok) return null;
  const body = await response.json().catch(() => null);
  return body?.data ?? null;
}

export type Supervisor = { id: string; displayName: string };

export async function fetchSupervisors(): Promise<Supervisor[]> {
  const response = await fetch('/api/users/supervisors');
  if (!response.ok) return [];
  const body = await response.json().catch(() => null);
  return body?.data ?? [];
}

export type SubmitFaultReportResult =
  | { status: 'queued'; mutationId: string } // saved on device, pending sync — NOT "saved"/"logged"
  | { status: 'error'; message: string };

/**
 * Local-first write (§4 point 1): writes the full mutation to the Dexie queue and returns
 * immediately. No fetch happens here at all — the sync engine pushes it later. A failure here
 * means the LOCAL write itself failed (rare — e.g. IndexedDB unavailable), which is the one
 * case that's still a genuine, loud error; anything past that point is "queued," never "done."
 */
export async function submitFaultReport(
  values: CreateFaultReportFormValues,
): Promise<SubmitFaultReportResult> {
  try {
    const mutation = await enqueueMutation(offlineDb, { endpoint: '/api/faults', payload: values });
    return { status: 'queued', mutationId: mutation.id };
  } catch {
    return { status: 'error', message: 'Could not save on this device' };
  }
}

export type RepairTruckKit = {
  truckId: string;
  plate: string;
  mother: { id: string; serial: string } | null;
  subs: Array<{ slot: 'B' | 'C' | 'D'; id: string | null; serial: string | null }>;
};

export async function fetchRepairTruck(truck: string): Promise<RepairTruckKit | null> {
  const response = await fetch(`/api/lookup-cockpit?query=${encodeURIComponent(truck)}`);
  if (!response.ok) return null;
  const body = await response.json().catch(() => null);
  const data = body?.data;
  if (data?.target?.kind !== 'truck' || !data.target.id) return null;
  return {
    truckId: data.target.id,
    plate: data.target.label,
    mother: data.kit?.mother?.id
      ? { id: data.kit.mother.id, serial: data.kit.mother.serial }
      : null,
    subs: Array.isArray(data.kit?.subs)
      ? data.kit.subs.map((item: { slot: 'B' | 'C' | 'D'; id?: string | null; serial?: string | null }) => ({
          slot: item.slot,
          id: item.id ?? null,
          serial: item.serial ?? null,
        }))
      : [],
  };
}

export type SubmitRepairResult =
  | { status: 'queued'; mutationId: string }
  | { status: 'error'; message: string };

export async function submitRepairBatch(values: RepairBatchFormValues): Promise<SubmitRepairResult> {
  try {
    const mutation = await enqueueMutation(offlineDb, { endpoint: '/api/repairs', payload: values });
    return { status: 'queued', mutationId: mutation.id };
  } catch {
    return { status: 'error', message: 'Could not save the repair operation on this device' };
  }
}
