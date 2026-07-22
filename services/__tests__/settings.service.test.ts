import { createId } from '@paralleldrive/cuid2';
import bcrypt from 'bcryptjs';
import { eq } from 'drizzle-orm';
import { describe, expect, it } from 'vitest';
import { organisations, users } from '../../db/schema';
import { AuthzError } from '../../lib/errors';
import { createTestDb } from '../../tests/helpers/testDb';
import { seedBaseFixtures } from '../../tests/helpers/fixtures';
import { resetSettingsUserPassword } from '../settings.service';

describe('resetSettingsUserPassword', () => {
  it('lets a supervisor reset an active user and invalidates the old password', async () => {
    const { db } = createTestDb();
    const { orgId, supervisorId, installerId } = seedBaseFixtures(db);
    const oldHash = await bcrypt.hash('Original-pass-2026!', 4);
    const currentSecond = Math.floor(Date.now() / 1000);
    db.update(users).set({ passwordHash: oldHash, updatedAt: currentSecond }).where(eq(users.id, installerId)).run();

    await resetSettingsUserPassword(
      db,
      { id: supervisorId, orgId, role: 'supervisor' },
      { userId: installerId, newPassword: 'Replacement-pass-2026!', confirmPassword: 'Replacement-pass-2026!' },
    );

    const updated = db.select().from(users).where(eq(users.id, installerId)).get()!;
    expect(await bcrypt.compare('Original-pass-2026!', updated.passwordHash)).toBe(false);
    expect(await bcrypt.compare('Replacement-pass-2026!', updated.passwordHash)).toBe(true);
    expect(updated.updatedAt).toBeGreaterThan(currentSecond);
  });

  it('rejects password resets from installers', async () => {
    const { db } = createTestDb();
    const { orgId, supervisorId, installerId } = seedBaseFixtures(db);

    await expect(resetSettingsUserPassword(
      db,
      { id: installerId, orgId, role: 'installer' },
      { userId: supervisorId, newPassword: 'Replacement-pass-2026!', confirmPassword: 'Replacement-pass-2026!' },
    )).rejects.toBeInstanceOf(AuthzError);
  });

  it('does not expose users from another organisation', async () => {
    const { db } = createTestDb();
    const { orgId, supervisorId } = seedBaseFixtures(db);
    const otherOrgId = createId();
    const otherUserId = createId();
    db.insert(organisations).values({ id: otherOrgId, name: 'Other Org' }).run();
    db.insert(users).values({
      id: otherUserId,
      orgId: otherOrgId,
      username: 'outsider',
      displayName: 'Outsider',
      passwordHash: await bcrypt.hash('Original-pass-2026!', 4),
      role: 'installer',
    }).run();

    await expect(resetSettingsUserPassword(
      db,
      { id: supervisorId, orgId, role: 'supervisor' },
      { userId: otherUserId, newPassword: 'Replacement-pass-2026!', confirmPassword: 'Replacement-pass-2026!' },
    )).rejects.toThrow('User could not be found.');
  });
});
