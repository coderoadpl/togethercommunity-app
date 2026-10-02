import { z } from 'zod';

import { languageSchema } from './language.js';
import { tenantSchema } from './tenant.js';

export const operatorTenantSlugSchema = z.string().trim().toLowerCase()
  .regex(/^[a-z0-9][a-z0-9-]{1,61}[a-z0-9]$/);

export const provisionTenantInputSchema = z.object({
  slug: operatorTenantSlugSchema,
  name: tenantSchema.shape.name,
  ownerEmail: z.string().trim().toLowerCase().email(),
  defaultLanguage: languageSchema.optional(),
}).strict();

export type ProvisionTenantInput = z.infer<typeof provisionTenantInputSchema>;

export const operatorTenantReadinessSchema = z.object({
  tenantExists: z.boolean(),
  ownerGrantPresent: z.boolean(),
  storageConfigured: z.boolean(),
  lastProbeOk: z.boolean(),
  lastProbeAt: z.string().datetime().nullable(),
  stripeConfigured: z.boolean(),
  mode: z.enum(['live', 'test']).nullable(),
  webhookEndpointRegistered: z.boolean(),
  legalUrlsSet: z.boolean(),
  publishedProducts: z.number().int().nonnegative(),
}).strict();

export type OperatorTenantReadiness = z.infer<typeof operatorTenantReadinessSchema>;
