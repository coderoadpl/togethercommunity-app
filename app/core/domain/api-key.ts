import { z } from 'zod';

import { capabilitiesForPrincipal, type Capability } from './authorization.js';
import { transactionalLanguageSchema } from './transactional-email.js';

const tenantApiKeyScopeSchema = z.enum([
  'report:read',
  'enrollment',
  'subscriptions:read',
  'subscriptions:adopt',
  'marketing',
  'transactional',
  'import:content',
  'import:users',
]);

export type TenantApiKeyScope = z.output<typeof tenantApiKeyScopeSchema>;

export const tenantApiKeyKindSchema = z.enum(['legacy', 'shop_management']);

type TenantApiKeyKind = z.output<typeof tenantApiKeyKindSchema>;

export const shopManagementScopeSchema = z.enum([
  'shop:catalog:read',
  'shop:catalog:write',
  'shop:orders:read',
  'shop:fulfilment:write',
  'shop:settings:read',
  'shop:settings:write',
  'shop:integrations:read',
  'shop:integrations:write',
]);

export type ShopManagementScope = z.output<typeof shopManagementScopeSchema>;

const tenantApiKeyStoredScopeSchema = z.union([tenantApiKeyScopeSchema, shopManagementScopeSchema]);

export type TenantApiKeyStoredScope = z.output<typeof tenantApiKeyStoredScopeSchema>;

const isShopManagementScope = (scope: TenantApiKeyStoredScope): scope is ShopManagementScope =>
  shopManagementScopeSchema.options.some((option) => option === scope);

const isLegacyApiKeyScope = (scope: TenantApiKeyStoredScope): scope is TenantApiKeyScope =>
  tenantApiKeyScopeSchema.options.some((option) => option === scope);

export const IMPORT_API_KEY_DEFAULT_EXPIRY_DAYS = 7;
export const IMPORT_API_KEY_MAX_LIFETIME_DAYS = 30;
export const IMPORT_API_KEY_MAX_LIFETIME_MS = IMPORT_API_KEY_MAX_LIFETIME_DAYS * 24 * 60 * 60 * 1000;

export const SHOP_MANAGEMENT_KEY_MAX_LIFETIME_MS = 30 * 24 * 60 * 60 * 1000;

export const shopManagementKeysSwitchSchema = z.enum(['enabled', 'disabled']);

export type ShopManagementKeysSwitch = z.output<typeof shopManagementKeysSwitchSchema>;

export const isImportApiKeyScope = (scope: TenantApiKeyStoredScope): boolean =>
  scope === 'import:content' || scope === 'import:users';

export const tenantApiKeySchema = z.object({
  id: z.string(),
  tenantId: z.string(),
  name: z.string(),
  keyHash: z.string(),
  kind: tenantApiKeyKindSchema,
  scopes: z.array(tenantApiKeyStoredScopeSchema).min(1).nullable(),
  issuedByUserId: z.string().min(1).nullable(),
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
  kind: apiKey.kind,
  scopes: apiKey.scopes,
  issuedByUserId: apiKey.issuedByUserId,
  createdAt: apiKey.createdAt,
  expiresAt: apiKey.expiresAt,
  revokedAt: apiKey.revokedAt,
});

export const createApiKeyInputSchema = z.object({
  name: z.string().trim().min(1).max(120),
  kind: tenantApiKeyKindSchema.optional(),
  scopes: z.array(tenantApiKeyStoredScopeSchema).min(1).optional(),
  expiresAt: z.string().datetime().nullable().optional(),
}).superRefine((input, ctx) => {
  const scopes = input.scopes ?? [];
  if (input.kind === 'shop_management') {
    if (scopes.length === 0) {
      ctx.addIssue({ code: 'custom', path: ['scopes'], message: 'Shop management keys require explicit scopes' });
    }
    if (scopes.some((scope) => !isShopManagementScope(scope))) {
      ctx.addIssue({
        code: 'custom',
        path: ['scopes'],
        message: 'Shop management scopes cannot be combined with other scopes',
      });
    }
    if (input.expiresAt == null) {
      ctx.addIssue({ code: 'custom', path: ['expiresAt'], message: 'Shop management keys require an expiry' });
    }
    return;
  }
  if (scopes.some(isShopManagementScope)) {
    ctx.addIssue({
      code: 'custom',
      path: ['scopes'],
      message: 'Shop management scopes require the shop_management key kind',
    });
  }
  const hasImportScope = scopes.some(isImportApiKeyScope);
  const hasExistingScope = scopes.some((scope) => isLegacyApiKeyScope(scope) && !isImportApiKeyScope(scope));
  if (hasImportScope && hasExistingScope) {
    ctx.addIssue({
      code: 'custom',
      path: ['scopes'],
      message: 'Import scopes cannot be combined with non-import scopes',
    });
  }
  if (scopes.includes('report:read') && scopes.some((scope) => scope !== 'report:read')) {
    ctx.addIssue({ code: 'custom', path: ['scopes'], message: 'Report scope cannot be combined with write scopes' });
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
  'report:read': capabilitiesForPrincipal('report-api-key'),
  enrollment: ['enrollment:create'],
  'subscriptions:read': capabilitiesForPrincipal('subscriptions-read-api-key'),
  'subscriptions:adopt': capabilitiesForPrincipal('subscriptions-adopt-api-key'),
  marketing: capabilitiesForPrincipal('api-key').filter((capability) => capability !== 'enrollment:create'),
  transactional: capabilitiesForPrincipal('transactional-api-key'),
  'import:content': capabilitiesForPrincipal('import-content-api-key'),
  'import:users': capabilitiesForPrincipal('import-users-api-key'),
};

type ApiKeyGrant = { kind?: TenantApiKeyKind; scopes?: TenantApiKey['scopes'] };

export const capabilitiesForApiKey = (apiKey: ApiKeyGrant): readonly Capability[] => {
  if (apiKey.kind === 'shop_management') return [];
  if (apiKey.scopes === null || apiKey.scopes === undefined) return capabilitiesForPrincipal('api-key');
  return [...new Set(apiKey.scopes.filter(isLegacyApiKeyScope).flatMap((scope) => capabilitiesByScope[scope]))];
};

const capabilitiesByShopManagementScope: Record<ShopManagementScope, readonly Capability[]> = {
  'shop:catalog:read': ['product:read', 'product:price:read'],
  'shop:catalog:write': ['product:write', 'product:price:write', 'product:publish'],
  'shop:orders:read': ['order:read', 'order:export'],
  'shop:fulfilment:write': ['order:write'],
  'shop:settings:read': ['tenant:settings:read'],
  'shop:settings:write': ['tenant:settings:write'],
  'shop:integrations:read': ['tenant:secret:read'],
  'shop:integrations:write': ['tenant:secret:write', 'integration:test'],
};

export const shopManagementCapabilitiesForApiKey = (apiKey: ApiKeyGrant): readonly Capability[] =>
  apiKey.kind !== 'shop_management' || apiKey.scopes === null || apiKey.scopes === undefined
    ? []
    : [...new Set(apiKey.scopes.filter(isShopManagementScope).flatMap((scope) => capabilitiesByShopManagementScope[scope]))];

export const apiKeyHasCapability = (
  apiKey: ApiKeyGrant,
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
