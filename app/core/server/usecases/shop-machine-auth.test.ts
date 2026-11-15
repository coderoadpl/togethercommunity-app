import { describe, expect, it, vi } from 'vitest';

import {
  capabilitiesForPrincipal,
  shopManagementScopeSchema,
  type Member,
  type Membership,
  type StaffRole,
  type Tenant,
  type TenantApiKey,
  type ShopManagementKeyEvent,
  type TenantApiKeyStoredScope,
} from '#core/domain/index.js';

import type { AccountIdentity, ApiKeyRateLimitRepository } from '../ports.js';
import {
  authenticateShopManagementKey,
  identifyShopManagementKey,
  recordShopManagementKeyRequest,
  type ShopMachineAuthDeps,
} from './shop-machine-auth.js';

const NOW = '1998-08-03T10:00:30.000Z';
const TENANT: Tenant = { id: 't-acme', slug: 'acme', name: 'Acme', status: 'active', plan: 'hosted', contentVersion: 1 };
const OTHER_TENANT: Tenant = { ...TENANT, id: 't-studio', slug: 'studio', name: 'Studio' };
const SECRET = 'shop-secret';
const OWNER_ID = 'user-owner';

const shopKey = (overrides: Partial<TenantApiKey> = {}): TenantApiKey => ({
  id: 'shop-key-1',
  tenantId: TENANT.id,
  name: 'Shop backend',
  keyHash: `hash:${SECRET}`,
  kind: 'shop_management',
  scopes: ['shop:catalog:read'],
  issuedByUserId: OWNER_ID,
  createdAt: '1998-08-01T10:00:00.000Z',
  expiresAt: '1998-08-10T10:00:00.000Z',
  revokedAt: null,
  ...overrides,
});

const issuerMember: Member = {
  id: 'member-owner',
  tenantId: TENANT.id,
  userId: OWNER_ID,
  email: 'owner@example.test',
  displayName: 'Shop Owner',
  avatarUrl: 'https://cdn.example.test/owner.png',
  language: 'en',
  videoAutoplay: true,
  tags: [],
  marketingConsents: {},
  externalCustomerIds: {},
  createdAt: '1998-07-01T00:00:00.000Z',
  deletedAt: null,
  bannedAt: null,
  bannedReason: null,
  bannedByUserId: null,
  dmOptOutAt: null,
};

const createRateLimits = (): ApiKeyRateLimitRepository & { count: (apiKeyId: string, period: string) => number } => {
  const buckets = new Map<string, { windowStartedAt: string; count: number }>();
  return {
    claim: async (_tenantId, input) => {
      const key = `${input.apiKeyId}:${input.period}`;
      const cost = input.cost ?? 1;
      const current = buckets.get(key);
      const count = current?.windowStartedAt === input.windowStartedAt ? current.count : 0;
      if (count + cost > input.limit) return false;
      buckets.set(key, { windowStartedAt: input.windowStartedAt, count: count + cost });
      return true;
    },
    release: async (_tenantId, input) => {
      const key = `${input.apiKeyId}:${input.period}`;
      const current = buckets.get(key);
      if (current?.windowStartedAt !== input.windowStartedAt) return;
      buckets.set(key, { ...current, count: Math.max(0, current.count - (input.cost ?? 1)) });
    },
    count: (apiKeyId, period) => buckets.get(`${apiKeyId}:${period}`)?.count ?? 0,
  };
};

