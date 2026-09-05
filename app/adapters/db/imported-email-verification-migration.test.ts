import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { inArray, sql } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import type { Db } from './client.js';
import { createTestDatabase } from './test-database-name.js';
import { importAuditEvents, members, tenantApiKeys, tenants, user } from './schema.js';

const baseDatabaseUrl =
  process.env['DATABASE_URL'] ?? 'postgres://together:together@localhost:48912/together';
const backfill = readFileSync(
  join(process.cwd(), 'drizzle/0100_verify_imported_member_emails.sql'),
  'utf8',
);
const NOW = '1998-08-14T10:00:00.000Z';
const TENANT_ID = 'tenant-verify-backfill';

let db: Db;
let closeTestDatabase: () => Promise<void>;

const emailVerifiedById = async (): Promise<Map<string, boolean>> => {
  const rows = await db
    .select({ id: user.id, emailVerified: user.emailVerified })
    .from(user)
    .where(inArray(user.id, ['imported-user', 'self-signup-user']));
  return new Map(rows.map((row) => [row.id, row.emailVerified]));
};

beforeAll(async () => {
  const testDatabase = await createTestDatabase('together_verify_backfill_test', baseDatabaseUrl);
  db = testDatabase.db;
  closeTestDatabase = testDatabase.close;
  await db.insert(tenants).values({
    id: TENANT_ID,
    slug: 'verify-backfill',
    name: 'Verify Backfill',
    createdAt: NOW,
  });
  await db.insert(tenantApiKeys).values({
    id: 'backfill-key',
    tenantId: TENANT_ID,
    name: 'Import',
    keyHash: 'verify-backfill-key-hash',
    scopes: ['import:users'],
    createdAt: NOW,
    expiresAt: '1998-08-20T10:00:00.000Z',
  });
  await db.insert(user).values([
    { id: 'imported-user', name: 'Imported', email: 'imported@example.test', emailVerified: false },
    { id: 'self-signup-user', name: 'Signed up', email: 'signup@example.test', emailVerified: false },
  ]);
  await db.insert(members).values([
    {
      id: 'imported-member',
      tenantId: TENANT_ID,
      userId: 'imported-user',
      email: 'imported@example.test',
      displayName: 'Imported',
      createdAt: NOW,
    },
    {
      id: 'self-signup-member',
      tenantId: TENANT_ID,
      userId: 'self-signup-user',
      email: 'signup@example.test',
      displayName: 'Signed up',
      createdAt: NOW,
    },
  ]);
  await db.insert(importAuditEvents).values({
    id: 'audit-imported-member',
    tenantId: TENANT_ID,
    apiKeyId: 'backfill-key',
    kind: 'member',
    importKey: 'imported-member',
    resourceId: 'imported-member',
    action: 'created',
    payloadHash: 'a'.repeat(64),
    at: NOW,
  });
}, 60_000);

afterAll(async () => {
  await closeTestDatabase();
});

describe('0100 imported member e-mail verification backfill', () => {
  it('verifies imported members only and stays a no-op on replay', async () => {
    expect(await emailVerifiedById()).toEqual(
      new Map([['imported-user', false], ['self-signup-user', false]]),
    );

    await db.execute(sql.raw(backfill));
    const afterFirstRun = await emailVerifiedById();
    await db.execute(sql.raw(backfill));

    expect(afterFirstRun).toEqual(
      new Map([['imported-user', true], ['self-signup-user', false]]),
    );
    expect(await emailVerifiedById()).toEqual(afterFirstRun);
  });
});
