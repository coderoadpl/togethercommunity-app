import { z } from 'zod';

import { nipSchema } from './commerce.js';
import { SHOP_MANAGEMENT_KEY_SECRET_KEYS } from './shop-management-key.js';
import { setTenantSecretInputSchema, type TenantSecretKey } from './tenant-secret.js';

const NIP_SECRET_KEYS: ReadonlySet<TenantSecretKey> = new Set(['ksef.contextNip', 'ksef.test.contextNip']);

export const shopIntegrationSecretKeySchema = z.enum(SHOP_MANAGEMENT_KEY_SECRET_KEYS, {
  errorMap: () => ({
    message: `Only ${SHOP_MANAGEMENT_KEY_SECRET_KEYS.join(', ')} can be set with a shop management key; Stripe, storage and ShipX have their own configure routes`,
  }),
});

export type ShopIntegrationSecretKey = z.infer<typeof shopIntegrationSecretKeySchema>;

export const shopIntegrationSecretInputSchema = setTenantSecretInputSchema
  .extend({ key: shopIntegrationSecretKeySchema })
  .strict()
  .superRefine((input, ctx) => {
    if (!NIP_SECRET_KEYS.has(input.key)) return;
    const nip = nipSchema.safeParse(input.value);
    if (!nip.success) ctx.addIssue({ code: z.ZodIssueCode.custom, path: ['value'], message: nip.error.issues[0]?.message ?? 'Invalid NIP' });
  });

export type ShopIntegrationSecretInput = z.input<typeof shopIntegrationSecretInputSchema>;

export const shopIntegrationSecretDeleteInputSchema = z.object({ key: shopIntegrationSecretKeySchema }).strict();
