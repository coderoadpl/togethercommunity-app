import { z } from 'zod';

import { transactionalLanguageSchema } from './transactional-email.js';

export const tenantApiKeySchema = z.object({
  id: z.string(),
  tenantId: z.string(),
  name: z.string(),
  keyHash: z.string(),
  createdAt: z.string().datetime(),
  revokedAt: z.string().datetime().nullable(),
});

export type TenantApiKey = z.infer<typeof tenantApiKeySchema>;

export const tenantApiKeyPublicSchema = tenantApiKeySchema.omit({ keyHash: true });

export type TenantApiKeyPublic = z.infer<typeof tenantApiKeyPublicSchema>;

export const toTenantApiKeyPublic = (apiKey: TenantApiKey): TenantApiKeyPublic => ({
  id: apiKey.id,
  tenantId: apiKey.tenantId,
  name: apiKey.name,
  createdAt: apiKey.createdAt,
  revokedAt: apiKey.revokedAt,
});

export const createApiKeyInputSchema = z.object({
  name: z.string().trim().min(1).max(120),
});

export type CreateApiKeyInput = z.input<typeof createApiKeyInputSchema>;

export const m2mEnrollInputSchema = z.object({
  email: z.string().email(),
  productId: z.string().min(1),
  expiresAt: z.string().datetime().nullable().optional(),
  language: transactionalLanguageSchema.optional(),
  doNotSendEmail: z.boolean().optional(),
});

export type M2mEnrollInput = z.input<typeof m2mEnrollInputSchema>;
