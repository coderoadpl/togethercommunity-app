import { describe, expect, it, vi } from 'vitest';

import type { EntitlementKey, Identity, Membership, ShopManagementKeyEvent, StaffRole, Tenant } from '#core/domain/index.js';

import type { Ctx } from '../context.js';
import type { AccountIdentity, EntitlementKeyRateLimitRepository } from '../ports.js';
import {
  authenticateEntitlementKey,
  claimEntitlementKeyRateLimit,
  entitlementKeyHash,
  type EntitlementKeyAuthDeps,
} from './entitlement-key-auth.js';
import { createEntitlementKey, listEntitlementKeys, revokeEntitlementKey, type EntitlementKeyDeps } from './entitlement-keys.js';
import { shopManagementKeyHash } from './shop-machine-auth.js';

const NOW = '2026-11-20T12:00:30.000Z';
const TENANT: Tenant = { id: 't-acme', slug: 'acme', name: 'Acme', status: 'active', plan: 'hosted', contentVersion: 1 };
const OTHER_TENANT: Tenant = { ...TENANT, id: 't-studio', slug: 'studio', name: 'Studio' };
const SECRET = 'entitlement-secret';
const OWNER_ID = 'user-owner';
const stubCrypto = { generateSecret: () => SECRET, hash: (value: string) => `hash:${value}` };

const entitlementKey = (overrides: Partial<EntitlementKey> = {}): EntitlementKey => ({
  id: 'ek-1',
  tenantId: TENANT.id,
  name: 'Companion app',
  keyHash: entitlementKeyHash(stubCrypto, SECRET),
  scopes: ['entitlements:check'],
  productIds: null,
  issuedByUserId: OWNER_ID,
  createdAt: '2026-11-01T00:00:00.000Z',
  expiresAt: '2026-12-01T00:00:00.000Z',
  revokedAt: null,
  ...overrides,
});

const createRateLimits = (): EntitlementKeyRateLimitRepository & { count: (period: string) => number } => {
  const buckets = new Map<string, { windowStartedAt: string; count: number }>();
  return {
    claim: async (_tenantId, input) => {
      const key = `${input.apiKeyId}:${input.period}`;
      const current = buckets.get(key);
      const count = current?.windowStartedAt === input.windowStartedAt ? current.count : 0;
      if (count + input.weight > input.limit) return false;
      buckets.set(key, { windowStartedAt: input.windowStartedAt, count: count + input.weight });
      return true;
    },
    release: async (_tenantId, input) => {
      const key = `${input.apiKeyId}:${input.period}`;
      const current = buckets.get(key);
      if (current?.windowStartedAt !== input.windowStartedAt) return;
      buckets.set(key, { ...current, count: Math.max(0, current.count - input.weight) });
    },
    count: (period) => buckets.get(`ek-1:${period}`)?.count ?? 0,
  };
};

const authHarness = (options: { keys?: EntitlementKey[]; account?: AccountIdentity | null; staffRole?: StaffRole | null; source?: Membership['source'] } = {}) => {
  const keys = options.keys ?? [entitlementKey()];
  const account = options.account === undefined
    ? { userId: OWNER_ID, email: 'owner@acme.example', name: 'Owner', emailVerified: true }
    : options.account;
  const staffRole = options.staffRole === undefined ? 'owner' : options.staffRole;
  const rateLimits = createRateLimits();
  const deps: EntitlementKeyAuthDeps = {
    entitlementKeys: { findByHash: async (tenantId, keyHash) => keys.find((key) => key.tenantId === tenantId && key.keyHash === keyHash) ?? null },
    apiKeyCrypto: stubCrypto,
    accountIdentities: { findById: async (userId) => (account?.userId === userId ? account : null) },
    tenantAccess: {
      findStaffGrant: async (userId, lookup) =>
        staffRole !== null && userId === OWNER_ID && 'tenantId' in lookup && lookup.tenantId === TENANT.id
          ? { tenant: TENANT, staffRole, source: options.source ?? 'direct' }
          : null,
    },
    entitlementKeyRateLimits: rateLimits,
    clock: { nowIso: () => NOW },
  };
  return { deps, rateLimits };
};

const invalidKey = { ok: false, error: { code: 'unauthorized', message: 'Invalid API key' } };

