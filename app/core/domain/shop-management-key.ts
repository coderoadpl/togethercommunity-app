import { z } from 'zod';

import type { Capability } from './authorization.js';
import type { UpdateTenantSettingsInput } from './tenant.js';
import type { TenantSecretKey } from './tenant-secret.js';

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

export const shopManagementKeyModeSchema = z.enum(['direct', 'propose']);

export type ShopManagementKeyMode = z.output<typeof shopManagementKeyModeSchema>;

export const SHOP_MANAGEMENT_SCOPES_REFUSED_IN_PROPOSE_MODE = [
  'shop:fulfilment:write',
  'shop:integrations:write',
] as const satisfies readonly ShopManagementScope[];

const scopeRefusedInProposeMode = (scope: ShopManagementScope): boolean =>
  SHOP_MANAGEMENT_SCOPES_REFUSED_IN_PROPOSE_MODE.some((refused) => refused === scope);

const readScopeRequiredInProposeMode: Partial<Record<ShopManagementScope, ShopManagementScope>> = {
  'shop:catalog:write': 'shop:catalog:read',
  'shop:settings:write': 'shop:settings:read',
};

export const SHOP_MANAGEMENT_KEY_MAX_LIFETIME_MS = 30 * 24 * 60 * 60 * 1000;

export const shopManagementKeysSwitchSchema = z.enum(['enabled', 'disabled']);

export type ShopManagementKeysSwitch = z.output<typeof shopManagementKeysSwitchSchema>;

export const shopManagementKeySchema = z.object({
  id: z.string().min(1),
  tenantId: z.string().min(1),
  name: z.string(),
  keyHash: z.string().min(1),
  scopes: z.array(shopManagementScopeSchema),
  purpose: z.literal('purchase-smoke').optional(),
  mode: shopManagementKeyModeSchema,
  issuedByUserId: z.string().min(1),
  createdAt: z.string().datetime(),
  expiresAt: z.string().datetime(),
  revokedAt: z.string().datetime().nullable(),
});

export type ShopManagementKey = z.infer<typeof shopManagementKeySchema>;

export const shopManagementKeyPublicSchema = shopManagementKeySchema.omit({ keyHash: true });

export type ShopManagementKeyPublic = z.infer<typeof shopManagementKeyPublicSchema>;

export const toShopManagementKeyPublic = (key: ShopManagementKey): ShopManagementKeyPublic => ({
  id: key.id,
  tenantId: key.tenantId,
  name: key.name,
  scopes: key.scopes,
  mode: key.mode,
  ...(key.purpose === undefined ? {} : { purpose: key.purpose }),
  issuedByUserId: key.issuedByUserId,
  createdAt: key.createdAt,
  expiresAt: key.expiresAt,
  revokedAt: key.revokedAt,
});

export const createShopManagementKeyInputSchema = z.object({
  name: z.string().trim().min(1).max(120),
  scopes: z.array(shopManagementScopeSchema),
  purpose: z.literal('purchase-smoke').optional(),
  expiresAt: z.string().datetime(),
  mode: shopManagementKeyModeSchema.default('direct'),
}).strict().superRefine((input, context) => {
  if (input.purpose === 'purchase-smoke') {
    if (input.scopes.length !== 0 || input.mode !== 'direct') {
      context.addIssue({ code: z.ZodIssueCode.custom, message: 'Purchase smoke purpose requires direct mode and no scopes' });
    }
    return;
  }
  if (input.scopes.length === 0) context.addIssue({ code: z.ZodIssueCode.custom, path: ['scopes'], message: 'Choose at least one scope' });
  if (input.mode !== 'propose') return;
  input.scopes.forEach((scope, index) => {
    if (scopeRefusedInProposeMode(scope)) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['scopes', index],
        message: `${scope} cannot be granted to a propose-mode key`,
      });
    }
    const readScope = readScopeRequiredInProposeMode[scope];
    if (readScope !== undefined && !input.scopes.includes(readScope)) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['scopes', index],
        message: `${scope} on a propose-mode key needs ${readScope} as well`,
      });
    }
  });
});

export type CreateShopManagementKeyInput = z.input<typeof createShopManagementKeyInputSchema>;

const capabilitiesByShopManagementScope: Record<ShopManagementScope, readonly Capability[]> = {
  'shop:catalog:read': ['product:read', 'product:price:read'],
  'shop:catalog:write': ['product:write', 'product:price:write', 'product:publish'],
  'shop:orders:read': ['order:read', 'order:export'],
  'shop:fulfilment:write': ['order:write'],
  'shop:settings:read': ['tenant:settings:read'],
  'shop:settings:write': ['tenant:settings:write'],
  'shop:integrations:read': ['tenant:secret:read'],
  'shop:integrations:write': ['tenant:secret:write'],
};

