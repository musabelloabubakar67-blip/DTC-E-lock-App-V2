// Session lifetime shared by lib/auth.ts (NextAuth) and middleware.ts (sliding renewal).
// Kept free of db imports so the middleware bundle can use it.

// Idle limit: a session ends after 30 days without any request. Active users stay signed in,
// because middleware.ts renews the cookie (see SESSION_RENEW_AFTER_SECONDS).
export const SESSION_MAX_AGE_SECONDS = 60 * 60 * 24 * 30;

// Re-issue the cookie at most once a day, not on every request.
export const SESSION_RENEW_AFTER_SECONDS = 60 * 60 * 24;

export const SECURE_COOKIES = process.env.NODE_ENV === 'production';

// NextAuth's own name for the session cookie (`__Secure-` prefix when cookies are secure).
export const SESSION_COOKIE_NAME = `${SECURE_COOKIES ? '__Secure-' : ''}next-auth.session-token`;
