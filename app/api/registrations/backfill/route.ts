// Supervisor-only: writes a registration record onto a mother that already has a devices row
// but was never actually registered (a bare import artifact) — see
// registration.service.ts's backfillRegistrationForExistingDevice.
import { NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '../../../../lib/auth';
import { db } from '../../../../db';
import { backfillRegistrationSchema } from '../../../../lib/validations/registration';
import { AuthzError, BusinessError } from '../../../../lib/errors';
import { requireSupervisor } from '../../../../services/auth.service';
import { backfillRegistrationForExistingDevice } from '../../../../services/registration.service';

export async function POST(request: Request) {
  const session = await getServerSession(authOptions);

  try {
    const actor = requireSupervisor(
      session?.user ? { id: session.user.id, orgId: session.user.orgId, role: session.user.role } : null,
    );
    const parsed = backfillRegistrationSchema.safeParse(await request.json());
    if (!parsed.success) {
      return NextResponse.json(
        { error: { code: 'validation_error', message: parsed.error.issues[0]?.message ?? 'Invalid registration' } },
        { status: 400 },
      );
    }

    const result = backfillRegistrationForExistingDevice(db, { actor, ...parsed.data });
    return NextResponse.json({ data: result }, { status: 201 });
  } catch (error) {
    if (error instanceof AuthzError) {
      return NextResponse.json({ error: { code: 'unauthorized', message: error.message } }, { status: 401 });
    }
    if (error instanceof BusinessError) {
      return NextResponse.json({ error: { code: 'business_error', message: error.message } }, { status: 409 });
    }
    return NextResponse.json(
      { error: { code: 'internal_error', message: 'Registration backfill failed' } },
      { status: 500 },
    );
  }
}
