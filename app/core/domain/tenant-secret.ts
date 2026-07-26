import { z } from 'zod';

export const tenantSecretKeySchema = z.enum([
  'stripe.restrictedKey',
  'stripe.webhookSecret',
  'bunny.apiKey',
  'bunny.securityKey',
  's3.accessKeyId',
  's3.secretAccessKey',
  'ses.accessKeyId',
  'ses.secretAccessKey',
  'ses.region',
]);

export type TenantSecretKey = z.infer<typeof tenantSecretKeySchema>;

export const tenantSecretSchema = z.object({
  id: z.string(),
  tenantId: z.string(),
  key: tenantSecretKeySchema,
  ciphertext: z.string(),
  iv: z.string(),
  authTag: z.string(),
  maskedPreview: z.string(),
  updatedAt: z.string().datetime(),
});

export type TenantSecret = z.infer<typeof tenantSecretSchema>;

export const tenantSecretMaskedSchema = tenantSecretSchema.pick({
  key: true,
  maskedPreview: true,
  updatedAt: true,
});

export type TenantSecretMasked = z.infer<typeof tenantSecretMaskedSchema>;

export const setTenantSecretInputSchema = z.object({
  key: tenantSecretKeySchema,
  value: z.string().trim().min(1),
});

export type SetTenantSecretInput = z.input<typeof setTenantSecretInputSchema>;
