// Service-layer authorization primitives (§4 Auth, §6 "Corrections — supervisor only").
// Source of truth for role enforcement — route/middleware checks may mirror this, never replace it.
// No next/server import here (§7 layer contract).
import { AuthzError } from '../lib/errors';

export type UserRole = 'installer' | 'supervisor';

export type AuthenticatedUser = {
  id: string;
  orgId: string;
  role: UserRole;
};

export function requireAuthenticated(
  user: AuthenticatedUser | null | undefined,
): AuthenticatedUser {
  if (
    !user
    || !user.id
    || !user.orgId
    || (user.role !== 'installer' && user.role !== 'supervisor')
  ) {
    throw new AuthzError('Authentication required');
  }
  return user;
}

export function requireSupervisor(user: AuthenticatedUser | null | undefined): AuthenticatedUser {
  const authed = requireAuthenticated(user);
  if (authed.role !== 'supervisor') {
    throw new AuthzError('Supervisor role required');
  }
  return authed;
}
