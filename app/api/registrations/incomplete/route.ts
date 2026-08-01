import { NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '../../../../lib/auth';
import { db } from '../../../../db';
import { registerIncompleteKitSchema } from '../../../../lib/validations/registration';
import { AuthzError, BusinessError } from '../../../../lib/errors';
import { requireAuthenticated } from '../../../../services/auth.service';
import { registerIncompleteKit } from '../../../../services/registration.service';

export async function POST(request: Request) {
  const session = await getServerSession(authOptions);

  try {
    const actor = requireAuthenticated(
      session?.user ? { id: session.user.id, orgId: session.user.orgId, role: session.user.role } : null,
    );
    const parsed = registerIncompleteKitSchema.safeParse(await request.json());
    if (!parsed.success) {
      return NextResponse.json(
        { error: { code: 'validation_error', message: parsed.error.issues[0]?.message ?? 'Invalid registration' } },
        { status: 400 },
      );
    }

    const result = registerIncompleteKit(db, { actor, ...parsed.data });
    return NextResponse.json({ data: result }, { status: 201 });
  } catch (error) {
    if (error instanceof AuthzError) {
      return NextResponse.json({ error: { code: 'unauthorized', message: error.message } }, { status: 401 });
    }
    if (error instanceof BusinessError) {
      return NextResponse.json({ error: { code: 'business_error', message: error.message } }, { status: 409 });
    }
    return NextResponse.json(
      { error: { code: 'internal_error', message: 'Incomplete registration failed' } },
      { status: 500 },
    );
  }
}