describe('authenticateEntitlementKey', () => {
  it('gives the key only the entitlement capabilities of its scopes', async () => {
    const { result } = await authenticateEntitlementKey(TENANT, SECRET, authHarness().deps);
    if (!result.ok) throw new Error(result.error.message);
    expect(result.value.ctx.capabilities).toEqual(['entitlement:check']);
    expect(result.value.ctx.machineActor).toEqual({ kind: 'entitlement_key', apiKeyId: 'ek-1' });
    expect(result.value.ctx.identity.memberId).toBeNull();
    const both = await authenticateEntitlementKey(TENANT, SECRET, authHarness({ keys: [entitlementKey({ scopes: ['entitlements:check', 'entitlements:members:read'] })] }).deps);
    if (!both.result.ok) throw new Error(both.result.error.message);
    expect(both.result.value.ctx.capabilities).toEqual(['entitlement:check', 'entitlement:member:read']);
  });

  it.each([
    ['another workspace', { keys: [entitlementKey({ tenantId: OTHER_TENANT.id })] }],
    ['a revoked key', { keys: [entitlementKey({ revokedAt: '2026-11-10T00:00:00.000Z' })] }],
    ['an expired key', { keys: [entitlementKey({ expiresAt: NOW })] }],
    ['an issuer who is no longer the owner', { staffRole: 'admin' as const }],
    ['an issuer whose ownership comes from an organization', { source: 'organization' as const }],
    ['an issuer whose e-mail is no longer verified', { account: { userId: OWNER_ID, email: 'owner@acme.example', name: 'Owner', emailVerified: false } }],
  ])('refuses %s with the same answer as an unknown key', async (_label, options) => {
    expect((await authenticateEntitlementKey(TENANT, SECRET, authHarness(options).deps)).result).toEqual(invalidKey);
    expect((await authenticateEntitlementKey(TENANT, 'unknown-secret', authHarness().deps)).result).toEqual(invalidKey);
  });

  it('never accepts a shop management key secret, whose stored hash lives in another domain', async () => {
    const shopHash = shopManagementKeyHash(stubCrypto, SECRET, 'direct');
    const h = authHarness({ keys: [entitlementKey({ keyHash: shopHash })] });
    expect((await authenticateEntitlementKey(TENANT, SECRET, h.deps)).result).toEqual(invalidKey);
  });

  it('answers a missing key as missing', async () => {
    expect((await authenticateEntitlementKey(TENANT, '  ', authHarness().deps)).attribution).toEqual({ match: 'missing' });
  });
});

describe('claimEntitlementKeyRateLimit', () => {
  it('counts every subject of a batch and refuses once the minute is spent', async () => {
    const h = authHarness();
    expect((await claimEntitlementKeyRateLimit('ek-1', TENANT.id, 25, h.deps)).ok).toBe(true);
    expect(h.rateLimits.count('minute')).toBe(25);
    for (let batch = 0; batch < 11; batch += 1) await claimEntitlementKeyRateLimit('ek-1', TENANT.id, 25, h.deps);
    const refused = await claimEntitlementKeyRateLimit('ek-1', TENANT.id, 1, h.deps);
    expect(refused).toMatchObject({ ok: false, error: { code: 'rate_limited', details: { period: 'minute' } } });
    expect(h.rateLimits.count('minute')).toBe(300);
    expect(h.rateLimits.count('day')).toBe(300);
  });
});

const ownerIdentity: Identity = {
  userId: OWNER_ID,
  email: 'owner@acme.example',
  name: 'Owner',
  emailVerified: true,
  image: null,
  tenantAccess: 'staff',
  tenantId: TENANT.id,
  tenantSlug: TENANT.slug,
  tenantName: TENANT.name,
  staffRole: 'owner',
  staffGrantSource: 'direct',
  memberId: null,
  memberDisplayName: null,
  memberBannedAt: null,
  memberDmOptOutAt: null,
  memberLanguage: null,
  memberVideoAutoplay: null,
};

const issueHarness = (options: { switchState?: 'enabled' | 'disabled' } = {}) => {
  const stored: EntitlementKey[] = [];
  const events: ShopManagementKeyEvent[] = [];
  let next = 0;
  const deps: EntitlementKeyDeps = {
    entitlementKeys: {
      listByTenant: async (tenantId) => stored.filter((key) => key.tenantId === tenantId),
      create: vi.fn(async (_tenantId: string, key: EntitlementKey, event: ShopManagementKeyEvent) => { stored.push(key); events.push(event); }),
      findByHash: async () => null,
      revoke: async (tenantId, id, revokedAt, event) => {
        const index = stored.findIndex((key) => key.tenantId === tenantId && key.id === id && key.revokedAt === null);
        const found = stored[index];
        if (found === undefined) return null;
        const revoked = { ...found, revokedAt };
        stored[index] = revoked;
        events.push(event);
        return revoked;
      },
    },
    products: { findById: async (tenantId, productId) => (tenantId === TENANT.id && productId === 'prod-pro' ? { id: productId, tenantId } : null) },
    apiKeyCrypto: stubCrypto,
    ids: { nextId: () => `id-${String((next += 1))}` },
    clock: { nowIso: () => NOW },
    shopManagementKeysSwitch: options.switchState ?? 'enabled',
  };
  return { deps, stored, events };
};

