// Thin route: session auth → Zod validate → verification.service.ts → JSON (§10, §7 layer
// contract). actor_user_id always comes from the session — never taken from the request body.
// POST /api/verifications: kit scan / manual entry (§3). Match appends a verifications row;
// mismatch runs the full correct → conflict_review flow — recordKitVerification does both,
// this route never branches on the outcome itself.
import { NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '../../../lib/auth';
import { db } from '../../../db';
import { recordKitVerificationSchema } from '../../../lib/validations/verification';
import { recordKitVerification } from '../../../services/verification.service';
import { requireAuthenticated } from '../../../services/auth.service';
import { BusinessError, AuthzError } from '../../../lib/errors';

export async function POST(request: Request) {
  const session = await getServerSession(authOptions);

  try {
    const user = requireAuthenticated(
      session?.user ? { id: session.user.id, orgId: session.user.orgId, role: session.user.role } : null,
    );

    const body = await request.json();
    const parsed = recordKitVerificationSchema.safeParse(body);
    if (!parsed.success) {
      return NextResponse.json(
        { error: { code: 'validation_error', message: parsed.error.message } },
        { status: 400 },
      );
    }

    const result = recordKitVerification(db, {
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
    return NextResponse.json({ error: { code: 'internal_error', message: 'Verification failed' } }, { status: 500 });
  }
}
