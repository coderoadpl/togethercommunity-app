import { and, eq } from 'drizzle-orm';
import { err, notFound, ok, validation, type AppError } from '#core/domain/index.js';
import type { MarketingContactCampaignTransaction } from '#core/server/index.js';

import type { Db } from './client.js';
import { campaigns } from './schema.js';
import type { DirectoryRepositoryDeps } from './marketing-contact-repositories.js';
import { createMarketingContactAudienceRepository } from './marketing-contact-audience.js';
import { createCampaignRepository, createConsentDefinitionRepository } from './marketing-repositories.js';

class SnapshotRollback extends Error {
  constructor(readonly failure: AppError) { super(failure.message); }
}
export const createMarketingContactCampaignTransaction = (db: Db, deps: DirectoryRepositoryDeps): MarketingContactCampaignTransaction => ({
  schedule: async (tenantId, input) => {
    try {
      return await db.transaction(async (tx) => {
        await tx.select({ id: campaigns.id }).from(campaigns).where(and(eq(campaigns.tenantId, tenantId), eq(campaigns.id, input.campaignId))).for('update');
        const repo = createCampaignRepository(tx);
        const campaign = await repo.findById(tenantId, input.campaignId);
        if (campaign === null) return err(notFound('Campaign was not found'));
        if (campaign.status !== 'draft' || campaign.audienceVersion !== 2 || campaign.audience === null) return err(validation('A contact campaign must be a draft before scheduling'));
        const snapshot = await createMarketingContactAudienceRepository(tx, deps).createSnapshot(tenantId, { campaignId: campaign.id, audience: campaign.audience, consentDefinitionId: campaign.consentDefinitionId, asOf: input.asOf });
        if (!snapshot.ok) throw new SnapshotRollback(snapshot.error);
        const version = (await createConsentDefinitionRepository(tx).listVersions(tenantId, campaign.consentDefinitionId)).at(-1);
        const updated = await repo.update(tenantId, { ...campaign, status: 'scheduled', sendAt: input.sendAt, audienceSnapshotId: snapshot.value.id, snapshotMaxContactId: snapshot.value.maxContactId, cursorContactId: null, candidateCount: snapshot.value.candidateCount, toSend: snapshot.value.eligibleCount, sent: 0, failed: 0, skipped: 0, errorCount: 0, pausedReason: null, audienceNameSnapshot: 'Contact lists', consentLabelSnapshot: version?.label ?? null });
        return updated === null ? err(notFound('Campaign was not found')) : ok(updated);
      }, { isolationLevel: 'repeatable read' });
    } catch (cause) {
      if (cause instanceof SnapshotRollback) return err(cause.failure);
      throw cause;
    }
  },
});
