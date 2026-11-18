import { copyFileSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { drizzle } from 'drizzle-orm/node-postgres';
import pg from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { z } from 'zod';

import { createSecretCrypto } from '#adapters/crypto/secret-crypto.js';
import { createTenantSecretResolver } from '#adapters/crypto/tenant-secret-resolver.js';

import type { Db } from './client.js';
import { runMigrations } from './migration-runner.js';
import { createTenantSecretRepository } from './repositories.js';
import * as dbSchema from './schema.js';
import { uniqueTestDatabaseName } from './test-database-name.js';

const SLOT_MIGRATION_SUFFIX = '_shipx_slots';
const TEST_DB = uniqueTestDatabaseName('together_shipx_slots_migration_test');
const baseDatabaseUrl = process.env['DATABASE_URL'] ?? 'postgres://together:together@localhost:48912/together';
const testUrl = (() => {
  const url = new URL(baseDatabaseUrl);
  url.pathname = `/${TEST_DB}`;
  return url.toString();
})();
const masterKey = Buffer.alloc(32, 11).toString('base64');
const crypto = createSecretCrypto(masterKey);
const UPDATED_AT = '2026-10-01T08:00:00.000Z';

const LEGACY_KEYS: readonly string[] = ['shipx.organizationId', 'shipx.token'];

const journalSchema = z.object({ entries: z.array(z.object({ tag: z.string() }).passthrough()) }).passthrough();

interface Workspace {
  id: string;
  environment: 'sandbox' | 'production';
  legacy: Partial<Record<'shipx.organizationId' | 'shipx.token', string>>;
}

const WORKSPACES: readonly Workspace[] = [
  { id: 'tenant-production', environment: 'production', legacy: { 'shipx.organizationId': '1234', 'shipx.token': 'production-token' } },
  { id: 'tenant-sandbox', environment: 'sandbox', legacy: { 'shipx.organizationId': '5678', 'shipx.token': 'sandbox-token' } },
  { id: 'tenant-partial', environment: 'production', legacy: { 'shipx.token': 'partial-token' } },
  { id: 'tenant-none', environment: 'production', legacy: {} },
];

interface SecretRow {
  id: string;
  tenant_id: string;
  key: string;
  ciphertext: string;
  iv: string;
  auth_tag: string;
  masked_preview: string;
  updated_at: string;
}

let pool: pg.Pool;
let db: Db;
let partialMigrations: string;
let before: SecretRow[];

const rowsOf = async (): Promise<SecretRow[]> => (await pool.query<SecretRow>(
  `select id, tenant_id, key, ciphertext, iv, auth_tag, masked_preview, updated_at from tenant_secrets
   where key like 'shipx.%' order by tenant_id collate "C", key collate "C"`,
)).rows;

const keysOf = (rows: readonly SecretRow[], tenantId: string): string[] =>
  rows.filter((row) => row.tenant_id === tenantId).map((row) => row.key);

beforeAll(async () => {
  const admin = new pg.Client({ connectionString: baseDatabaseUrl });
  await admin.connect();
  await admin.query(`CREATE DATABASE ${pg.escapeIdentifier(TEST_DB)}`);
  await admin.end();

  const journal = journalSchema.parse(JSON.parse(readFileSync('drizzle/meta/_journal.json', 'utf8')));
  const position = journal.entries.findIndex((entry) => entry.tag.endsWith(SLOT_MIGRATION_SUFFIX));
  if (position === -1) throw new Error('The ShipX slot migration is missing from the journal');
  const earlier = journal.entries.slice(0, position);
  partialMigrations = mkdtempSync(join(tmpdir(), 'together-shipx-slots-'));
  mkdirSync(join(partialMigrations, 'meta'));
  const files = new Set(readdirSync('drizzle'));
  for (const entry of earlier) {
    const file = `${entry.tag}.sql`;
    if (!files.has(file)) throw new Error(`${file} is missing`);
    copyFileSync(join('drizzle', file), join(partialMigrations, file));
  }
  writeFileSync(join(partialMigrations, 'meta', '_journal.json'), JSON.stringify({ ...journal, entries: earlier }));

  pool = new pg.Pool({ connectionString: testUrl });
  db = drizzle(pool, { schema: dbSchema });
  await runMigrations({ connectionString: testUrl, migrationsFolder: partialMigrations });
  for (const workspace of WORKSPACES) {
    await pool.query(
      `insert into tenants (id, slug, name, created_at, shipx_environment) values ($1, $1, $1, $2, $3)`,
      [workspace.id, UPDATED_AT, workspace.environment],
    );
    for (const [key, value] of Object.entries(workspace.legacy)) {
      const encrypted = crypto.encrypt(value);
      await pool.query(
        `insert into tenant_secrets (id, tenant_id, key, ciphertext, iv, auth_tag, masked_preview, updated_at)
         values ($1, $2, $3, $4, $5, $6, $7, $8)`,
        [`legacy-${workspace.id}-${key}`, workspace.id, key, encrypted.ciphertext, encrypted.iv, encrypted.authTag, `••••${value.slice(-4)}`, UPDATED_AT],
      );
    }
  }
  before = await rowsOf();
  await runMigrations({ connectionString: testUrl, migrationsFolder: 'drizzle' });
}, 120_000);

afterAll(async () => {
  await pool.end();
  rmSync(partialMigrations, { recursive: true, force: true });
  const admin = new pg.Client({ connectionString: baseDatabaseUrl });
  await admin.connect();
  await admin.query(`DROP DATABASE IF EXISTS ${pg.escapeIdentifier(TEST_DB)} WITH (FORCE)`);
  await admin.end();
});

describe('ShipX slot migration', () => {
  it('copies each legacy row into the slot named by the stored environment and keeps the legacy rows', async () => {
    const after = await rowsOf();
    expect(keysOf(after, 'tenant-production')).toEqual([
      'shipx.organizationId', 'shipx.production.organizationId', 'shipx.production.token', 'shipx.token',
    ]);
    expect(keysOf(after, 'tenant-sandbox')).toEqual([
      'shipx.organizationId', 'shipx.sandbox.organizationId', 'shipx.sandbox.token', 'shipx.token',
    ]);
    expect(keysOf(after, 'tenant-partial')).toEqual(['shipx.production.token', 'shipx.token']);
    expect(keysOf(after, 'tenant-none')).toEqual([]);
    for (const legacy of before) expect(after).toContainEqual(legacy);
  });

  it('keeps the ciphertext, iv, auth tag, masked preview and update time under a new row id', async () => {
    const after = await rowsOf();
    const copies = after.filter((row) => !LEGACY_KEYS.includes(row.key));
    expect(copies).toHaveLength(5);
    for (const copy of copies) {
      const field = copy.key.endsWith('.organizationId') ? 'shipx.organizationId' : 'shipx.token';
      const source = before.find((row) => row.tenant_id === copy.tenant_id && row.key === field);
      expect(source).toBeDefined();
      expect(copy).toEqual({ ...source, id: copy.id, key: copy.key });
      expect(copy.id).not.toBe(source?.id);
    }
  });

  it('lets the new slot names decrypt to the values the previous release stored', async () => {
    const resolver = createTenantSecretResolver(createTenantSecretRepository(db), crypto);
    expect(await resolver.resolve('tenant-production', 'shipx.production.organizationId')).toEqual({ ok: true, value: '1234' });
    expect(await resolver.resolve('tenant-production', 'shipx.production.token')).toEqual({ ok: true, value: 'production-token' });
    expect(await resolver.resolve('tenant-sandbox', 'shipx.sandbox.token')).toEqual({ ok: true, value: 'sandbox-token' });
    expect(await resolver.resolve('tenant-partial', 'shipx.production.token')).toEqual({ ok: true, value: 'partial-token' });
    expect((await resolver.resolve('tenant-partial', 'shipx.production.organizationId')).ok).toBe(false);
    expect((await resolver.resolve('tenant-production', 'shipx.sandbox.token')).ok).toBe(false);
  });

  it('leaves the stored environment column in place for the previous release', async () => {
    const { rows } = await pool.query<{ id: string; shipx_environment: string }>(
      `select id, shipx_environment from tenants where id like 'tenant-%' order by id collate "C"`,
    );
    expect(rows).toEqual([
      { id: 'tenant-none', shipx_environment: 'production' },
      { id: 'tenant-partial', shipx_environment: 'production' },
      { id: 'tenant-production', shipx_environment: 'production' },
      { id: 'tenant-sandbox', shipx_environment: 'sandbox' },
    ]);
  });
});
