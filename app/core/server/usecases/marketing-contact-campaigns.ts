import { contactCampaignAudienceSchema, contactCampaignAudienceInputSchema, err, notFound, ok, validation, type AppError, type Campaign, type ContactCampaignAudience, type Result } from '#core/domain/index.js';

import { authorizeRequiredTenant } from '../authorize.js';
import type { Ctx } from '../context.js';
import type { MarketingContactAudienceDeps } from '../marketing-audience-ports.js';
import type { CampaignRepository } from '../ports.js';
import { prepareMarketingContactAudience, prepareValidatedMarketingContactAudience } from './marketing-contact-audience.js';

interface LegacyAudienceLogger {
  warn(message: string): void;
}

const normalizeStoredMarketingContactAudience = (
  campaignId: string,
  audience: ContactCampaignAudience,
  logger: LegacyAudienceLogger,
): Result<ContactCampaignAudience, AppError> => {
  const parsed = contactCampaignAudienceSchema.safeParse(audience);
  if (!parsed.success) return err(validation('Invalid contact audience', parsed.error.flatten()));
  const excluded = new Set(parsed.data.excludeLists);
  const includeLists = parsed.data.includeLists.filter((id) => !excluded.has(id));
  if (includeLists.length !== parsed.data.includeLists.length) {
    logger.warn(`[marketing] normalized overlapping contact audience campaign=${campaignId}`);
  }
  return ok({ ...parsed.data, includeLists });
};

export const setMarketingCampaignAudience = async (ctx: Ctx, input: { campaignId: string; audience: ContactCampaignAudience }, deps: MarketingContactAudienceDeps & { campaigns: CampaignRepository }): Promise<Result<{ campaign: Campaign }, AppError>> => {
  const tenant = authorizeRequiredTenant(ctx, 'marketing:campaign:write');
  if (!tenant.ok) return tenant;
  const audience = contactCampaignAudienceInputSchema.safeParse(input.audience);
  if (!audience.success) return err(validation('Invalid contact audience', audience.error.flatten()));
  const campaign = await deps.campaigns.findById(tenant.value, input.campaignId);
  if (campaign === null) return err(notFound('Campaign was not found'));
  if (campaign.status !== 'draft') return err(validation('Return the campaign to draft before changing its audience'));
  const prepared = await prepareMarketingContactAudience(tenant.value, audience.data, deps);
  if (!prepared.ok) return prepared;
  const updated = await deps.campaigns.update(tenant.value, { ...campaign, audienceVersion: 2, audience: audience.data, audienceSnapshotId: null, snapshotMaxContactId: null, cursorContactId: null, candidateCount: 0, toSend: 0, skipped: 0 });
  return updated === null ? err(notFound('Campaign was not found')) : ok({ campaign: updated });
};

export const scheduleMarketingContactCampaign = async (ctx: Ctx, input: { campaignId: string; sendAt: string }, deps: MarketingContactAudienceDeps & { campaigns: CampaignRepository; logger: LegacyAudienceLogger }): Promise<Result<Campaign, AppError>> => {
  const tenant = authorizeRequiredTenant(ctx, 'marketing:campaign:send');
  if (!tenant.ok) return tenant;
  const campaign = await deps.campaigns.findById(tenant.value, input.campaignId);
  if (campaign === null) return err(notFound('Campaign was not found'));
  if (campaign.status !== 'draft' || campaign.audience === null) return err(validation('A contact campaign must be a draft before scheduling'));
  const audience = normalizeStoredMarketingContactAudience(campaign.id, campaign.audience, deps.logger);
  if (!audience.ok) return audience;
  const prepared = await prepareValidatedMarketingContactAudience(tenant.value, audience.value, deps);
  if (!prepared.ok) return prepared;
  return deps.contactCampaigns.schedule(tenant.value, { ...input, audience: audience.value, asOf: deps.clock.nowIso() });
};

export const returnMarketingCampaignToDraft = async (ctx: Ctx, input: { campaignId: string }, deps: { campaigns: CampaignRepository }): Promise<Result<Campaign, AppError>> => {
  const tenant = authorizeRequiredTenant(ctx, 'marketing:campaign:write');
  if (!tenant.ok) return tenant;
  const campaign = await deps.campaigns.findById(tenant.value, input.campaignId);
  if (campaign === null) return err(notFound('Campaign was not found'));
  if (campaign.status !== 'scheduled') return err(validation('Only a scheduled campaign can return to draft'));
  const updated = await deps.campaigns.update(tenant.value, { ...campaign, status: 'draft', sendAt: null, audienceSnapshotId: null, snapshotMaxContactId: null, cursorContactId: null, snapshotMaxMemberId: null, cursorMemberId: null, toSend: 0, candidateCount: 0, skipped: 0 });
  return updated === null ? err(notFound('Campaign was not found')) : ok(updated);
};
