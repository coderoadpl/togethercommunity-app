import { describe, expect, it } from 'vitest';

import {
  capabilitiesForApiKey,
  createApiKeyInputSchema,
  shopManagementCapabilitiesForApiKey,
  shopManagementScopeSchema,
  tenantApiKeySchema,
} from './api-key.js';
import { capabilitiesForPrincipal } from './authorization.js';

const EXPIRY = '2026-06-08T00:00:00.000Z';

describe('createApiKeyInputSchema', () => {
  it('accepts a shop management key with explicit scopes and an expiry', () => {
    expect(createApiKeyInputSchema.safeParse({
      name: 'Shop backend', kind: 'shop_management', scopes: ['shop:catalog:read'], expiresAt: EXPIRY,
    }).success).toBe(true);
  });

  it.each([
    ['no scopes', { expiresAt: EXPIRY }],
    ['no expiry', { scopes: ['shop:catalog:read'] }],
    ['a null expiry', { scopes: ['shop:catalog:read'], expiresAt: null }],
    ['a legacy scope', { scopes: ['shop:catalog:read', 'transactional'], expiresAt: EXPIRY }],
    ['an import scope', { scopes: ['shop:catalog:read', 'import:users'], expiresAt: EXPIRY }],
    ['only a report scope', { scopes: ['report:read'], expiresAt: EXPIRY }],
  ])('rejects a shop management key with %s', (_label, input) => {
    expect(createApiKeyInputSchema.safeParse({ name: 'Shop backend', kind: 'shop_management', ...input }).success)
      .toBe(false);
  });

  it.each([undefined, 'legacy'] as const)('rejects shop scopes on a legacy key (kind %s)', (kind) => {
    expect(createApiKeyInputSchema.safeParse({
      name: 'Legacy', kind, scopes: ['shop:orders:read'], expiresAt: EXPIRY,
    }).success).toBe(false);
  });

  it('keeps legacy inputs valid without a kind', () => {
    expect(createApiKeyInputSchema.safeParse({ name: 'CI key' }).success).toBe(true);
    expect(createApiKeyInputSchema.safeParse({ name: 'CI key', scopes: ['marketing', 'enrollment'] }).success).toBe(true);
    expect(createApiKeyInputSchema.safeParse({ name: 'Migration', scopes: ['import:content'], expiresAt: EXPIRY }).success)
      .toBe(true);
  });

  it('rejects an unknown kind', () => {
    expect(createApiKeyInputSchema.safeParse({ name: 'CI key', kind: 'root' }).success).toBe(false);
  });
});

describe('tenantApiKeySchema', () => {
  it('requires an explicit kind on stored keys', () => {
    expect(tenantApiKeySchema.safeParse({
      id: 'k', tenantId: 't', name: 'n', keyHash: 'h', scopes: null, issuedByUserId: null,
      createdAt: EXPIRY, expiresAt: null, revokedAt: null,
    }).success).toBe(false);
  });
});

describe('shop management capabilities', () => {
  it('maps each shop scope to the existing capabilities', () => {
    const shop = (scope: (typeof shopManagementScopeSchema.options)[number]) =>
      shopManagementCapabilitiesForApiKey({ kind: 'shop_management', scopes: [scope] });

    expect(shop('shop:catalog:read')).toEqual(['product:read', 'product:price:read']);
    expect(shop('shop:catalog:write')).toEqual(['product:write', 'product:price:write', 'product:publish']);
    expect(shop('shop:orders:read')).toEqual(['order:read', 'order:export']);
    expect(shop('shop:fulfilment:write')).toEqual(['order:write']);
    expect(shop('shop:settings:read')).toEqual(['tenant:settings:read']);
    expect(shop('shop:settings:write')).toEqual(['tenant:settings:write']);
    expect(shop('shop:integrations:read')).toEqual(['tenant:secret:read']);
    expect(shop('shop:integrations:write')).toEqual(['tenant:secret:write', 'integration:test']);
  });

  it('never grants key administration through any shop scope', () => {
    const all = shopManagementCapabilitiesForApiKey({ kind: 'shop_management', scopes: [...shopManagementScopeSchema.options] });
    expect(all).not.toContain('api-key:write');
    expect(all).not.toContain('api-key:read');
  });

  it.each([
    ['a null-scope legacy key', { kind: 'legacy', scopes: null }],
    ['a scope-less legacy grant', { scopes: null }],
    ['a legacy key carrying a shop scope', { kind: 'legacy', scopes: ['shop:catalog:write'] }],
    ['a shop management key without scopes', { kind: 'shop_management', scopes: null }],
  ] as const)('grants no shop capabilities to %s', (_label, apiKey) => {
    expect(shopManagementCapabilitiesForApiKey({ ...apiKey, scopes: apiKey.scopes === null ? null : [...apiKey.scopes] }))
      .toEqual([]);
  });

  it('grants a shop management key no legacy capabilities', () => {
    expect(capabilitiesForApiKey({ kind: 'shop_management', scopes: ['shop:catalog:read'] })).toEqual([]);
    expect(capabilitiesForApiKey({ kind: 'shop_management', scopes: null })).toEqual([]);
  });

  it('keeps the legacy fallback for null-scope legacy keys', () => {
    expect(capabilitiesForApiKey({ kind: 'legacy', scopes: null })).toEqual(capabilitiesForPrincipal('api-key'));
    expect(capabilitiesForApiKey({ scopes: null })).toEqual(capabilitiesForPrincipal('api-key'));
  });
});
