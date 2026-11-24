import { eq } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import type { Identity, ShopManagementKey, ShopManagementKeyEvent } from '#core/domain/index.js';
import {
  authenticateApplicationKey,
  createApplicationKey,
  purgeShopManagementKeys,
  recordShopManagementKeyRequest,
  revokeApplicationKey,
  type Ctx,
} from '#core/server/index.js';

import { createApplicationKeyRateLimitRepository, createApplicationKeyRepository } from './application-keys.js';
import { createShopManagementKeyEventRepository } from './shop-management-key-events.js';
import { createShopManagementKeyRepository } from './shop-management-keys.js';
import { applicationKeyRateLimitBuckets, applicationKeys, shopManagementKeyEvents, shopManagementKeys, tenants } from './schema.js';
import { createTestDatabase } from './test-database-name.js';

// Literal copies of what the release on production (779b7198) parses; they must not follow this release's schemas.
const previousShopManagementKeyEventKinds = ['created', 'revoked', 'purged', 'request'] as const;
const previousShopManagementKeyEventMethods = ['POST', 'PUT', 'PATCH', 'DELETE'] as const;
const previousShopManagementScopes = [
  'shop:catalog:read',
  'shop:catalog:write',
  'shop:orders:read',
  'shop:fulfilment:write',
  'shop:settings:read',
  'shop:settings:write',
  'shop:integrations:read',
  'shop:integrations:write',
] as const;
const previousShopManagementKeyModes = ['direct', 'propose'] as const;

const listed = (values: readonly string[], value: unknown): boolean => values.some((candidate) => candidate === value);
const nonEmptyString = (value: unknown): boolean => typeof value === 'string' && value.length >= 1;
const isoDatetime = (value: unknown): boolean => typeof value === 'string' && /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d+)?Z$/.test(value);

// adapters/db may not import zod, so the previous schemas are spelled out check by check:
// z.object({ id: z.string().min(1), tenantId: z.string().min(1), apiKeyId: z.string().min(1), kind: z.enum(KINDS),
//   actorUserId: z.string().min(1), method: z.enum(METHODS).nullable(), route: z.string().min(1).nullable(),
//   resourceId: z.string().max(200).regex(/^[A-Za-z0-9][A-Za-z0-9._:-]*$/).nullable(), at: z.string().datetime() })
const previousEventParses = (row: Record<string, unknown>): boolean =>
  nonEmptyString(row['id'])
  && nonEmptyString(row['tenantId'])
  && nonEmptyString(row['apiKeyId'])
  && listed(previousShopManagementKeyEventKinds, row['kind'])
  && nonEmptyString(row['actorUserId'])
  && (row['method'] === null || listed(previousShopManagementKeyEventMethods, row['method']))
  && (row['route'] === null || nonEmptyString(row['route']))
  && (row['resourceId'] === null || (typeof row['resourceId'] === 'string' && row['resourceId'].length <= 200 && /^[A-Za-z0-9][A-Za-z0-9._:-]*$/.test(row['resourceId'])))
  && isoDatetime(row['at']);

// z.object({ ..., scopes: z.array(shopManagementScopeSchema).min(1), mode: shopManagementKeyModeSchema, ... })
const previousShopKeyParses = (row: Record<string, unknown>): boolean => {
  const scopes = row['scopes'];
  return Array.isArray(scopes) && scopes.length >= 1
    && scopes.every((scope) => listed(previousShopManagementScopes, scope))
    && listed(previousShopManagementKeyModes, row['mode']);
};

const baseDatabaseUrl = process.env['DATABASE_URL'] ?? 'postgres://together:together@localhost:48912/together';
const TENANT = { id: 'tenant-application-rollback', slug: 'application-rollback', name: 'Rollback', status: 'active', plan: 'hosted', contentVersion: 1 } as const;
const NOW = '2026-11-20T12:00:00.000Z';
const EXPIRY = '2026-12-20T12:00:00.000Z';
const OWNER_ID = 'user-rollback-owner';

