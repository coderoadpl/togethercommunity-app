import { and, eq, isNull } from 'drizzle-orm';

import type { CheckoutConsentJobRepository } from '#core/server/index.js';

import type { Db } from './client.js';
import { checkoutConsentJobs } from './app-schema.js';

export const createCheckoutConsentJobRepository = (db: Db): CheckoutConsentJobRepository => ({
  enqueue: async (tenantId, job) => {
    await db.insert(checkoutConsentJobs).values({ ...job, tenantId }).onConflictDoNothing();
  },
  lockPending: async (tenantId, checkoutSessionId) => (await db.select().from(checkoutConsentJobs)
    .where(and(
      eq(checkoutConsentJobs.tenantId, tenantId),
      eq(checkoutConsentJobs.checkoutSessionId, checkoutSessionId),
      isNull(checkoutConsentJobs.completedAt),
    )).for('update'))[0] ?? null,
  complete: async (tenantId, checkoutSessionId, completedAt) => {
    await db.update(checkoutConsentJobs).set({ completedAt }).where(and(
      eq(checkoutConsentJobs.tenantId, tenantId),
      eq(checkoutConsentJobs.checkoutSessionId, checkoutSessionId),
      isNull(checkoutConsentJobs.completedAt),
    ));
  },
});