const harness = (options: {
  keys?: TenantApiKey[];
  account?: AccountIdentity | null;
  staffRole?: StaffRole | null;
  member?: Member | null;
} = {}) => {
  const keys = options.keys ?? [shopKey()];
  const state = {
    account: options.account === undefined
      ? { userId: OWNER_ID, email: 'owner@example.test', name: 'Shop Owner', emailVerified: true }
      : options.account,
    staffRole: options.staffRole === undefined ? 'owner' : options.staffRole,
    now: NOW,
  };
  const findMember = vi.fn(async (tenantId: string, userId: string) => {
    const member = options.member === undefined ? issuerMember : options.member;
    return member !== null && member.tenantId === tenantId && member.userId === userId ? member : null;
  });
  const findStaffGrant = vi.fn(async (userId: string, lookup: { tenantId: string } | { tenantSlug: string }): Promise<Membership | null> =>
    state.staffRole !== null && userId === OWNER_ID && 'tenantId' in lookup && lookup.tenantId === TENANT.id
      ? { tenant: TENANT, staffRole: state.staffRole }
      : null);
  const rateLimits = createRateLimits();
  const deps: ShopMachineAuthDeps = {
    tenantApiKeys: {
      findByHash: async (tenantId, keyHash) =>
        keys.find((key) => key.tenantId === tenantId && key.keyHash === keyHash) ?? null,
    },
    apiKeyCrypto: { generateSecret: () => SECRET, hash: (value) => `hash:${value}` },
    accountIdentities: { findById: async (userId) => (state.account?.userId === userId ? state.account : null) },
    tenantAccess: { findStaffGrant, findMember },
    apiKeyRateLimits: rateLimits,
    clock: { nowIso: () => state.now },
  };
  return { deps, state, findMember, rateLimits };
};

const authenticateWithAttribution = (
  h: ReturnType<typeof harness>,
  scope: Parameters<typeof authenticateShopManagementKey>[2] = 'shop:catalog:read',
  tenant: Tenant = TENANT,
  secret = SECRET,
) => authenticateShopManagementKey(tenant, secret, scope, h.deps);

const authenticate = async (...args: Parameters<typeof authenticateWithAttribution>) =>
  (await authenticateWithAttribution(...args)).result;

const invalidKey = { ok: false, error: { code: 'unauthorized', message: 'Invalid API key' } };

const LEGACY_SCOPE_FAMILIES: readonly TenantApiKeyStoredScope[][] = [
  ['report:read'],
  ['enrollment'],
  ['subscriptions:read'],
  ['subscriptions:adopt'],
  ['marketing'],
  ['transactional'],
  ['import:content'],
  ['import:users'],
];

