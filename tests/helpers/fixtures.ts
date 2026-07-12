import { createId } from '@paralleldrive/cuid2';
import { organisations, users, trucks, devices } from '../../db/schema';

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type DbClient = any;

export function seedBaseFixtures(db: DbClient) {
  const orgId = createId();
  db.insert(organisations).values({ id: orgId, name: 'Test Org' }).run();

  const supervisorId = createId();
  db.insert(users)
    .values({
      id: supervisorId,
      orgId,
      username: 'sup',
      displayName: 'Sup',
      passwordHash: 'x',
      role: 'supervisor',
    })
    .run();

  const installerId = createId();
  db.insert(users)
    .values({
      id: installerId,
      orgId,
      username: 'inst',
      displayName: 'Inst',
      passwordHash: 'x',
      role: 'installer',
    })
    .run();

  return { orgId, supervisorId, installerId };
}

export function createTruck(db: DbClient, orgId: string, plate: string): string {
  const id = createId();
  db.insert(trucks).values({ id, orgId, plate, createdVia: 'manual' }).run();
  return id;
}

export function createDevice(
  db: DbClient,
  orgId: string,
  opts: { type: 'mother' | 'sub'; serial: string; status?: string },
): string {
  const id = createId();
  db.insert(devices)
    .values({
      id,
      orgId,
      deviceType: opts.type,
      serial: opts.serial,
      lifecycleStatus: opts.status ?? 'available',
    })
    .run();
  return id;
}
