import { eq, sql } from 'drizzle-orm';
import { drizzle } from 'drizzle-orm/node-postgres';
import pg from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { shopManagementKeyEventSchema, type EntitlementKey, type ShopManagementKey, type ShopManagementKeyEvent } from '#core/domain/index.js';

import type { Db } from './client.js';
import { createEntitlementKeyRateLimitRepository, createEntitlementKeyRepository } from './entitlement-keys.js';
import { createEntitlementSubjectReader } from './entitlement-subjects.js';
import { createShopManagementKeyEventRepository } from './shop-management-key-events.js';
import { createShopManagementKeyRepository } from './shop-management-keys.js';
import * as dbSchema from './schema.js';
import { createTestDatabase } from './test-database-name.js';

const baseDatabaseUrl = process.env['DATABASE_URL'] ?? 'postgres://together:together@localhost:48912/together';
const NOW = '2026-11-20T12:00:00.000Z';
const EXPIRY = '2026-12-20T12:00:00.000Z';
const TENANT = 'tenant-entitlements';
const NEIGHBOUR = 'tenant-entitlements-neighbour';

let database: Awaited<ReturnType<typeof createTestDatabase>>;

const entitlementKey = (overrides: Partial<EntitlementKey> = {}): EntitlementKey => ({
  id: 'ek-1', tenantId: TENANT, name: 'Companion app', keyHash: 'hash-entitlement', scopes: ['entitlements:check'], productIds: null, match: 'verified',
  issuedByUserId: 'user-owner', createdAt: NOW, expiresAt: EXPIRY, revokedAt: null,
  ...overrides,
});

const shopKey: ShopManagementKey = {
  id: 'shop-key', tenantId: TENANT, name: 'Shop backend', keyHash: 'hash-shop', scopes: ['shop:catalog:read'], mode: 'direct',
  issuedByUserId: 'user-owner', createdAt: NOW, expiresAt: EXPIRY, revokedAt: null,
};

const event = (apiKeyId: string, overrides: Partial<ShopManagementKeyEvent> = {}): ShopManagementKeyEvent => ({
  id: `event-${apiKeyId}-${overrides.kind ?? 'created'}`, tenantId: TENANT, apiKeyId, kind: 'created', actorUserId: 'user-owner',
  method: null, route: null, resourceId: null, at: NOW,
  ...overrides,
});

beforeAll(async () => {
  database = await createTestDatabase('together_entitlement_keys_test', baseDatabaseUrl);
  for (const [id, slug] of [[TENANT, 'entitlements'], [NEIGHBOUR, 'entitlements-neighbour']] as const) {
    await database.db.insert(dbSchema.tenants).values({ id, slug, name: slug, createdAt: NOW });
  }
  await createShopManagementKeyRepository(database.db).create(TENANT, shopKey, event('shop-key'));
  await createEntitlementKeyRepository(database.db).create(TENANT, entitlementKey(), event('ek-1'));
}, 120_000);

afterAll(async () => {
  await database.close();
});

describe('migration 0168', () => {
  it('refuses a stored scope outside the closed list and a key without the check scope', async () => {
    const insert = (scopes: unknown) => {
      const id = `bad-${JSON.stringify(scopes)}`;
      return database.db.execute(sql`insert into entitlement_keys (id, tenant_id, name, key_hash, scopes, issued_by_user_id, created_at, expires_at)
        values (${id}, ${TENANT}, 'x', ${id}, ${JSON.stringify(scopes)}::jsonb, 'user-owner', ${NOW}, ${EXPIRY})`);
    };
    await expect(insert(['entitlements:members:read'])).rejects.toThrow();
    await expect(insert(['entitlements:check', 'shop:catalog:read'])).rejects.toThrow();
    await expect(insert([])).rejects.toThrow();
  });
});

describe('a release without entitlement keys', () => {
  it('keeps listing and authenticating shop management keys as before, the entitlement key being in its own table', async () => {
    const shopKeys = createShopManagementKeyRepository(database.db);
    expect((await shopKeys.listByTenant(TENANT)).map((key) => key.id)).toEqual(['shop-key']);
    expect(await shopKeys.findByHash(TENANT, 'hash-entitlement')).toBeNull();
    expect(await shopKeys.findByHash(TENANT, 'hash-shop')).toMatchObject({ id: 'shop-key' });
  });

  it('reads the history rows an entitlement key writes with the shop management key event schema', async () => {
    await createShopManagementKeyEventRepository(database.db).record(TENANT, event('ek-1', {
      id: 'event-ek-1-request', kind: 'request', method: 'POST', route: '/api/m2m/entitlements/check',
    }));
    const rows = await database.db.select().from(dbSchema.shopManagementKeyEvents).where(eq(dbSchema.shopManagementKeyEvents.apiKeyId, 'ek-1'));
    const page = await createShopManagementKeyEventRepository(database.db).list(TENANT, { limit: 50, apiKeyId: 'ek-1' });
    expect(page.events.map((row) => shopManagementKeyEventSchema.parse(row).kind).sort()).toEqual(['created', 'request']);
    expect(rows).toHaveLength(2);
  });
});

