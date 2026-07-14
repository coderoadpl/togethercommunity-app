import { z } from 'zod';

import { languageSchema } from './language.js';

export const checkoutSessionInputSchema = z.object({
  productId: z.string().min(1),
  email: z.string().email().optional(),
  language: languageSchema.optional(),
});

export type CheckoutSessionInput = z.input<typeof checkoutSessionInputSchema>;

export const stripeWebhookPayloadSchema = z.object({
  id: z.string().min(1),
  type: z.string().min(1),
  data: z.object({
    object: z.object({
      id: z.string().min(1),
      customer_email: z.string().email().nullable().optional(),
      customer_details: z.object({ email: z.string().email().nullable() }).nullable().optional(),
      metadata: z.record(z.string()).nullable().optional(),
    }),
  }),
});

export const processedPaymentEventSchema = z.object({
  id: z.string().min(1),
  tenantId: z.string().min(1),
  type: z.string().min(1),
  objectId: z.string().min(1),
  processedAt: z.string().datetime(),
});

export type ProcessedPaymentEvent = z.infer<typeof processedPaymentEventSchema>;
