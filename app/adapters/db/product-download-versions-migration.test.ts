import { readFileSync } from 'node:fs';

import pg from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import type { ProductDownloadAsset } from '#core/domain/index.js';

import { products, tenants } from './schema.js';
import { createProductDownloadAssetRepository } from './repositories.js';
import { createTestDatabase } from './test-database-name.js';

const NOW = '2026-09-01T12:00:00.000Z';
const baseDatabaseUrl = process.env['DATABASE_URL'] ?? 'postgres://together:together@localhost:48912/together';
let database: Awaited<ReturnType<typeof createTestDatabase>>;
let repository: ReturnType<typeof createProductDownloadAssetRepository>;
const asset = (id: string, overrides: Partial<ProductDownloadAsset> = {}): ProductDownloadAsset => ({
  id, tenantId: 'version-tenant', productId: 'version-product', lineageId: id,
  versionNumber: 1, versionNote: null, supersededAt: null, replacesAssetId: null,
  fileName: `${id}.pdf`, contentType: 'application/pdf', sizeBytes: 1024,
  storageKey: `product-downloads/version-product/${id}/file.pdf`, status: 'pending', createdAt: NOW,
  ...overrides,
});
const completion = (replacesAssetId?: string) => ({ replacesAssetId, versionNote: 'Corrected diagram', now: NOW });

beforeAll(async () => {
  database = await createTestDatabase('together_download_versions', baseDatabaseUrl);
  repository = createProductDownloadAssetRepository(database.db);
  await database.db.insert(tenants).values({ id: 'version-tenant', slug: 'version-tenant', name: 'Versions', createdAt: NOW });
  await database.db.insert(products).values({ id: 'version-product', tenantId: 'version-tenant', slug: 'versions', title: 'Workbook', description: '', priceCents: 1000, currency: 'PLN', published: true, createdAt: NOW });
}, 60_000);
afterAll(async () => { await database?.close(); });

describe('download version transactions', () => {
  it('serializes concurrent completions, preserves storage keys, and promotes only within the lineage', async () => {
    const first = asset('first', { status: 'ready' });
    for (const row of [first, asset('second'), asset('third'), asset('epub', { status: 'ready' })]) {
      await repository.create(row.tenantId, row);
    }
    const results = await Promise.all(['second', 'third'].map((id) =>
      repository.markReady(first.tenantId, id, 2048, completion(first.id))));
    expect(results.map((row) => row?.versionNumber).sort()).toEqual([2, 3]);
    const history = (await repository.listReadyByProduct(first.tenantId, first.productId))
      .filter((row) => row.lineageId === first.id).sort((a, b) => b.versionNumber - a.versionNumber);
    expect(history.map((row) => row.supersededAt)).toEqual([null, NOW, NOW]);
    expect(history.map((row) => row.storageKey).sort()).toEqual([first, asset('second'), asset('third')].map((row) => row.storageKey).sort());
    const latest = history[0];
    const previous = history[1];
    if (!latest || !previous) throw new Error('Missing completed versions');
    expect(await repository.markReady(first.tenantId, latest.id, 2048, completion(first.id))).toEqual(latest);
    expect(await repository.delete(first.tenantId, latest.id)).toBe(true);
    expect(await repository.findById(first.tenantId, previous.id)).toMatchObject({ supersededAt: null });
    expect(await repository.delete(first.tenantId, first.id)).toBe(true);
    expect(await repository.findById(first.tenantId, previous.id)).toMatchObject({ supersededAt: null });
    expect(await repository.findById(first.tenantId, 'epub')).toMatchObject({ lineageId: 'epub', supersededAt: null });
    expect(await repository.findById('other-tenant', previous.id)).toBeNull();
  });

  it('does not complete a replacement whose target disappeared', async () => {
    const pending = asset('orphan');
    await repository.create(pending.tenantId, pending);
    expect(await repository.markReady(pending.tenantId, pending.id, 1024, completion('missing'))).toBeNull();
    expect(await repository.findById(pending.tenantId, pending.id)).toMatchObject({ status: 'pending' });
  });

  it('backfills existing single-version rows without changing delivery fields', async () => {
    const client = new pg.Client({ connectionString: database.url });
    await client.connect();
    try {
      await client.query('CREATE TEMP TABLE product_download_assets (id text PRIMARY KEY, tenant_id text NOT NULL, storage_key text NOT NULL, status text NOT NULL)');
      await client.query("INSERT INTO product_download_assets VALUES ('legacy', 'tenant', 'original-object', 'ready')");
      await client.query(readFileSync('drizzle/0128_product_download_versions.sql', 'utf8'));
      const result = await client.query('SELECT * FROM product_download_assets');
      expect(result.rows).toEqual([{
        id: 'legacy', tenant_id: 'tenant', storage_key: 'original-object', status: 'ready',
        lineage_id: 'legacy', version_number: 1, version_note: null, superseded_at: null, replaces_asset_id: null,
      }]);
    } finally {
      await client.end();
    }
  });
});
