// Thin route: wires NextAuth to the shared config in lib/auth.ts (§7 layer contract).
import NextAuth from 'next-auth';
import { authOptions } from '../../../../lib/auth';

const handler = NextAuth(authOptions);

export { handler as GET, handler as POST };