describe('entitlement key repository', () => {
  it('finds a key only in its own workspace and revokes it once', async () => {
    const keys = createEntitlementKeyRepository(database.db);
    expect(await keys.findByHash(NEIGHBOUR, 'hash-entitlement')).toBeNull();
    await keys.create(TENANT, entitlementKey({ id: 'ek-revoke', keyHash: 'hash-revoke', productIds: ['prod-pro'] }), event('ek-revoke'));
    expect(await keys.findByHash(TENANT, 'hash-revoke')).toMatchObject({ productIds: ['prod-pro'] });
    expect(await keys.revoke(NEIGHBOUR, 'ek-revoke', NOW, event('ek-revoke', { tenantId: NEIGHBOUR, kind: 'revoked' }))).toBeNull();
    expect(await keys.revoke(TENANT, 'ek-revoke', NOW, event('ek-revoke', { kind: 'revoked' }))).toMatchObject({ revokedAt: NOW });
    expect(await keys.revoke(TENANT, 'ek-revoke', NOW, event('ek-revoke', { id: 'event-again', kind: 'revoked' }))).toBeNull();
  });

  it('counts a weighted claim, refuses the claim that would pass the limit and ignores another workspace', async () => {
    const limits = createEntitlementKeyRateLimitRepository(database.db);
    const window = { apiKeyId: 'ek-1', period: 'minute' as const, windowStartedAt: '2026-11-20T12:00:00.000Z' };
    expect(await limits.claim(TENANT, { ...window, limit: 30, weight: 25 })).toBe(true);
    expect(await limits.claim(TENANT, { ...window, limit: 30, weight: 6 })).toBe(false);
    expect(await limits.claim(TENANT, { ...window, limit: 30, weight: 5 })).toBe(true);
    expect(await limits.claim(NEIGHBOUR, { ...window, limit: 30, weight: 1 })).toBe(false);
    await limits.release(TENANT, { ...window, weight: 5 });
    expect(await limits.claim(TENANT, { ...window, limit: 30, weight: 5 })).toBe(true);
    expect(await limits.claim(TENANT, { ...window, windowStartedAt: '2026-11-20T12:01:00.000Z', limit: 30, weight: 30 })).toBe(true);
  });

  it('deletes the workspace entitlement keys with the shop management key purge', async () => {
    const purgeTenant = 'tenant-entitlements-purge';
    await database.db.insert(dbSchema.tenants).values({ id: purgeTenant, slug: 'entitlements-purge', name: 'purge', createdAt: NOW });
    await createEntitlementKeyRepository(database.db).create(purgeTenant, entitlementKey({ id: 'ek-purge', tenantId: purgeTenant, keyHash: 'hash-purge' }), event('ek-purge', { tenantId: purgeTenant }));
    let next = 0;
    const purged = await createShopManagementKeyRepository(database.db).purge(
      purgeTenant,
      (apiKeyId) => event(apiKeyId, { id: `purged-${String((next += 1))}`, tenantId: purgeTenant, kind: 'purged' }),
      { at: NOW, actorUserId: 'user-owner', nextEventId: () => `withdrawal-${String((next += 1))}` },
    );
    expect(purged).toBe(1);
    expect(await createEntitlementKeyRepository(database.db).listByTenant(purgeTenant)).toEqual([]);
    expect(await createEntitlementKeyRepository(database.db).listByTenant(TENANT)).not.toEqual([]);
  });
});

