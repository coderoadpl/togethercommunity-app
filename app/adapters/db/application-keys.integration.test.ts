import { eq, sql } from 'drizzle-orm';
import { drizzle } from 'drizzle-orm/node-postgres';
import pg from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { shopManagementKeyEventSchema, type ApplicationKey, type Identity, type ShopManagementKey, type ShopManagementKeyEvent, type Tenant } from '#core/domain/index.js';
import {
  applicationKeyHash,
  authenticateApplicationKey,
  listApplicationKeys,
  purgeShopManagementKeys,
  revokeApplicationKey,
  type ApplicationKeyAuthDeps,
} from '#core/server/index.js';

import type { Db } from './client.js';
import { createApplicationKeyRateLimitRepository, createApplicationKeyRepository } from './application-keys.js';
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

const applicationKey = (overrides: Partial<ApplicationKey> = {}): ApplicationKey => ({
  id: 'ek-1', tenantId: TENANT, name: 'Companion app', keyHash: 'hash-entitlement', scopes: ['entitlements:check'], productIds: null,
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
  database = await createTestDatabase('together_application_keys_test', baseDatabaseUrl);
  for (const [id, slug] of [[TENANT, 'entitlements'], [NEIGHBOUR, 'entitlements-neighbour']] as const) {
    await database.db.insert(dbSchema.tenants).values({ id, slug, name: slug, createdAt: NOW });
  }
  await createShopManagementKeyRepository(database.db).create(TENANT, shopKey, event('shop-key'));
  await createApplicationKeyRepository(database.db).create(TENANT, applicationKey(), event('ek-1'));
}, 120_000);

afterAll(async () => {
  await database.close();
});

describe('migration 0169', () => {
  it('refuses a stored scope outside the closed list and a key without the check scope', async () => {
    const insert = (scopes: unknown) => {
      const id = `bad-${JSON.stringify(scopes)}`;
      return database.db.execute(sql`insert into application_keys (id, tenant_id, name, key_hash, scopes, issued_by_user_id, created_at, expires_at)
        values (${id}, ${TENANT}, 'x', ${id}, ${JSON.stringify(scopes)}::jsonb, 'user-owner', ${NOW}, ${EXPIRY})`);
    };
    await expect(insert(['entitlements:members:read'])).rejects.toThrow();
    await expect(insert(['entitlements:check', 'shop:catalog:read'])).rejects.toThrow();
    await expect(insert([])).rejects.toThrow();
  });
});

describe('a release without application keys', () => {
  it('keeps listing and authenticating shop management keys as before, the application key being in its own table', async () => {
    const shopKeys = createShopManagementKeyRepository(database.db);
    expect((await shopKeys.listByTenant(TENANT)).map((key) => key.id)).toEqual(['shop-key']);
    expect(await shopKeys.findByHash(TENANT, 'hash-entitlement')).toBeNull();
    expect(await shopKeys.findByHash(TENANT, 'hash-shop')).toMatchObject({ id: 'shop-key' });
  });

  it('reads the history rows an application key writes with the shop management key event schema', async () => {
    await createShopManagementKeyEventRepository(database.db).record(TENANT, event('ek-1', {
      id: 'event-ek-1-request', kind: 'request', method: 'POST', route: '/api/m2m/entitlements/check',
    }));
    const rows = await database.db.select().from(dbSchema.shopManagementKeyEvents).where(eq(dbSchema.shopManagementKeyEvents.apiKeyId, 'ek-1'));
    const page = await createShopManagementKeyEventRepository(database.db).list(TENANT, { limit: 50, apiKeyId: 'ek-1' });
    expect(page.events.map((row) => shopManagementKeyEventSchema.parse(row).kind).sort()).toEqual(['created', 'request']);
    expect(rows).toHaveLength(2);
  });
});

