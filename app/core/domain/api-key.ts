import { z } from 'zod';

import { capabilitiesForPrincipal, type Capability } from './authorization.js';
import { transactionalLanguageSchema } from './transactional-email.js';

const tenantApiKeyScopeSchema = z.enum([
  'enrollment',
  'marketing',
  'transactional',
  'import:content',
  'import:users',
]);

export type TenantApiKeyScope = z.output<typeof tenantApiKeyScopeSchema>;

export const IMPORT_API_KEY_DEFAULT_EXPIRY_DAYS = 7;
export const IMPORT_API_KEY_MAX_LIFETIME_DAYS = 30;
export const IMPORT_API_KEY_MAX_LIFETIME_MS = IMPORT_API_KEY_MAX_LIFETIME_DAYS * 24 * 60 * 60 * 1000;

export const isImportApiKeyScope = (scope: TenantApiKeyScope): boolean =>
  scope === 'import:content' || scope === 'import:users';

export const tenantApiKeySchema = z.object({
  id: z.string(),
  tenantId: z.string(),
  name: z.string(),
  keyHash: z.string(),
  scopes: z.array(tenantApiKeyScopeSchema).min(1).nullable(),
  createdAt: z.string().datetime(),
  expiresAt: z.string().datetime().nullable(),
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
  expiresAt: apiKey.expiresAt,
  revokedAt: apiKey.revokedAt,
});

export const createApiKeyInputSchema = z.object({
  name: z.string().trim().min(1).max(120),
  scopes: z.array(tenantApiKeyScopeSchema).min(1).optional(),
  expiresAt: z.string().datetime().nullable().optional(),
}).superRefine((input, ctx) => {
  const scopes = input.scopes ?? [];
  const hasImportScope = scopes.some(isImportApiKeyScope);
  const hasExistingScope = scopes.some((scope) => !isImportApiKeyScope(scope));
  if (hasImportScope && hasExistingScope) {
    ctx.addIssue({
      code: 'custom',
      path: ['scopes'],
      message: 'Import scopes cannot be combined with enrollment, marketing, or transactional scopes',
    });
  }
  if (hasImportScope && input.expiresAt == null) {
    ctx.addIssue({
      code: 'custom',
      path: ['expiresAt'],
      message: 'Import API keys require an expiry',
    });
  }
});

export type CreateApiKeyInput = z.input<typeof createApiKeyInputSchema>;

const capabilitiesByScope: Record<TenantApiKeyScope, readonly Capability[]> = {
  enrollment: ['enrollment:create'],
  marketing: capabilitiesForPrincipal('api-key').filter((capability) => capability !== 'enrollment:create'),
  transactional: capabilitiesForPrincipal('transactional-api-key'),
  'import:content': capabilitiesForPrincipal('import-content-api-key'),
  'import:users': capabilitiesForPrincipal('import-users-api-key'),
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
