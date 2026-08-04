import { z } from 'zod';

import type { Product } from './product.js';

const grantSourceSchema = z.enum(['simulated', 'manual', 'stripe', 'import']);

export type GrantSource = z.infer<typeof grantSourceSchema>;

export const grantWindowStatusSchema = z.enum(['active', 'upcoming', 'expired']);

export type GrantWindowStatus = z.infer<typeof grantWindowStatusSchema>;

export type GrantedProduct = Product & {
  grantStatus: GrantWindowStatus;
  grantStartsAt: string;
  grantExpiresAt: string | null;
};

export const productGrantSchema = z.object({
  id: z.string(),
  tenantId: z.string(),
  memberId: z.string(),
  productId: z.string(),
  source: grantSourceSchema,
  startsAt: z.string().datetime(),
  expiresAt: z.string().datetime().nullable(),
  legacyId: z.string().nullable(),
  createdAt: z.string().datetime(),
});

export type ProductGrant = z.infer<typeof productGrantSchema>;

export const memberGrantSchema = z.object({
  id: z.string(),
  productId: z.string(),
  productName: z.string(),
  startsAt: z.string().datetime(),
  expiresAt: z.string().datetime().nullable(),
  source: grantSourceSchema,
  active: z.boolean(),
});

export type MemberGrant = z.infer<typeof memberGrantSchema>;

export const grantProductToMemberInputSchema = z.object({
  memberId: z.string().min(1),
  productId: z.string().min(1),
  expiresAt: z.string().datetime().nullable().optional(),
});

export type GrantProductToMemberInput = z.input<typeof grantProductToMemberInputSchema>;

export const revokeGrantInputSchema = z.object({
  grantId: z.string().min(1),
});

export type RevokeGrantInput = z.input<typeof revokeGrantInputSchema>;

export const devGrantInputSchema = z.object({
  email: z.string().email(),
  productId: z.string().min(1),
  startsAt: z.string().datetime().optional(),
  expiresAt: z.string().datetime().nullable().optional(),
});

export type DevGrantInput = z.input<typeof devGrantInputSchema>;
