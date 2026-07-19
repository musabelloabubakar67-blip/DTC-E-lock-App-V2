// NextAuth config: credentials provider, bcrypt-verified, 30-day session (§4 Auth).
// Server-verified only — actor_user_id for services always comes from the session (§6 Actor & authority),
// routes must strip any client-supplied actor before calling a service.
import type { NextAuthOptions } from 'next-auth';
import CredentialsProvider from 'next-auth/providers/credentials';
import bcrypt from 'bcryptjs';
import { eq } from 'drizzle-orm';
import { db } from '../db';
import { users } from '../db/schema';
import {
  clearFailedLogins,
  isLoginRateLimited,
  loginAttemptKey,
  recordFailedLogin,
} from './security/login-rate-limit';

const SESSION_MAX_AGE_SECONDS = 60 * 60 * 24 * 7;
const DUMMY_PASSWORD_HASH = '$2a$10$7EqJtq98hPqEX7fNZaFWoO5uT6uO5sFl0hgsoL4uMn6GywS6aP8mK';

function requestIp(headers: Record<string, string | string[] | undefined> | undefined) {
  if (!headers) return 'unknown';
  const forwarded = headers['x-forwarded-for'];
  const raw = Array.isArray(forwarded) ? forwarded[0] : forwarded;
  if (raw) return raw.split(',')[0]?.trim() || 'unknown';

  const realIp = headers['x-real-ip'];
  return (Array.isArray(realIp) ? realIp[0] : realIp) ?? 'unknown';
}

export const authOptions: NextAuthOptions = {
  session: { strategy: 'jwt', maxAge: SESSION_MAX_AGE_SECONDS },
  useSecureCookies: process.env.NODE_ENV === 'production',
  pages: { signIn: '/login' },
  providers: [
    CredentialsProvider({
      name: 'credentials',
      credentials: {
        username: { label: 'Username', type: 'text' },
        password: { label: 'Password', type: 'password' },
      },
      async authorize(credentials, request) {
        if (!credentials?.username || !credentials?.password) return null;

        const username = credentials.username.trim().toLowerCase();
        const attemptKey = loginAttemptKey(requestIp(request.headers), username);
        if (isLoginRateLimited(attemptKey)) return null;

        const user = db
          .select()
          .from(users)
          .where(eq(users.username, username))
          .get();

        const valid = await bcrypt.compare(credentials.password, user?.passwordHash ?? DUMMY_PASSWORD_HASH);
        if (!user || !user.isActive || !valid) {
          recordFailedLogin(attemptKey);
          return null;
        }

        clearFailedLogins(attemptKey);

        db.update(users)
          .set({ lastLogin: Math.floor(Date.now() / 1000) })
          .where(eq(users.id, user.id))
          .run();

        return {
          id: user.id,
          name: user.displayName,
          orgId: user.orgId,
          role: user.role,
          sessionVersion: user.updatedAt,
        };
      },
    }),
  ],
  callbacks: {
    async redirect({ url, baseUrl }) {
      if (url.startsWith('/')) return `${baseUrl}${url}`;

      try {
        const parsed = new URL(url);
        if (parsed.origin === baseUrl) {
          return parsed.toString();
        }
      } catch {
        return baseUrl;
      }

      return baseUrl;
    },
    async jwt({ token, user }) {
      if (user) {
        token.id = (user as { id: string }).id;
        token.orgId = (user as { orgId: string }).orgId;
        token.role = (user as { role: 'installer' | 'supervisor' }).role;
        token.sessionVersion = (user as { sessionVersion: number }).sessionVersion;
        token.revoked = false;
      }

      if (typeof token.id !== 'string' || typeof token.sessionVersion !== 'number') {
        token.revoked = true;
        return token;
      }

      const currentUser = db
        .select({
          id: users.id,
          orgId: users.orgId,
          role: users.role,
          displayName: users.displayName,
          isActive: users.isActive,
          updatedAt: users.updatedAt,
        })
        .from(users)
        .where(eq(users.id, token.id))
        .get();

      if (!currentUser || !currentUser.isActive || currentUser.updatedAt !== token.sessionVersion) {
        token.revoked = true;
        return token;
      }

      token.orgId = currentUser.orgId;
      token.role = currentUser.role;
      token.name = currentUser.displayName;
      token.revoked = false;
      return token;
    },
    async session({ session, token }) {
      if (session.user) {
        session.user.id = token.revoked ? '' : token.id;
        session.user.orgId = token.revoked ? '' : token.orgId;
        session.user.role = token.revoked ? 'installer' : token.role;
      }
      return session;
    },
  },
};
