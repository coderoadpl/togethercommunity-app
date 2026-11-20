import { describe, expect, it } from 'vitest';

import { capabilitiesForPrincipal } from './authorization.js';
import {
  createShopManagementKeyInputSchema,
  SHOP_MANAGEMENT_SCOPES_REFUSED_IN_PROPOSE_MODE,
  shopManagementCapabilities,
  shopManagementKeySchema,
  shopManagementScopeSchema,
  toShopManagementKeyPublic,
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

  it('creates a direct-mode key unless the owner chooses propose mode', () => {
    const parsed = createShopManagementKeyInputSchema.parse({ name: 'Shop backend', scopes: ['shop:catalog:write'], expiresAt: EXPIRY });
    expect(parsed.mode).toBe('direct');
    expect(createShopManagementKeyInputSchema.parse({
      name: 'Shop backend', scopes: ['shop:catalog:read', 'shop:catalog:write'], expiresAt: EXPIRY, mode: 'propose',
    }).mode).toBe('propose');
  });

  it('rejects an unknown mode', () => {
    expect(createShopManagementKeyInputSchema.safeParse({
      name: 'Shop backend', scopes: ['shop:catalog:read'], expiresAt: EXPIRY, mode: 'review',
    }).success).toBe(false);
  });

  it.each(SHOP_MANAGEMENT_SCOPES_REFUSED_IN_PROPOSE_MODE)('refuses %s for a propose-mode key', (scope) => {
    const parsed = createShopManagementKeyInputSchema.safeParse({
      name: 'Shop backend', scopes: ['shop:catalog:read', scope], expiresAt: EXPIRY, mode: 'propose',
    });
    expect(parsed.success).toBe(false);
    expect(parsed.error?.issues.map((issue) => issue.path)).toEqual([['scopes', 1]]);
  });

  it.each([
    ['shop:catalog:write', 'shop:catalog:read'],
    ['shop:settings:write', 'shop:settings:read'],
  ] as const)('refuses %s on a propose-mode key without %s', (writeScope, readScope) => {
    const parsed = createShopManagementKeyInputSchema.safeParse({
      name: 'Shop backend', scopes: ['shop:orders:read', writeScope], expiresAt: EXPIRY, mode: 'propose',
    });
    expect(parsed.success).toBe(false);
    expect(parsed.error?.issues.map(({ path, message }) => [path, message])).toEqual([
      [['scopes', 1], `${writeScope} on a propose-mode key needs ${readScope} as well`],
    ]);
    expect(createShopManagementKeyInputSchema.safeParse({
      name: 'Shop backend', scopes: [writeScope, readScope], expiresAt: EXPIRY, mode: 'propose',
    }).success).toBe(true);
    expect(createShopManagementKeyInputSchema.safeParse({
      name: 'Shop backend', scopes: [writeScope], expiresAt: EXPIRY, mode: 'direct',
    }).success).toBe(true);
  });

  it.each(SHOP_MANAGEMENT_SCOPES_REFUSED_IN_PROPOSE_MODE)('still grants %s to a direct-mode key', (scope) => {
    expect(createShopManagementKeyInputSchema.safeParse({
      name: 'Shop backend', scopes: [scope], expiresAt: EXPIRY, mode: 'direct',
    }).success).toBe(true);
  });
});

describe('shopManagementKeySchema', () => {
  const stored = {
    id: 'k', tenantId: 't', name: 'n', keyHash: 'h', scopes: ['shop:orders:read'], mode: 'direct', issuedByUserId: 'owner',
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
    ['no mode', { mode: undefined }],
    ['an unknown mode', { mode: 'review' }],
  ])('rejects a stored key with %s', (_label, overrides) => {
    expect(shopManagementKeySchema.safeParse({ ...stored, ...overrides }).success).toBe(false);
  });

  it('publishes the mode without the key hash', () => {
    const key = shopManagementKeySchema.parse({ ...stored, mode: 'propose' });
    expect(toShopManagementKeyPublic(key)).toEqual({
      id: 'k', tenantId: 't', name: 'n', scopes: ['shop:orders:read'], mode: 'propose', issuedByUserId: 'owner',
      createdAt: EXPIRY, expiresAt: EXPIRY, revokedAt: null,
    });
  });
});

describe('shop management capabilities', () => {
  it('maps each shop scope to the existing capabilities', () => {
    const shop = (scope: (typeof shopManagementScopeSchema.options)[number]) => shopManagementCapabilities([scope], 'direct');

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
    for (const mode of ['direct', 'propose'] as const) {
      const all = shopManagementCapabilities([...shopManagementScopeSchema.options], mode);
      expect(all).not.toContain('api-key:write');
      expect(all).not.toContain('api-key:read');
      expect(all).not.toContain('proposal:read');
      expect(all).not.toContain('proposal:decide');
    }
  });

  it('never grants a proposal capability to a direct-mode key', () => {
    expect(shopManagementCapabilities([...shopManagementScopeSchema.options], 'direct')
      .filter((capability) => capability.startsWith('proposal:'))).toEqual([]);
  });
});

describe('propose-mode shop management capabilities', () => {
  const shop = (scope: (typeof shopManagementScopeSchema.options)[number]) => shopManagementCapabilities([scope], 'propose');
  const readScopes = shopManagementScopeSchema.options.filter((scope) => scope.endsWith(':read'));
  const writeScopes = shopManagementScopeSchema.options.filter((scope) => scope.endsWith(':write'));
  const directWriteCapabilities = shopManagementCapabilities(writeScopes, 'direct');

  it('keeps the read capabilities of every read scope', () => {
    for (const scope of readScopes) {
      expect(shop(scope)).toEqual([...shopManagementCapabilities([scope], 'direct'), 'proposal:own:manage']);
    }
  });

  it('turns the catalog and settings write scopes into proposal submission only', () => {
    expect(shop('shop:catalog:write')).toEqual(['proposal:submit:catalog', 'proposal:own:manage']);
    expect(shop('shop:settings:write')).toEqual(['proposal:submit:settings', 'proposal:own:manage']);
    expect(shop('shop:fulfilment:write')).toEqual(['proposal:own:manage']);
    expect(shop('shop:integrations:write')).toEqual(['proposal:own:manage']);
  });

  it('holds no live write capability for any combination of scopes', () => {
    const all = shopManagementCapabilities([...shopManagementScopeSchema.options], 'propose');
    expect(directWriteCapabilities.length).toBeGreaterThan(0);
    expect(all.filter((capability) => directWriteCapabilities.includes(capability))).toEqual([]);
  });

  it('grants only the management of its own proposals to a key whose scopes map to nothing', () => {
    expect(shopManagementCapabilities(['shop:fulfilment:write', 'shop:integrations:write'], 'propose')).toEqual(['proposal:own:manage']);
  });

  it('maps only to capabilities the owner holds, so the owner intersection keeps them', () => {
    const owner = capabilitiesForPrincipal('owner');
    const all = shopManagementCapabilities([...shopManagementScopeSchema.options], 'propose');
    expect(all.filter((capability) => !owner.includes(capability))).toEqual([]);
  });
});
