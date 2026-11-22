import { z } from 'zod';

import {
  CHANGE_PROPOSAL_GROUP_LIMITS,
  CHANGE_PROPOSAL_LIMITS,
  changeProposalGroupKeyReceiptSchema,
  changeProposalGroupOwnerViewSchema,
  changeProposalKeyReceiptPageSchema,
  changeProposalKeyReceiptSchema,
  changeProposalListStatusSchema,
  changeProposalOwnerDetailSchema,
  changeProposalOwnerPageSchema,
  changeProposalOwnerViewSchema,
  changeProposalSummarySchema,
  createChangeProposalGroupInputSchema,
} from '#core/domain/index.js';

export const PROPOSAL_GROUP_HEADER = 'x-proposal-group';

export const changeProposalGroupIdSchema = z.string()
  .min(1)
  .max(CHANGE_PROPOSAL_LIMITS.identifierMaxLength)
  .regex(/^[A-Za-z0-9][A-Za-z0-9_.-]*$/, 'A change proposal group id holds only letters, digits, ".", "_" and "-"');

export const SHOP_PROPOSAL_ROUTES = {
  listProposals: { method: 'GET', path: '/api/m2m/shop/proposals', scope: null },
  getProposal: { method: 'GET', path: '/api/m2m/shop/proposals/:id', scope: null },
  withdrawProposal: { method: 'POST', path: '/api/m2m/shop/proposals/:id/withdraw', scope: null },
  createGroup: { method: 'POST', path: '/api/m2m/shop/proposals/groups', scope: null },
  getGroup: { method: 'GET', path: '/api/m2m/shop/proposals/groups/:id', scope: null },
  withdrawGroup: { method: 'POST', path: '/api/m2m/shop/proposals/groups/:id/withdraw', scope: null },
} as const;

export const changeProposalListQuerySchema = z.object({
  status: changeProposalListStatusSchema.optional(),
  cursor: z.string().min(1).max(CHANGE_PROPOSAL_LIMITS.identifierMaxLength).optional(),
  groupId: changeProposalGroupIdSchema.optional(),
  limit: z.coerce.number().int().min(1).max(100).optional(),
}).strict();

export type ChangeProposalListQueryInput = z.input<typeof changeProposalListQuerySchema>;

export const changeProposalReceiptOutputSchema = z.object({ proposal: changeProposalKeyReceiptSchema });

export const changeProposalProposedOutputSchema = z.object({
  outcome: z.literal('proposed'),
  proposal: changeProposalKeyReceiptSchema,
  group: changeProposalGroupKeyReceiptSchema.optional(),
});

export type ChangeProposalProposedOutput = z.output<typeof changeProposalProposedOutputSchema>;

export const proposableOutputSchema = <T extends object>(applied: z.ZodType<T, z.ZodTypeDef, unknown>) =>
  z.union([
    changeProposalProposedOutputSchema,
    applied.transform((data): { outcome: 'applied' } & T => ({ outcome: 'applied', ...data })),
  ]);

export const changeProposalGroupCreateInputSchema = createChangeProposalGroupInputSchema;

export type ChangeProposalGroupCreateInput = z.input<typeof changeProposalGroupCreateInputSchema>;

export const changeProposalGroupReceiptOutputSchema = z.object({ group: changeProposalGroupKeyReceiptSchema });

export const shopProposalContracts = {
  listProposals: { input: changeProposalListQuerySchema, output: changeProposalKeyReceiptPageSchema },
  getProposal: { output: changeProposalReceiptOutputSchema },
  withdrawProposal: { output: changeProposalReceiptOutputSchema },
  createGroup: { input: changeProposalGroupCreateInputSchema, output: changeProposalGroupReceiptOutputSchema },
  getGroup: { output: changeProposalGroupReceiptOutputSchema },
  withdrawGroup: { output: changeProposalGroupReceiptOutputSchema },
} as const;

export const changeProposalsListOutputSchema = changeProposalOwnerPageSchema;

export const changeProposalShowOutputSchema = z.object({ proposal: changeProposalOwnerDetailSchema });

export const changeProposalSummaryOutputSchema = changeProposalSummarySchema;

export const changeProposalRejectInputSchema = z.object({
  note: z.string().max(CHANGE_PROPOSAL_LIMITS.decisionNoteMaxLength).nullable().optional(),
}).strict();

export type ChangeProposalRejectInput = z.input<typeof changeProposalRejectInputSchema>;

export const changeProposalRejectOutputSchema = z.object({ proposal: changeProposalOwnerViewSchema });

export const changeProposalApproveInputSchema = z.object({}).strict();

export const changeProposalApproveOutputSchema = z.object({ proposal: changeProposalOwnerViewSchema });

export const changeProposalGroupOutputSchema = z.object({ group: changeProposalGroupOwnerViewSchema });

export const changeProposalGroupApproveInputSchema = z.object({
  itemIds: z.array(z.string().min(1).max(CHANGE_PROPOSAL_LIMITS.identifierMaxLength)).min(1).max(CHANGE_PROPOSAL_GROUP_LIMITS.itemsPerGroup),
}).strict();

export type ChangeProposalGroupApproveInput = z.input<typeof changeProposalGroupApproveInputSchema>;
