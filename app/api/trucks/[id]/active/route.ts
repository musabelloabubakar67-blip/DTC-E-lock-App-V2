// Thin route: session auth (supervisor) → Zod validate → movement.service.ts's setTruckActive →
// JSON (§10, §7 layer contract). id may be a plate or an internal truck id.
import { NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '../../../../../lib/auth';
import { db } from '../../../../../db';
import { z } from 'zod';
import { setTruckActive } from '../../../../../services/movement.service';
import { requireAuthenticated } from '../../../../../services/auth.service';
import { BusinessError, AuthzError } from '../../../../../lib/errors';

const setTruckActiveSchema = z.object({
  isActive: z.boolean(),
  notes: z.string().optional(),
});

export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const session = await getServerSession(authOptions);
  const { id } = await params;

  try {
    const user = requireAuthenticated(
      session?.user ? { id: session.user.id, orgId: session.user.orgId, role: session.user.role } : null,
    );

    const body = await request.json();
    const parsed = setTruckActiveSchema.safeParse(body);
    if (!parsed.success) {
      return NextResponse.json(
        { error: { code: 'validation_error', message: parsed.error.message } },
        { status: 400 },
      );
    }

    const result = setTruckActive(db, {
      orgId: user.orgId,
      truckId: id,
      isActive: parsed.data.isActive,
      notes: parsed.data.notes,
      actor: user,
    });

    return NextResponse.json({ data: result }, { status: 200 });
  } catch (error) {
    if (error instanceof AuthzError) {
      return NextResponse.json({ error: { code: 'unauthorized', message: error.message } }, { status: 401 });
    }
    if (error instanceof BusinessError) {
      return NextResponse.json({ error: { code: 'business_error', message: error.message } }, { status: 409 });
    }
    return NextResponse.json(
      { error: { code: 'internal_error', message: 'Truck status change failed' } },
      { status: 500 },
    );
  }
}
