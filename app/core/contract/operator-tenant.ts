import { z } from 'zod';

import { operatorTenantReadinessSchema, tenantSchema } from '#core/domain/index.js';

export { operatorTenantReadinessSchema, operatorTenantSlugSchema, provisionTenantInputSchema } from '#core/domain/index.js';
export type { OperatorTenantReadiness, ProvisionTenantInput } from '#core/domain/index.js';

export const provisionTenantOutputSchema = z.object({
  tenant: tenantSchema.pick({ id: true, slug: true, name: true }).strict(),
  created: z.boolean(),
  ownerUserId: z.string(),
  readiness: operatorTenantReadinessSchema,
}).strict();
