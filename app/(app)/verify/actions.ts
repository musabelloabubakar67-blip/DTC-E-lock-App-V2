// Client-side logic for verify/page.tsx. §4/§9: queue-first like every mutating action except
// registration. §3: verification is a byproduct of work, prompted on any truck interaction —
// this is the first place in the app that can actually trigger recordKitVerification.
import type { RecordKitVerificationFormValues } from '../../../lib/validations/verification';
import { offlineDb, enqueueMutation } from '../../../lib/offline/db';

export type SubmitVerificationResult =
  | { status: 'queued'; mutationId: string } // saved on device, pending sync
  | { status: 'error'; message: string };

export async function submitVerification(
  values: RecordKitVerificationFormValues,
): Promise<SubmitVerificationResult> {
  try {
    const mutation = await enqueueMutation(offlineDb, { endpoint: '/api/verifications', payload: values });
    return { status: 'queued', mutationId: mutation.id };
  } catch {
    return { status: 'error', message: 'Could not save on this device' };
  }
}
