import { and, eq, sql } from 'drizzle-orm';

import type { ProviderCustomerOwnerRepository } from '#core/server/ports.js';

import type { Db } from './client.js';
import { providerCustomerOwners } from './schema.js';

export const createProviderCustomerOwnerRepository = (db: Db): ProviderCustomerOwnerRepository => ({
  claimStripeCustomer: async (tenantId, claim) => {
    await db.insert(providerCustomerOwners)
      .values({ provider: 'stripe', customerId: claim.customerId, tenantId, memberId: claim.memberId, createdAt: claim.claimedAt })
      .onConflictDoUpdate({
        target: [providerCustomerOwners.provider, providerCustomerOwners.customerId],
        set: { memberId: sql`excluded.member_id` },
        setWhere: sql`${providerCustomerOwners.tenantId} = ${tenantId} and ${providerCustomerOwners.memberId} is null`,
      });
    const [owner] = await db.select({ tenantId: providerCustomerOwners.tenantId }).from(providerCustomerOwners)
      .where(and(eq(providerCustomerOwners.provider, 'stripe'), eq(providerCustomerOwners.customerId, claim.customerId)))
      .limit(1);
    return owner?.tenantId === tenantId ? 'this-workspace' : 'another-workspace';
  },
});
