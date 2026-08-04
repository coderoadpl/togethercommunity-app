import { z } from 'zod';

import { capabilitiesForPrincipal, type Capability } from './authorization.js';
import { transactionalLanguageSchema } from './transactional-email.js';

const tenantApiKeyScopeSchema = z.enum(['enrollment', 'marketing', 'transactional']);

type TenantApiKeyScope = z.output<typeof tenantApiKeyScopeSchema>;

export const tenantApiKeySchema = z.object({
  id: z.string(),
  tenantId: z.string(),
  name: z.string(),
  keyHash: z.string(),
  scopes: z.array(tenantApiKeyScopeSchema).min(1).nullable(),
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
  scopes: apiKey.scopes,
  createdAt: apiKey.createdAt,
  revokedAt: apiKey.revokedAt,
});

export const createApiKeyInputSchema = z.object({
  name: z.string().trim().min(1).max(120),
  scopes: z.array(tenantApiKeyScopeSchema).min(1).optional(),
});

export type CreateApiKeyInput = z.input<typeof createApiKeyInputSchema>;

const capabilitiesByScope: Record<TenantApiKeyScope, readonly Capability[]> = {
  enrollment: ['enrollment:create'],
  marketing: [
    'marketing:consent:read',
    'marketing:consent:write',
    'marketing:message:read',
    'marketing:message:send',
    'marketing:layout:read',
    'marketing:suppression:read',
    'marketing:suppression:write',
  ],
  transactional: capabilitiesForPrincipal('transactional-api-key'),
};

export const capabilitiesForApiKey = (apiKey: { scopes?: TenantApiKey['scopes'] }): readonly Capability[] =>
  apiKey.scopes === null || apiKey.scopes === undefined
    ? capabilitiesForPrincipal('api-key')
    : [...new Set(apiKey.scopes.flatMap((scope) => capabilitiesByScope[scope]))];

export const apiKeyHasCapability = (
  apiKey: { scopes?: TenantApiKey['scopes'] },
  capability: Capability,
): boolean => capabilitiesForApiKey(apiKey).includes(capability);

export const m2mEnrollInputSchema = z.object({
  email: z.string().email(),
  productId: z.string().min(1),
  priceId: z.string().min(1).optional(),
  expiresAt: z.string().datetime().nullable().optional(),
  language: transactionalLanguageSchema.optional(),
  doNotSendEmail: z.boolean().optional(),
});

export type M2mEnrollInput = z.input<typeof m2mEnrollInputSchema>;
