import { z } from 'zod';

export const grantSourceSchema = z.enum(['simulated', 'manual']);

export type GrantSource = z.infer<typeof grantSourceSchema>;

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

export const devGrantInputSchema = z.object({
  email: z.string().email(),
  productId: z.string().min(1),
  startsAt: z.string().datetime().optional(),
  expiresAt: z.string().datetime().nullable().optional(),
});

export type DevGrantInput = z.input<typeof devGrantInputSchema>;
