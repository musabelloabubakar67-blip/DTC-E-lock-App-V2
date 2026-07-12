// Thin route: session auth → users WHERE role='supervisor' → JSON. Backs the authority
// pickers (static_pw_auth_by, closure_by) — never a hardcoded name list (§4).
import { NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { eq, and } from 'drizzle-orm';
import { authOptions } from '../../../../lib/auth';
import { db } from '../../../../db';
import { users } from '../../../../db/schema';
import { requireAuthenticated } from '../../../../services/auth.service';
import { AuthzError } from '../../../../lib/errors';

export async function GET() {
  const session = await getServerSession(authOptions);

  try {
    const user = requireAuthenticated(
      session?.user ? { id: session.user.id, orgId: session.user.orgId, role: session.user.role } : null,
    );

    const supervisors = db
      .select({ id: users.id, displayName: users.displayName })
      .from(users)
      .where(and(eq(users.orgId, user.orgId), eq(users.role, 'supervisor'), eq(users.isActive, 1)))
      .all();

    return NextResponse.json({ data: supervisors });
  } catch (error) {
    if (error instanceof AuthzError) {
      return NextResponse.json({ error: { code: 'unauthorized', message: error.message } }, { status: 401 });
    }
    return NextResponse.json(
      { error: { code: 'internal_error', message: 'Could not load supervisors' } },
      { status: 500 },
    );
  }
}
