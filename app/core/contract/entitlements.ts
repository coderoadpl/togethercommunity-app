import { z } from 'zod';

import {
  createApplicationKeyInputSchema,
  entitlementCheckInputSchema,
  entitlementCheckOutputSchema,
  applicationKeyPublicSchema,
} from '#core/domain/index.js';

export const entitlementContracts = {
  checkEntitlements: { input: entitlementCheckInputSchema, output: entitlementCheckOutputSchema },
} as const;

export const apiKeysApplicationListOutputSchema = z.object({
  apiKeys: z.array(applicationKeyPublicSchema),
});

export const apiKeysApplicationCreateInputSchema = createApplicationKeyInputSchema;

export type ApiKeysApplicationCreateInput = z.input<typeof apiKeysApplicationCreateInputSchema>;

export const apiKeysApplicationCreateOutputSchema = z.object({
  apiKey: applicationKeyPublicSchema,
  secret: z.string(),
});

export const apiKeysApplicationRevokeOutputSchema = z.object({
  apiKey: applicationKeyPublicSchema,
});
