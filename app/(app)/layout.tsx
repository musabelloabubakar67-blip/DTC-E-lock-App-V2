import { getServerSession } from 'next-auth';
import { redirect } from 'next/navigation';
import { cookies } from 'next/headers';
import { authOptions } from '../../lib/auth';
import AppShell from './_components/AppShell';

export default async function AppLayout({ children }: { children: React.ReactNode }) {
  const session = await getServerSession(authOptions);

  if (!session?.user?.id) {
    redirect('/login');
  }

  const role = session.user.role;
  const displayName = session.user.name ?? null;
  const cookieStore = await cookies();
  const rawTheme = cookieStore.get('dtc-theme')?.value ?? 'system';
  const theme = rawTheme === 'light' || rawTheme === 'dark' ? rawTheme : 'system';
  const compactMode = cookieStore.get('dtc-compact-mode')?.value === 'true';

  return (
    <AppShell role={role} displayName={displayName} theme={theme} compactMode={compactMode}>
      {children}
    </AppShell>
  );
}
