import {
  copyFileSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { drizzle } from 'drizzle-orm/node-postgres';
import pg from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import {
  shopManagementKeyEventResourceId,
  shopManagementScopeSchema,
  type ShopManagementKey,
  type ShopManagementKeyEvent,
} from '#core/domain/index.js';

import type { Db } from './client.js';
import { runMigrations } from './migration-runner.js';
import { createTenantApiKeyRepository } from './repositories.js';
import { createShopManagementKeyEventRepository } from './shop-management-key-events.js';
import { createShopManagementKeyRateLimitRepository, createShopManagementKeyRepository } from './shop-management-keys.js';
import * as dbSchema from './schema.js';
import { uniqueTestDatabaseName } from './test-database-name.js';

const LAST_MIGRATION_WITHOUT_SHOP_KEYS = 154;
const TEST_DB = uniqueTestDatabaseName('together_shop_management_keys_test');
const baseDatabaseUrl = process.env['DATABASE_URL'] ?? 'postgres://together:together@localhost:48912/together';
const testUrl = (() => {
  const url = new URL(baseDatabaseUrl);
  url.pathname = `/${TEST_DB}`;
  return url.toString();
})();
const NOW = '1998-08-03T10:00:00.000Z';
const EXPIRY = '1998-08-10T10:00:00.000Z';
const TENANT = 'tenant-shop-keys';
const AUDIT_TENANT = 'tenant-shop-keys-audit';
const PURGE_TENANT = 'tenant-shop-keys-purge';
const NEIGHBOUR_TENANT = 'tenant-shop-keys-neighbour';

let pool: pg.Pool;
let db: Db;
let partialMigrations: string;
let legacyShapeBefore: unknown;

const tenantApiKeysShape = async () => ({
  columns: (await pool.query<{ column_name: string; data_type: string; is_nullable: string; column_default: string | null }>(
    `select column_name, data_type, is_nullable, column_default from information_schema.columns
     where table_name = 'tenant_api_keys' order by column_name collate "C"`,
  )).rows,
  constraints: (await pool.query<{ conname: string; definition: string }>(
    `select conname, pg_get_constraintdef(oid) as definition from pg_constraint
     where conrelid = 'tenant_api_keys'::regclass order by conname collate "C"`,
  )).rows,
  indexes: (await pool.query<{ indexname: string; indexdef: string }>(
    `select indexname, indexdef from pg_indexes where tablename = 'tenant_api_keys' order by indexname collate "C"`,
  )).rows,
});

const shopKey = (overrides: Partial<ShopManagementKey> = {}): ShopManagementKey => ({
  id: 'shop-key', tenantId: TENANT, name: 'Shop backend', keyHash: 'hash-shop',
  scopes: ['shop:catalog:read'], issuedByUserId: 'user-owner', createdAt: NOW, expiresAt: EXPIRY, revokedAt: null,
  ...overrides,
});

const keyEvent = (overrides: Partial<ShopManagementKeyEvent> = {}): ShopManagementKeyEvent => ({
  id: 'event-created', tenantId: TENANT, apiKeyId: 'shop-key', kind: 'created', actorUserId: 'user-owner',
  method: null, route: null, resourceId: null, at: NOW,
  ...overrides,
});

const requestEvent = (overrides: Partial<ShopManagementKeyEvent> = {}): ShopManagementKeyEvent => keyEvent({
  id: 'event-request', kind: 'request', method: 'POST', route: '/api/m2m/shop/products/update',
  resourceId: 'product-1', ...overrides,
});

const eventIds = async (tenantId = TENANT): Promise<string[]> =>
  (await pool.query<{ id: string }>('select id from shop_management_key_events where tenant_id = $1 order by id collate "C"', [tenantId]))
    .rows.map((row) => row.id);

const insertEvent = (event: ShopManagementKeyEvent) => createShopManagementKeyEventRepository(db).record(event.tenantId, event);

beforeAll(async () => {
  const admin = new pg.Client({ connectionString: baseDatabaseUrl });
  await admin.connect();
  await admin.query(`CREATE DATABASE ${TEST_DB}`);
  await admin.end();

  partialMigrations = mkdtempSync(join(tmpdir(), 'together-shop-keys-'));
  mkdirSync(join(partialMigrations, 'meta'));
  for (const file of readdirSync('drizzle')) {
    const prefix = /^(\d{4})_.*\.sql$/.exec(file)?.[1];
    if (prefix !== undefined && Number(prefix) <= LAST_MIGRATION_WITHOUT_SHOP_KEYS) {
      copyFileSync(join('drizzle', file), join(partialMigrations, file));
    }
  }
  const journal: unknown = JSON.parse(readFileSync('drizzle/meta/_journal.json', 'utf8'));
  if (typeof journal !== 'object' || journal === null || !('entries' in journal)) {
    throw new Error('The drizzle journal is unreadable');
  }
  const { entries } = journal;
  if (!Array.isArray(entries)) throw new Error('The drizzle journal has no entries');
  writeFileSync(
    join(partialMigrations, 'meta', '_journal.json'),
    JSON.stringify({ ...journal, entries: entries.slice(0, LAST_MIGRATION_WITHOUT_SHOP_KEYS + 1) }),
  );

  pool = new pg.Pool({ connectionString: testUrl });
  db = drizzle(pool, { schema: dbSchema });
  await runMigrations({ connectionString: testUrl, migrationsFolder: partialMigrations });
  await pool.query(
    `insert into tenants (id, slug, name, created_at) values ($1, 'shop-keys', 'Shop keys', $2)`,
    [TENANT, NOW],
  );
  await pool.query(
    `insert into tenant_api_keys (id, tenant_id, name, key_hash, scopes, created_at, expires_at, revoked_at)
     values ('old-scoped', $1, 'Old scoped', 'hash-old-scoped', '["import:content"]', $2, $3, null),
            ('old-unscoped', $1, 'Old unscoped', 'hash-old-unscoped', null, $2, null, null)`,
    [TENANT, NOW, EXPIRY],
  );
  await pool.query(
    `insert into tenants (id, slug, name, created_at) values ($1, 'shop-keys-audit', 'Shop keys audit', $2)`,
    [AUDIT_TENANT, NOW],
  );
  legacyShapeBefore = await tenantApiKeysShape();
  await runMigrations({ connectionString: testUrl, migrationsFolder: 'drizzle' });
}, 120_000);

afterAll(async () => {
  await pool.end();
  rmSync(partialMigrations, { recursive: true, force: true });
  const admin = new pg.Client({ connectionString: baseDatabaseUrl });
  await admin.connect();
  await admin.query(`DROP DATABASE IF EXISTS ${TEST_DB} WITH (FORCE)`);
  await admin.end();
});

describe('shop management key migration', () => {
  it('leaves tenant_api_keys exactly in the shape of the previous release', async () => {
    expect(await tenantApiKeysShape()).toEqual(legacyShapeBefore);
  });

  it('reads rows written before the migration unchanged', async () => {
    const keys = await createTenantApiKeyRepository(db).listByTenant(TENANT);
    expect(keys.filter((key) => key.id.startsWith('old-'))).toEqual([
      expect.objectContaining({ id: 'old-scoped', scopes: ['import:content'], expiresAt: EXPIRY }),
      expect.objectContaining({ id: 'old-unscoped', scopes: null, expiresAt: null }),
    ]);
    expect(await createTenantApiKeyRepository(db).findActiveByHash(TENANT, 'hash-old-unscoped'))
      .toMatchObject({ id: 'old-unscoped', scopes: null });
  });

  it('checks exactly the shop scopes of the domain at the database', async () => {
    const { rows } = await pool.query<{ definition: string }>(
      `select pg_get_constraintdef(oid) as definition from pg_constraint where conname = 'shop_management_keys_scopes_check'`,
    );
    const allowed = /<@\s*'(\[[^']*\])'::jsonb/u.exec(rows[0]?.definition ?? '')?.[1] ?? '[]';
    const parsed: unknown = JSON.parse(allowed);
    expect(parsed).toEqual([...shopManagementScopeSchema.options]);
  });

  it.each([
    ['null scopes', 'null'],
    ['an empty scope array', `'[]'`],
    ['a scope string instead of an array', `'"shop:catalog:read"'`],
    ['a scope object instead of an array', `'{"scope":"shop:catalog:read"}'`],
    ['a legacy scope', `'["shop:catalog:read", "report:read"]'`],
    ['a nested scope array', `'[["shop:catalog:read"]]'`],
  ])('rejects a key with %s at the database', async (_label, scopes) => {
    await expect(pool.query(
      `insert into shop_management_keys (id, tenant_id, name, key_hash, scopes, issued_by_user_id, created_at, expires_at)
       values ('bad-scopes', $1, 'Bad', 'hash-bad-scopes', ${scopes}, 'user-owner', $2, $3)`,
      [TENANT, NOW, EXPIRY],
    )).rejects.toThrow(/shop_management_keys_scopes_check|null value in column "scopes"/u);
  });

  it.each([
    ['without an issuer', `null, '${EXPIRY}'`, /issued_by_user_id/u],
    ['without an expiry', `'user-owner', null`, /expires_at/u],
  ])('rejects a key %s at the database', async (_label, values, expected) => {
    await expect(pool.query(
      `insert into shop_management_keys (id, tenant_id, name, key_hash, scopes, issued_by_user_id, expires_at, created_at)
       values ('bad-issuer', $1, 'Bad', 'hash-bad-issuer', '["shop:catalog:read"]', ${values}, $2)`,
      [TENANT, NOW],
    )).rejects.toThrow(expected);
  });
});

