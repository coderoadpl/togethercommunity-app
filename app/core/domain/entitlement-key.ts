import { z } from 'zod';

import type { Capability } from './authorization.js';

export const entitlementKeyScopeSchema = z.enum(['entitlements:check', 'entitlements:members:read']);

export type EntitlementKeyScope = z.output<typeof entitlementKeyScopeSchema>;

export const ENTITLEMENT_KEY_MAX_LIFETIME_MS = 90 * 24 * 60 * 60 * 1000;

export const ENTITLEMENT_KEY_MAX_PRODUCTS = 50;

const productIdSchema = z.string().trim().min(1).max(200);

const scopesSchema = z.array(entitlementKeyScopeSchema).min(1)
  .refine((scopes) => scopes.includes('entitlements:check'), { message: 'entitlements:check is required' });

export const entitlementKeySchema = z.object({
  id: z.string().min(1),
  tenantId: z.string().min(1),
  name: z.string(),
  keyHash: z.string().min(1),
  scopes: scopesSchema,
  productIds: z.array(productIdSchema).min(1).max(ENTITLEMENT_KEY_MAX_PRODUCTS).nullable(),
  issuedByUserId: z.string().min(1),
  createdAt: z.string().datetime(),
  expiresAt: z.string().datetime(),
  revokedAt: z.string().datetime().nullable(),
});

export type EntitlementKey = z.infer<typeof entitlementKeySchema>;

export const entitlementKeyPublicSchema = entitlementKeySchema.omit({ keyHash: true });

export type EntitlementKeyPublic = z.infer<typeof entitlementKeyPublicSchema>;

export const toEntitlementKeyPublic = (key: EntitlementKey): EntitlementKeyPublic => ({
  id: key.id,
  tenantId: key.tenantId,
  name: key.name,
  scopes: key.scopes,
  productIds: key.productIds,
  issuedByUserId: key.issuedByUserId,
  createdAt: key.createdAt,
  expiresAt: key.expiresAt,
  revokedAt: key.revokedAt,
});

export const createEntitlementKeyInputSchema = z.object({
  name: z.string().trim().min(1).max(120),
  scopes: scopesSchema,
  expiresAt: z.string().datetime(),
  productIds: z.array(productIdSchema).min(1).max(ENTITLEMENT_KEY_MAX_PRODUCTS).optional(),
}).strict();

export type CreateEntitlementKeyInput = z.input<typeof createEntitlementKeyInputSchema>;

const capabilitiesByEntitlementKeyScope: Record<EntitlementKeyScope, readonly Capability[]> = {
  'entitlements:check': ['entitlement:check'],
  'entitlements:members:read': ['entitlement:member:read'],
};

export const entitlementKeyCapabilities = (scopes: readonly EntitlementKeyScope[]): readonly Capability[] =>
  [...new Set(scopes.flatMap((scope) => capabilitiesByEntitlementKeyScope[scope]))];
