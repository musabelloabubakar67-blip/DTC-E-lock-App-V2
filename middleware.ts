// Keeps active users signed in: renews the NextAuth session cookie (see
// lib/auth-session/renew.ts). Covers the web app and the Android app's API calls alike, since
// both send the same cookie and the Android cookie jar stores any Set-Cookie it receives.
import { NextResponse, type NextRequest } from 'next/server';
import { SECURE_COOKIES, SESSION_COOKIE_NAME, SESSION_MAX_AGE_SECONDS } from './lib/auth-session/config';
import { renewSessionToken } from './lib/auth-session/renew';

export async function middleware(request: NextRequest) {
  const response = NextResponse.next();
  const renewed = await renewSessionToken(
    request.cookies.get(SESSION_COOKIE_NAME)?.value,
    process.env.NEXTAUTH_SECRET ?? process.env.AUTH_SECRET,
  );
  if (renewed) {
    response.cookies.set(SESSION_COOKIE_NAME, renewed, {
      httpOnly: true,
      sameSite: 'lax',
      path: '/',
      secure: SECURE_COOKIES,
      maxAge: SESSION_MAX_AGE_SECONDS,
    });
  }
  return response;
}

export const config = {
  // Skip NextAuth's own routes (sign-in/out set the cookie themselves) and static files.
  matcher: ['/((?!api/auth|_next/static|_next/image|icons/|sw\\.js|manifest\\.json|offline\\.html|.*\\.(?:png|jpe?g|svg|ico|webp)$).*)'],
};
