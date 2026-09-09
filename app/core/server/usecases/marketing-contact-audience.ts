import { appError, contactCampaignAudienceSchema, err, ok, validation, type AppError, type ContactAudiencePreview, type ContactCampaignAudience, type Result } from '#core/domain/index.js';

import { authorizeRequiredTenant } from '../authorize.js';
import type { Ctx } from '../context.js';
import type { MarketingContactAudienceDeps } from '../marketing-audience-ports.js';
import { reconcileMarketingMemberContacts } from './marketing-member-contacts.js';

export const prepareMarketingContactAudience = async (tenantId: string, audience: ContactCampaignAudience, deps: MarketingContactAudienceDeps): Promise<Result<void, AppError>> => {
  const parsed = contactCampaignAudienceSchema.safeParse(audience);
  if (!parsed.success) return err(validation('Invalid contact audience', parsed.error.flatten()));
  const lists = await Promise.all([...new Set([...audience.includeLists, ...audience.excludeLists])].map((id) => deps.directory.lists.findById(tenantId, id)));
  if (lists.some((list) => list === null || list.archivedAt !== null)) return err(validation('Audience lists must exist and be active in this tenant'));
  if (audience.excludeProductIds.length > 0 && !await deps.directory.lists.validateRule(tenantId, { kind: 'product_grant', productIds: audience.excludeProductIds, state: 'ever' })) return err(validation('Excluded products must exist in this tenant'));
  if (audience.includeMembersWithConsent || audience.excludeProductIds.length > 0 || lists.some((list) => list?.rule?.kind === 'product_grant')) {
    const synced = await reconcileMarketingMemberContacts(tenantId, { maxJobs: 500, deadlineAt: new Date(Date.parse(deps.clock.nowIso()) + 2000).toISOString() }, deps.directory);
    if (!synced.ok) return synced;
    if (synced.value.pending) return err(appError('conflict', 'Directory synchronization in progress; retry the audience preview or schedule'));
  }
  return ok(undefined);
};

export const previewMarketingContactAudience = async (ctx: Ctx, input: { audience: ContactCampaignAudience; consentDefinitionId: string }, deps: MarketingContactAudienceDeps): Promise<Result<ContactAudiencePreview, AppError>> => {
  const tenant = authorizeRequiredTenant(ctx, 'marketing:campaign:read');
  if (!tenant.ok) return tenant;
  const read = authorizeRequiredTenant(ctx, 'marketing:contact:read');
  if (!read.ok) return read;
  const parsed = contactCampaignAudienceSchema.safeParse(input.audience);
  if (!parsed.success) return err(validation('Invalid contact audience', parsed.error.flatten()));
  const prepared = await prepareMarketingContactAudience(tenant.value, parsed.data, deps);
  if (!prepared.ok) return prepared;
  return deps.contactAudience.preview(tenant.value, { audience: parsed.data, consentDefinitionId: input.consentDefinitionId, asOf: deps.clock.nowIso() });
};
