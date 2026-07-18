import { NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '../../../lib/auth';
import { db } from '../../../db';
import { AuthzError } from '../../../lib/errors';
import { requireAuthenticated } from '../../../services/auth.service';
import { listRegistrationsPage } from '../../../services/registration.service';

export async function GET(request: Request) {
  const session = await getServerSession(authOptions);

  try {
    const user = requireAuthenticated(
      session?.user ? { id: session.user.id, orgId: session.user.orgId, role: session.user.role } : null,
    );

    const params = new URL(request.url).searchParams;
    const result = listRegistrationsPage(db, user.orgId, {
      page: parsePage(params.get('page')),
      pageSize: parsePageSize(params.get('pageSize'), 8),
      query: params.get('q') ?? '',
    });

    return NextResponse.json({
      data: result.items,
      pagination: { total: result.total, page: result.page, pageSize: result.pageSize },
    });
  } catch (error) {
    if (error instanceof AuthzError) {
      return NextResponse.json({ error: { code: 'unauthorized', message: error.message } }, { status: 401 });
    }
    return NextResponse.json({ error: { code: 'internal_error', message: 'Could not load registry' } }, { status: 500 });
  }
}

function parsePage(value: string | null): number {
  const parsed = Number.parseInt(value ?? '', 10);
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : 0;
}

function parsePageSize(value: string | null, fallback: number): number {
  const parsed = Number.parseInt(value ?? '', 10);
  return Number.isFinite(parsed) ? Math.min(100, Math.max(1, parsed)) : fallback;
}
