import { getServerSession } from 'next-auth';
import { redirect } from 'next/navigation';
import { cookies } from 'next/headers';
import { authOptions } from '../../lib/auth';
import AppShell from './_components/AppShell';

export default async function AppLayout({ children }: { children: React.ReactNode }) {
  const session = await getServerSession(authOptions);

  if (!session?.user) {
    redirect('/login');
  }

  const role = session.user.role;
  const displayName = session.user.name ?? null;
  const rawTheme = cookies().get('dtc-theme')?.value ?? 'system';
  const theme = rawTheme === 'light' || rawTheme === 'dark' ? rawTheme : 'system';
  const compactMode = cookies().get('dtc-compact-mode')?.value === 'true';

  return (
    <AppShell role={role} displayName={displayName} theme={theme} compactMode={compactMode}>
      {children}
    </AppShell>
  );
}