describe('shop management key lifecycle', () => {
  it('rolls back the key when its creation event fails', async () => {
    const repo = createShopManagementKeyRepository(db);
    await insertEvent(keyEvent({ id: 'event-taken', apiKeyId: 'earlier-key' }));

    await expect(repo.create(TENANT, shopKey({ id: 'orphan-key', keyHash: 'hash-orphan' }), keyEvent({ id: 'event-taken', apiKeyId: 'orphan-key' })))
      .rejects.toThrow();
    expect((await repo.listByTenant(TENANT)).map((key) => key.id)).not.toContain('orphan-key');
  });

  it('rolls back the creation event when the key insert fails', async () => {
    const repo = createShopManagementKeyRepository(db);
    await repo.create(TENANT, shopKey({ id: 'first-hash', keyHash: 'hash-duplicate' }), keyEvent({ id: 'event-first-hash', apiKeyId: 'first-hash' }));
    await expect(repo.create(
      TENANT,
      shopKey({ id: 'duplicate-hash', keyHash: 'hash-duplicate' }),
      keyEvent({ id: 'event-duplicate-hash', apiKeyId: 'duplicate-hash' }),
    )).rejects.toThrow();
    expect(await eventIds()).not.toContain('event-duplicate-hash');
  });

  it('refuses a key of another tenant through a tenant-scoped write', async () => {
    await expect(createShopManagementKeyRepository(db).create(
      AUDIT_TENANT,
      shopKey({ id: 'foreign-key', keyHash: 'hash-foreign' }),
      keyEvent({ id: 'event-foreign-key', tenantId: AUDIT_TENANT, apiKeyId: 'foreign-key' }),
    )).rejects.toThrow();
    expect(await eventIds(AUDIT_TENANT)).not.toContain('event-foreign-key');
  });

  it('commits a key with its creation event and revokes it with a revocation event', async () => {
    const repo = createShopManagementKeyRepository(db);
    await repo.create(TENANT, shopKey(), keyEvent());
    expect(await repo.findByHash(TENANT, 'hash-shop')).toEqual(shopKey());
    expect(await repo.findByHash(AUDIT_TENANT, 'hash-shop')).toBeNull();
    expect(await createTenantApiKeyRepository(db).findActiveByHash(TENANT, 'hash-shop')).toBeNull();

    await expect(repo.revoke(TENANT, 'shop-key', NOW, keyEvent({ id: 'event-taken', kind: 'revoked' }))).rejects.toThrow();
    expect(await repo.findByHash(TENANT, 'hash-shop')).toMatchObject({ id: 'shop-key', revokedAt: null });

    expect(await createTenantApiKeyRepository(db).revoke(TENANT, 'shop-key', NOW)).toBeNull();
    expect(await repo.findByHash(TENANT, 'hash-shop')).toMatchObject({ revokedAt: null });

    expect(await repo.revoke(TENANT, 'shop-key', NOW, keyEvent({ id: 'event-revoked', kind: 'revoked' })))
      .toMatchObject({ id: 'shop-key', revokedAt: NOW });
    expect(await repo.findByHash(TENANT, 'hash-shop')).toMatchObject({ id: 'shop-key', revokedAt: NOW });
    expect(await repo.revoke(TENANT, 'shop-key', NOW, keyEvent({ id: 'event-revoked-twice', kind: 'revoked' }))).toBeNull();
    expect(await eventIds()).toEqual(['event-created', 'event-first-hash', 'event-revoked', 'event-taken']);
  });

  it('never revokes a legacy key through the shop management repository', async () => {
    expect(await createShopManagementKeyRepository(db).revoke(TENANT, 'old-unscoped', NOW, keyEvent({ id: 'event-legacy', apiKeyId: 'old-unscoped', kind: 'revoked' })))
      .toBeNull();
    expect(await createTenantApiKeyRepository(db).findActiveByHash(TENANT, 'hash-old-unscoped')).toMatchObject({ revokedAt: null });
    expect(await eventIds()).not.toContain('event-legacy');
  });

  it('keeps the key hash out of the error of a failing key write', async () => {
    const repo = createShopManagementKeyRepository(db);
    const keyHash = 'collision-hash-0123456789abcdef0123456789abcdef';
    await repo.create(TENANT, shopKey({ id: 'collision-a', keyHash }), keyEvent({ id: 'event-collision-a', apiKeyId: 'collision-a' }));
    const failure = await repo.create(TENANT, shopKey({ id: 'collision-b', keyHash }), keyEvent({ id: 'event-collision-b', apiKeyId: 'collision-b' }))
      .then(() => null, (error: unknown) => error);
    expect(failure).toBeInstanceOf(Error);
    const chain: unknown[] = [];
    for (let link: unknown = failure; link instanceof Error; link = link.cause) chain.push(link.message, link.stack, Reflect.get(link, 'params'));
    expect(JSON.stringify(chain)).not.toContain(keyHash);
  });

  it('refuses an event of another tenant through a tenant-scoped write', async () => {
    await expect(createShopManagementKeyEventRepository(db).record(TENANT, keyEvent({ id: 'event-foreign', tenantId: AUDIT_TENANT })))
      .rejects.toThrow();
    expect(await eventIds(AUDIT_TENANT)).not.toContain('event-foreign');
  });

  it.each([
    ['a request without a method', requestEvent({ id: 'bad-1', method: null })],
    ['a request without a route', requestEvent({ id: 'bad-2', route: null })],
    ['a lifecycle event with a route', keyEvent({ id: 'bad-5', route: '/api/api-keys' })],
    ['a lifecycle event with a resource id', keyEvent({ id: 'bad-6', resourceId: 'product-1' })],
  ])('rejects %s at the database', async (_label, event) => {
    await expect(pool.query(
      `insert into shop_management_key_events (id, tenant_id, api_key_id, kind, actor_user_id, method, route, resource_id, at)
       values ($1, $2, $3, $4, $5, $6, $7, $8, $9)`,
      [event.id, event.tenantId, event.apiKeyId, event.kind, event.actorUserId, event.method, event.route, event.resourceId, event.at],
    )).rejects.toThrow(/shop_management_key_events_shape_check/);
  });

  it.each([
    ['a lifecycle event', keyEvent({ id: 'bad-actor-1' })],
    ['a request', requestEvent({ id: 'bad-actor-2' })],
  ])('rejects %s without an acting account at the database', async (_label, event) => {
    await expect(pool.query(
      `insert into shop_management_key_events (id, tenant_id, api_key_id, kind, actor_user_id, method, route, resource_id, at)
       values ($1, $2, $3, $4, null, $5, $6, $7, $8)`,
      [event.id, event.tenantId, event.apiKeyId, event.kind, event.method, event.route, event.resourceId, event.at],
    )).rejects.toThrow(/actor_user_id/);
  });

  it('rejects a resource id longer than 200 characters at the database and in the event schema', async () => {
    const event = requestEvent({ id: 'bad-resource', resourceId: 'r'.repeat(201) });
    await expect(pool.query(
      `insert into shop_management_key_events (id, tenant_id, api_key_id, kind, actor_user_id, method, route, resource_id, at)
       values ($1, $2, $3, $4, $5, $6, $7, $8, $9)`,
      [event.id, event.tenantId, event.apiKeyId, event.kind, event.actorUserId, event.method, event.route, event.resourceId, event.at],
    )).rejects.toThrow(/shop_management_key_events_resource_id_length_check/);
    await expect(createShopManagementKeyEventRepository(db).record(TENANT, event)).rejects.toThrow();
    expect(await eventIds(TENANT)).not.toContain('bad-resource');
  });
});