describe('authenticateShopManagementKey', () => {
  it('builds the request context from the issuer identity with intersected capabilities and the key id', async () => {
    const h = harness({ keys: [shopKey({ scopes: ['shop:catalog:read', 'shop:orders:read'] })] });
    const result = await authenticate(h);
    if (!result.ok) throw new Error(result.error.message);
    expect(result.value.apiKey.id).toBe('shop-key-1');
    expect(result.value.ctx.identity).toEqual({
      userId: OWNER_ID,
      email: 'owner@example.test',
      name: 'Shop Owner',
      emailVerified: true,
      image: 'https://cdn.example.test/owner.png',
      tenantAccess: 'staff',
      tenantId: TENANT.id,
      tenantSlug: TENANT.slug,
      tenantName: TENANT.name,
      staffRole: 'owner',
      memberId: 'member-owner',
      memberDisplayName: 'Shop Owner',
      memberBannedAt: null,
      memberDmOptOutAt: null,
      memberLanguage: 'en',
      memberVideoAutoplay: true,
    });
    expect(result.value.ctx.identity.userId).not.toBe('api-key');
    expect(result.value.ctx.machineActor).toEqual({ kind: 'shop_management_key', apiKeyId: 'shop-key-1' });
    expect(result.value.ctx.impersonation).toBeUndefined();
    expect([...(result.value.ctx.capabilities ?? [])].sort()).toEqual(
      ['order:export', 'order:read', 'product:price:read', 'product:read'],
    );
  });

  it('never grants more than the owner holds, even with every shop scope', async () => {
    const h = harness({ keys: [shopKey({ scopes: [...shopManagementScopeSchema.options] })] });
    const result = await authenticate(h);
    if (!result.ok) throw new Error(result.error.message);
    const owner = capabilitiesForPrincipal('owner');
    const granted = result.value.ctx.capabilities ?? [];
    expect(granted.length).toBeGreaterThan(0);
    expect(granted.every((capability) => owner.includes(capability))).toBe(true);
    expect(granted).not.toContain('api-key:write');
    expect(granted).not.toContain('api-key:read');
  });

  it('builds the context without member fields when the issuer has no member row and never creates one', async () => {
    const h = harness({ member: null });
    const result = await authenticate(h);
    if (!result.ok) throw new Error(result.error.message);
    expect(result.value.ctx.identity).toMatchObject({ memberId: null, image: null, staffRole: 'owner', tenantAccess: 'staff' });
    expect(h.findMember).toHaveBeenCalledWith(TENANT.id, OWNER_ID);
  });

  it.each([
    ['an empty secret', '   ', { ok: false, error: { code: 'unauthorized', message: 'Missing API key' } }],
    ['an unknown secret', 'unknown-secret', invalidKey],
  ] as const)('rejects %s', async (_label, secret, expected) => {
    expect(await authenticate(harness(), 'shop:catalog:read', TENANT, secret)).toMatchObject(expected);
  });

  it('accepts a secret with surrounding whitespace', async () => {
    expect(await authenticate(harness(), 'shop:catalog:read', TENANT, `  ${SECRET}\n`)).toMatchObject({ ok: true });
  });

  it('rejects a key without the required scope and a key with another shop scope', async () => {
    const h = harness({ keys: [shopKey({ scopes: ['shop:orders:read'] })] });
    expect(await authenticate(h, 'shop:catalog:read')).toMatchObject({
      ok: false,
      error: { code: 'forbidden', message: 'shop:catalog:read is not permitted' },
    });
    expect(await authenticate(h, 'shop:catalog:write')).toMatchObject({
      ok: false,
      error: { code: 'forbidden', message: 'shop:catalog:write is not permitted' },
    });
  });

  it('rejects a legacy key with null scopes', async () => {
    const h = harness({ keys: [shopKey({ kind: 'legacy', scopes: null, issuedByUserId: null, expiresAt: null })] });
    expect(await authenticate(h)).toMatchObject(invalidKey);
  });

  it.each(LEGACY_SCOPE_FAMILIES)('rejects a legacy key scoped to %s', async (scope) => {
    const h = harness({ keys: [shopKey({ kind: 'legacy', scopes: [scope], issuedByUserId: null })] });
    expect(await authenticate(h)).toMatchObject(invalidKey);
  });

  it('rejects a legacy-kind key that carries shop scopes', async () => {
    const h = harness({ keys: [shopKey({ kind: 'legacy' })] });
    expect(await authenticate(h)).toMatchObject(invalidKey);
  });

  it('rejects a shop key whose stored scopes mix shop and legacy scopes', async () => {
    const h = harness({ keys: [shopKey({ scopes: ['shop:catalog:read', 'report:read'] })] });
    expect(await authenticate(h)).toMatchObject(invalidKey);
  });

  it.each([
    ['null scopes', null],
    ['an empty scope list', []],
  ] as const)('rejects a shop key with %s even though the database refuses such a row', async (_label, scopes) => {
    const h = harness({ keys: [shopKey({ scopes: scopes === null ? null : [...scopes] })] });
    expect(await authenticate(h)).toMatchObject(invalidKey);
  });

  it('rejects a key presented for another tenant', async () => {
    expect(await authenticate(harness(), 'shop:catalog:read', OTHER_TENANT)).toMatchObject(invalidKey);
  });

  it('rejects a row whose tenant does not match the requested tenant', async () => {
    const h = harness({ keys: [shopKey()] });
    h.deps.tenantApiKeys.findByHash = async () => shopKey({ tenantId: OTHER_TENANT.id });
    expect(await authenticate(h)).toMatchObject(invalidKey);
  });

  it('rejects a revoked row even if the repository returned it', async () => {
    const h = harness({ keys: [shopKey({ revokedAt: '1998-08-02T00:00:00.000Z' })] });
    expect(await authenticate(h)).toMatchObject(invalidKey);
  });

  it('rejects a key at and after its expiry, and a shop key without one', async () => {
    const h = harness();
    h.state.now = '1998-08-10T10:00:00.000Z';
    expect(await authenticate(h)).toMatchObject(invalidKey);
    h.state.now = '1998-08-11T00:00:00.000Z';
    expect(await authenticate(h)).toMatchObject(invalidKey);
    expect(await authenticate(harness({ keys: [shopKey({ expiresAt: null })] }))).toMatchObject(invalidKey);
  });

  it('rejects a shop key without an issuer', async () => {
    expect(await authenticate(harness({ keys: [shopKey({ issuedByUserId: null })] }))).toMatchObject(invalidKey);
  });

  it.each([
    ['demoted to admin', { staffRole: 'admin' as const }],
    ['removed from staff', { staffRole: null }],
    ['with an unverified email', { account: { userId: OWNER_ID, email: 'owner@example.test', name: 'Owner', emailVerified: false } }],
    ['whose account was deleted', { account: null }],
  ])('rejects a key whose issuer is %s', async (_label, options) => {
    expect(await authenticate(harness(options))).toEqual(invalidKey);
  });

  it('revalidates the issuer on every request', async () => {
    const h = harness();
    expect(await authenticate(h)).toMatchObject({ ok: true });
    h.state.staffRole = 'admin';
    expect(await authenticate(h)).toEqual(invalidKey);
    h.state.staffRole = 'owner';
    h.state.account = null;
    expect(await authenticate(h)).toEqual(invalidKey);
  });

  it('allows 60 requests a minute per key and rejects the 61st with a retry-after', async () => {
    const h = harness();
    for (let request = 0; request < 60; request += 1) {
      expect(await authenticate(h)).toMatchObject({ ok: true });
    }
    expect(await authenticate(h)).toMatchObject({
      ok: false,
      error: { code: 'rate_limited', details: { period: 'minute', retryAfterSeconds: 30 } },
    });
    h.state.now = '1998-08-03T10:01:00.000Z';
    expect(await authenticate(h)).toMatchObject({ ok: true });
  });

  it('caps a key at 10,000 requests a day', async () => {
    const h = harness();
    const claims: Array<{ period: string; limit: number }> = [];
    const claim = h.deps.apiKeyRateLimits.claim;
    h.deps.apiKeyRateLimits.claim = async (tenantId, input) => {
      claims.push({ period: input.period, limit: input.limit });
      return claim(tenantId, input);
    };
    await authenticate(h);
    expect(claims).toEqual([{ period: 'minute', limit: 60 }, { period: 'day', limit: 10_000 }]);
  });

  it('leaves the day count unchanged when the minute window refuses', async () => {
    const h = harness();
    for (let request = 0; request < 61; request += 1) await authenticate(h);
    expect(h.rateLimits.count('shop-key-1', 'minute')).toBe(60);
    expect(h.rateLimits.count('shop-key-1', 'day')).toBe(60);
  });

  it('gives the minute unit back when the day window refuses', async () => {
    const h = harness();
    const claim = h.deps.apiKeyRateLimits.claim;
    h.deps.apiKeyRateLimits.claim = async (tenantId, input) => input.period === 'day' ? false : claim(tenantId, input);
    expect(await authenticate(h)).toMatchObject({
      ok: false,
      error: { code: 'rate_limited', details: { period: 'day', retryAfterSeconds: 50_370 } },
    });
    expect(h.rateLimits.count('shop-key-1', 'minute')).toBe(0);
  });
});

