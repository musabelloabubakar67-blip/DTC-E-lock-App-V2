// Client-side submit logic for register/page.tsx, extracted so failure-handling is testable
// without rendering the DOM. §9: online-only, no offline queue; failure must be LOUD — a
// failed write must never report success.
import type { RegisterKitFormValues } from '../../../lib/validations/registration';

export type SubmitRegistrationResult =
  | { status: 'success'; data: { motherDeviceId: string; subDeviceIds: string[]; registrationLogId: string } }
  | { status: 'error'; message: string };

export async function submitRegistrationKit(
  values: RegisterKitFormValues,
): Promise<SubmitRegistrationResult> {
  try {
    const response = await fetch('/api/registrations', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(values),
    });

    const body = await response.json().catch(() => null);

    if (!response.ok || !body?.data) {
      return {
        status: 'error',
        message: body?.error?.message ?? `Registration failed (HTTP ${response.status})`,
      };
    }

    return { status: 'success', data: body.data };
  } catch {
    // Network error / server unreachable — still loud, never silently "registered".
    return { status: 'error', message: 'Registration failed: could not reach server' };
  }
}
