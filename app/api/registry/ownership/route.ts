import { NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '../../../../lib/auth';
import { db } from '../../../../db';
import { AuthzError, BusinessError } from '../../../../lib/errors';
import { requireAuthenticated } from '../../../../services/auth.service';
import { setRegistrationsOwnership } from '../../../../services/registration.service';

export async function POST(request: Request) {
  const session = await getServerSession(authOptions);

  try {
    const actor = requireAuthenticated(
      session?.user ? { id: session.user.id, orgId: session.user.orgId, role: session.user.role } : null,
    );
    const body = await request.json();
    const registrationId = typeof body?.registrationId === 'string' ? body.registrationId : '';
    const registrationIds = Array.isArray(body?.registrationIds)
      ? body.registrationIds.filter((id: unknown): id is string => typeof id === 'string')
      : [];
    const requestedRegistrationIds = registrationIds.length > 0 ? registrationIds : registrationId ? [registrationId] : [];
    const ownershipStatus = body?.ownershipStatus;
    const notes = typeof body?.notes === 'string' ? body.notes : undefined;
    if (requestedRegistrationIds.length === 0 || (ownershipStatus !== 'owned' && ownershipStatus !== 'released_external')) {
      return NextResponse.json(
        { error: { code: 'validation_error', message: 'registrationId or registrationIds and ownershipStatus are required' } },
        { status: 400 },
      );
    }

    const result = setRegistrationsOwnership(db, { registrationIds: requestedRegistrationIds, actor, ownershipStatus, notes });
    return NextResponse.json({ data: result });
  } catch (error) {
    if (error instanceof AuthzError) {
      return NextResponse.json({ error: { code: 'unauthorized', message: error.message } }, { status: 401 });
    }
    if (error instanceof BusinessError) {
      return NextResponse.json({ error: { code: 'business_error', message: error.message } }, { status: 409 });
    }
    return NextResponse.json({ error: { code: 'internal_error', message: 'Could not update kit ownership' } }, { status: 500 });
  }
}
