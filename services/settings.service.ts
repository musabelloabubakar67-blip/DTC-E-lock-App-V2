import { createId } from '@paralleldrive/cuid2';
import bcrypt from 'bcryptjs';
import { and, eq, ne } from 'drizzle-orm';
import type { BetterSQLite3Database } from 'drizzle-orm/better-sqlite3';
import * as schema from '../db/schema';
import { organisations, users } from '../db/schema';
import { AuthzError } from '../lib/errors';
import type { AuthenticatedUser } from './auth.service';
import { requireSupervisor } from './auth.service';

export type AppearanceMode = 'system' | 'light' | 'dark';

export type SettingsUser = {
  id: string;
  username: string;
  displayName: string;
  role: 'installer' | 'supervisor';
  company: 'mrs' | 'dangote' | null;
  isActive: boolean;
  lastLogin: number | null;
  createdAt: number;
  updatedAt: number;
};

export type SettingsData = {
  organisation: {
    id: string;
    name: string;
  } | null;
  users: SettingsUser[];
  appearance: {
    mode: AppearanceMode;
    compactMode: boolean;
  };
  security: {
    sessionDays: number;
    supervisorRequiredForCorrections: boolean;
  };
};

export type CreateSettingsUserInput = {
  username: string;
  displayName: string;
  password: string;
  role: 'installer' | 'supervisor';
  company?: 'mrs' | 'dangote' | null;
};

export type ChangePasswordInput = {
  currentPassword: string;
  newPassword: string;
  confirmPassword: string;
};

export type ResetUserPasswordInput = {
  userId: string;
  newPassword: string;
  confirmPassword: string;
};

export function getSettingsData(
  db: BetterSQLite3Database<typeof schema>,
  actor: AuthenticatedUser,
  appearance: { mode: AppearanceMode; compactMode?: boolean },
): SettingsData {
  const organisation = db
    .select({ id: organisations.id, name: organisations.name })
    .from(organisations)
    .where(eq(organisations.id, actor.orgId))
    .get() ?? null;

  const rows = db
    .select({
      id: users.id,
      username: users.username,
      displayName: users.displayName,
      role: users.role,
      company: users.company,
      isActive: users.isActive,
      lastLogin: users.lastLogin,
      createdAt: users.createdAt,
      updatedAt: users.updatedAt,
    })
    .from(users)
    .where(eq(users.orgId, actor.orgId))
    .all();

  return {
    organisation,
    users: rows.map((user) => ({
      ...user,
      isActive: Boolean(user.isActive),
    })),
    appearance: {
      mode: appearance.mode,
      compactMode: Boolean(appearance.compactMode),
    },
    security: {
      sessionDays: 30,
      supervisorRequiredForCorrections: true,
    },
  };
}

export async function createSettingsUser(
  db: BetterSQLite3Database<typeof schema>,
  actor: AuthenticatedUser,
  input: CreateSettingsUserInput,
): Promise<{ id: string }> {
  const supervisor = requireSupervisor(actor);
  const username = input.username.trim().toLowerCase();
  const displayName = input.displayName.trim();
  const password = input.password;

  if (!username || username.length < 3) {
    throw new Error('Username must be at least 3 characters.');
  }
  if (!displayName) {
    throw new Error('Display name is required.');
  }
  if (password.length < 12) {
    throw new Error('Password must be at least 12 characters.');
  }
  if (password.toLowerCase().includes(username)) {
    throw new Error('Password cannot contain the username.');
  }

  const existing = db
    .select({ id: users.id })
    .from(users)
    .where(eq(users.username, username))
    .get();

  if (existing) {
    throw new Error('A user with that username already exists.');
  }

  const passwordHash = await bcrypt.hash(password, 10);
  const id = createId();
  const now = Math.floor(Date.now() / 1000);

  db.insert(users)
    .values({
      id,
      orgId: supervisor.orgId,
      username,
      displayName,
      passwordHash,
      role: input.role,
      company: input.company ?? null,
      isActive: 1,
      createdAt: now,
      updatedAt: now,
    })
    .run();

  return { id };
}

export function setSettingsUserActive(
  db: BetterSQLite3Database<typeof schema>,
  actor: AuthenticatedUser,
  input: { userId: string; isActive: boolean },
): void {
  const supervisor = requireSupervisor(actor);

  if (input.userId === supervisor.id && !input.isActive) {
    throw new AuthzError('You cannot deactivate your own account.');
  }

  const result = db
    .update(users)
    .set({ isActive: input.isActive ? 1 : 0, updatedAt: Math.floor(Date.now() / 1000) })
    .where(and(eq(users.orgId, supervisor.orgId), eq(users.id, input.userId), ne(users.id, supervisor.id)))
    .run();

  if (result.changes === 0) {
    throw new Error('User could not be updated.');
  }
}

export async function changeSettingsPassword(
  db: BetterSQLite3Database<typeof schema>,
  actor: AuthenticatedUser,
  input: ChangePasswordInput,
): Promise<void> {
  const user = db
    .select({ id: users.id, passwordHash: users.passwordHash })
    .from(users)
    .where(and(eq(users.orgId, actor.orgId), eq(users.id, actor.id), eq(users.isActive, 1)))
    .get();

  if (!user) {
    throw new AuthzError('Authentication required');
  }

  const currentValid = await bcrypt.compare(input.currentPassword, user.passwordHash);
  if (!currentValid) {
    throw new Error('Current password is incorrect.');
  }

  if (input.newPassword.length < 12) {
    throw new Error('New password must be at least 12 characters.');
  }

  if (input.newPassword !== input.confirmPassword) {
    throw new Error('New passwords do not match.');
  }

  if (input.currentPassword === input.newPassword) {
    throw new Error('New password must be different.');
  }

  const passwordHash = await bcrypt.hash(input.newPassword, 10);
  db.update(users)
    .set({ passwordHash, updatedAt: Math.floor(Date.now() / 1000) })
    .where(eq(users.id, user.id))
    .run();
}

export async function resetSettingsUserPassword(
  db: BetterSQLite3Database<typeof schema>,
  actor: AuthenticatedUser,
  input: ResetUserPasswordInput,
): Promise<void> {
  const supervisor = requireSupervisor(actor);
  const target = db
    .select({
      id: users.id,
      username: users.username,
      passwordHash: users.passwordHash,
      isActive: users.isActive,
      updatedAt: users.updatedAt,
    })
    .from(users)
    .where(and(eq(users.orgId, supervisor.orgId), eq(users.id, input.userId)))
    .get();

  if (!target) {
    throw new Error('User could not be found.');
  }
  if (!target.isActive) {
    throw new Error('Activate this user before resetting their password.');
  }
  if (input.newPassword.length < 12) {
    throw new Error('New password must be at least 12 characters.');
  }
  if (input.newPassword !== input.confirmPassword) {
    throw new Error('New passwords do not match.');
  }
  if (input.newPassword.toLowerCase().includes(target.username)) {
    throw new Error('Password cannot contain the username.');
  }
  if (await bcrypt.compare(input.newPassword, target.passwordHash)) {
    throw new Error('New password must be different.');
  }

  const passwordHash = await bcrypt.hash(input.newPassword, 10);
  db.update(users)
    .set({ passwordHash, updatedAt: Math.max(Math.floor(Date.now() / 1000), target.updatedAt + 1) })
    .where(and(eq(users.orgId, supervisor.orgId), eq(users.id, target.id)))
    .run();
}
