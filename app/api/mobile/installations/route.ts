import { NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '../../../../lib/auth';
import { db } from '../../../../db';
import { BusinessError, AuthzError } from '../../../../lib/errors';
import { requireAuthenticated } from '../../../../services/auth.service';
import { nativeInstallSchema, recordNativeInstallation } from '../../../../services/native-workflow.service';

export async function POST(request: Request) {
  const session = await getServerSession(authOptions);

  try {
    const user = requireAuthenticated(
      session?.user ? { id: session.user.id, orgId: session.user.orgId, role: session.user.role } : null,
    );
    const parsed = nativeInstallSchema.safeParse(await request.json());
    if (!parsed.success) {
      return NextResponse.json(
        { error: { code: 'validation_error', message: parsed.error.issues[0]?.message ?? 'Invalid installation' } },
        { status: 400 },
      );
    }

    const result = recordNativeInstallation(db, { orgId: user.orgId, actorUserId: user.id, payload: parsed.data });

    return NextResponse.json({ data: result }, { status: 201 });
  } catch (error) {
    if (error instanceof AuthzError) {
      return NextResponse.json({ error: { code: 'unauthorized', message: error.message } }, { status: 401 });
    }
    if (error instanceof BusinessError) {
      return NextResponse.json({ error: { code: 'business_error', message: error.message } }, { status: 409 });
    }
    return NextResponse.json(
      { error: { code: 'internal_error', message: 'Installation failed' } },
      { status: 500 },
    );
  }
}
