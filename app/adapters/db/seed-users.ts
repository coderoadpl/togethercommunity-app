import { and, eq } from 'drizzle-orm';

import { createAuth } from '#adapters/auth/create-auth.js';
import type { Clock } from '#core/server/index.js';

import type { Db } from './client.js';
import { createEmailOutboxRepository } from './email-outbox.js';
import { account, user } from './schema.js';

export interface SeedUsers {
  ensurePassworded(email: string, name: string, password: string): Promise<string>;
  ensurePasswordless(id: string, email: string, name: string): Promise<string>;
}

export const createSeedUsers = (db: Db, clock: Clock): SeedUsers => {
  const auth = createAuth(db, {
    secret: process.env['BETTER_AUTH_SECRET'] ?? 'dev-only-secret-do-not-use-in-prod',
    baseUrl: 'http://localhost:48730',
    baseDomain: 'localhost',
    singleTenantMode: false,
    trustedOrigins: () => ['http://localhost:48730'],
    secureCookies: false,
    exposeMagicLinks: false,
    emailOutbox: createEmailOutboxRepository(db),
    ids: { nextId: () => crypto.randomUUID() },
    clock,
    dispatchEmail: () => undefined,
    defaultTenantName: 'Together',
    google: null,
  });

  return {
    ensurePassworded: async (email, name, password) => {
      const context = await auth.$context;
      const hashed = await context.password.hash(password);
      const existing = await db.select().from(user).where(eq(user.email, email)).limit(1);
      if (existing.length === 0) {
        // Signing up through the API would queue a verification e-mail for an
        // address that exists only in the fixture.
        const created = await context.internalAdapter.createUser({
          name,
          email,
          emailVerified: true,
        });
        await context.internalAdapter.linkAccount({
          userId: created.id,
          accountId: created.id,
          providerId: 'credential',
          password: hashed,
        });
      } else {
        await db
          .update(account)
          .set({ password: hashed })
          .where(and(
            eq(account.userId, existing[0]?.id ?? ''),
            eq(account.providerId, 'credential'),
          ));
      }
      const [row] = await db.select().from(user).where(eq(user.email, email)).limit(1);
      if (!row) throw new Error(`Seeded user not found: ${email}`);
      const seededAt = new Date(clock.nowIso());
      await db
        .update(user)
        .set({ emailVerified: true, createdAt: seededAt, updatedAt: seededAt })
        .where(eq(user.id, row.id));
      await db
        .update(account)
        .set({ createdAt: seededAt, updatedAt: seededAt })
        .where(eq(account.userId, row.id));
      return row.id;
    },

    ensurePasswordless: async (id, email, name) => {
      const existing = await db.select().from(user).where(eq(user.email, email)).limit(1);
      const found = existing[0];
      const now = new Date(clock.nowIso());
      if (found) {
        await db.update(user).set({ createdAt: now, updatedAt: now }).where(eq(user.id, found.id));
        return found.id;
      }
      await db
        .insert(user)
        .values({ id, name, email, emailVerified: true, createdAt: now, updatedAt: now })
        .onConflictDoNothing({ target: user.email });
      const rows = await db.select().from(user).where(eq(user.email, email)).limit(1);
      const row = rows[0];
      if (!row) throw new Error(`Seeded user not found: ${email}`);
      return row.id;
    },
  };
};
