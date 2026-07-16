// Client-side logic for verify/page.tsx. Online-first so a kit verification can immediately
// settle matching review items; if the device is offline, fall back to the local mutation queue.
import type { RecordKitVerificationFormValues } from '../../../lib/validations/verification';
import { offlineDb, enqueueMutation } from '../../../lib/offline/db';

export type SubmitVerificationResult =
  | { status: 'applied'; matched: boolean }
  | { status: 'queued'; mutationId: string } // saved on device, pending sync
  | { status: 'error'; message: string };

export async function submitVerification(
  values: RecordKitVerificationFormValues,
): Promise<SubmitVerificationResult> {
  try {
    const response = await fetch('/api/verifications', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(values),
    });
    const body = await response.json().catch(() => null);
    if (response.ok && body?.data) {
      return { status: 'applied', matched: Boolean(body.data.matched) };
    }
    if (response.status >= 400 && response.status < 500) {
      return { status: 'error', message: body?.error?.message ?? `Verification failed (HTTP ${response.status})` };
    }
  } catch {
    // Offline or unreachable: queue below.
  }

  try {
    const mutation = await enqueueMutation(offlineDb, { endpoint: '/api/verifications', payload: values });
    return { status: 'queued', mutationId: mutation.id };
  } catch {
    return { status: 'error', message: 'Could not save on this device' };
  }
}
