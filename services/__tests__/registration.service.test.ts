import { describe, it, expect } from 'vitest';
import { eq, isNull, and } from 'drizzle-orm';
import { kitMembers, devices, slotPairings } from '../../db/schema';
import { createTestDb } from '../../tests/helpers/testDb';
import { seedBaseFixtures } from '../../tests/helpers/fixtures';
import { registerKit } from '../registration.service';
import { BusinessError } from '../../lib/errors';

describe('registration.service', () => {
  it('writes an unslotted kit: mother + 3 subs, all available, kit_members open with no slot', () => {
    const { db } = createTestDb();
    const { orgId, installerId } = seedBaseFixtures(db);

    const result = registerKit(db, {
      orgId,
      actorUserId: installerId,
      motherSerial: '123456789012',
      subSerials: ['AABBCCDDEEFF', '112233445566', '778899AABBCC'],
      simNumber: '2348012345678',
    });

    const mother = db.select().from(devices).where(eq(devices.id, result.motherDeviceId)).get()!;
    expect(mother.deviceType).toBe('mother');
    expect(mother.lifecycleStatus).toBe('available');

    expect(result.subDeviceIds).toHaveLength(3);
    for (const subId of result.subDeviceIds) {
      const sub = db.select().from(devices).where(eq(devices.id, subId)).get()!;
      expect(sub.deviceType).toBe('sub');
      expect(sub.lifecycleStatus).toBe('available');

      const membership = db
        .select()
        .from(kitMembers)
        .where(and(eq(kitMembers.subDeviceId, subId), isNull(kitMembers.removedAt)))
        .get()!;
      expect(membership).toBeTruthy();
      expect(membership.motherDeviceId).toBe(result.motherDeviceId);
    }

    // Slots are assigned only at install (§2, §6) — registration must not have created any.
    const anySlotPairings = db.select().from(slotPairings).all();
    expect(anySlotPairings).toHaveLength(0);
  });

  it('registration never writes to slot_pairings — slots are install-only (§2, §6)', () => {
    const { db } = createTestDb();
    const { orgId, installerId } = seedBaseFixtures(db);

    const result = registerKit(db, {
      orgId,
      actorUserId: installerId,
      motherSerial: '222222222222',
      subSerials: ['S1AAAAAAAAAA', 'S2BBBBBBBBBB', 'S3CCCCCCCCCC'],
      simNumber: '2348033333333',
    });

    // No slot_pairings rows at all — not even unslotted placeholders.
    expect(db.select().from(slotPairings).all()).toHaveLength(0);

    // kit_members rows exist for this mother, open, and carry no slot value (kit_members has
    // no slot column — slotting is only representable via slot_pairings, created at install).
    const memberships = db
      .select()
      .from(kitMembers)
      .where(eq(kitMembers.motherDeviceId, result.motherDeviceId))
      .all();
    expect(memberships).toHaveLength(3);
    for (const m of memberships) {
      expect(m.removedAt).toBeNull();
      expect(Object.prototype.hasOwnProperty.call(m, 'slot')).toBe(false);
    }
  });

  it('a duplicate serial (mother or sub) throws BusinessError — write-once per device', () => {
    const { db } = createTestDb();
    const { orgId, installerId } = seedBaseFixtures(db);

    registerKit(db, {
      orgId,
      actorUserId: installerId,
      motherSerial: '999999999999',
      subSerials: ['AAAAAAAAAAAA', 'BBBBBBBBBBBB', 'CCCCCCCCCCCC'],
      simNumber: '2348000000000',
    });

    // Same mother serial again, with fresh (distinct) subs.
    expect(() =>
      registerKit(db, {
        orgId,
        actorUserId: installerId,
        motherSerial: '999999999999',
        subSerials: ['DDDDDDDDDDDD', 'EEEEEEEEEEEE', 'FFFFFFFFFFFF'],
        simNumber: '2348011111111',
      }),
    ).toThrow(BusinessError);

    // A brand-new mother, but reusing one of the already-registered sub serials.
    expect(() =>
      registerKit(db, {
        orgId,
        actorUserId: installerId,
        motherSerial: '888888888888',
        subSerials: ['AAAAAAAAAAAA', 'GGGGGGGGGGGG', 'HHHHHHHHHHHH'],
        simNumber: '2348022222222',
      }),
    ).toThrow(BusinessError);
  });
});