const proposeModeCapabilitiesByShopManagementScope: Record<ShopManagementScope, readonly Capability[]> = {
  'shop:catalog:read': ['product:read', 'product:price:read'],
  'shop:catalog:write': ['proposal:submit:catalog', 'proposal:asset:upload'],
  'shop:orders:read': ['order:read', 'order:export'],
  'shop:fulfilment:write': [],
  'shop:settings:read': ['tenant:settings:read'],
  'shop:settings:write': ['proposal:submit:settings', 'proposal:asset:upload'],
  'shop:integrations:read': ['tenant:secret:read'],
  'shop:integrations:write': [],
};

const capabilitiesByShopManagementKeyMode: Record<ShopManagementKeyMode, Record<ShopManagementScope, readonly Capability[]>> = {
  direct: capabilitiesByShopManagementScope,
  propose: proposeModeCapabilitiesByShopManagementScope,
};

const scopeIndependentCapabilitiesByMode: Record<ShopManagementKeyMode, readonly Capability[]> = {
  direct: [],
  propose: ['proposal:own:manage'],
};

export const shopManagementCapabilities = (
  scopes: readonly ShopManagementScope[],
  mode: ShopManagementKeyMode,
): readonly Capability[] =>
  [...new Set([
    ...scopes.flatMap((scope) => capabilitiesByShopManagementKeyMode[mode][scope]),
    ...scopeIndependentCapabilitiesByMode[mode],
  ])];

export const SHOP_MANAGEMENT_KEY_SECRET_KEYS = [
  'ifirma.invoiceApiKey',
  'ifirma.username',
  'ksef.token',
  'ksef.contextNip',
  'ksef.test.token',
  'ksef.test.contextNip',
] as const satisfies readonly TenantSecretKey[];

export const SHOP_MANAGEMENT_KEY_INTEGRATION_OPERATIONS = [
  'stripe:configure',
  'stripe:probe',
  'shipx:configure',
  'storage:configure',
] as const;

type ShopManagementKeyIntegrationOperation = (typeof SHOP_MANAGEMENT_KEY_INTEGRATION_OPERATIONS)[number];

type ShopManagementKeyIntegrationGrant =
  | { operation: ShopManagementKeyIntegrationOperation }
  | { secretKey: string };

export const SHOP_MANAGEMENT_KEY_SETTINGS_FIELDS = {
  name: true,
  defaultLanguage: true,
  logoUrl: true,
  logoDarkUrl: true,
  faviconUrl: true,
  accentColor: true,
  accentLight: true,
  ogTitle: true,
  ogDescription: true,
  ogImageUrl: true,
  socialLinks: true,
  checkoutAppearance: true,
  supportEmail: true,
  supportUrl: true,
  termsUrl: true,
  privacyUrl: true,
  invoiceSellerName: true,
  invoiceSellerAddress: true,
  invoiceVatMode: true,
  invoiceVatRatePercent: true,
  invoiceExemptionBasisKind: true,
  invoiceExemptionBasis: true,
  invoicingProvider: true,
  autoIssueInvoices: true,
  autoIssueInvoiceScope: true,
  ksefSubmissionMode: true,
  shippingRates: true,
  inpostGeowidgetToken: true,
} as const satisfies Partial<Record<keyof UpdateTenantSettingsInput, true>>;

export const SHOP_MANAGEMENT_KEY_SETTINGS_OPERATIONS = ['shop-settings:update', 'shop-settings:branding-asset-upload'] as const;

export interface ShopManagementKeySettingsGrant {
  operation: (typeof SHOP_MANAGEMENT_KEY_SETTINGS_OPERATIONS)[number];
  fields: readonly string[];
}

export type ShopManagementKeyGrant = ShopManagementKeyIntegrationGrant | ShopManagementKeySettingsGrant;

const capabilitiesNeedingGrant: readonly Capability[] = ['tenant:secret:write', 'tenant:settings:write', 'integration:test'];

export const shopManagementKeyMayWriteSecret = (key: string): boolean =>
  SHOP_MANAGEMENT_KEY_SECRET_KEYS.some((allowed) => allowed === key);

export const shopManagementKeyMayWriteSetting = (field: string): boolean =>
  Object.keys(SHOP_MANAGEMENT_KEY_SETTINGS_FIELDS).includes(field);

const integrationGrantCovers = (grant: ShopManagementKeyIntegrationGrant): boolean =>
  'operation' in grant
    ? SHOP_MANAGEMENT_KEY_INTEGRATION_OPERATIONS.includes(grant.operation)
    : shopManagementKeyMayWriteSecret(grant.secretKey);

export const shopManagementKeyGrantCovers = (
  capability: Capability,
  grant: ShopManagementKeyGrant | undefined,
): boolean => {
  if (!capabilitiesNeedingGrant.includes(capability)) return true;
  if (grant === undefined) return false;
  if ('fields' in grant) {
    return capability === 'tenant:settings:write'
      && SHOP_MANAGEMENT_KEY_SETTINGS_OPERATIONS.includes(grant.operation)
      && grant.fields.every(shopManagementKeyMayWriteSetting);
  }
  return capability === 'tenant:secret:write' && integrationGrantCovers(grant);
};
