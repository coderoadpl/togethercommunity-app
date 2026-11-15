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

import type { ShopManagementKeyEvent, TenantApiKey } from '#core/domain/index.js';

import type { Db } from './client.js';
import { runMigrations } from './migration-runner.js';
import { createTenantApiKeyRepository } from './repositories.js';
import { createShopManagementKeyEventRepository } from './shop-management-key-events.js';
import * as dbSchema from './schema.js';
import { uniqueTestDatabaseName } from './test-database-name.js';

const LAST_MIGRATION_WITHOUT_KEY_KINDS = 154;
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

const previousReleaseAuditKinds: readonly string[] = [
  'impersonation_started',
  'impersonation_ended',
  'content_version_restored',
  'redirect_created',
  'redirect_updated',
  'redirect_deleted',
  'post_purged',
  'tenant_provisioned',
  'team.admin_added',
  'team.admin_invited',
  'team.admin_activated',
  'team.invitation_revoked',
  'team.admin_removed',
];

let pool: pg.Pool;
let db: Db;
let partialMigrations: string;

const shopKey = (overrides: Partial<TenantApiKey> = {}): TenantApiKey => ({
  id: 'shop-key', tenantId: TENANT, name: 'Shop backend', keyHash: 'hash-shop', kind: 'shop_management',
  scopes: ['shop:catalog:read'], issuedByUserId: 'user-owner', createdAt: NOW, expiresAt: EXPIRY, revokedAt: null,
  ...overrides,
});

const keyEvent = (overrides: Partial<ShopManagementKeyEvent> = {}): ShopManagementKeyEvent => ({
  id: 'event-created', tenantId: TENANT, apiKeyId: 'shop-key', kind: 'created', actorUserId: 'user-owner',
  method: null, route: null, resourceId: null, status: null, outcome: 'succeeded', at: NOW,
  ...overrides,
});

