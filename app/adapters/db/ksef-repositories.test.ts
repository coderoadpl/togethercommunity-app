import { drizzle } from 'drizzle-orm/node-postgres';
import { migrate } from 'drizzle-orm/node-postgres/migrator';
import pg from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import type { Db } from './client.js';
import {
  createKsefNumberRepository,
  createKsefSubmissionJobRepository,
} from './ksef-repositories.js';
import {
  invoices,
  ksefSubmissionJobs,
  members,
  orders,
  products,
  tenants,
} from './schema.js';
import * as dbSchema from './schema.js';
import { uniqueTestDatabaseName } from './test-database-name.js';

const TEST_DB = uniqueTestDatabaseName('together_ksef_test');
const baseDatabaseUrl = process.env['DATABASE_URL'] ?? 'postgres://together:together@localhost:48912/together';
const testUrl = (() => {
  const url = new URL(baseDatabaseUrl);
  url.pathname = `/${TEST_DB}`;
  return url.toString();
})();
const now = '2026-07-27T10:00:00.000Z';
let db: Db;
let dbPool: pg.Pool;

afterAll(async () => {
  await dbPool.end();
  const admin = new pg.Client({ connectionString: baseDatabaseUrl });
  await admin.connect();
  await admin.query(`DROP DATABASE IF EXISTS ${TEST_DB} WITH (FORCE)`);
  await admin.end();
});

beforeAll(async () => {
  const admin = new pg.Client({ connectionString: baseDatabaseUrl });
  await admin.connect();
  await admin.query(`DROP DATABASE IF EXISTS ${TEST_DB} WITH (FORCE)`);
  await admin.query(`CREATE DATABASE ${TEST_DB}`);
  await admin.end();
  const pool = new pg.Pool({ connectionString: testUrl });
  await migrate(drizzle(pool), { migrationsFolder: 'drizzle' });
  await pool.end();
  dbPool = new pg.Pool({ connectionString: testUrl });
  db = drizzle(dbPool, { schema: dbSchema });
  await db.insert(tenants).values({
    id: 'tenant-ksef',
    slug: 'ksef',
    name: 'KSeF',
    createdAt: now,
  });
  await db.insert(members).values({
    id: 'member-ksef',
    tenantId: 'tenant-ksef',
    userId: 'user-ksef',
    email: 'buyer@example.com',
    createdAt: now,
  });
  await db.insert(products).values({
    id: 'product-ksef',
    tenantId: 'tenant-ksef',
    type: 'course',
    slug: 'course',
    title: 'Course',
    description: '',
    priceCents: 7900,
    currency: 'PLN',
    createdAt: now,
  });
  await db.insert(orders).values(Array.from({ length: 20 }, (_, index) => ({
    id: `order-${String(index + 1)}`,
    tenantId: 'tenant-ksef',
    memberId: 'member-ksef',
    productId: 'product-ksef',
    kind: 'one_time' as const,
    status: 'paid' as const,
    amountCents: 7900,
    currency: 'PLN',
    provider: 'simulated' as const,
    createdAt: now,
  })));
}, 60_000);

describe('KSeF invoice numbering', () => {
  it('allocates a unique immutable sequence under concurrency', async () => {
    const repository = createKsefNumberRepository(db);
    const allocated = await Promise.all(
      Array.from({ length: 20 }, (_, index) =>
        repository.allocate('tenant-ksef', {
          orderId: `order-${String(index + 1)}`,
          invoiceType: 'VAT',
          year: 2026,
          allocatedAt: now,
        })),
    );

    expect(new Set(allocated.map((item) => item.p2)).size).toBe(20);
    expect(allocated.map((item) => item.sequence).sort((a, b) => a - b))
      .toEqual(Array.from({ length: 20 }, (_, index) => index + 1));
    expect(await repository.allocate('tenant-ksef', {
      orderId: 'order-1',
      invoiceType: 'VAT',
      year: 2026,
      allocatedAt: now,
    })).toEqual(allocated[0]);
  });
});

describe('KSeF submission jobs', () => {
  it('serializes each tenant under concurrent claims and reclaims an expired lease', async () => {
    await db.insert(invoices).values([1, 2].map((sequence) => ({
      id: `invoice-job-${String(sequence)}`,
      tenantId: 'tenant-ksef',
      orderId: `order-${String(sequence)}`,
      status: 'queued' as const,
      provider: 'ksef',
      createdAt: new Date(Date.parse(now) + sequence).toISOString(),
    })));
    await db.insert(ksefSubmissionJobs).values([1, 2].map((sequence) => ({
      id: `job-${String(sequence)}`,
      tenantId: 'tenant-ksef',
      invoiceId: `invoice-job-${String(sequence)}`,
      status: 'queued' as const,
      nextAttemptAt: now,
      createdAt: new Date(Date.parse(now) + sequence).toISOString(),
    })));
    const repository = createKsefSubmissionJobRepository(db);

    const claimed = await Promise.all([
      repository.claimDue(now),
      repository.claimDue(now),
    ]);

    expect(claimed.filter((job) => job !== null)).toHaveLength(1);
    expect(claimed.filter((job) => job === null)).toHaveLength(1);
    expect(claimed.find((job) => job !== null)).toMatchObject({
      id: 'job-1',
      status: 'running',
      attempts: 1,
    });

    const reclaimed = await repository.claimDue(
      new Date(Date.parse(now) + 16 * 60 * 1000).toISOString(),
    );

    expect(reclaimed).toMatchObject({
      id: 'job-1',
      status: 'running',
      attempts: 2,
    });
  });
});
