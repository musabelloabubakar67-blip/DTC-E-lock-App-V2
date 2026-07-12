// Client-side submit logic for movement/page.tsx. §4/§9: queue-first.
import type { MovementActionFormValues } from '../../../lib/validations/movement';
import { offlineDb, enqueueMutation } from '../../../lib/offline/db';

export type SubmitMovementResult =
  | { status: 'queued'; mutationId: string } // saved on device, pending sync
  | { status: 'error'; message: string };

export async function submitMovement(values: MovementActionFormValues): Promise<SubmitMovementResult> {
  try {
    const mutation = await enqueueMutation(offlineDb, { endpoint: '/api/movements', payload: values });
    return { status: 'queued', mutationId: mutation.id };
  } catch {
    return { status: 'error', message: 'Could not save on this device' };
  }
}
