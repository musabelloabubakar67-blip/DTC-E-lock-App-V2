'use client';

import { useState } from 'react';
import { signIn } from 'next-auth/react';
import { useRouter, useSearchParams } from 'next/navigation';

type LoginState = { status: 'idle' } | { status: 'submitting' } | { status: 'error'; message: string };

export default function LoginForm() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [state, setState] = useState<LoginState>({ status: 'idle' });

  async function handleSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setState({ status: 'submitting' });

    const callbackPath = safeCallbackPath(searchParams.get('callbackUrl'));
    const result = await signIn('credentials', {
      username: username.trim().toLowerCase(),
      password,
      redirect: false,
      callbackUrl: `${window.location.origin}${callbackPath}`,
    });

    if (!result || result.error) {
      setState({ status: 'error', message: 'Username or password is incorrect.' });
      return;
    }

    router.replace(callbackPath);
    router.refresh();
  }

  return (
    <form className="login-form" onSubmit={handleSubmit}>
      <div className="login-form__header">
        <h2>Operator access</h2>
        <p>Credentials are verified against the local DTC user registry.</p>
      </div>

      {state.status === 'error' && (
        <p className="banner banner--error" role="alert">
          {state.message}
        </p>
      )}

      <label>
        <span>Username</span>
        <input
          autoComplete="username"
          autoFocus
          value={username}
          onChange={(event) => setUsername(event.target.value)}
          placeholder="Enter username"
          required
        />
      </label>

      <label>
        <span>Password</span>
        <input
          autoComplete="current-password"
          type="password"
          value={password}
          onChange={(event) => setPassword(event.target.value)}
          placeholder="Enter password"
          required
        />
      </label>

      <button className="btn btn--primary" type="submit" disabled={state.status === 'submitting'}>
        {state.status === 'submitting' ? 'Signing in' : 'Sign in'}
      </button>
    </form>
  );
}

function safeCallbackPath(callbackUrl: string | null): string {
  if (!callbackUrl) return '/';

  try {
    const parsed = new URL(callbackUrl, window.location.origin);

    if (parsed.origin !== window.location.origin) {
      return '/';
    }

    const nextPath = `${parsed.pathname}${parsed.search}${parsed.hash}`;
    return nextPath.startsWith('/login') ? '/' : nextPath;
  } catch {
    return '/';
  }
}
