import { createId } from '@paralleldrive/cuid2';
import bcrypt from 'bcryptjs';
import { db, sqlite } from '../db';
import { organisations, users } from '../db/schema';
import { ORG_NAME, SEED_USERS } from '../config/client.config';

async function main() {
  const SEED_PASSWORD = process.env.SEED_USER_PASSWORD;
  if (!SEED_PASSWORD) {
    throw new Error('SEED_USER_PASSWORD env var is required to seed users');
  }

  const existingOrg = db.select().from(organisations).all()[0];
  const orgId = existingOrg?.id ?? createId();

  if (!existingOrg) {
    db.insert(organisations).values({ id: orgId, name: ORG_NAME }).run();
    console.log(`created organisation: ${ORG_NAME} (${orgId})`);
  } else {
    console.log(`organisation already exists: ${existingOrg.name} (${orgId})`);
  }

  const passwordHash = await bcrypt.hash(SEED_PASSWORD, 10);

  for (const seedUser of SEED_USERS) {
    const username = seedUser.displayName.toLowerCase();
    const existing = db.select().from(users).all().find((u) => u.username === username);
    if (existing) {
      console.log(`skip (exists): ${username}`);
      continue;
    }
    db.insert(users)
      .values({
        id: createId(),
        orgId,
        username,
        displayName: seedUser.displayName,
        passwordHash,
        role: seedUser.role,
      })
      .run();
    console.log(`created user: ${username} (${seedUser.role})`);
  }

  console.log('Seed complete.');
}

main()
  .catch((err) => {
    console.error(err);
    process.exitCode = 1;
  })
  .finally(() => {
    sqlite.close();
  });
