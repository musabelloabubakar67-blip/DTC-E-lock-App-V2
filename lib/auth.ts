// NextAuth config: credentials provider, bcrypt-verified, 30-day session (§4 Auth).
// Server-verified only — actor_user_id for services always comes from the session (§6 Actor & authority),
// routes must strip any client-supplied actor before calling a service.
import type { NextAuthOptions } from 'next-auth';
import CredentialsProvider from 'next-auth/providers/credentials';
import bcrypt from 'bcryptjs';
import { eq } from 'drizzle-orm';
import { db } from '../db';
import { users } from '../db/schema';

const SESSION_MAX_AGE_SECONDS = 60 * 60 * 24 * 30; // 30 days — field tool, personal devices (§4 Auth)

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
      async authorize(credentials) {
        if (!credentials?.username || !credentials?.password) return null;

        const user = db
          .select()
          .from(users)
          .where(eq(users.username, credentials.username))
          .get();

        if (!user || !user.isActive) return null;

        const valid = await bcrypt.compare(credentials.password, user.passwordHash);
        if (!valid) return null;

        db.update(users)
          .set({ lastLogin: Math.floor(Date.now() / 1000) })
          .where(eq(users.id, user.id))
          .run();

        return {
          id: user.id,
          name: user.displayName,
          orgId: user.orgId,
          role: user.role,
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
      }
      return token;
    },
    async session({ session, token }) {
      if (session.user) {
        session.user.id = token.id as string;
        session.user.orgId = token.orgId as string;
        session.user.role = token.role as 'installer' | 'supervisor';
      }
      return session;
    },
  },
};
