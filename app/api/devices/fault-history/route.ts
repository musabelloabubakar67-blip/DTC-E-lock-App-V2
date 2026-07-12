// Thin route: session auth → fault.service.ts's recurrence query → JSON (§10, §4 inline history).
// GET /api/devices/fault-history?deviceId=... — surfaced BEFORE the fault form is filled in,
// never an input field (§4 "Recurring fault?" is gone; recurrence is shown, not asked).
import { NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '../../../../lib/auth';
import { db } from '../../../../db';
import { getDeviceFaultHistory } from '../../../../services/fault.service';
import { requireAuthenticated } from '../../../../services/auth.service';
import { AuthzError } from '../../../../lib/errors';

export async function GET(request: Request) {
  const session = await getServerSession(authOptions);

  try {
    requireAuthenticated(
      session?.user ? { id: session.user.id, orgId: session.user.orgId, role: session.user.role } : null,
    );

    const deviceId = new URL(request.url).searchParams.get('deviceId');
    if (!deviceId) {
      return NextResponse.json(
        { error: { code: 'validation_error', message: 'deviceId query param is required' } },
        { status: 400 },
      );
    }

    const history = getDeviceFaultHistory(db, deviceId);
    return NextResponse.json({ data: history });
  } catch (error) {
    if (error instanceof AuthzError) {
      return NextResponse.json({ error: { code: 'unauthorized', message: error.message } }, { status: 401 });
    }
    return NextResponse.json(
      { error: { code: 'internal_error', message: 'Could not load fault history' } },
      { status: 500 },
    );
  }
}
