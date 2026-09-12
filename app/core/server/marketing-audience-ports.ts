import type { AppError, Campaign, ContactAudiencePreview, ContactCampaignAudience, MarketingAudienceContact, MarketingAudienceSnapshot, Result } from '#core/domain/index.js';
import type { MarketingContactDeps } from './marketing-contact-ports.js';
import type { Clock } from './ports.js';

export interface MarketingContactAudienceRepository {
  preview(tenantId: string, input: { audience: ContactCampaignAudience; consentDefinitionId: string; asOf: string }): Promise<Result<ContactAudiencePreview, AppError>>;
  createSnapshot(tenantId: string, input: { campaignId: string; audience: ContactCampaignAudience; consentDefinitionId: string; asOf: string }): Promise<Result<MarketingAudienceSnapshot, AppError>>;
  fetchSnapshotPage(tenantId: string, input: { snapshotId: string; afterContactId: string | null; maxContactId: string; limit: number }): Promise<MarketingAudienceContact[]>;
}
export interface MarketingContactCampaignTransaction {
  schedule(tenantId: string, input: { campaignId: string; sendAt: string; asOf: string }): Promise<Result<Campaign, AppError>>;
}
export interface MarketingContactAudienceDeps {
  contactAudience: MarketingContactAudienceRepository;
  contactCampaigns: MarketingContactCampaignTransaction;
  directory: MarketingContactDeps;
  clock: Clock;
}
