import { z } from 'zod';

import { normalizeEmail } from './email.js';

const marketingAddressSchema = z.string().transform(normalizeEmail).pipe(z.string().email());
export const marketingNameSchema = z.string().trim().max(200);
export const marketingTagsSchema = z.array(z.string().trim().min(1).max(64).refine((value) => !value.includes('|'), 'Pipe characters are not supported in tokens')).max(50).transform((tags) => [...new Set(tags)]);
export const marketingContactFieldsSchema = z.object({
  displayName: marketingNameSchema.nullable().optional(),
  firstName: marketingNameSchema.nullable().optional(),
  lastName: marketingNameSchema.nullable().optional(),
  source: z.string().trim().max(120).optional(),
  tags: marketingTagsSchema.optional(),
}).strict();
export const marketingContactUpsertSchema = marketingContactFieldsSchema.extend({ email: marketingAddressSchema });
export type MarketingContactUpsert = z.output<typeof marketingContactUpsertSchema>;
export const marketingContactSchema = z.object({
  id: z.string().min(1), tenantId: z.string().min(1), email: marketingAddressSchema,
  emailHmac: z.string().min(1), displayName: marketingNameSchema.nullable(),
  firstName: marketingNameSchema.nullable(), lastName: marketingNameSchema.nullable(),
  source: z.string().trim().min(1).max(120), tags: marketingTagsSchema,
  memberId: z.string().nullable(), createdAt: z.string().datetime(), updatedAt: z.string().datetime(),
  archivedAt: z.string().datetime().nullable(),
});
export type MarketingContact = z.output<typeof marketingContactSchema>;
export const marketingContactPublicSchema = marketingContactSchema.omit({ emailHmac: true });
export type MarketingContactPublic = z.output<typeof marketingContactPublicSchema>;
const marketingConsentStateSchema = z.enum(['none', 'pending_confirmation', 'active', 'withdrawn']);
export const marketingContactListQuerySchema = z.object({
  id: z.string().min(1).optional(), search: z.string().trim().max(200).optional(), tags: marketingTagsSchema.optional(),
  listId: z.string().min(1).optional(), consentDefinitionId: z.string().min(1).optional(),
  consentState: marketingConsentStateSchema.optional(), suppressed: z.boolean().optional(),
  linkedMember: z.boolean().optional(), archived: z.boolean().optional(),
  cursor: z.string().max(4000).optional(), limit: z.number().int().min(1).max(100).default(50),
}).strict().refine((query) => query.consentState === undefined || query.consentDefinitionId !== undefined, 'Consent state requires a consent definition');
export type MarketingContactListQuery = z.output<typeof marketingContactListQuerySchema>;
export const marketingContactViewSchema = marketingContactPublicSchema.extend({
  listKeys: z.array(z.string()), consentState: marketingConsentStateSchema.nullable(),
  suppressionReason: z.string().nullable(),
});
export type MarketingContactView = z.output<typeof marketingContactViewSchema>;
export const marketingContactPageSchema = z.object({ contacts: z.array(marketingContactViewSchema), nextCursor: z.string().nullable() });
export type MarketingContactPage = z.output<typeof marketingContactPageSchema>;
export type MarketingContactUpsertResult = { contact: MarketingContact; outcome: 'created' | 'updated' | 'unchanged' };

export const marketingContactUpdateSchema = marketingContactFieldsSchema.extend({ contactId: z.string().min(1) });