it.each([
  ['a space', 'product 1'],
  ['a leading separator', '-product-1'],
  ['a slash', 'product/1'],
  ['a quote', "product'1"],
  ['a non-ASCII letter', 'produkt-\u0142'],
  ['a trailing newline', 'product-1\n'],
  ['an empty string', ''],
])('rejects a resource id with %s at the database with the event schema pattern', async (_label, resourceId) => {
  const event = requestEvent({ id: `bad-pattern-${String(resourceId.length)}-${resourceId.charCodeAt(0)}`, resourceId });
  await expect(pool.query(
    `insert into shop_management_key_events (id, tenant_id, api_key_id, kind, actor_user_id, method, route, resource_id, at)
     values ($1, $2, $3, $4, $5, $6, $7, $8, $9)`,
    [event.id, event.tenantId, event.apiKeyId, event.kind, event.actorUserId, event.method, event.route, event.resourceId, event.at],
  )).rejects.toThrow(/shop_management_key_events_resource_id_pattern_check/);
  expect(shopManagementKeyEventResourceId(resourceId)).toBeNull();
});

it('accepts every identifier shape the event schema keeps at the database', async () => {
  const resourceId = `A0._:-${'z'.repeat(194)}`;
  expect(shopManagementKeyEventResourceId(resourceId)).toBe(resourceId);
  await insertEvent(requestEvent({ id: 'good-pattern', resourceId }));
  expect(await eventIds()).toContain('good-pattern');
});

