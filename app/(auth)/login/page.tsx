import { getServerSession } from 'next-auth';
import { redirect } from 'next/navigation';
import { authOptions } from '../../../lib/auth';
import LoginForm from './LoginForm';

export default async function LoginPage() {
  const session = await getServerSession(authOptions);

  if (session?.user) {
    redirect('/');
  }

  return (
    <main className="login-shell">
      <section className="login-hero" aria-label="DTC E-Lock sign in">
        <div className="login-hero__brand">
          <span className="login-hero__mark" aria-hidden="true">
            D
          </span>
          <div>
            <strong>DTC E-Lock</strong>
            <span>Daylight operations console</span>
          </div>
        </div>

        <div className="login-hero__copy">
          <h1>Sign in</h1>
          <p>Use your field operator credentials to access registration, install, lookup, movement, triage, and review workflows.</p>
        </div>

        <dl className="login-status-grid" aria-label="Session requirements">
          <div>
            <dt>Session</dt>
            <dd>30 day device token</dd>
          </div>
          <div>
            <dt>Authority</dt>
            <dd>Role checked server-side</dd>
          </div>
          <div>
            <dt>Offline</dt>
            <dd>Queue after sign-in</dd>
          </div>
        </dl>
      </section>

      <section className="login-panel" aria-label="Credentials">
        <LoginForm />
      </section>
    </main>
  );
}
