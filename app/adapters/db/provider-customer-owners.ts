import { and, eq } from 'drizzle-orm';

import type { ProviderCustomerOwnerRepository } from '#core/server/ports.js';

import type { Db } from './client.js';
import { providerCustomerOwners } from './schema.js';

export const createProviderCustomerOwnerRepository = (db: Db): ProviderCustomerOwnerRepository => ({
  claimStripeCustomer: async (tenantId, customerId, claimedAt) => {
    await db.insert(providerCustomerOwners)
      .values({ provider: 'stripe', customerId, tenantId, createdAt: claimedAt })
      .onConflictDoNothing({ target: [providerCustomerOwners.provider, providerCustomerOwners.customerId] });
    const [owner] = await db.select({ tenantId: providerCustomerOwners.tenantId }).from(providerCustomerOwners)
      .where(and(eq(providerCustomerOwners.provider, 'stripe'), eq(providerCustomerOwners.customerId, customerId)))
      .limit(1);
    return owner?.tenantId === tenantId ? 'this-workspace' : 'another-workspace';
  },
});