describe('shop management key attribution', () => {
  const matched = (apiKeyId: string, kind: 'legacy' | 'shop_management' = 'shop_management', issuerUserId: string | null = OWNER_ID) =>
    ({ match: 'matched', apiKeyId, kind, issuerUserId });

  it('attributes an accepted request to its key and issuer', async () => {
    expect((await authenticateWithAttribution(harness())).attribution).toEqual(matched('shop-key-1'));
  });

  it.each([
    ['a revoked key', { keys: [shopKey({ revokedAt: '1998-08-02T00:00:00.000Z' })] }, matched('shop-key-1')],
    ['an expired key', { keys: [shopKey({ expiresAt: '1998-08-03T00:00:00.000Z' })] }, matched('shop-key-1')],
    ['a legacy key', { keys: [shopKey({ id: 'legacy-1', kind: 'legacy', scopes: null, issuedByUserId: null, expiresAt: null })] }, matched('legacy-1', 'legacy', null)],
    ['a key whose issuer lost owner standing', { staffRole: 'admin' as const }, matched('shop-key-1')],
  ])('attributes the 401 refusal of %s to the stored row', async (_label, options, expected) => {
    const outcome = await authenticateWithAttribution(harness(options));
    expect(outcome.result).toMatchObject(invalidKey);
    expect(outcome.attribution).toEqual(expected);
  });

  it('attributes a scope refusal and a rate-limit refusal to the key', async () => {
    const h = harness();
    const refused = await authenticateWithAttribution(h, 'shop:catalog:write');
    expect(refused.result).toMatchObject({ ok: false, error: { code: 'forbidden' } });
    expect(refused.attribution).toEqual(matched('shop-key-1'));
    h.deps.apiKeyRateLimits.claim = async () => false;
    const limited = await authenticateWithAttribution(h);
    expect(limited.result).toMatchObject({ ok: false, error: { code: 'rate_limited' } });
    expect(limited.attribution).toEqual(matched('shop-key-1'));
  });

  it('records that no key matched an unknown secret or a row from another tenant, and a missing secret', async () => {
    expect((await authenticateWithAttribution(harness(), 'shop:catalog:read', TENANT, 'unknown')).attribution).toEqual({ match: 'none' });
    expect((await authenticateWithAttribution(harness(), 'shop:catalog:read', OTHER_TENANT)).attribution).toEqual({ match: 'none' });
    expect((await authenticateWithAttribution(harness(), 'shop:catalog:read', TENANT, '  ')).attribution).toEqual({ match: 'missing' });
  });

  it('identifies a key without authenticating it or claiming its rate limit', async () => {
    const h = harness({ keys: [shopKey({ revokedAt: '1998-08-02T00:00:00.000Z' })] });
    expect(await identifyShopManagementKey(TENANT.id, SECRET, h.deps)).toEqual(matched('shop-key-1'));
    expect(await identifyShopManagementKey(TENANT.id, 'unknown', h.deps)).toEqual({ match: 'none' });
    expect(await identifyShopManagementKey(TENANT.id, '', h.deps)).toEqual({ match: 'missing' });
    expect(h.rateLimits.count('shop-key-1', 'minute')).toBe(0);
  });
});

