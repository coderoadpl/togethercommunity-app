import { z } from 'zod';

const listIds = z.array(z.string().min(1)).max(100).transform((ids) => [...new Set(ids)].sort());
export const contactCampaignAudienceSchema = z.object({
  version: z.literal(2),
  includeLists: listIds,
  excludeLists: listIds,
  excludeProductIds: listIds,
  includeMembersWithConsent: z.boolean(),
}).strict();
export type ContactCampaignAudience = z.output<typeof contactCampaignAudienceSchema>;

export const marketingAudienceSkipReasonSchema = z.enum(['suppressed', 'unsubscribed', 'not_consented', 'pending_confirmation', 'contact_archived', 'contact_address_changed']);
const marketingAudienceSkippedSchema = z.object({ suppressed: z.number().int().nonnegative(), withdrawn: z.number().int().nonnegative(), pendingConfirmation: z.number().int().nonnegative(), noConsent: z.number().int().nonnegative() });
export const contactAudiencePreviewSchema = z.object({
  count: z.number().int().nonnegative(), candidateCount: z.number().int().nonnegative(), excludedCount: z.number().int().nonnegative(),
  skipped: marketingAudienceSkippedSchema,
  sample: z.array(z.object({ contactId: z.string(), email: z.string().email(), displayName: z.string().nullable(), memberId: z.string().nullable() })).max(20),
  computedAt: z.string().datetime(), audienceHash: z.string().min(1),
});
export type ContactAudiencePreview = z.output<typeof contactAudiencePreviewSchema>;
export const marketingAudienceContactSchema = z.object({
  tenantId: z.string(), snapshotId: z.string(), contactId: z.string(), email: z.string().email(), emailHmac: z.string(),
  memberIdSnapshot: z.string().nullable(), displayNameSnapshot: z.string().nullable(), firstNameSnapshot: z.string().nullable(),
  consentRowId: z.string().nullable(), eligibilityAtSnapshot: z.boolean(), skipReason: marketingAudienceSkipReasonSchema.nullable(), createdAt: z.string().datetime(),
});
export type MarketingAudienceContact = z.output<typeof marketingAudienceContactSchema>;
export const marketingAudienceSnapshotSchema = z.object({
  id: z.string(), tenantId: z.string(), campaignId: z.string(), revision: z.number().int().positive(), audienceJson: contactCampaignAudienceSchema,
  listRevisionSnapshots: z.array(z.object({ id: z.string(), revision: z.number().int() })),
  consentDefinitionId: z.string(), definitionVersion: z.number().int().positive(), candidateCount: z.number().int().nonnegative(), eligibleCount: z.number().int().nonnegative(),
  skippedCounts: marketingAudienceSkippedSchema, createdAt: z.string().datetime(), maxContactId: z.string().nullable(),
});
export type MarketingAudienceSnapshot = z.output<typeof marketingAudienceSnapshotSchema>;
