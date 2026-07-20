import { NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '../../../../lib/auth';
import { db } from '../../../../db';
import { AuthzError } from '../../../../lib/errors';
import { requireAuthenticated } from '../../../../services/auth.service';
import { getDashboard } from '../../../../services/dashboard.service';

export async function GET() {
  const session = await getServerSession(authOptions);

  try {
    const user = requireAuthenticated(
      session?.user ? { id: session.user.id, orgId: session.user.orgId, role: session.user.role } : null,
    );

    const response = NextResponse.json({
      data: {
        user: {
          id: user.id,
          name: session?.user?.name ?? 'DTC operator',
          role: user.role,
        },
        dashboard: getDashboard(db, { orgId: user.orgId, role: user.role }),
      },
    });
    response.headers.set('Cache-Control', 'private, no-store');
    return response;
  } catch (error) {
    if (error instanceof AuthzError) {
      return NextResponse.json({ error: { code: 'unauthorized', message: error.message } }, { status: 401 });
    }
    return NextResponse.json(
      { error: { code: 'internal_error', message: 'Could not load the mobile workspace' } },
      { status: 500 },
    );
  }
}
