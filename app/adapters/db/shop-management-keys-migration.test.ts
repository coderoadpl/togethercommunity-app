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

import type { TenantApiKey, TenantAuditEventInput } from '#core/domain/index.js';

import type { Db } from './client.js';
import { runMigrations } from './migration-runner.js';
import { createTenantAuditEventRepository } from './impersonation.js';
import { createTenantApiKeyRepository } from './repositories.js';
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

let pool: pg.Pool;
let db: Db;
let partialMigrations: string;

const shopKey = (overrides: Partial<TenantApiKey> = {}): TenantApiKey => ({
  id: 'shop-key', tenantId: TENANT, name: 'Shop backend', keyHash: 'hash-shop', kind: 'shop_management',
  scopes: ['shop:catalog:read'], issuedByUserId: 'user-owner', createdAt: NOW, expiresAt: EXPIRY, revokedAt: null,
  ...overrides,
});

const audit = (overrides: Partial<TenantAuditEventInput> = {}): TenantAuditEventInput => ({
  id: 'audit-shop-key', tenantId: TENANT, kind: 'api_key.shop_management_created', actorUserId: 'user-owner',
  actorEmail: 'owner@example.test', actorApiKeyId: null, subjectMemberId: null, reason: 'Shop backend (shop-key)', at: NOW,
  ...overrides,
});

const auditIds = async (): Promise<string[]> =>
  (await pool.query<{ id: string }>('select id from tenant_audit_events where tenant_id = $1 order by id', [TENANT]))
    .rows.map((row) => row.id);

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
});

describe('shop management key lifecycle', () => {
  it('rolls back the key when its creation audit event fails', async () => {
    const repo = createTenantApiKeyRepository(db);
    await pool.query(
      `insert into tenant_audit_events (id, tenant_id, kind, actor_user_id, actor_email, at)
       values ('audit-taken', $1, 'tenant_provisioned', 'operator', 'operator@example.test', $2)`,
      [TENANT, NOW],
    );

    await expect(repo.createShopManagement(TENANT, shopKey({ id: 'orphan-key', keyHash: 'hash-orphan' }), audit({ id: 'audit-taken' })))
      .rejects.toThrow();
    expect((await repo.listByTenant(TENANT)).map((key) => key.id)).not.toContain('orphan-key');
  });

  it('rolls back the creation audit event when the key insert fails', async () => {
    const repo = createTenantApiKeyRepository(db);
    await expect(repo.createShopManagement(
      TENANT,
      shopKey({ id: 'duplicate-hash', keyHash: 'hash-old-scoped' }),
      audit({ id: 'audit-duplicate-hash' }),
    )).rejects.toThrow();
    expect(await auditIds()).not.toContain('audit-duplicate-hash');
  });

  it('commits a key with its audit event and revokes it with another', async () => {
    const repo = createTenantApiKeyRepository(db);
    await repo.createShopManagement(TENANT, shopKey(), audit());
    expect(await repo.findActiveByHash(TENANT, 'hash-shop'))
      .toEqual(shopKey());

    await expect(repo.revokeShopManagement(TENANT, 'shop-key', NOW, audit({ id: 'audit-taken', kind: 'api_key.shop_management_revoked' })))
      .rejects.toThrow();
    expect(await repo.findActiveByHash(TENANT, 'hash-shop')).toMatchObject({ id: 'shop-key', revokedAt: null });

    expect(await repo.revoke(TENANT, 'shop-key', NOW)).toBeNull();
    expect(await repo.findActiveByHash(TENANT, 'hash-shop')).toMatchObject({ revokedAt: null });

    expect(await repo.revokeShopManagement(TENANT, 'shop-key', NOW, audit({ id: 'audit-revoked', kind: 'api_key.shop_management_revoked' })))
      .toMatchObject({ id: 'shop-key', revokedAt: NOW });
    expect(await repo.findActiveByHash(TENANT, 'hash-shop')).toBeNull();
    expect(await repo.revokeShopManagement(TENANT, 'shop-key', NOW, audit({ id: 'audit-revoked-twice', kind: 'api_key.shop_management_revoked' })))
      .toBeNull();
    expect(await auditIds()).toEqual(['audit-revoked', 'audit-shop-key', 'audit-taken']);
  });

  it('never revokes a legacy key through the shop management path', async () => {
    const repo = createTenantApiKeyRepository(db);
    expect(await repo.revokeShopManagement(TENANT, 'old-unscoped', NOW, audit({ id: 'audit-legacy', kind: 'api_key.shop_management_revoked' })))
      .toBeNull();
    expect(await repo.findActiveByHash(TENANT, 'hash-old-unscoped')).toMatchObject({ revokedAt: null });
    expect(await auditIds()).not.toContain('audit-legacy');
  });

  it('stores the key id of an audit event written through a shop key and keeps null for every other event', async () => {
    const repo = createTenantAuditEventRepository(db);
    const event = (overrides: Partial<TenantAuditEventInput>) => audit({ tenantId: AUDIT_TENANT, ...overrides });
    await repo.record(AUDIT_TENANT, event({ id: 'audit-keyed', kind: 'redirect_created', actorApiKeyId: 'shop-key', at: '1998-08-04T00:00:00.000Z' }));
    await repo.record(AUDIT_TENANT, event({ id: 'audit-session', kind: 'redirect_updated', at: '1998-08-04T00:00:01.000Z' }));
    const stored = await pool.query<{ id: string; actor_api_key_id: string | null }>(
      `select id, actor_api_key_id from tenant_audit_events where id in ('audit-keyed', 'audit-session', 'audit-before-key-ids') order by id`,
    );
    expect(stored.rows).toEqual([
      { id: 'audit-before-key-ids', actor_api_key_id: null },
      { id: 'audit-keyed', actor_api_key_id: 'shop-key' },
      { id: 'audit-session', actor_api_key_id: null },
    ]);
    const listed = (await repo.list(AUDIT_TENANT, { limit: 100 })).events
      .map((listedEvent) => ({ id: listedEvent.id, actorApiKeyId: listedEvent.actorApiKeyId }));
    expect(listed).toEqual([
      { id: 'audit-session', actorApiKeyId: null },
      { id: 'audit-keyed', actorApiKeyId: 'shop-key' },
      { id: 'audit-before-key-ids', actorApiKeyId: null },
    ]);
  });

  it('refuses to create a shop management key without its audit event', async () => {
    await expect(createTenantApiKeyRepository(db).create(TENANT, shopKey({ id: 'unaudited', keyHash: 'hash-unaudited' })))
      .rejects.toThrow();
  });
});