describe('recordShopManagementKeyRequest', () => {
  it.each([
    [200, 'succeeded'],
    [204, 'succeeded'],
    [400, 'refused'],
    [401, 'refused'],
    [403, 'refused'],
    [429, 'refused'],
    [500, 'failed'],
  ] as const)('records one request row for status %i as %s', async (status, outcome) => {
    const recorded: Array<{ tenantId: string; event: ShopManagementKeyEvent }> = [];
    await recordShopManagementKeyRequest(TENANT.id, {
      apiKeyId: 'shop-key-1', actorUserId: OWNER_ID, method: 'POST', route: '/api/m2m/shop/products/update',
      resourceId: 'product-1', status,
    }, {
      shopManagementKeyEvents: { record: async (tenantId, event) => { recorded.push({ tenantId, event }); } },
      ids: { nextId: () => 'event-1' },
      clock: { nowIso: () => NOW },
    });
    expect(recorded).toEqual([{
      tenantId: TENANT.id,
      event: {
        id: 'event-1', tenantId: TENANT.id, apiKeyId: 'shop-key-1', kind: 'request', actorUserId: OWNER_ID, method: 'POST',
        route: '/api/m2m/shop/products/update', resourceId: 'product-1', status, outcome, at: NOW,
      },
    }]);
  });
});