const requestEvent = (overrides: Partial<ShopManagementKeyEvent> = {}): ShopManagementKeyEvent => keyEvent({
  id: 'event-request', kind: 'request', method: 'POST', route: '/api/m2m/shop/products/update',
  resourceId: 'product-1', status: 200, ...overrides,
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
    if (prefix !== undefined && Number(prefix) <= LAST_MIGRATION_WITHOUT_KEY_KINDS) {
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
    JSON.stringify({ ...journal, entries: entries.slice(0, LAST_MIGRATION_WITHOUT_KEY_KINDS + 1) }),
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
  await pool.query(
    `insert into tenant_audit_events (id, tenant_id, kind, actor_user_id, actor_email, subject_member_id, reason, at)
     values ('audit-before-key-ids', $1, 'redirect_created', 'user-owner', 'owner@example.test', null, null, $2)`,
    [AUDIT_TENANT, NOW],
  );
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
  it('reads rows written before the migration as legacy keys with unchanged scopes', async () => {
    const keys = await createTenantApiKeyRepository(db).listByTenant(TENANT);
    expect(keys.filter((key) => key.id.startsWith('old-'))).toEqual([
      expect.objectContaining({ id: 'old-scoped', kind: 'legacy', scopes: ['import:content'], issuedByUserId: null, expiresAt: EXPIRY }),
      expect.objectContaining({ id: 'old-unscoped', kind: 'legacy', scopes: null, issuedByUserId: null, expiresAt: null }),
    ]);
    expect(await createTenantApiKeyRepository(db).findActiveByHash(TENANT, 'hash-old-unscoped'))
      .toMatchObject({ id: 'old-unscoped', kind: 'legacy', scopes: null });
  });

  it('defaults a row inserted without the new columns to legacy', async () => {
    await pool.query(
      `insert into tenant_api_keys (id, tenant_id, name, key_hash, scopes, created_at)
       values ('older-binary', $1, 'Older binary', 'hash-older-binary', '["marketing"]', $2)`,
      [TENANT, NOW],
    );
    expect(await createTenantApiKeyRepository(db).findActiveByHash(TENANT, 'hash-older-binary'))
      .toMatchObject({ kind: 'legacy', scopes: ['marketing'], issuedByUserId: null });
  });

  it.each([
    ['an unknown kind', `'root', 'user-owner', '${EXPIRY}'`],
    ['a shop management key without an issuer', `'shop_management', null, '${EXPIRY}'`],
    ['a shop management key without an expiry', `'shop_management', 'user-owner', null`],
  ])('rejects %s at the database', async (_label, values) => {
    await expect(pool.query(
      `insert into tenant_api_keys (id, tenant_id, name, key_hash, kind, issued_by_user_id, expires_at, scopes, created_at)
       values ('invalid', $1, 'Invalid', 'hash-invalid', ${values}, '["shop:catalog:read"]', $2)`,
      [TENANT, NOW],
    )).rejects.toThrow(/tenant_api_keys_/);
  });

  it.each([
    ['null scopes', 'null'],
    ['an empty scope array', `'[]'`],
    ['a scope string instead of an array', `'"shop:catalog:read"'`],
    ['a scope object instead of an array', `'{"scope":"shop:catalog:read"}'`],
  ])('rejects a shop management key with %s at the database', async (_label, scopes) => {
    await expect(pool.query(
      `insert into tenant_api_keys (id, tenant_id, name, key_hash, kind, issued_by_user_id, expires_at, scopes, created_at)
       values ('unscoped-shop', $1, 'Unscoped shop', 'hash-unscoped-shop', 'shop_management', 'user-owner', $2, ${scopes}, $3)`,
      [TENANT, EXPIRY, NOW],
    )).rejects.toThrow(/tenant_api_keys_shop_management_scopes_check/);
  });

  it('keeps accepting a legacy key without scopes', async () => {
    await pool.query(
      `insert into tenant_api_keys (id, tenant_id, name, key_hash, kind, scopes, created_at)
       values ('new-unscoped-legacy', $1, 'New unscoped legacy', 'hash-new-unscoped-legacy', 'legacy', null, $2)`,
      [TENANT, NOW],
    );
    expect(await createTenantApiKeyRepository(db).findActiveByHash(TENANT, 'hash-new-unscoped-legacy'))
      .toMatchObject({ id: 'new-unscoped-legacy', kind: 'legacy', scopes: null });
  });
});

describe('shop management key lifecycle', () => {
  it('rolls back the key when its creation event fails', async () => {
    const repo = createTenantApiKeyRepository(db);
    await insertEvent(keyEvent({ id: 'event-taken', apiKeyId: 'earlier-key' }));

    await expect(repo.createShopManagement(TENANT, shopKey({ id: 'orphan-key', keyHash: 'hash-orphan' }), keyEvent({ id: 'event-taken', apiKeyId: 'orphan-key' })))
      .rejects.toThrow();
    expect((await repo.listByTenant(TENANT)).map((key) => key.id)).not.toContain('orphan-key');
  });

  it('rolls back the creation event when the key insert fails', async () => {
    const repo = createTenantApiKeyRepository(db);
    await expect(repo.createShopManagement(
      TENANT,
      shopKey({ id: 'duplicate-hash', keyHash: 'hash-old-scoped' }),
      keyEvent({ id: 'event-duplicate-hash', apiKeyId: 'duplicate-hash' }),
    )).rejects.toThrow();
    expect(await eventIds()).not.toContain('event-duplicate-hash');
  });

  it('commits a key with its creation event and revokes it with a revocation event', async () => {
    const repo = createTenantApiKeyRepository(db);
    await repo.createShopManagement(TENANT, shopKey(), keyEvent());
    expect(await repo.findActiveByHash(TENANT, 'hash-shop'))
      .toEqual(shopKey());

    await expect(repo.revokeShopManagement(TENANT, 'shop-key', NOW, keyEvent({ id: 'event-taken', kind: 'revoked' })))
      .rejects.toThrow();
    expect(await repo.findActiveByHash(TENANT, 'hash-shop')).toMatchObject({ id: 'shop-key', revokedAt: null });

    expect(await repo.revoke(TENANT, 'shop-key', NOW)).toBeNull();
    expect(await repo.findActiveByHash(TENANT, 'hash-shop')).toMatchObject({ revokedAt: null });

    expect(await repo.revokeShopManagement(TENANT, 'shop-key', NOW, keyEvent({ id: 'event-revoked', kind: 'revoked' })))
      .toMatchObject({ id: 'shop-key', revokedAt: NOW });
    expect(await repo.findActiveByHash(TENANT, 'hash-shop')).toBeNull();
    expect(await repo.findByHash(TENANT, 'hash-shop')).toMatchObject({ id: 'shop-key', revokedAt: NOW });
    expect(await repo.findByHash(AUDIT_TENANT, 'hash-shop')).toBeNull();
    expect(await repo.revokeShopManagement(TENANT, 'shop-key', NOW, keyEvent({ id: 'event-revoked-twice', kind: 'revoked' })))
      .toBeNull();
    expect(await eventIds()).toEqual(['event-created', 'event-revoked', 'event-taken']);
  });

  it('never revokes a legacy key through the shop management path', async () => {
    const repo = createTenantApiKeyRepository(db);
    expect(await repo.revokeShopManagement(TENANT, 'old-unscoped', NOW, keyEvent({ id: 'event-legacy', apiKeyId: 'old-unscoped', kind: 'revoked' })))
      .toBeNull();
    expect(await repo.findActiveByHash(TENANT, 'hash-old-unscoped')).toMatchObject({ revokedAt: null });
    expect(await eventIds()).not.toContain('event-legacy');
  });

  it('refuses to create a shop management key without its creation event', async () => {
    await expect(createTenantApiKeyRepository(db).create(TENANT, shopKey({ id: 'unaudited', keyHash: 'hash-unaudited' })))
      .rejects.toThrow();
  });

  it('refuses an event of another tenant through a tenant-scoped write', async () => {
    await expect(createShopManagementKeyEventRepository(db).record(TENANT, keyEvent({ id: 'event-foreign', tenantId: AUDIT_TENANT })))
      .rejects.toThrow();
    expect(await eventIds(AUDIT_TENANT)).not.toContain('event-foreign');
  });

  it.each([
    ['a request without a method', requestEvent({ id: 'bad-1', method: null })],
    ['a request without a route', requestEvent({ id: 'bad-2', route: null })],
    ['a request without a status', requestEvent({ id: 'bad-3', status: null })],
    ['a lifecycle event without an actor', keyEvent({ id: 'bad-4', actorUserId: null })],
    ['a lifecycle event with a route', keyEvent({ id: 'bad-5', route: '/api/api-keys' })],
    ['a lifecycle event with a refused outcome', keyEvent({ id: 'bad-6', outcome: 'refused' })],
  ])('rejects %s at the database', async (_label, event) => {
    await expect(pool.query(
      `insert into shop_management_key_events (id, tenant_id, api_key_id, kind, actor_user_id, method, route, resource_id, status, outcome, at)
       values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)`,
      [event.id, event.tenantId, event.apiKeyId, event.kind, event.actorUserId, event.method, event.route, event.resourceId, event.status, event.outcome, event.at],
    )).rejects.toThrow(/shop_management_key_events_shape_check/);
  });

  it('leaves tenant_audit_events in the shape of the previous release', async () => {
    const columns = await pool.query<{ column_name: string }>(
      `select column_name from information_schema.columns where table_name = 'tenant_audit_events' order by column_name collate "C"`,
    );
    expect(columns.rows.map((row) => row.column_name)).toEqual(
      ['actor_email', 'actor_user_id', 'at', 'id', 'kind', 'reason', 'subject_member_id', 'tenant_id'],
    );
    expect((await pool.query('select id from tenant_audit_events where tenant_id = $1', [AUDIT_TENANT])).rows)
      .toEqual([{ id: 'audit-before-key-ids' }]);
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
      requestEvent({ id: 'list-b-refused', tenantId: LIST_TENANT, apiKeyId: 'key-b', status: 403, outcome: 'refused', resourceId: null, at: at(4) }),
      keyEvent({ id: 'list-a-revoked', tenantId: LIST_TENANT, apiKeyId: 'key-a', kind: 'revoked', at: at(5) }),
      keyEvent({ id: 'other-a-created', tenantId: OTHER_TENANT, apiKeyId: 'key-a', at: at(6) }),
    ]) await insertEvent(event);
  });

  it('lists a workspace history newest first, page by page', async () => {
    const repo = createShopManagementKeyEventRepository(db);
    const first = await repo.list(LIST_TENANT, { limit: 3 });
    expect(first.events.map((event) => event.id)).toEqual(['list-a-revoked', 'list-b-refused', 'list-b-created']);
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
      `insert into tenant_api_keys (id, tenant_id, name, key_hash, kind, scopes, issued_by_user_id, created_at, expires_at, revoked_at)
       values ('purge-shop-active', $1, 'Active', 'hash-purge-shop-active', 'shop_management', '["shop:catalog:write"]', 'user-owner', $3, $4, null),
              ('purge-shop-revoked', $1, 'Revoked', 'hash-purge-shop-revoked', 'shop_management', '["shop:orders:read"]', 'user-owner', $3, $4, $3),
              ('purge-legacy', $1, 'Legacy', 'hash-purge-legacy', 'legacy', '["marketing"]', null, $3, null, null),
              ('neighbour-shop', $2, 'Neighbour', 'hash-neighbour-shop', 'shop_management', '["shop:catalog:read"]', 'user-owner', $3, $4, null)`,
      [PURGE_TENANT, NEIGHBOUR_TENANT, NOW, EXPIRY],
    );
    await pool.query(
      `insert into api_key_rate_limit_buckets (api_key_id, period, window_started_at, count) values ('purge-shop-active', 'minute', $1, 3)`,
      [NOW],
    );
    await insertEvent(requestEvent({ id: 'purge-request-before', tenantId: PURGE_TENANT, apiKeyId: 'purge-shop-active' }));
  };
  const purgeEvent = (prefix: string) => (apiKeyId: string): ShopManagementKeyEvent => keyEvent({
    id: `${prefix}-${apiKeyId}`, tenantId: PURGE_TENANT, apiKeyId, kind: 'purged',
  });
  const keyIds = async (): Promise<string[]> =>
    (await pool.query<{ id: string }>(
      'select id from tenant_api_keys where tenant_id = any($1) order by id collate "C"',
      [[PURGE_TENANT, NEIGHBOUR_TENANT]],
    )).rows.map((row) => row.id);

  beforeAll(insertKeys);

  it('keeps every key and writes no purge event when one purge event cannot be written', async () => {
    await insertEvent(keyEvent({ id: 'taken-purge-shop-revoked', tenantId: PURGE_TENANT, apiKeyId: 'earlier-key' }));
    await expect(createTenantApiKeyRepository(db).purgeShopManagement(PURGE_TENANT, purgeEvent('taken')))
      .rejects.toThrow();
    expect(await keyIds()).toEqual(['neighbour-shop', 'purge-legacy', 'purge-shop-active', 'purge-shop-revoked']);
    expect(await eventIds(PURGE_TENANT)).toEqual(['purge-request-before', 'taken-purge-shop-revoked']);
  });

  it('deletes only the workspace shop management keys, revoked or not, with one purge event per key', async () => {
    const repo = createTenantApiKeyRepository(db);
    expect(await repo.purgeShopManagement(PURGE_TENANT, purgeEvent('purged'))).toBe(2);
    expect(await keyIds()).toEqual(['neighbour-shop', 'purge-legacy']);
    expect((await pool.query('select api_key_id from api_key_rate_limit_buckets where api_key_id = $1', ['purge-shop-active'])).rows)
      .toEqual([]);
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

    expect(await repo.purgeShopManagement(PURGE_TENANT, purgeEvent('purged-again'))).toBe(0);
    expect(await eventIds(PURGE_TENANT)).not.toContain('purged-again-purge-shop-active');
  });

  it('keeps the key history after the purge and writes no workspace audit event', async () => {
    expect((await createShopManagementKeyEventRepository(db).list(PURGE_TENANT, { apiKeyId: 'purge-shop-active', limit: 50 })).events
      .map((event) => event.kind).sort()).toEqual(['purged', 'request']);
    const kinds = await pool.query<{ kind: string }>('select kind from tenant_audit_events where tenant_id = $1', [PURGE_TENANT]);
    expect(kinds.rows.map((row) => row.kind).filter((kind) => !previousReleaseAuditKinds.includes(kind))).toEqual([]);
  });

  it('removes the history together with its workspace', async () => {
    await pool.query('delete from tenant_api_keys where tenant_id = $1', [PURGE_TENANT]);
    await pool.query('delete from tenants where id = $1', [PURGE_TENANT]);
    expect(await eventIds(PURGE_TENANT)).toEqual([]);
  });
});

