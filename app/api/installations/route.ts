// Thin route: session auth → Zod validate → installation.service.ts → JSON (§10, §7 layer contract).
// actor_user_id always comes from the session — any client-supplied actor field is ignored/stripped.
import { NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '../../../lib/auth';
import { db } from '../../../db';
import { installKitSchema } from '../../../lib/validations/installation';
import { listInstallationHistory, recordInstallation } from '../../../services/installation.service';
import { requireAuthenticated } from '../../../services/auth.service';
import { BusinessError, AuthzError } from '../../../lib/errors';

export async function GET() {
  const session = await getServerSession(authOptions);

  try {
    const user = requireAuthenticated(
      session?.user ? { id: session.user.id, orgId: session.user.orgId, role: session.user.role } : null,
    );

    return NextResponse.json({ data: listInstallationHistory(db, user.orgId) });
  } catch (error) {
    if (error instanceof AuthzError) {
      return NextResponse.json({ error: { code: 'unauthorized', message: error.message } }, { status: 401 });
    }
    return NextResponse.json(
      { error: { code: 'internal_error', message: 'Could not load installation history' } },
      { status: 500 },
    );
  }
}

export async function POST(request: Request) {
  const session = await getServerSession(authOptions);

  try {
    const user = requireAuthenticated(
      session?.user ? { id: session.user.id, orgId: session.user.orgId, role: session.user.role } : null,
    );

    const body = await request.json();
    const parsed = installKitSchema.safeParse(body);
    if (!parsed.success) {
      return NextResponse.json(
        { error: { code: 'validation_error', message: parsed.error.message } },
        { status: 400 },
      );
    }

    const result = recordInstallation(db, {
      orgId: user.orgId,
      actorUserId: user.id, // never taken from the request body
      ...parsed.data,
    });

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
