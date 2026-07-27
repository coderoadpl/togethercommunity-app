import { drizzle } from 'drizzle-orm/node-postgres';
import { migrate } from 'drizzle-orm/node-postgres/migrator';
import pg from 'pg';
import { beforeAll, describe, expect, it } from 'vitest';

import { createDb, type Db } from './client.js';
import { createKsefNumberRepository } from './ksef-repositories.js';
import { members, orders, products, tenants } from './schema.js';

const TEST_DB = 'together_ksef_test';
const baseDatabaseUrl = process.env['DATABASE_URL'] ?? 'postgres://together:together@localhost:48912/together';
const testUrl = (() => {
  const url = new URL(baseDatabaseUrl);
  url.pathname = `/${TEST_DB}`;
  return url.toString();
})();
const now = '2026-07-27T10:00:00.000Z';
let db: Db;

beforeAll(async () => {
  const admin = new pg.Client({ connectionString: baseDatabaseUrl });
  await admin.connect();
  await admin.query(`DROP DATABASE IF EXISTS ${TEST_DB} WITH (FORCE)`);
  await admin.query(`CREATE DATABASE ${TEST_DB}`);
  await admin.end();
  const pool = new pg.Pool({ connectionString: testUrl });
  await migrate(drizzle(pool), { migrationsFolder: 'drizzle' });
  await pool.end();
  db = createDb('node-postgres', testUrl);
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