describe('shop management key rate limits', () => {
  const window = '1998-08-03T10:00:00.000Z';

  it('counts claims per key and window up to the limit and gives a unit back', async () => {
    const limits = createShopManagementKeyRateLimitRepository(db);
    const claim = () => limits.claim(TENANT, { apiKeyId: 'collision-a', period: 'minute', windowStartedAt: window, limit: 2 });
    expect([await claim(), await claim(), await claim()]).toEqual([true, true, false]);
    await limits.release(TENANT, { apiKeyId: 'collision-a', period: 'minute', windowStartedAt: window });
    expect(await claim()).toBe(true);
    expect(await limits.claim(TENANT, { apiKeyId: 'collision-a', period: 'minute', windowStartedAt: '1998-08-03T10:01:00.000Z', limit: 2 }))
      .toBe(true);
  });

  it('refuses a claim for a key of another workspace or a legacy key', async () => {
    const limits = createShopManagementKeyRateLimitRepository(db);
    expect(await limits.claim(AUDIT_TENANT, { apiKeyId: 'collision-a', period: 'day', windowStartedAt: window, limit: 10 })).toBe(false);
    expect(await limits.claim(TENANT, { apiKeyId: 'old-unscoped', period: 'day', windowStartedAt: window, limit: 10 })).toBe(false);
  });
});

