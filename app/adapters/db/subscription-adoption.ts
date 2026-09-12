import { sql } from 'drizzle-orm';

import type { AppError, Result } from '#core/domain/index.js';
import type { SubscriptionAdoptionTransaction } from '#core/server/index.js';

import type { Db } from './client.js';
import { createMemberEventRepository } from './member-events.js';
import {
  createMemberRepository, createMemberSubscriptionRepository, createProductGrantRepository,
  createProductPriceRepository, createProductRepository,
} from './repositories.js';

export const createSubscriptionAdoptionTransaction = (db: Db): SubscriptionAdoptionTransaction => ({
  run: async (tenantId, operation) => {
    let rejected: Result<never, AppError> | null = null;
    try {
      return await db.transaction(async (tx) => {
        await tx.execute(sql`select pg_advisory_xact_lock(hashtextextended(${`subscription-adoption:${tenantId}`}, 0))`);
        const result = await operation({
          members: createMemberRepository(tx), products: createProductRepository(tx),
          prices: createProductPriceRepository(tx), subscriptions: createMemberSubscriptionRepository(tx),
          grants: createProductGrantRepository(tx), memberEvents: createMemberEventRepository(tx),
        });
        if (!result.ok) { rejected = result; tx.rollback(); }
        return result;
      });
    } catch (cause) {
      if (rejected !== null) return rejected;
      throw cause;
    }
  },
});
