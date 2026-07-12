// Thin route: session auth (supervisor) → Zod validate → movement.service.ts's
// changeTruckCompany → JSON (§10, §7 layer contract). This is the RARE secondary correction
// path (§6) — the common case is company confirmed as a byproduct of installKit, not here.
import { NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '../../../../../lib/auth';
import { db } from '../../../../../db';
import { z } from 'zod';
import { changeTruckCompany } from '../../../../../services/movement.service';
import { requireAuthenticated } from '../../../../../services/auth.service';
import { BusinessError, AuthzError } from '../../../../../lib/errors';

const changeTruckCompanySchema = z.object({
  company: z.enum(['mrs', 'dangote']),
  notes: z.string().optional(),
});

export async function POST(request: Request, { params }: { params: { id: string } }) {
  const session = await getServerSession(authOptions);

  try {
    const user = requireAuthenticated(
      session?.user ? { id: session.user.id, orgId: session.user.orgId, role: session.user.role } : null,
    );

    const body = await request.json();
    const parsed = changeTruckCompanySchema.safeParse(body);
    if (!parsed.success) {
      return NextResponse.json(
        { error: { code: 'validation_error', message: parsed.error.message } },
        { status: 400 },
      );
    }

    const result = changeTruckCompany(db, {
      orgId: user.orgId,
      truckId: params.id,
      company: parsed.data.company,
      notes: parsed.data.notes,
      actor: user, // requireSupervisor() runs inside changeTruckCompany — service is the source of truth
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
      { error: { code: 'internal_error', message: 'Company reassignment failed' } },
      { status: 500 },
    );
  }
}