describe('shop management key events', () => {
  const LIST_TENANT = 'tenant-shop-keys-events';
  const OTHER_TENANT = 'tenant-shop-keys-events-other';

  beforeAll(async () => {
    for (const [tenantId, slug] of [[LIST_TENANT, 'shop-keys-events'], [OTHER_TENANT, 'shop-keys-events-other']] as const) {
      await pool.query(`insert into tenants (id, slug, name, created_at) values ($1, $2, 'Events', $3)`, [tenantId, slug, NOW]);
    }
    const at = (second: number) => `1998-08-05T00:00:${String(second).padStart(2, '0')}.000Z`;
    for (const event of [
      keyEvent({ id: 'list-a-created', tenantId: LIST_TENANT, apiKeyId: 'key-a', at: at(1) }),
      requestEvent({ id: 'list-a-request', tenantId: LIST_TENANT, apiKeyId: 'key-a', at: at(2) }),
      keyEvent({ id: 'list-b-created', tenantId: LIST_TENANT, apiKeyId: 'key-b', at: at(3) }),
      requestEvent({ id: 'list-b-request', tenantId: LIST_TENANT, apiKeyId: 'key-b', resourceId: null, at: at(4) }),
      keyEvent({ id: 'list-a-revoked', tenantId: LIST_TENANT, apiKeyId: 'key-a', kind: 'revoked', at: at(5) }),
      keyEvent({ id: 'other-a-created', tenantId: OTHER_TENANT, apiKeyId: 'key-a', at: at(6) }),
    ]) await insertEvent(event);
  });

  it('lists a workspace history newest first, page by page', async () => {
    const repo = createShopManagementKeyEventRepository(db);
    const first = await repo.list(LIST_TENANT, { limit: 3 });
    expect(first.events.map((event) => event.id)).toEqual(['list-a-revoked', 'list-b-request', 'list-b-created']);
    expect(first.nextCursor).toBe('list-b-created');
    const second = await repo.list(LIST_TENANT, { limit: 3, cursor: 'list-b-created' });
    expect(second.events.map((event) => event.id)).toEqual(['list-a-request', 'list-a-created']);
    expect(second.nextCursor).toBeNull();
    expect(second.events[0]).toEqual(requestEvent({ id: 'list-a-request', tenantId: LIST_TENANT, apiKeyId: 'key-a', at: '1998-08-05T00:00:02.000Z' }));
  });

  it('filters by key and never shows another workspace', async () => {
    const repo = createShopManagementKeyEventRepository(db);
    expect((await repo.list(LIST_TENANT, { apiKeyId: 'key-a', limit: 50 })).events.map((event) => event.id))
      .toEqual(['list-a-revoked', 'list-a-request', 'list-a-created']);
    expect((await repo.list(OTHER_TENANT, { limit: 50 })).events.map((event) => event.id)).toEqual(['other-a-created']);
    expect(await repo.list(OTHER_TENANT, { limit: 50, cursor: 'list-a-revoked' })).toEqual({ events: [], nextCursor: null });
  });
});

