import { NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '../../../../lib/auth';
import { sqlite } from '../../../../db';
import { AuthzError } from '../../../../lib/errors';
import { requireAuthenticated } from '../../../../services/auth.service';
import { buildExport } from '../../../../services/data-management.service';

export async function GET(request: Request) {
  const session = await getServerSession(authOptions);

  try {
    const user = requireAuthenticated(
      session?.user ? { id: session.user.id, orgId: session.user.orgId, role: session.user.role } : null,
    );
    const url = new URL(request.url);
    const exported = buildExport(sqlite, user, {
      dataset: url.searchParams.get('dataset') ?? '',
      format: url.searchParams.get('format') ?? 'csv',
    });

    return new NextResponse(exported.body, {
      headers: {
        'Content-Type': exported.contentType,
        'Content-Disposition': `attachment; filename="${exported.filename}"`,
        'Cache-Control': 'no-store',
      },
    });
  } catch (error) {
    if (error instanceof AuthzError) {
      return NextResponse.json({ error: { code: 'unauthorized', message: error.message } }, { status: 401 });
    }
    return NextResponse.json({ error: { code: 'internal_error', message: 'Could not export data' } }, { status: 500 });
  }
}
