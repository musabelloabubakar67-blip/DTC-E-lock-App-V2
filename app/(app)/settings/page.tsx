import { cookies } from 'next/headers';
import { getServerSession } from 'next-auth';
import { redirect } from 'next/navigation';
import { authOptions } from '../../../lib/auth';
import { db, sqlite } from '../../../db';
import { requireSupervisor } from '../../../services/auth.service';
import { listExportSummaries } from '../../../services/data-management.service';
import { getSettingsData, type AppearanceMode } from '../../../services/settings.service';
import { changePasswordAction, createUserAction, setAppearanceAction, setUserActiveAction, type SettingsActionState } from './actions';
import SettingsClient from './settings-client';

export default async function SettingsPage() {
  const session = await getServerSession(authOptions);

  if (!session?.user) {
    redirect('/login');
  }

  const rawMode = cookies().get('dtc-theme')?.value ?? 'system';
  const mode: AppearanceMode = rawMode === 'light' || rawMode === 'dark' ? rawMode : 'system';
  const compactMode = cookies().get('dtc-compact-mode')?.value === 'true';

  const settings = getSettingsData(
    db,
    { id: session.user.id, orgId: session.user.orgId, role: session.user.role },
    { mode, compactMode },
  );

  const initialActionState: SettingsActionState = { status: 'idle' };
  const exports = session.user.role === 'supervisor'
    ? listExportSummaries(
        sqlite,
        requireSupervisor({ id: session.user.id, orgId: session.user.orgId, role: session.user.role }),
      )
    : [];

  return (
    <SettingsClient
      settings={settings}
      currentUserId={session.user.id}
      currentRole={session.user.role}
      initialActionState={initialActionState}
      exportSummaries={exports}
      changePasswordAction={changePasswordAction}
      createUserAction={createUserAction}
      setUserActiveAction={setUserActiveAction}
      setAppearanceAction={setAppearanceAction}
    />
  );
}
