// Thin route: session auth → sync.service.ts's applySyncBatch → JSON (§10, §7 layer contract).
//
// PASS TWO: real dispatch to the business services + server-authoritative conflict handling.
// An "applied" result means the mutation's business effect is committed, not merely received
// (sync.service.ts's rule A). actorUserId for every dispatched mutation comes from THIS
// session, never from the mutation payload.
import { NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '../../../lib/auth';
import { db } from '../../../db';
import { applySyncBatch, type IncomingMutation } from '../../../services/sync.service';
import { requireAuthenticated } from '../../../services/auth.service';
import { AuthzError } from '../../../lib/errors';

export async function POST(request: Request) {
  const session = await getServerSession(authOptions);

  try {
    const user = requireAuthenticated(
      session?.user ? { id: session.user.id, orgId: session.user.orgId, role: session.user.role } : null,
    );

    const body = await request.json();
    const mutations: IncomingMutation[] = Array.isArray(body?.mutations) ? body.mutations : [];

    const results = applySyncBatch(db, { orgId: user.orgId, actor: user, mutations });

    return NextResponse.json({ results });
  } catch (error) {
    if (error instanceof AuthzError) {
      return NextResponse.json({ error: { code: 'unauthorized', message: error.message } }, { status: 401 });
    }
    return NextResponse.json({ error: { code: 'internal_error', message: 'Sync failed' } }, { status: 500 });
  }
}
