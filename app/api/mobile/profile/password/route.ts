import { NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { z } from 'zod';
import { authOptions } from '../../../../../lib/auth';
import { db } from '../../../../../db';
import { AuthzError } from '../../../../../lib/errors';
import { requireAuthenticated } from '../../../../../services/auth.service';
import { changeSettingsPassword } from '../../../../../services/settings.service';

const passwordSchema = z.object({
  currentPassword: z.string().min(1),
  newPassword: z.string().min(12),
  confirmPassword: z.string().min(12),
});

export async function POST(request: Request) {
  const session = await getServerSession(authOptions);

  try {
    const actor = requireAuthenticated(
      session?.user ? { id: session.user.id, orgId: session.user.orgId, role: session.user.role } : null,
    );
    const parsed = passwordSchema.safeParse(await request.json());
    if (!parsed.success) {
      return NextResponse.json(
        { error: { code: 'validation_error', message: parsed.error.issues[0]?.message ?? 'Invalid password change' } },
        { status: 400 },
      );
    }

    await changeSettingsPassword(db, actor, parsed.data);
    return NextResponse.json({ data: { changed: true } });
  } catch (error) {
    if (error instanceof AuthzError) {
      return NextResponse.json({ error: { code: 'unauthorized', message: error.message } }, { status: 401 });
    }
    return NextResponse.json(
      { error: { code: 'password_change_failed', message: error instanceof Error ? error.message : 'Could not change password' } },
      { status: 400 },
    );
  }
}
