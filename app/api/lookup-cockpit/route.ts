import { NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '../../../lib/auth';
import { db } from '../../../db';
import { requireAuthenticated } from '../../../services/auth.service';
import { getLookupCockpit } from '../../../services/lookup.service';
import { AuthzError } from '../../../lib/errors';

export async function GET(request: Request) {
  const session = await getServerSession(authOptions);

  try {
    const user = requireAuthenticated(
      session?.user ? { id: session.user.id, orgId: session.user.orgId, role: session.user.role } : null,
    );
    const query = new URL(request.url).searchParams.get('query') ?? '';

    return NextResponse.json({ data: getLookupCockpit(db, { query, orgId: user.orgId }) });
  } catch (error) {
    if (error instanceof AuthzError) {
      return NextResponse.json({ error: { code: 'unauthorized', message: error.message } }, { status: 401 });
    }
    return NextResponse.json(
      { error: { code: 'internal_error', message: 'Could not load lookup cockpit' } },
      { status: 500 },
    );
  }
}
