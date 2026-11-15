import { describe, expect, it } from 'vitest';

import {
  createShopManagementKeyInputSchema,
  shopManagementCapabilities,
  shopManagementKeySchema,
  shopManagementScopeSchema,
} from './shop-management-key.js';

const EXPIRY = '2026-06-08T00:00:00.000Z';

describe('createShopManagementKeyInputSchema', () => {
  it('accepts explicit shop scopes and an expiry', () => {
    expect(createShopManagementKeyInputSchema.safeParse({
      name: 'Shop backend', scopes: ['shop:catalog:read'], expiresAt: EXPIRY,
    }).success).toBe(true);
  });

  it.each([
    ['no scopes', { expiresAt: EXPIRY }],
    ['an empty scope list', { scopes: [], expiresAt: EXPIRY }],
    ['no expiry', { scopes: ['shop:catalog:read'] }],
    ['a null expiry', { scopes: ['shop:catalog:read'], expiresAt: null }],
    ['a legacy scope', { scopes: ['shop:catalog:read', 'transactional'], expiresAt: EXPIRY }],
    ['an import scope', { scopes: ['shop:catalog:read', 'import:users'], expiresAt: EXPIRY }],
    ['only a report scope', { scopes: ['report:read'], expiresAt: EXPIRY }],
    ['a key kind field', { kind: 'shop_management', scopes: ['shop:catalog:read'], expiresAt: EXPIRY }],
  ])('rejects %s', (_label, input) => {
    expect(createShopManagementKeyInputSchema.safeParse({ name: 'Shop backend', ...input }).success).toBe(false);
  });
});

describe('shopManagementKeySchema', () => {
  const stored = {
    id: 'k', tenantId: 't', name: 'n', keyHash: 'h', scopes: ['shop:orders:read'], issuedByUserId: 'owner',
    createdAt: EXPIRY, expiresAt: EXPIRY, revokedAt: null,
  };

  it('parses a stored key with an issuer, an expiry and shop scopes', () => {
    expect(shopManagementKeySchema.safeParse(stored).success).toBe(true);
  });

  it.each([
    ['no issuer', { issuedByUserId: null }],
    ['no expiry', { expiresAt: null }],
    ['no scopes', { scopes: null }],
    ['a legacy scope', { scopes: ['marketing'] }],
  ])('rejects a stored key with %s', (_label, overrides) => {
    expect(shopManagementKeySchema.safeParse({ ...stored, ...overrides }).success).toBe(false);
  });
});

describe('shop management capabilities', () => {
  it('maps each shop scope to the existing capabilities', () => {
    const shop = (scope: (typeof shopManagementScopeSchema.options)[number]) => shopManagementCapabilities([scope]);

    expect(shop('shop:catalog:read')).toEqual(['product:read', 'product:price:read']);
    expect(shop('shop:catalog:write')).toEqual(['product:write', 'product:price:write', 'product:publish']);
    expect(shop('shop:orders:read')).toEqual(['order:read', 'order:export']);
    expect(shop('shop:fulfilment:write')).toEqual(['order:write']);
    expect(shop('shop:settings:read')).toEqual(['tenant:settings:read']);
    expect(shop('shop:settings:write')).toEqual(['tenant:settings:write']);
    expect(shop('shop:integrations:read')).toEqual(['tenant:secret:read']);
    expect(shop('shop:integrations:write')).toEqual(['tenant:secret:write']);
  });

  it('never grants key administration through any shop scope', () => {
    const all = shopManagementCapabilities([...shopManagementScopeSchema.options]);
    expect(all).not.toContain('api-key:write');
    expect(all).not.toContain('api-key:read');
  });
});
