import { NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '../../../../lib/auth';
import { db, sqlite } from '../../../../db';
import { AuthzError } from '../../../../lib/errors';
import { requireAuthenticated, requireSupervisor } from '../../../../services/auth.service';
import { listExportSummaries } from '../../../../services/data-management.service';
import {
  createSettingsUser,
  getSettingsData,
  setSettingsUserActive,
  type CreateSettingsUserInput,
} from '../../../../services/settings.service';

async function actorFromSession() {
  const session = await getServerSession(authOptions);
  const actor = requireAuthenticated(
    session?.user ? { id: session.user.id, orgId: session.user.orgId, role: session.user.role } : null,
  );
  return { actor, session };
}

export async function GET() {
  try {
    const { actor } = await actorFromSession();
    const settings = getSettingsData(db, actor, { mode: 'system', compactMode: false });
    const exports = actor.role === 'supervisor'
      ? listExportSummaries(sqlite, requireSupervisor(actor))
      : [];

    const response = NextResponse.json({
      data: {
        settings,
        currentUserId: actor.id,
        currentRole: actor.role,
        exports,
      },
    });
    response.headers.set('Cache-Control', 'private, no-store');
    return response;
  } catch (error) {
    return settingsError(error, 'Could not load settings');
  }
}

export async function POST(request: Request) {
  try {
    const { actor } = await actorFromSession();
    const body = await request.json();

    if (body?.action === 'create_user') {
      const input: CreateSettingsUserInput = {
        username: String(body.username ?? ''),
        displayName: String(body.displayName ?? ''),
        password: String(body.password ?? ''),
        role: body.role === 'supervisor' ? 'supervisor' : 'installer',
        company: body.company === 'mrs' || body.company === 'dangote' ? body.company : null,
      };
      const result = await createSettingsUser(db, actor, input);
      return NextResponse.json({ data: result }, { status: 201 });
    }

    if (body?.action === 'set_user_active') {
      setSettingsUserActive(db, actor, {
        userId: String(body.userId ?? ''),
        isActive: body.isActive === true,
      });
      return NextResponse.json({ data: { userId: body.userId, isActive: body.isActive === true } });
    }

    return NextResponse.json(
      { error: { code: 'validation_error', message: 'Unknown settings action.' } },
      { status: 400 },
    );
  } catch (error) {
    return settingsError(error, 'Could not update settings');
  }
}

function settingsError(error: unknown, fallback: string) {
  if (error instanceof AuthzError) {
    return NextResponse.json({ error: { code: 'unauthorized', message: error.message } }, { status: 401 });
  }
  return NextResponse.json(
    { error: { code: 'settings_error', message: error instanceof Error ? error.message : fallback } },
    { status: 400 },
  );
}
