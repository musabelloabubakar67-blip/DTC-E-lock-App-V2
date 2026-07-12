import type { DefaultSession } from 'next-auth';

declare module 'next-auth' {
  interface Session {
    user: {
      id: string;
      orgId: string;
      role: 'installer' | 'supervisor';
    } & DefaultSession['user'];
  }

  interface User {
    id: string;
    orgId: string;
    role: 'installer' | 'supervisor';
  }
}

declare module 'next-auth/jwt' {
  interface JWT {
    id: string;
    orgId: string;
    role: 'installer' | 'supervisor';
  }
}
