// Client-side logic for lookup/page.tsx.
export type TrustState = 'verified' | 'stale' | 'unverified';

export type TrustStateResult = {
  state: TrustState;
  latestVerifiedAt: number | null;
  weakestTier: 'qr_scan' | 'photo_attestation' | 'manual' | null;
};

export type LookupCockpitViewModel = {
  target: {
    kind: 'truck' | 'mother_device' | 'unknown';
    id: string | null;
    label: string;
  };
  company: { value: 'mrs' | 'dangote' | null; declared: boolean };
  trust: TrustStateResult;
  kit: {
    mother: { id: string; serial: string } | null;
    subs: Array<{ slot: 'B' | 'C' | 'D'; id: string | null; serial: string | null }>;
    status: 'confirmed' | 'not_confirmed';
  };
  reviews: Array<{
    id: string;
    kind: 'sync_conflict' | 'unlogged_swap' | 'import_conflict';
    status: 'open' | 'resolved' | 'dismissed';
    payload: unknown;
    createdAt: number;
  }>;
  sync: {
    pendingCount: number;
    items: Array<{ id: string; endpoint: string; clientTs: number; status: 'pending' }>;
  };
  audit: Array<{
    id: string;
    createdAt: number;
    actorName: string | null;
    operation: string;
    entityTable: string;
    entityId: string;
    summary: string;
  }>;
};

export async function fetchTrustStateByMother(motherDeviceId: string): Promise<TrustStateResult | null> {
  const response = await fetch(`/api/trust-state?motherDeviceId=${encodeURIComponent(motherDeviceId)}`);
  if (!response.ok) return null;
  const body = await response.json().catch(() => null);
  return body?.data ?? null;
}

export async function fetchLookupCockpit(query: string): Promise<LookupCockpitViewModel | null> {
  const response = await fetch(`/api/lookup-cockpit?query=${encodeURIComponent(query)}`);
  if (!response.ok) return null;
  const body = await response.json().catch(() => null);
  return body?.data ?? null;
}

// §6 "Truck company reassignment (rare, secondary correction path — supervisor only)" — NOT
// the normal way company changes (that's confirmed as a byproduct of every install); this is
// the out-of-band back-office correction.
export type ChangeTruckCompanyResult =
  | { status: 'ok' }
  | { status: 'error'; message: string };

export async function changeTruckCompany(
  truckId: string,
  company: 'mrs' | 'dangote',
): Promise<ChangeTruckCompanyResult> {
  try {
    const response = await fetch(`/api/trucks/${encodeURIComponent(truckId)}/company`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ company }),
    });
    if (!response.ok) {
      const body = await response.json().catch(() => null);
      return { status: 'error', message: body?.error?.message ?? 'Company reassignment failed' };
    }
    return { status: 'ok' };
  } catch {
    return { status: 'error', message: 'Company reassignment failed' };
  }
}
