// Thin route: session auth → verification.service.ts's getTrustState → JSON (§10, §3).
// GET /api/trust-state?motherDeviceId=... or ?truckId=...
import { NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '../../../lib/auth';
import { db } from '../../../db';
import { getTrustState } from '../../../services/verification.service';
import { requireAuthenticated } from '../../../services/auth.service';
import { AuthzError, BusinessError } from '../../../lib/errors';

export async function GET(request: Request) {
  const session = await getServerSession(authOptions);

  try {
    requireAuthenticated(
      session?.user ? { id: session.user.id, orgId: session.user.orgId, role: session.user.role } : null,
    );

    const params = new URL(request.url).searchParams;
    const motherDeviceId = params.get('motherDeviceId');
    const truckId = params.get('truckId');

    if (!motherDeviceId && !truckId) {
      return NextResponse.json(
        { error: { code: 'validation_error', message: 'motherDeviceId or truckId query param is required' } },
        { status: 400 },
      );
    }

    const trustState = motherDeviceId ? getTrustState(db, { motherDeviceId }) : getTrustState(db, { truckId: truckId! });

    return NextResponse.json({ data: trustState });
  } catch (error) {
    if (error instanceof AuthzError) {
      return NextResponse.json({ error: { code: 'unauthorized', message: error.message } }, { status: 401 });
    }
    if (error instanceof BusinessError) {
      return NextResponse.json({ error: { code: 'business_error', message: error.message } }, { status: 409 });
    }
    return NextResponse.json(
      { error: { code: 'internal_error', message: 'Could not load trust state' } },
      { status: 500 },
    );
  }
}
