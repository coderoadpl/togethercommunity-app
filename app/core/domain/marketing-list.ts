import { z } from 'zod';

import { marketingTagsSchema } from './marketing-contact.js';

export const marketingListKeySchema = z.string().trim().min(1).max(120).regex(/^[a-z0-9][a-z0-9_-]*$/);
export const marketingListRuleSchema = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('tag'), tags: marketingTagsSchema.refine((tags) => tags.length > 0), match: z.enum(['any', 'all']) }).strict(),
  z.object({ kind: z.literal('product_grant'), productIds: z.array(z.string().min(1)).min(1).max(50), state: z.enum(['active', 'ever']) }).strict(),
  z.object({ kind: z.literal('consent_definition'), definitionId: z.string().min(1), state: z.literal('active') }).strict(),
]);
export type MarketingListRule = z.output<typeof marketingListRuleSchema>;
export const marketingListSchema = z.object({
  id: z.string().min(1), tenantId: z.string().min(1), key: marketingListKeySchema,
  name: z.string().trim().min(1).max(200), kind: z.enum(['static', 'dynamic']),
  rule: marketingListRuleSchema.nullable(), revision: z.number().int().positive(),
  createdAt: z.string().datetime(), updatedAt: z.string().datetime(), archivedAt: z.string().datetime().nullable(),
}).refine((list) => (list.kind === 'static') === (list.rule === null), 'Static lists cannot have rules; dynamic lists require a rule');
export type MarketingList = z.output<typeof marketingListSchema>;
export const marketingListCreateSchema = z.object({
  key: marketingListKeySchema, name: z.string().trim().min(1).max(200), rule: marketingListRuleSchema.nullable().default(null),
}).strict();
export const marketingListUpdateSchema = z.object({
  listId: z.string().min(1), expectedRevision: z.number().int().positive(),
  name: z.string().trim().min(1).max(200).optional(), rule: marketingListRuleSchema.optional(),
}).strict();
export const marketingListQuerySchema = z.object({ cursor: z.string().optional(), limit: z.number().int().min(1).max(100).default(50), archived: z.boolean().default(false) }).strict();
export type MarketingListQuery = z.output<typeof marketingListQuerySchema>;
export const marketingListPageSchema = z.object({ lists: z.array(marketingListSchema), nextCursor: z.string().nullable() });
export type MarketingListPage = z.output<typeof marketingListPageSchema>;
export const marketingListCountsSchema = z.object({
  contactCount: z.number().int().nonnegative(), suppressedCount: z.number().int().nonnegative(),
  eligibleCount: z.number().int().nonnegative().nullable(), consentDefinitionId: z.string().nullable(), computedAt: z.string().datetime(),
});
export type MarketingListCounts = z.output<typeof marketingListCountsSchema>;
export const marketingListMembershipChangeSchema = z.object({ listId: z.string().min(1), contactIds: z.array(z.string().min(1)).min(1).max(200) }).strict();
export type MarketingListMembershipChange = z.output<typeof marketingListMembershipChangeSchema>;
export type MarketingListMembershipResult = { changed: number };
export type MarketingListSave = { list: MarketingList; expectedRevision: number | null };
