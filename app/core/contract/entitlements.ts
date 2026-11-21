import { z } from 'zod';

import {
  createEntitlementKeyInputSchema,
  entitlementCheckInputSchema,
  entitlementCheckOutputSchema,
  entitlementKeyPublicSchema,
} from '#core/domain/index.js';

export const entitlementContracts = {
  checkEntitlements: { input: entitlementCheckInputSchema, output: entitlementCheckOutputSchema },
} as const;

export const apiKeysEntitlementListOutputSchema = z.object({
  apiKeys: z.array(entitlementKeyPublicSchema),
});

export const apiKeysEntitlementCreateInputSchema = createEntitlementKeyInputSchema;

export type ApiKeysEntitlementCreateInput = z.input<typeof apiKeysEntitlementCreateInputSchema>;

export const apiKeysEntitlementCreateOutputSchema = z.object({
  apiKey: entitlementKeyPublicSchema,
  secret: z.string(),
});

export const apiKeysEntitlementRevokeOutputSchema = z.object({
  apiKey: entitlementKeyPublicSchema,
});
