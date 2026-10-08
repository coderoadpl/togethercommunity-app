import { readFileSync } from 'node:fs';

import pg from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { productSchema } from '#core/domain/index.js';

import { products, tenants } from './schema.js';
import { createProductRepository } from './repositories.js';
import { createTestDatabase } from './test-database-name.js';

const now = '2026-10-08T10:00:00.000Z';
const baseDatabaseUrl = process.env['DATABASE_URL'] ?? 'postgres://together:together@localhost:48912/together';
let database: Awaited<ReturnType<typeof createTestDatabase>>;

beforeAll(async () => {
  database = await createTestDatabase('together_product_vat', baseDatabaseUrl);
  await database.db.insert(tenants).values({ id: 'vat-tenant', slug: 'vat-workspace', name: 'VAT workspace', createdAt: now });
}, 60_000);
afterAll(async () => { await database?.close(); });

describe('product VAT persistence', () => {
  it('stores numeric VAT for a physical product and isolates tenants', async () => {
    const repository = createProductRepository(database.db);
    const product = productSchema.parse({ id: 'printed', tenantId: 'vat-tenant', type: 'physical', slug: 'printed', title: 'Printed material', description: '', coverUrl: null, priceCents: 10500, currency: 'PLN', vatRate: 5, vatExemptionBasis: null, accessItems: [], published: false, legacyId: null, createdAt: now });
    expect(await repository.create('vat-tenant', product)).toBe('created');
    expect(await repository.findById('vat-tenant', product.id)).toMatchObject({ vatRate: 5, vatExemptionBasis: null, type: 'physical' });
    expect(await repository.findById('other-tenant', product.id)).toBeNull();
    await database.db.insert(products).values({ ...product, id: 'legacy', slug: 'legacy', vatRate: null });
    expect(await repository.findById('vat-tenant', 'legacy')).toMatchObject({ vatRate: null });
  });

  it('keeps legacy products following Settings without freezing configured rates', async () => {
    const client = new pg.Client({ connectionString: database.url });
    await client.connect();
    try {
      await client.query('CREATE TEMP TABLE tenants (id text PRIMARY KEY, invoice_vat_mode text, invoice_vat_rate_percent integer, invoice_exemption_basis text)');
      await client.query('CREATE TEMP TABLE products (id text PRIMARY KEY, tenant_id text NOT NULL)');
      await client.query("INSERT INTO tenants VALUES ('rated', 'rate', 8, NULL), ('exempt', 'exempt', NULL, 'Section 1'), ('unset', 'rate', NULL, NULL)");
      await client.query("INSERT INTO products VALUES ('a', 'rated'), ('b', 'exempt'), ('c', 'unset')");
      await client.query(readFileSync('drizzle/0135_product_vat.sql', 'utf8'));
      expect((await client.query('SELECT id, vat_rate, vat_exemption_basis FROM products ORDER BY id')).rows).toEqual([
        { id: 'a', vat_rate: null, vat_exemption_basis: null },
        { id: 'b', vat_rate: null, vat_exemption_basis: null },
        { id: 'c', vat_rate: null, vat_exemption_basis: null },
      ]);
      await client.query("UPDATE tenants SET invoice_vat_mode = 'rate', invoice_vat_rate_percent = 23 WHERE id = 'exempt'");
      expect((await client.query("SELECT vat_rate, vat_exemption_basis FROM products WHERE id = 'b'")).rows).toEqual([
        { vat_rate: null, vat_exemption_basis: null },
      ]);
    } finally { await client.end(); }
  });
});
