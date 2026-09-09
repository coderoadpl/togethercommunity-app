import type { AppError } from '#core/domain/index.js';
import type { MarketingDeliveryRepos, MarketingDeliveryTransaction } from '#core/server/index.js';

import type { Db } from './client.js';
import { createEmailOutboxRepository } from './email-outbox.js';
import { createEmailEventRepository } from './email-events.js';
import { createMarketingOutboxRepository } from './marketing-outbox.js';
import { createMarketingSnsInboxRepository } from './marketing-sns-inbox.js';
import { createCampaignRepository, createCampaignSendRepository, createSuppressionRepository, createUnsubscribeTokenRepository, createTenantSesSettingsRepository } from './marketing-repositories.js';

export const createMarketingDeliveryRepos = (db: Db): MarketingDeliveryRepos => ({
  marketingOutbox: createMarketingOutboxRepository(db), snsInbox: createMarketingSnsInboxRepository(db),
  sends: createCampaignSendRepository(db), campaigns: createCampaignRepository(db), events: createEmailEventRepository(db),
  suppressions: createSuppressionRepository(db), unsubscribes: createUnsubscribeTokenRepository(db),
  sesSettings: createTenantSesSettingsRepository(db), outbox: createEmailOutboxRepository(db),
});
class DeliveryRollback extends Error {
  constructor(readonly failure: AppError) { super(failure.message); }
}
export const createMarketingDeliveryTransaction = (db: Db): MarketingDeliveryTransaction => ({
  run: async (tenantId, operation) => {
    if (tenantId.length === 0) throw new Error('Tenant context is required');
    try {
      return await db.transaction(async (tx) => {
        const result = await operation(createMarketingDeliveryRepos(tx));
        if (!result.ok) throw new DeliveryRollback(result.error);
        return result;
      });
    } catch (cause) {
      if (cause instanceof DeliveryRollback) return { ok: false, error: cause.failure };
      throw cause;
    }
  },
});
