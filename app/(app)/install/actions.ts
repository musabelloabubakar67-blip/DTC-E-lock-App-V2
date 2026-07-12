// Client-side submit logic for install/page.tsx.
// §4/§9: queue-first (installation is NOT the online-only form — that's registration only).
import type { InstallKitFormValues } from '../../../lib/validations/installation';
import { offlineDb, enqueueMutation } from '../../../lib/offline/db';

export type SubmitInstallationResult =
  | { status: 'queued'; mutationId: string } // saved on device, pending sync
  | { status: 'error'; message: string };

export async function submitInstallation(
  values: InstallKitFormValues,
): Promise<SubmitInstallationResult> {
  try {
    const mutation = await enqueueMutation(offlineDb, { endpoint: '/api/installations', payload: values });
    return { status: 'queued', mutationId: mutation.id };
  } catch {
    return { status: 'error', message: 'Could not save on this device' };
  }
}
