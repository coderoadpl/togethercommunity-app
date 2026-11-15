import { describe, expect, it, vi } from 'vitest';

import {
  capabilitiesForPrincipal,
  shopManagementScopeSchema,
  type Member,
  type Membership,
  type StaffRole,
  type Tenant,
  type TenantApiKey,
  type TenantApiKeyStoredScope,
} from '#core/domain/index.js';

import type { AccountIdentity, ApiKeyRateLimitRepository } from '../ports.js';
import { authenticateShopManagementKey, type ShopMachineAuthDeps } from './shop-machine-auth.js';

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

const createRateLimits = (): ApiKeyRateLimitRepository => {
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
    release: async () => undefined,
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
  const deps: ShopMachineAuthDeps = {
    tenantApiKeys: {
      findActiveByHash: async (tenantId, keyHash) =>
        keys.find((key) => key.tenantId === tenantId && key.keyHash === keyHash) ?? null,
    },
    apiKeyCrypto: { generateSecret: () => SECRET, hash: (value) => `hash:${value}` },
    accountIdentities: { findById: async (userId) => (state.account?.userId === userId ? state.account : null) },
    tenantAccess: { findStaffGrant, findMember },
    apiKeyRateLimits: createRateLimits(),
    clock: { nowIso: () => state.now },
  };
  return { deps, state, findMember };
};

const authenticate = (
  h: ReturnType<typeof harness>,
  scope: Parameters<typeof authenticateShopManagementKey>[2] = 'shop:catalog:read',
  tenant: Tenant = TENANT,
  secret = SECRET,
) => authenticateShopManagementKey(tenant, secret, scope, h.deps);

const invalidKey = { ok: false, error: { code: 'unauthorized', message: 'Invalid API key' } };
const issuerDenied = {
  ok: false,
  error: { code: 'forbidden', message: 'The API key issuer is no longer a verified owner of this workspace' },
};

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

  it('rejects a key presented for another tenant', async () => {
    expect(await authenticate(harness(), 'shop:catalog:read', OTHER_TENANT)).toMatchObject(invalidKey);
  });

  it('rejects a row whose tenant does not match the requested tenant', async () => {
    const h = harness({ keys: [shopKey()] });
    h.deps.tenantApiKeys.findActiveByHash = async () => shopKey({ tenantId: OTHER_TENANT.id });
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
    expect(await authenticate(harness(options))).toMatchObject(issuerDenied);
  });

  it('revalidates the issuer on every request', async () => {
    const h = harness();
    expect(await authenticate(h)).toMatchObject({ ok: true });
    h.state.staffRole = 'admin';
    expect(await authenticate(h)).toMatchObject(issuerDenied);
    h.state.staffRole = 'owner';
    h.state.account = null;
    expect(await authenticate(h)).toMatchObject(issuerDenied);
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
    expect(claims).toEqual([{ period: 'day', limit: 10_000 }, { period: 'minute', limit: 60 }]);
  });
});
