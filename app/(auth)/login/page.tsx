import { getServerSession } from 'next-auth';
import Image from 'next/image';
import { cookies } from 'next/headers';
import { redirect } from 'next/navigation';
import { authOptions } from '../../../lib/auth';
import LoginForm from './LoginForm';

export default async function LoginPage() {
  const session = await getServerSession(authOptions);

  if (session?.user?.id) {
    redirect('/');
  }

  const cookieStore = await cookies();
  const rawTheme = cookieStore.get('dtc-theme')?.value ?? 'system';
  const theme = rawTheme === 'light' || rawTheme === 'dark' ? rawTheme : 'system';

  return (
    <main className="login-shell" data-theme={theme}>
      <header className="login-topbar">
        <div className="login-topbar__brand">
          <Image
            className="login-topbar__logo"
            src="/dtc-logo.jpeg"
            alt="DTC Direct Trucking Company"
            width={148}
            height={48}
            priority
          />
          <span aria-hidden="true" />
          <strong>DTC / E-Lock control system</strong>
        </div>
        <div className="login-topbar__state" aria-label="Access gateway ready">
          <span>Secure gateway</span>
          <strong><i aria-hidden="true" />Ready</strong>
        </div>
      </header>

      <div className="login-stage">
        <section className="login-hero" aria-label="DTC E-Lock access">
          <div className="login-hero__index" aria-hidden="true">
            <b>01</b>
            <span>AUTH / DTC</span>
          </div>

          <div className="login-hero__copy">
            <span>[ SECURE OPERATIONS CONSOLE ]</span>
            <h1>DTC<br /><em>E-Lock</em></h1>
            <p>Authorized operator access for fleet lock control.</p>
          </div>

          <dl className="login-status-grid" aria-label="Session requirements">
            <div>
              <dt>Session</dt>
              <dd>7-day token</dd>
            </div>
            <div>
              <dt>Authority</dt>
              <dd>Role validated</dd>
            </div>
            <div>
              <dt>Offline</dt>
              <dd>Queue resumes</dd>
            </div>
          </dl>
        </section>

        <section className="login-panel" aria-label="Credentials">
          <div className="login-panel__heading">
            <span>02 / Credentials</span>
            <strong>Restricted access</strong>
          </div>
          <LoginForm />
          <footer className="login-panel__footer">
            <span>DTC internal system</span>
            <span>Rev / 03.0</span>
          </footer>
        </section>
      </div>
    </main>
  );
}