describe('application key repository', () => {
  it('finds a key only in its own workspace and revokes it once', async () => {
    const keys = createApplicationKeyRepository(database.db);
    expect(await keys.findByHash(NEIGHBOUR, 'hash-entitlement')).toBeNull();
    await keys.create(TENANT, applicationKey({ id: 'ek-revoke', keyHash: 'hash-revoke', productIds: ['prod-pro'] }), event('ek-revoke'));
    expect(await keys.findByHash(TENANT, 'hash-revoke')).toMatchObject({ productIds: ['prod-pro'] });
    expect(await keys.revoke(NEIGHBOUR, 'ek-revoke', NOW, event('ek-revoke', { tenantId: NEIGHBOUR, kind: 'revoked' }))).toBeNull();
    expect(await keys.revoke(TENANT, 'ek-revoke', NOW, event('ek-revoke', { kind: 'revoked' }))).toMatchObject({ revokedAt: NOW });
    expect(await keys.revoke(TENANT, 'ek-revoke', NOW, event('ek-revoke', { id: 'event-again', kind: 'revoked' }))).toBeNull();
  });

  it('counts a weighted claim, refuses the claim that would pass the limit and ignores another workspace', async () => {
    const limits = createApplicationKeyRateLimitRepository(database.db);
    const window = { apiKeyId: 'ek-1', period: 'minute' as const, windowStartedAt: '2026-11-20T12:00:00.000Z' };
    expect(await limits.claim(TENANT, { ...window, limit: 30, weight: 25 })).toBe(true);
    expect(await limits.claim(TENANT, { ...window, limit: 30, weight: 6 })).toBe(false);
    expect(await limits.claim(TENANT, { ...window, limit: 30, weight: 5 })).toBe(true);
    expect(await limits.claim(NEIGHBOUR, { ...window, limit: 30, weight: 1 })).toBe(false);
    await limits.release(TENANT, { ...window, weight: 5 });
    expect(await limits.claim(TENANT, { ...window, limit: 30, weight: 5 })).toBe(true);
    expect(await limits.claim(TENANT, { ...window, windowStartedAt: '2026-11-20T12:01:00.000Z', limit: 30, weight: 30 })).toBe(true);
  });

  it('deletes the workspace application keys with the shop management key purge', async () => {
    const purgeTenant = 'tenant-entitlements-purge';
    await database.db.insert(dbSchema.tenants).values({ id: purgeTenant, slug: 'entitlements-purge', name: 'purge', createdAt: NOW });
    await createApplicationKeyRepository(database.db).create(purgeTenant, applicationKey({ id: 'ek-purge', tenantId: purgeTenant, keyHash: 'hash-purge' }), event('ek-purge', { tenantId: purgeTenant }));
    let next = 0;
    const purged = await createShopManagementKeyRepository(database.db).purge(
      purgeTenant,
      (apiKeyId) => event(apiKeyId, { id: `purged-${String((next += 1))}`, tenantId: purgeTenant, kind: 'purged' }),
      { at: NOW, actorUserId: 'user-owner', nextEventId: () => `withdrawal-${String((next += 1))}` },
    );
    expect(purged).toBe(1);
    expect(await createApplicationKeyRepository(database.db).listByTenant(purgeTenant)).toEqual([]);
    expect(await createApplicationKeyRepository(database.db).listByTenant(TENANT)).not.toEqual([]);
  });
});

describe('the purge as the stop action for every verified owner', () => {
  const STOP_TENANT = 'tenant-entitlements-stop';
  const organizationOwner: Identity = {
    userId: 'user-organization-owner', email: 'organization-owner@example.test', name: 'Organization owner', emailVerified: true, image: null,
    tenantAccess: 'staff', tenantId: STOP_TENANT, tenantSlug: 'entitlements-stop', tenantName: 'stop', staffRole: 'owner', staffGrantSource: 'organization',
    memberId: null, memberDisplayName: null, memberBannedAt: null, memberDmOptOutAt: null, memberLanguage: null, memberVideoAutoplay: null,
  };

  it('lets an owner whose role comes from an organization delete both key kinds, while listing and revoking application keys stay direct-owner only', async () => {
    await database.db.insert(dbSchema.tenants).values({ id: STOP_TENANT, slug: 'entitlements-stop', name: 'stop', createdAt: NOW });
    await createShopManagementKeyRepository(database.db).create(STOP_TENANT, { ...shopKey, id: 'shop-stop', tenantId: STOP_TENANT, keyHash: 'hash-shop-stop' }, event('shop-stop', { tenantId: STOP_TENANT }));
    await createApplicationKeyRepository(database.db).create(STOP_TENANT, applicationKey({ id: 'ek-stop', tenantId: STOP_TENANT, keyHash: 'hash-stop' }), event('ek-stop', { tenantId: STOP_TENANT }));
    let next = 0;
    const deps = {
      applicationKeys: createApplicationKeyRepository(database.db),
      shopManagementKeys: createShopManagementKeyRepository(database.db),
      ids: { nextId: () => `stop-${String((next += 1))}` },
      clock: { nowIso: () => NOW },
    };
    const ctx = { identity: organizationOwner };
    expect(await listApplicationKeys(ctx, deps)).toMatchObject({ ok: false, error: { code: 'forbidden' } });
    expect(await revokeApplicationKey(ctx, { id: 'ek-stop' }, deps)).toMatchObject({ ok: false, error: { code: 'forbidden' } });

    expect(await purgeShopManagementKeys(ctx, deps)).toEqual({ ok: true, value: { purged: 2 } });
    expect(await createShopManagementKeyRepository(database.db).listByTenant(STOP_TENANT)).toEqual([]);
    expect(await createApplicationKeyRepository(database.db).listByTenant(STOP_TENANT)).toEqual([]);
  });
});

