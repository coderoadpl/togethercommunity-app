import { z } from 'zod';

import {
  CHANGE_PROPOSAL_LIMITS,
  changeProposalDisplayStatusSchema,
  changeProposalKeyReceiptPageSchema,
  changeProposalKeyReceiptSchema,
  changeProposalOwnerDetailSchema,
  changeProposalOwnerPageSchema,
  changeProposalOwnerViewSchema,
} from '#core/domain/index.js';

export const SHOP_PROPOSAL_ROUTES = {
  listProposals: { method: 'GET', path: '/api/m2m/shop/proposals', scope: null },
  getProposal: { method: 'GET', path: '/api/m2m/shop/proposals/:id', scope: null },
  withdrawProposal: { method: 'POST', path: '/api/m2m/shop/proposals/:id/withdraw', scope: null },
} as const;

export const changeProposalListQuerySchema = z.object({
  status: changeProposalDisplayStatusSchema.optional(),
  cursor: z.string().min(1).max(CHANGE_PROPOSAL_LIMITS.identifierMaxLength).optional(),
  limit: z.coerce.number().int().min(1).max(100).optional(),
}).strict();

export type ChangeProposalListQueryInput = z.input<typeof changeProposalListQuerySchema>;

export const changeProposalReceiptOutputSchema = z.object({ proposal: changeProposalKeyReceiptSchema });

export const changeProposalProposedOutputSchema = z.object({
  outcome: z.literal('proposed'),
  proposal: changeProposalKeyReceiptSchema,
});

export type ChangeProposalProposedOutput = z.output<typeof changeProposalProposedOutputSchema>;

export const proposableOutputSchema = <T extends object>(applied: z.ZodType<T, z.ZodTypeDef, unknown>) =>
  z.union([
    changeProposalProposedOutputSchema,
    applied.transform((data): { outcome: 'applied' } & T => ({ outcome: 'applied', ...data })),
  ]);

export const shopProposalContracts = {
  listProposals: { input: changeProposalListQuerySchema, output: changeProposalKeyReceiptPageSchema },
  getProposal: { output: changeProposalReceiptOutputSchema },
  withdrawProposal: { output: changeProposalReceiptOutputSchema },
} as const;

export const changeProposalsListOutputSchema = changeProposalOwnerPageSchema;

export const changeProposalShowOutputSchema = z.object({ proposal: changeProposalOwnerDetailSchema });

export const changeProposalRejectInputSchema = z.object({
  note: z.string().max(CHANGE_PROPOSAL_LIMITS.decisionNoteMaxLength).nullable().optional(),
}).strict();

export type ChangeProposalRejectInput = z.input<typeof changeProposalRejectInputSchema>;

export const changeProposalRejectOutputSchema = z.object({ proposal: changeProposalOwnerViewSchema });

export const changeProposalApproveInputSchema = z.object({}).strict();

export const changeProposalApproveOutputSchema = z.object({ proposal: changeProposalOwnerViewSchema });
