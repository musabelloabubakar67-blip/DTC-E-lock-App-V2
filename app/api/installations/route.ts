// Thin route: session auth → Zod validate → installation.service.ts → JSON (§10, §7 layer contract).
// actor_user_id always comes from the session — any client-supplied actor field is ignored/stripped.
import { NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '../../../lib/auth';
import { db } from '../../../db';
import { installKitSchema } from '../../../lib/validations/installation';
import { listInstallationHistoryPage, recordInstallation } from '../../../services/installation.service';
import { requireAuthenticated } from '../../../services/auth.service';
import { BusinessError, AuthzError } from '../../../lib/errors';

export async function GET(request: Request) {
  const session = await getServerSession(authOptions);

  try {
    const user = requireAuthenticated(
      session?.user ? { id: session.user.id, orgId: session.user.orgId, role: session.user.role } : null,
    );

    const params = new URL(request.url).searchParams;
    const result = listInstallationHistoryPage(db, user.orgId, {
      page: parsePage(params.get('page')),
      pageSize: parsePageSize(params.get('pageSize'), 5),
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
    return NextResponse.json(
      { error: { code: 'internal_error', message: 'Could not load installation history' } },
      { status: 500 },
    );
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
