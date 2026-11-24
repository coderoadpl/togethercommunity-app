import { z } from 'zod';

import type { Capability } from './authorization.js';

export const applicationKeyScopeSchema = z.enum(['entitlements:check', 'entitlements:members:read']);

export type ApplicationKeyScope = z.output<typeof applicationKeyScopeSchema>;

export const APPLICATION_KEY_MAX_LIFETIME_MS = 90 * 24 * 60 * 60 * 1000;

export const APPLICATION_KEY_MAX_PRODUCTS = 50;

const productIdSchema = z.string().trim().min(1).max(200);

const scopesSchema = z.array(applicationKeyScopeSchema).min(1)
  .refine((scopes) => scopes.includes('entitlements:check'), { message: 'entitlements:check is required' });

export const applicationKeySchema = z.object({
  id: z.string().min(1),
  tenantId: z.string().min(1),
  name: z.string(),
  keyHash: z.string().min(1),
  scopes: scopesSchema,
  productIds: z.array(productIdSchema).min(1).max(APPLICATION_KEY_MAX_PRODUCTS).nullable(),
  issuedByUserId: z.string().min(1),
  createdAt: z.string().datetime(),
  expiresAt: z.string().datetime(),
  revokedAt: z.string().datetime().nullable(),
});

export type ApplicationKey = z.infer<typeof applicationKeySchema>;

const knownScopes = (values: readonly string[]): ApplicationKeyScope[] =>
  values.flatMap((value) => {
    const scope = applicationKeyScopeSchema.safeParse(value);
    return scope.success ? [scope.data] : [];
  });

// A later release may store scopes this one does not know; reading such a key drops them, so the key only lacks those capabilities.
export const storedApplicationKeySchema = applicationKeySchema.extend({
  scopes: z.array(z.string()).transform(knownScopes),
});

export const applicationKeyPublicSchema = storedApplicationKeySchema.omit({ keyHash: true });

export type ApplicationKeyPublic = z.infer<typeof applicationKeyPublicSchema>;

export const toApplicationKeyPublic = (key: ApplicationKey): ApplicationKeyPublic => ({
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

export const createApplicationKeyInputSchema = z.object({
  name: z.string().trim().min(1).max(120),
  scopes: scopesSchema,
  expiresAt: z.string().datetime(),
  productIds: z.array(productIdSchema).min(1).max(APPLICATION_KEY_MAX_PRODUCTS).optional(),
}).strict();

export type CreateApplicationKeyInput = z.input<typeof createApplicationKeyInputSchema>;

const capabilitiesByApplicationKeyScope: Record<ApplicationKeyScope, readonly Capability[]> = {
  'entitlements:check': ['entitlement:check'],
  'entitlements:members:read': ['entitlement:member:read'],
};

export const applicationKeyCapabilities = (scopes: readonly ApplicationKeyScope[]): readonly Capability[] =>
  [...new Set(scopes.flatMap((scope) => capabilitiesByApplicationKeyScope[scope]))];