describe('shop management key purge', () => {
  const insertKeys = async () => {
    for (const [tenantId, slug] of [[PURGE_TENANT, 'shop-keys-purge'], [NEIGHBOUR_TENANT, 'shop-keys-neighbour']] as const) {
      await pool.query(
        `insert into tenants (id, slug, name, created_at) values ($1, $2, 'Purge', $3) on conflict do nothing`,
        [tenantId, slug, NOW],
      );
    }
    await pool.query(
      `insert into shop_management_keys (id, tenant_id, name, key_hash, scopes, issued_by_user_id, created_at, expires_at, revoked_at)
       values ('purge-shop-active', $1, 'Active', 'hash-purge-shop-active', '["shop:catalog:write"]', 'user-owner', $3, $4, null),
              ('purge-shop-revoked', $1, 'Revoked', 'hash-purge-shop-revoked', '["shop:orders:read"]', 'user-owner', $3, $4, $3),
              ('neighbour-shop', $2, 'Neighbour', 'hash-neighbour-shop', '["shop:catalog:read"]', 'user-owner', $3, $4, null)`,
      [PURGE_TENANT, NEIGHBOUR_TENANT, NOW, EXPIRY],
    );
    await pool.query(
      `insert into tenant_api_keys (id, tenant_id, name, key_hash, scopes, created_at)
       values ('purge-legacy', $1, 'Legacy', 'hash-purge-legacy', '["marketing"]', $2)`,
      [PURGE_TENANT, NOW],
    );
    await pool.query(
      `insert into shop_management_key_rate_limit_buckets (api_key_id, period, window_started_at, count)
       values ('purge-shop-active', 'minute', $1, 3), ('neighbour-shop', 'minute', $1, 1)`,
      [NOW],
    );
    await insertEvent(requestEvent({ id: 'purge-request-before', tenantId: PURGE_TENANT, apiKeyId: 'purge-shop-active' }));
  };
  const purgeEvent = (prefix: string) => (apiKeyId: string): ShopManagementKeyEvent => keyEvent({
    id: `${prefix}-${apiKeyId}`, tenantId: PURGE_TENANT, apiKeyId, kind: 'purged',
  });
  const keyIds = async (): Promise<string[]> =>
    (await pool.query<{ id: string }>(
      `select id from (
         select id from shop_management_keys where tenant_id = any($1)
         union all select id from tenant_api_keys where tenant_id = any($1)
       ) as keys order by id collate "C"`,
      [[PURGE_TENANT, NEIGHBOUR_TENANT]],
    )).rows.map((row) => row.id);
  const bucketKeys = async (): Promise<string[]> =>
    (await pool.query<{ api_key_id: string }>(
      'select api_key_id from shop_management_key_rate_limit_buckets where api_key_id = any($1) order by api_key_id collate "C"',
      [['purge-shop-active', 'neighbour-shop']],
    )).rows.map((row) => row.api_key_id);

  beforeAll(insertKeys);

  it('keeps every key and writes no purge event when one purge event cannot be written', async () => {
    await insertEvent(keyEvent({ id: 'taken-purge-shop-revoked', tenantId: PURGE_TENANT, apiKeyId: 'earlier-key' }));
    await expect(createShopManagementKeyRepository(db).purge(PURGE_TENANT, purgeEvent('taken'))).rejects.toThrow();
    expect(await keyIds()).toEqual(['neighbour-shop', 'purge-legacy', 'purge-shop-active', 'purge-shop-revoked']);
    expect(await eventIds(PURGE_TENANT)).toEqual(['purge-request-before', 'taken-purge-shop-revoked']);
    expect(await bucketKeys()).toEqual(['neighbour-shop', 'purge-shop-active']);
  });

  it('deletes only the workspace shop management keys, revoked or not, with their buckets and one purge event per key', async () => {
    const repo = createShopManagementKeyRepository(db);
    expect(await repo.purge(PURGE_TENANT, purgeEvent('purged'))).toBe(2);
    expect(await keyIds()).toEqual(['neighbour-shop', 'purge-legacy']);
    expect(await bucketKeys()).toEqual(['neighbour-shop']);
    const events = await pool.query<{ id: string; api_key_id: string; kind: string }>(
      'select id, api_key_id, kind from shop_management_key_events where tenant_id = $1 order by id collate "C"',
      [PURGE_TENANT],
    );
    expect(events.rows).toEqual([
      { id: 'purge-request-before', api_key_id: 'purge-shop-active', kind: 'request' },
      { id: 'purged-purge-shop-active', api_key_id: 'purge-shop-active', kind: 'purged' },
      { id: 'purged-purge-shop-revoked', api_key_id: 'purge-shop-revoked', kind: 'purged' },
      { id: 'taken-purge-shop-revoked', api_key_id: 'earlier-key', kind: 'created' },
    ]);

    expect(await repo.purge(PURGE_TENANT, purgeEvent('purged-again'))).toBe(0);
    expect(await eventIds(PURGE_TENANT)).not.toContain('purged-again-purge-shop-active');
  });

  it('keeps the key history after the purge', async () => {
    expect((await createShopManagementKeyEventRepository(db).list(PURGE_TENANT, { apiKeyId: 'purge-shop-active', limit: 50 })).events
      .map((event) => event.kind).sort()).toEqual(['purged', 'request']);
  });

  it('removes the keys and the history together with their workspace', async () => {
    await pool.query('delete from tenant_api_keys where tenant_id = $1', [NEIGHBOUR_TENANT]);
    await pool.query('delete from tenants where id = $1', [NEIGHBOUR_TENANT]);
    expect(await keyIds()).not.toContain('neighbour-shop');
    expect(await bucketKeys()).toEqual([]);
    await pool.query('delete from tenant_api_keys where tenant_id = $1', [PURGE_TENANT]);
    await pool.query('delete from tenants where id = $1', [PURGE_TENANT]);
    expect(await eventIds(PURGE_TENANT)).toEqual([]);
  });
});

