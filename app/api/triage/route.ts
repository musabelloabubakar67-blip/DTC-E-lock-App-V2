// Thin route: session auth → movement.service.ts → JSON (§10 POST /api/triage — supervisor).
// Role is enforced in the service layer (applyTriage → requireSupervisor); this route mirrors
// it only for a fast 401, never as the source of truth.
import { NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '../../../lib/auth';
import { db } from '../../../db';
import { listRepairPool } from '../../../services/lookup.service';
import { applyTriageMovement } from '../../../services/movement.service';
import { requireAuthenticated } from '../../../services/auth.service';
import { BusinessError, AuthzError } from '../../../lib/errors';

export async function GET() {
  const session = await getServerSession(authOptions);
  try {
    const user = requireAuthenticated(
      session?.user ? { id: session.user.id, orgId: session.user.orgId, role: session.user.role } : null,
    );
    return NextResponse.json({ data: listRepairPool(db, user.orgId) });
  } catch (error) {
    if (error instanceof AuthzError) {
      return NextResponse.json({ error: { code: 'unauthorized', message: error.message } }, { status: 401 });
    }
    return NextResponse.json({ error: { code: 'internal_error', message: 'Could not load repair pool' } }, { status: 500 });
  }
}

export async function POST(request: Request) {
  const session = await getServerSession(authOptions);
  try {
    const user = requireAuthenticated(
      session?.user ? { id: session.user.id, orgId: session.user.orgId, role: session.user.role } : null,
    );

    const body = await request.json();
    const { deviceId, outcome } = body ?? {};
    if (!deviceId || (outcome !== 'revived' && outcome !== 'dead')) {
      return NextResponse.json(
        { error: { code: 'validation_error', message: 'deviceId and outcome ("revived"|"dead") are required' } },
        { status: 400 },
      );
    }

    const result = applyTriageMovement(db, { orgId: user.orgId, deviceId, actor: user, outcome });
    return NextResponse.json({ data: result }, { status: 201 });
  } catch (error) {
    if (error instanceof AuthzError) {
      return NextResponse.json({ error: { code: 'unauthorized', message: error.message } }, { status: 401 });
    }
    if (error instanceof BusinessError) {
      return NextResponse.json({ error: { code: 'business_error', message: error.message } }, { status: 409 });
    }
    return NextResponse.json({ error: { code: 'internal_error', message: 'Triage failed' } }, { status: 500 });
  }
}
