import { z } from 'zod';

export const grantSourceSchema = z.enum(['simulated', 'manual']);

export type GrantSource = z.infer<typeof grantSourceSchema>;

export const productGrantSchema = z.object({
  id: z.string(),
  tenantId: z.string(),
  memberId: z.string(),
  productId: z.string(),
  source: grantSourceSchema,
  createdAt: z.string(),
});

export type ProductGrant = z.infer<typeof productGrantSchema>;