describe('shop management key rollback guide', () => {
  const guide = readFileSync('docs/shop-management-keys.md', 'utf8');
  const rollback = /## Rollback\n([\s\S]*?)(?=\n## |\nSee also)/u.exec(guide)?.[1] ?? '';
  const migration = readFileSync('drizzle/0158_shop_management_keys.sql', 'utf8');

  it('names every table the migration adds, and the migration changes no existing table', () => {
    const created = [...migration.matchAll(/CREATE TABLE "?(\w+)"?/gu)].map((match) => match[1]);
    expect(created).toEqual(['shop_management_keys', 'shop_management_key_rate_limit_buckets', 'shop_management_key_events']);
    expect(migration).not.toMatch(/^\s*(ALTER|DROP|UPDATE|DELETE|INSERT|TRUNCATE)\b/mu);
    for (const name of created) expect(rollback).toContain(`\`${String(name)}\``);
  });

  it('needs no purge before a retreat and keeps the switch and the purge as owner controls', () => {
    expect(rollback).toMatch(/needs no purge/u);
    expect(rollback).toMatch(/reads `tenant_api_keys` exactly as before/u);
    expect(rollback).not.toMatch(/^\d\. /mu);
    expect(rollback).toMatch(/owner\s+controls, not rollback steps/u);
  });

  it('warns that the previous release reports a fingerprint mismatch and the health monitor alerts once', () => {
    const monitor = readFileSync('../.github/workflows/prod-health.yml', 'utf8');
    expect(monitor).toMatch(/\$fingerprint" = "false"/u);
    expect(monitor).toMatch(/uses: \.\/\.github\/actions\/alert-gate/u);
    expect(rollback).toMatch(/`\/api\/health` answer reports\s+`schemaFingerprintMatch: false`/u);
    expect(rollback).toMatch(/`\.github\/workflows\/prod-health\.yml`/u);
    expect(rollback).toMatch(/so it alerts once/u);
    expect(rollback).toMatch(/same failing set and sends none/u);
  });
});
