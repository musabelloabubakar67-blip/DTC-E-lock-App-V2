import { NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { z } from 'zod';
import { authOptions } from '../../../../lib/auth';
import { db } from '../../../../db';
import { AuthzError, BusinessError } from '../../../../lib/errors';
import { requireAuthenticated } from '../../../../services/auth.service';
import { backfillInstallationVerifications } from '../../../../services/installation.service';

const schema = z.object({
  from: z.number().int().nonnegative(),
  to: z.number().int().nonnegative(),
  dryRun: z.boolean().optional(),
}).refine((value) => value.from <= value.to, { message: 'Start date must be before end date' });

export async function POST(request: Request) {
  const session = await getServerSession(authOptions);
  try {
    const actor = requireAuthenticated(
      session?.user ? { id: session.user.id, orgId: session.user.orgId, role: session.user.role } : null,
    );
    const parsed = schema.safeParse(await request.json());
    if (!parsed.success) {
      return NextResponse.json(
        { error: { code: 'validation_error', message: parsed.error.issues[0]?.message ?? 'Invalid date range' } },
        { status: 400 },
      );
    }
    return NextResponse.json({ data: backfillInstallationVerifications(db, { actor, ...parsed.data }) });
  } catch (error) {
    if (error instanceof AuthzError) {
      return NextResponse.json({ error: { code: 'unauthorized', message: error.message } }, { status: 401 });
    }
    if (error instanceof BusinessError) {
      return NextResponse.json({ error: { code: 'business_error', message: error.message } }, { status: 409 });
    }
    return NextResponse.json(
      { error: { code: 'internal_error', message: 'Could not verify confirmed installations' } },
      { status: 500 },
    );
  }
}
