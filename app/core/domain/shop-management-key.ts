import { z } from 'zod';

import type { Capability } from './authorization.js';
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

export const SHOP_MANAGEMENT_KEY_MAX_LIFETIME_MS = 30 * 24 * 60 * 60 * 1000;

export const shopManagementKeysSwitchSchema = z.enum(['enabled', 'disabled']);

export type ShopManagementKeysSwitch = z.output<typeof shopManagementKeysSwitchSchema>;

export const shopManagementKeySchema = z.object({
  id: z.string().min(1),
  tenantId: z.string().min(1),
  name: z.string(),
  keyHash: z.string().min(1),
  scopes: z.array(shopManagementScopeSchema).min(1),
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
  issuedByUserId: key.issuedByUserId,
  createdAt: key.createdAt,
  expiresAt: key.expiresAt,
  revokedAt: key.revokedAt,
});

export const createShopManagementKeyInputSchema = z.object({
  name: z.string().trim().min(1).max(120),
  scopes: z.array(shopManagementScopeSchema).min(1),
  expiresAt: z.string().datetime(),
}).strict();

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

export const shopManagementCapabilities = (scopes: readonly ShopManagementScope[]): readonly Capability[] =>
  [...new Set(scopes.flatMap((scope) => capabilitiesByShopManagementScope[scope]))];

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

export type ShopManagementKeyIntegrationGrant =
  | { operation: ShopManagementKeyIntegrationOperation }
  | { secretKey: string };

const integrationCapabilitiesNeedingGrant: readonly Capability[] = ['tenant:secret:write', 'integration:test'];

export const shopManagementKeyMayWriteSecret = (key: string): boolean =>
  SHOP_MANAGEMENT_KEY_SECRET_KEYS.some((allowed) => allowed === key);

export const shopManagementKeyGrantCovers = (
  capability: Capability,
  grant: ShopManagementKeyIntegrationGrant | undefined,
): boolean => {
  if (!integrationCapabilitiesNeedingGrant.includes(capability)) return true;
  if (capability !== 'tenant:secret:write' || grant === undefined) return false;
  return 'operation' in grant
    ? SHOP_MANAGEMENT_KEY_INTEGRATION_OPERATIONS.includes(grant.operation)
    : shopManagementKeyMayWriteSecret(grant.secretKey);
};
