import { and, eq, sql } from 'drizzle-orm';

import type { AppError, Result } from '#core/domain/index.js';
import type { SubscriptionAdoptionRepositories, SubscriptionAdoptionTransaction } from '#core/server/index.js';

import type { Db } from './client.js';
import { createMemberEventRepository } from './member-events.js';
import {
  createMemberRepository, createMemberSubscriptionRepository, createProductGrantRepository,
  createProductPriceRepository, createProductRepository,
} from './repositories.js';
import { createProviderCustomerOwnerRepository } from './provider-customer-owners.js';
import { members } from './schema.js';
import { createStripeWebhookOwnershipReader } from './stripe-webhook-ownership.js';

const lockKey = async (tx: Db, key: string) => {
  await tx.execute(sql`select pg_advisory_xact_lock(hashtextextended(${key}, 0))`);
};

const createAdoptionMemberRepository = (tx: Db): SubscriptionAdoptionRepositories['members'] => ({
  findByEmail: createMemberRepository(tx).findByEmail,
  // FOR SHARE conflicts with the FOR UPDATE member erasure takes, so an erasure and an adoption of one member commit one after the other.
  findByIdForShare: async (tenantId, memberId) => {
    const [member] = await tx.select().from(members)
      .where(and(eq(members.tenantId, tenantId), eq(members.id, memberId))).for('share');
    return member ?? null;
  },
});

export const createSubscriptionAdoptionTransaction = (db: Db): SubscriptionAdoptionTransaction => ({
  run: async (tenantId, stripe, operation) => {
    let rejected: Result<never, AppError> | null = null;
    try {
      return await db.transaction(async (tx) => {
        // Every adoption takes workspace, subscription, then customer locks in this order, so no two adoptions wait on each other in a cycle.
        await lockKey(tx, `subscription-adoption:${tenantId}`);
        await lockKey(tx, `stripe-subscription:${stripe.subscriptionId}`);
        await lockKey(tx, `stripe-customer:${stripe.customerId}`);
        const result = await operation({
          members: createAdoptionMemberRepository(tx), customerOwners: createProviderCustomerOwnerRepository(tx), products: createProductRepository(tx),
          prices: createProductPriceRepository(tx), subscriptions: createMemberSubscriptionRepository(tx),
          grants: createProductGrantRepository(tx), memberEvents: createMemberEventRepository(tx),
          stripeWebhookOwnership: createStripeWebhookOwnershipReader(tx),
        });
        // Drizzle rolls back by throwing, so remember expected domain errors before aborting the transaction.
        if (!result.ok) { rejected = result; tx.rollback(); }
        return result;
      });
    } catch (cause) {
      if (rejected !== null) return rejected;
      throw cause;
    }
  },
});