describe('entitlement subject reader', () => {
  it('reads the account by its normalized e-mail', async () => {
    await database.db.insert(dbSchema.user).values({ id: 'user-ada', name: 'Ada', email: 'ada@example.test', emailVerified: true });
    expect(await createEntitlementSubjectReader(database.db).findAccountByEmail(' ADA@example.test ')).toEqual({ userId: 'user-ada', emailVerified: true });
    expect(await createEntitlementSubjectReader(database.db).findAccountByEmail('nobody@example.test')).toBeNull();
  });

  it('tells whether a member signed in to this workspace', async () => {
    await database.db.insert(dbSchema.members).values({ id: 'm-ada', tenantId: TENANT, userId: 'user-ada', email: 'ada@example.test', createdAt: NOW });
    const reader = createEntitlementSubjectReader(database.db);
    expect(await reader.hasSignedIn(TENANT, 'm-ada')).toBe(false);
    await database.db.insert(dbSchema.memberEvents).values({ id: 'sign-in:s1', tenantId: TENANT, memberId: 'm-ada', type: 'sign-in', payload: {}, occurredAt: NOW });
    expect(await reader.hasSignedIn(TENANT, 'm-ada')).toBe(true);
    expect(await reader.hasSignedIn(NEIGHBOUR, 'm-ada')).toBe(false);
  });

  it('finds members by the checkout-normalized address and lists only paid, live, not cancelled order products', async () => {
    await database.db.insert(dbSchema.members).values([
      { id: 'm-buyer', tenantId: TENANT, userId: 'user-buyer', email: ' Buyer@Example.test ', createdAt: NOW },
      { id: 'm-buyer-neighbour', tenantId: NEIGHBOUR, userId: 'user-buyer', email: 'buyer@example.test', createdAt: NOW },
    ]);
    const line = (productId: string) => ({ productId, name: 'Line', productType: 'course' as const, grossCents: 100, netCents: 100, vatRate: null, vatCents: 0, vatExemptionBasis: null, issuedCount: null });
    const order = (id: string, overrides: Partial<typeof dbSchema.orders.$inferInsert>) => ({
      id, tenantId: TENANT, memberId: 'm-buyer', productId: `prod-${id}`, kind: 'one_time' as const, status: 'paid' as const, amountCents: 100,
      currency: 'PLN', provider: 'stripe' as const, providerObjectIds: {}, lines: [line(`prod-${id}`)], createdAt: NOW, ...overrides,
    });
    await database.db.insert(dbSchema.products).values([
      ...['paid', 'sold-out', 'refunded', 'partial', 'test', 'simulated', 'subscribed'].map((id) => ({ id: `prod-${id}`, tenantId: TENANT })),
    ].map((product) => ({ ...product, slug: product.id, title: product.id, description: '', priceCents: 100, currency: 'PLN', createdAt: NOW })));
    await database.db.insert(dbSchema.orders).values([
      order('paid', { lines: [line('prod-paid'), line('prod-line')] }),
      order('sold-out', { cancelReason: 'out_of_stock' }),
      order('refunded', { status: 'refunded' }),
      order('partial', { status: 'partially_refunded' }),
      order('test', { mode: 'test' }),
      order('simulated', { provider: 'simulated' }),
      order('subscribed', { kind: 'recurring', providerObjectIds: { subscription: 'sub_1' } }),
    ]);
    const reader = createEntitlementSubjectReader(database.db);
    expect((await reader.findMembersByEmail(TENANT, 'buyer@example.test')).map((row) => row.id)).toEqual(['m-buyer']);
    expect((await reader.findMembersByEmail(NEIGHBOUR, 'buyer@example.test')).map((row) => row.id)).toEqual(['m-buyer-neighbour']);
    expect(await reader.listPaidCheckoutOrders(NEIGHBOUR, 'm-buyer')).toEqual([]);
    expect(await reader.listPaidCheckoutOrders(TENANT, 'm-buyer')).toEqual(expect.arrayContaining([
      { kind: 'one_time', productIds: ['prod-paid', 'prod-line'], providerSubscriptionId: null },
      { kind: 'recurring', productIds: ['prod-subscribed'], providerSubscriptionId: 'sub_1' },
    ]));
    expect(await reader.listPaidCheckoutOrders(TENANT, 'm-buyer')).toHaveLength(2);
  });

  it('keeps the e-mail being checked out of a database error and keeps only the SQLSTATE', async () => {
    const emptyUrl = new URL(database.url);
    emptyUrl.pathname = '/postgres';
    const pool = new pg.Pool({ connectionString: emptyUrl.toString() });
    try {
      const reader = createEntitlementSubjectReader(drizzle(pool, { schema: dbSchema }) satisfies Db);
      const failure: unknown = await reader.findAccountByEmail('private.person@example.test').then(() => null, (error: unknown) => error);
      expect(failure).toBeInstanceOf(Error);
      const serialized = failure instanceof Error ? `${failure.message} ${String(failure.cause)} ${failure.stack ?? ''}` : '';
      expect(serialized).not.toContain('private.person');
      expect(failure instanceof Error ? String(failure.cause) : '').toMatch(/PostgreSQL SQLSTATE [0-9A-Z]{5}/u);
    } finally {
      await pool.end();
    }
  });
});