const ownerCtx: Ctx = { identity: ownerIdentity };
const IN_30_DAYS = '2026-12-20T12:00:00.000Z';

describe('entitlement key issuance', () => {
  it('stores only the domain-separated hash and returns the secret once', async () => {
    const h = issueHarness();
    const created = await createEntitlementKey(ownerCtx, { name: 'Companion app', scopes: ['entitlements:check'], expiresAt: IN_30_DAYS, productIds: ['prod-pro'] }, h.deps);
    if (!created.ok) throw new Error(created.error.message);
    expect(created.value.secret).toBe(SECRET);
    expect(created.value.apiKey).not.toHaveProperty('keyHash');
    expect(h.stored[0]?.keyHash).toBe(`hash:together:entitlement-key:${SECRET}`);
    expect(h.stored[0]?.productIds).toEqual(['prod-pro']);
    expect(h.events.map((event) => event.kind)).toEqual(['created']);
    expect(JSON.stringify(h.events)).not.toContain(SECRET);
  });

  it.each([
    ['a shop management key', { ...ownerCtx, capabilities: ['api-key:write'], machineActor: { kind: 'shop_management_key', apiKeyId: 'shop-1', mode: 'direct' } }],
    ['an entitlement key', { ...ownerCtx, capabilities: ['entitlement:check'], machineActor: { kind: 'entitlement_key', apiKeyId: 'ek-1' } }],
    ['an admin', { identity: { ...ownerIdentity, staffRole: 'admin' } }],
    ['an owner with an unverified e-mail', { identity: { ...ownerIdentity, emailVerified: false } }],
    ['an owner through an organization', { identity: { ...ownerIdentity, staffGrantSource: 'organization' } }],
    ['an operator viewing as a member', { ...ownerCtx, impersonation: { id: 'imp-1', actorUserId: 'user-op', actorEmail: 'op@togethercommunity.app' } }],
  ] satisfies [string, Ctx][])('refuses %s', async (_label, ctx) => {
    const h = issueHarness();
    expect(await createEntitlementKey(ctx, { name: 'x', scopes: ['entitlements:check'], expiresAt: IN_30_DAYS }, h.deps)).toMatchObject({ ok: false });
    expect(await listEntitlementKeys(ctx, h.deps)).toMatchObject({ ok: false });
    expect(h.stored).toEqual([]);
  });

  it('refuses a lifetime above 90 days, a product of another workspace and the members scope alone', async () => {
    const h = issueHarness();
    expect(await createEntitlementKey(ownerCtx, { name: 'x', scopes: ['entitlements:check'], expiresAt: '2027-03-01T00:00:00.000Z' }, h.deps)).toMatchObject({ ok: false, error: { code: 'validation' } });
    expect(await createEntitlementKey(ownerCtx, { name: 'x', scopes: ['entitlements:check'], expiresAt: IN_30_DAYS, productIds: ['prod-of-studio'] }, h.deps)).toMatchObject({ ok: false, error: { code: 'validation' } });
    expect(await createEntitlementKey(ownerCtx, { name: 'x', scopes: ['entitlements:members:read'], expiresAt: IN_30_DAYS }, h.deps)).toMatchObject({ ok: false, error: { code: 'validation' } });
    expect(h.stored).toEqual([]);
  });

  it('refuses issuance while the deployment switch is off', async () => {
    const h = issueHarness({ switchState: 'disabled' });
    expect(await createEntitlementKey(ownerCtx, { name: 'x', scopes: ['entitlements:check'], expiresAt: IN_30_DAYS }, h.deps)).toMatchObject({ ok: false, error: { code: 'forbidden' } });
  });

  it('revokes once and records who revoked it', async () => {
    const h = issueHarness();
    const created = await createEntitlementKey(ownerCtx, { name: 'x', scopes: ['entitlements:check'], expiresAt: IN_30_DAYS }, h.deps);
    if (!created.ok) throw new Error(created.error.message);
    expect(await revokeEntitlementKey(ownerCtx, { id: created.value.apiKey.id }, h.deps)).toMatchObject({ ok: true, value: { revokedAt: NOW } });
    expect(await revokeEntitlementKey(ownerCtx, { id: created.value.apiKey.id }, h.deps)).toMatchObject({ ok: false, error: { code: 'not_found' } });
    expect(h.events.map((event) => [event.kind, event.actorUserId])).toEqual([['created', OWNER_ID], ['revoked', OWNER_ID]]);
  });
});
