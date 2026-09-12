import { z } from 'zod';

import { validation, type AppError } from './errors.js';
import { err, ok, type Result } from './result.js';

export const CONTACT_AUDIENCE_LIST_OVERLAP_MESSAGE = 'A list cannot be both included and excluded';

const listIds = z.array(z.string().min(1)).max(100).transform((ids) => [...new Set(ids)].sort());
export const contactCampaignAudienceSchema = z.object({
  version: z.literal(2),
  includeLists: listIds,
  excludeLists: listIds,
  excludeProductIds: listIds,
  includeMembersWithConsent: z.boolean(),
}).strict();
export type ContactCampaignAudience = z.output<typeof contactCampaignAudienceSchema>;

export const contactCampaignAudienceInputSchema = contactCampaignAudienceSchema.superRefine((audience, ctx) => {
  if (!audience.includeLists.some((id) => audience.excludeLists.includes(id))) return;
  ctx.addIssue({ code: z.ZodIssueCode.custom, path: ['includeLists'], message: CONTACT_AUDIENCE_LIST_OVERLAP_MESSAGE });
  ctx.addIssue({ code: z.ZodIssueCode.custom, path: ['excludeLists'], message: CONTACT_AUDIENCE_LIST_OVERLAP_MESSAGE });
});

export const normalizeStoredContactCampaignAudience = (audience: ContactCampaignAudience): Result<{ audience: ContactCampaignAudience; changed: boolean }, AppError> => {
  const parsed = contactCampaignAudienceSchema.safeParse(audience);
  if (!parsed.success) return err(validation('Invalid contact audience', parsed.error.flatten()));
  const excluded = new Set(parsed.data.excludeLists);
  const includeLists = parsed.data.includeLists.filter((id) => !excluded.has(id));
  return ok({ audience: { ...parsed.data, includeLists }, changed: includeLists.length !== parsed.data.includeLists.length });
};

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
