// Supervisor-triggered sweep: fills incomplete registrations' empty slots from the orphan sub
// pool (see registration.service.ts's autoAssignOrphanSubs). Normally runs automatically after
// registerIncompleteKit creates a new incomplete registration; this route exists so a
// supervisor can also run it on-demand against registrations that were already incomplete
// before that automatic hook existed.
import { NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '../../../../lib/auth';
import { db } from '../../../../db';
import { AuthzError } from '../../../../lib/errors';
import { requireSupervisor } from '../../../../services/auth.service';
import { autoAssignOrphanSubs } from '../../../../services/registration.service';

export async function POST() {
  const session = await getServerSession(authOptions);

  try {
    const user = requireSupervisor(
      session?.user ? { id: session.user.id, orgId: session.user.orgId, role: session.user.role } : null,
    );

    const result = autoAssignOrphanSubs(db, user.orgId, user.id);
    return NextResponse.json({ data: result }, { status: 200 });
  } catch (error) {
    if (error instanceof AuthzError) {
      return NextResponse.json({ error: { code: 'unauthorized', message: error.message } }, { status: 401 });
    }
    return NextResponse.json(
      { error: { code: 'internal_error', message: 'Orphan sweep failed' } },
      { status: 500 },
    );
  }
}