describe('entitlement subject reader', () => {
  it('reads the account by its normalized e-mail', async () => {
    await database.db.insert(dbSchema.user).values({ id: 'user-ada', name: 'Ada', email: 'ada@example.test', emailVerified: true });
    expect(await createEntitlementSubjectReader(database.db).findAccountByEmail(' ADA@example.test ')).toEqual({ userId: 'user-ada', emailVerified: true });
    expect(await createEntitlementSubjectReader(database.db).findAccountByEmail('nobody@example.test')).toBeNull();
  });

  it('reads the verified flag of the account a member row names', async () => {
    await database.db.insert(dbSchema.user).values({ id: 'user-eve', name: 'Eve', email: 'eve@example.test', emailVerified: false });
    const reader = createEntitlementSubjectReader(database.db);
    expect(await reader.findAccountById('user-ada')).toEqual({ userId: 'user-ada', emailVerified: true });
    expect(await reader.findAccountById('user-eve')).toEqual({ userId: 'user-eve', emailVerified: false });
    expect(await reader.findAccountById('user-nobody')).toBeNull();
  });

  it('tells whether a member signed in to this workspace', async () => {
    await database.db.insert(dbSchema.members).values({ id: 'm-ada', tenantId: TENANT, userId: 'user-ada', email: 'ada@example.test', createdAt: NOW });
    const reader = createEntitlementSubjectReader(database.db);
    expect(await reader.hasSignedIn(TENANT, 'm-ada')).toBe(false);
    await database.db.insert(dbSchema.memberEvents).values({ id: 'sign-in:s1', tenantId: TENANT, memberId: 'm-ada', type: 'sign-in', payload: {}, occurredAt: NOW });
    expect(await reader.hasSignedIn(TENANT, 'm-ada')).toBe(true);
    expect(await reader.hasSignedIn(NEIGHBOUR, 'm-ada')).toBe(false);
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

describe('a stored key holding a scope a later release adds', () => {
  const LATER_TENANT: Tenant = { id: 'tenant-entitlements-later', slug: 'entitlements-later', name: 'later', status: 'active', plan: 'hosted', contentVersion: 1 };
  const stubCrypto = { generateSecret: () => 'unused', hash: (value: string) => `hash:${value}` };
  const storeWithScopes = async (id: string, secret: string, scopes: readonly string[]) => {
    await database.db.execute(sql`insert into application_keys (id, tenant_id, name, key_hash, scopes, issued_by_user_id, created_at, expires_at)
      values (${id}, ${LATER_TENANT.id}, ${id}, ${applicationKeyHash(stubCrypto, secret)}, ${JSON.stringify(scopes)}::jsonb, 'user-owner', ${NOW}, ${EXPIRY})`);
  };
  const authDeps = (): ApplicationKeyAuthDeps => ({
    applicationKeys: createApplicationKeyRepository(database.db),
    apiKeyCrypto: stubCrypto,
    accountIdentities: { findById: async (userId) => (userId === 'user-owner' ? { userId, email: 'owner@example.test', name: 'Owner', emailVerified: true } : null) },
    tenantAccess: { findStaffGrant: async () => ({ tenant: LATER_TENANT, staffRole: 'owner', source: 'direct' }) },
    applicationKeyRateLimits: createApplicationKeyRateLimitRepository(database.db),
    clock: { nowIso: () => NOW },
  });

  beforeAll(async () => {
    await database.db.insert(dbSchema.tenants).values({ id: LATER_TENANT.id, slug: LATER_TENANT.slug, name: LATER_TENANT.name, createdAt: NOW });
    await database.db.execute(sql`alter table application_keys drop constraint application_keys_scopes_check`);
    await storeWithScopes('ek-later', 'later-secret', ['entitlements:check', 'later:scope', 'entitlements:members:read']);
    await storeWithScopes('ek-later-only', 'later-only-secret', ['later:scope']);
  });

  it('lists the key without the scope this release does not know', async () => {
    const listed = await createApplicationKeyRepository(database.db).listByTenant(LATER_TENANT.id);
    expect(listed.map((key) => [key.id, key.scopes])).toEqual([
      ['ek-later', ['entitlements:check', 'entitlements:members:read']],
      ['ek-later-only', []],
    ]);
  });

  it('authenticates the key with the capabilities of the scopes it knows and nothing for the rest', async () => {
    const known = await authenticateApplicationKey(LATER_TENANT, 'later-secret', authDeps());
    if (!known.result.ok) throw new Error(known.result.error.message);
    expect(known.result.value.ctx.capabilities).toEqual(['entitlement:check', 'entitlement:member:read']);
    const unknownOnly = await authenticateApplicationKey(LATER_TENANT, 'later-only-secret', authDeps());
    if (!unknownOnly.result.ok) throw new Error(unknownOnly.result.error.message);
    expect(unknownOnly.result.value.ctx.capabilities).toEqual([]);
  });

  it('revokes the key and returns it without the unknown scope', async () => {
    const revoked = await createApplicationKeyRepository(database.db).revoke(LATER_TENANT.id, 'ek-later-only', NOW, event('ek-later-only', { id: 'event-later-revoked', tenantId: LATER_TENANT.id, kind: 'revoked' }));
    expect(revoked).toMatchObject({ id: 'ek-later-only', scopes: [], revokedAt: NOW });
  });
});
