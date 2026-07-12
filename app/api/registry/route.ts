import { NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '../../../lib/auth';
import { db } from '../../../db';
import { AuthzError } from '../../../lib/errors';
import { requireAuthenticated } from '../../../services/auth.service';
import { listRegistrations } from '../../../services/registration.service';

export async function GET() {
  const session = await getServerSession(authOptions);

  try {
    const user = requireAuthenticated(
      session?.user ? { id: session.user.id, orgId: session.user.orgId, role: session.user.role } : null,
    );

    return NextResponse.json({ data: listRegistrations(db, user.orgId) });
  } catch (error) {
    if (error instanceof AuthzError) {
      return NextResponse.json({ error: { code: 'unauthorized', message: error.message } }, { status: 401 });
    }
    return NextResponse.json({ error: { code: 'internal_error', message: 'Could not load registry' } }, { status: 500 });
  }
}