const ownerIdentity: Identity = {
  userId: OWNER_ID,
  email: 'owner@example.test',
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
const ownerCtx: Ctx = { identity: ownerIdentity };

const shopKey: ShopManagementKey = {
  id: 'shop-rollback', tenantId: TENANT.id, name: 'Shop backend', keyHash: 'hash-shop-rollback', scopes: ['shop:catalog:read'], mode: 'direct',
  issuedByUserId: OWNER_ID, createdAt: NOW, expiresAt: EXPIRY, revokedAt: null,
};
const shopKeyCreated: ShopManagementKeyEvent = {
  id: 'event-shop-rollback', tenantId: TENANT.id, apiKeyId: shopKey.id, kind: 'created', actorUserId: OWNER_ID,
  method: null, route: null, resourceId: null, at: NOW,
};

let database: Awaited<ReturnType<typeof createTestDatabase>>;
let nextId = 0;
let nextSecret = 0;

const deps = () => {
  const db = database.db;
  return {
    applicationKeys: createApplicationKeyRepository(db),
    applicationKeyRateLimits: createApplicationKeyRateLimitRepository(db),
    shopManagementKeys: createShopManagementKeyRepository(db),
    shopManagementKeyEvents: createShopManagementKeyEventRepository(db),
    products: { findById: async (tenantId: string, productId: string) => (productId === 'prod-pro' ? { id: productId, tenantId } : null) },
    apiKeyCrypto: { generateSecret: () => `rollback-secret-${String((nextSecret += 1))}`, hash: (value: string) => `hash:${value}` },
    accountIdentities: { findById: async (userId: string) => (userId === OWNER_ID ? { userId, email: 'owner@example.test', name: 'Owner', emailVerified: true } : null) },
    tenantAccess: { findStaffGrant: async () => ({ tenant: TENANT, staffRole: 'owner' as const, source: 'direct' as const }) },
    ids: { nextId: () => `rollback-${String((nextId += 1))}` },
    clock: { nowIso: () => NOW },
    shopManagementKeysSwitch: 'enabled' as const,
  };
};

const storedEvents = async () =>
  database.db.select().from(shopManagementKeyEvents).where(eq(shopManagementKeyEvents.tenantId, TENANT.id));

beforeAll(async () => {
  database = await createTestDatabase('together_application_keys_rollback_test', baseDatabaseUrl);
  await database.db.insert(tenants).values({ id: TENANT.id, slug: TENANT.slug, name: TENANT.name, createdAt: NOW });
  await createShopManagementKeyRepository(database.db).create(TENANT.id, shopKey, shopKeyCreated);
}, 120_000);

afterAll(async () => {
  await database.close();
});

describe('rollback to the release without application keys', () => {
  it('leaves only history rows the previous event schema parses after issuing, using, revoking and purging application keys', async () => {
    const d = deps();
    const kept = await createApplicationKey(ownerCtx, { name: 'Companion app', scopes: ['entitlements:check', 'entitlements:members:read'], expiresAt: EXPIRY, productIds: ['prod-pro'] }, d);
    const revoked = await createApplicationKey(ownerCtx, { name: 'Old companion app', scopes: ['entitlements:check'], expiresAt: EXPIRY }, d);
    if (!kept.ok || !revoked.ok) throw new Error('application key issuance failed');
    const authenticated = await authenticateApplicationKey(TENANT, kept.value.secret, d);
    if (!authenticated.result.ok) throw new Error(authenticated.result.error.message);
    await recordShopManagementKeyRequest(TENANT.id, {
      apiKeyId: authenticated.result.value.apiKey.id,
      actorUserId: authenticated.result.value.ctx.identity.userId,
      method: 'POST',
      route: '/api/m2m/entitlements/check',
      resourceId: null,
    }, d);
    expect(await revokeApplicationKey(ownerCtx, { id: revoked.value.apiKey.id }, d)).toMatchObject({ ok: true });

    const rows = await storedEvents();
    expect(rows.map((row) => row.kind).toSorted()).toEqual(['created', 'created', 'created', 'request', 'revoked']);
    for (const row of rows) expect(previousEventParses(row)).toBe(true);
    const page = await createShopManagementKeyEventRepository(database.db).list(TENANT.id, { limit: 50 });
    expect(page.events).toHaveLength(rows.length);

    expect(await purgeShopManagementKeys(ownerCtx, d)).toEqual({ ok: true, value: { purged: 3 } });
    const afterPurge = await storedEvents();
    expect(afterPurge.filter((row) => row.kind === 'purged')).toHaveLength(3);
    for (const row of afterPurge) expect(previousEventParses(row)).toBe(true);
  });

  it('never puts an application key where the previous release lists or authenticates shop management keys', async () => {
    const d = deps();
    await createShopManagementKeyRepository(database.db).create(TENANT.id, { ...shopKey, id: 'shop-rollback-2', keyHash: 'hash-shop-rollback-2' }, { ...shopKeyCreated, id: 'event-shop-rollback-2', apiKeyId: 'shop-rollback-2' });
    const created = await createApplicationKey(ownerCtx, { name: 'Companion app', scopes: ['entitlements:check'], expiresAt: EXPIRY }, d);
    if (!created.ok) throw new Error(created.error.message);
    const shopRows = await database.db.select().from(shopManagementKeys).where(eq(shopManagementKeys.tenantId, TENANT.id));
    expect(shopRows.map((row) => row.id)).toEqual(['shop-rollback-2']);
    for (const row of shopRows) expect(previousShopKeyParses(row)).toBe(true);
    const [stored] = await database.db.select().from(applicationKeys).where(eq(applicationKeys.id, created.value.apiKey.id));
    expect(await createShopManagementKeyRepository(database.db).findByHash(TENANT.id, stored?.keyHash ?? '')).toBeNull();
  });

  it('lets the previous reseed delete the workspace while application keys and their rate-limit buckets remain', async () => {
    const d = deps();
    const created = await createApplicationKey(ownerCtx, { name: 'Companion app', scopes: ['entitlements:check'], expiresAt: EXPIRY }, d);
    if (!created.ok) throw new Error(created.error.message);
    expect(await d.applicationKeyRateLimits.claim(TENANT.id, { apiKeyId: created.value.apiKey.id, period: 'minute', windowStartedAt: NOW, limit: 10, weight: 1 })).toBe(true);
    await database.db.delete(shopManagementKeyEvents).where(eq(shopManagementKeyEvents.tenantId, TENANT.id));
    await database.db.delete(shopManagementKeys).where(eq(shopManagementKeys.tenantId, TENANT.id));
    await database.db.delete(tenants).where(eq(tenants.id, TENANT.id));
    expect(await database.db.select().from(applicationKeys).where(eq(applicationKeys.tenantId, TENANT.id))).toEqual([]);
    expect(await database.db.select().from(applicationKeyRateLimitBuckets).where(eq(applicationKeyRateLimitBuckets.apiKeyId, created.value.apiKey.id))).toEqual([]);
  });
});