describe('shop management key rollback guide', () => {
  const guide = readFileSync('docs/shop-management-keys.md', 'utf8');
  const rollback = /## Rollback\n([\s\S]*?)(?=\n## |\nSee also)/u.exec(guide)?.[1] ?? '';
  const migration = readFileSync('drizzle/0155_shop_management_keys.sql', 'utf8');

  it('names every column and table the migration adds as kept and ignored by the previous release', () => {
    const added = [
      ...[...migration.matchAll(/ADD COLUMN "?(\w+)"?/gu)].map((match) => match[1]),
      ...[...migration.matchAll(/CREATE TABLE "?(\w+)"?/gu)].map((match) => match[1]),
    ];
    expect(added).toEqual(['kind', 'issued_by_user_id', 'shop_management_key_events']);
    for (const name of added) expect(rollback).toContain(`\`${String(name)}\``);
  });

  it('no longer describes a workspace audit list limitation', () => {
    expect(rollback).not.toMatch(/actor_api_key_id|api_key\.shop_management_|audit-events/u);
    expect(rollback).toMatch(/audit list keeps working/u);
  });

  it('keeps the purge before the binary rollback because the previous release cannot parse shop key rows', () => {
    expect(rollback).toMatch(/fails to parse/u);
    const steps = [...rollback.matchAll(/^(\d)\. ([\s\S]*?)(?=^\d\. |^$)/gmu)].map((match) => match[2] ?? '');
    expect(steps).toHaveLength(4);
    expect(steps[0]).toContain('SHOP_MANAGEMENT_KEYS=disabled');
    expect(steps[1]).toContain('purge-shop-management');
    expect(steps[2]).toContain('api-key list');
    expect(steps[3]).toContain('Roll back the binary');
    expect(steps[3]).toContain('shop_management_key_events');
  });
});

