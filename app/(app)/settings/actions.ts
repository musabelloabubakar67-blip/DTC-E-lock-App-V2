'use server';

import { cookies } from 'next/headers';
import { revalidatePath } from 'next/cache';
import { getServerSession } from 'next-auth';
import { authOptions } from '../../../lib/auth';
import { db } from '../../../db';
import { requireAuthenticated } from '../../../services/auth.service';
import {
  changeSettingsPassword,
  createSettingsUser,
  setSettingsUserActive,
  type AppearanceMode,
  type CreateSettingsUserInput,
} from '../../../services/settings.service';

export type SettingsActionState =
  | { status: 'idle' }
  | { status: 'success'; message: string }
  | { status: 'error'; message: string };

async function getActor() {
  const session = await getServerSession(authOptions);
  return requireAuthenticated(
    session?.user ? { id: session.user.id, orgId: session.user.orgId, role: session.user.role } : null,
  );
}

export async function createUserAction(
  _state: SettingsActionState,
  formData: FormData,
): Promise<SettingsActionState> {
  try {
    const actor = await getActor();
    const role = String(formData.get('role') ?? 'installer') === 'supervisor' ? 'supervisor' : 'installer';
    const companyRaw = String(formData.get('company') ?? '');
    const company = companyRaw === 'mrs' || companyRaw === 'dangote' ? companyRaw : null;

    const input: CreateSettingsUserInput = {
      username: String(formData.get('username') ?? ''),
      displayName: String(formData.get('displayName') ?? ''),
      password: String(formData.get('password') ?? ''),
      role,
      company,
    };

    await createSettingsUser(db, actor, input);
    revalidatePath('/settings');
    return { status: 'success', message: 'User added.' };
  } catch (error) {
    return { status: 'error', message: error instanceof Error ? error.message : 'Could not add user.' };
  }
}

export async function changePasswordAction(
  _state: SettingsActionState,
  formData: FormData,
): Promise<SettingsActionState> {
  try {
    const actor = await getActor();
    await changeSettingsPassword(db, actor, {
      currentPassword: String(formData.get('currentPassword') ?? ''),
      newPassword: String(formData.get('newPassword') ?? ''),
      confirmPassword: String(formData.get('confirmPassword') ?? ''),
    });
    revalidatePath('/settings');
    return { status: 'success', message: 'Password changed.' };
  } catch (error) {
    return { status: 'error', message: error instanceof Error ? error.message : 'Could not change password.' };
  }
}

export async function setUserActiveAction(formData: FormData): Promise<void> {
  const actor = await getActor();
  setSettingsUserActive(db, actor, {
    userId: String(formData.get('userId') ?? ''),
    isActive: String(formData.get('isActive') ?? '') === 'true',
  });
  revalidatePath('/settings');
}

export async function setAppearanceAction(formData: FormData): Promise<void> {
  await getActor();
  const rawMode = String(formData.get('mode') ?? 'system');
  const mode: AppearanceMode = rawMode === 'light' || rawMode === 'dark' ? rawMode : 'system';
  const compactMode = String(formData.get('compactMode') ?? '') === 'true';

  cookies().set('dtc-theme', mode, { sameSite: 'lax', path: '/', maxAge: 60 * 60 * 24 * 365 });
  cookies().set('dtc-compact-mode', compactMode ? 'true' : 'false', {
    sameSite: 'lax',
    path: '/',
    maxAge: 60 * 60 * 24 * 365,
  });
  revalidatePath('/settings');
}
