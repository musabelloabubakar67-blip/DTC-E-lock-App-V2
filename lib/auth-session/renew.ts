// Sliding session renewal. NextAuth only re-issues its JWT cookie from /api/auth/session, and
// nothing calls that (no SessionProvider on the web, never from the Android app), while
// getServerSession cannot set cookies in the App Router. So every session used to expire a
// fixed maxAge after sign-in, however active the user was. middleware.ts calls this on each
// request instead, and re-issues the cookie once it is SESSION_RENEW_AFTER_SECONDS old.
import { decode, encode } from 'next-auth/jwt';
import { SESSION_MAX_AGE_SECONDS, SESSION_RENEW_AFTER_SECONDS } from './config';

/**
 * Returns a fresh session token when `token` is valid, not revoked and old enough to renew;
 * otherwise null (leave the cookie alone). Revocation (deactivation, password change) is
 * still decided by the jwt callback in lib/auth.ts on every request: this only extends expiry.
 */
export async function renewSessionToken(
  token: string | undefined,
  secret: string | undefined,
  nowSeconds = Math.floor(Date.now() / 1000),
): Promise<string | null> {
  if (!token || !secret) return null;

  let payload: Awaited<ReturnType<typeof decode>>;
  try {
    payload = await decode({ token, secret });
  } catch {
    return null; // expired, tampered or signed with another secret: NextAuth treats it as signed out
  }
  if (!payload || payload.revoked) return null;

  const issuedAt = typeof payload.iat === 'number' ? payload.iat : 0;
  if (nowSeconds - issuedAt < SESSION_RENEW_AFTER_SECONDS) return null;

  // encode() sets fresh iat/exp/jti; the identity claims carry over unchanged.
  return encode({ token: payload, secret, maxAge: SESSION_MAX_AGE_SECONDS });
}
