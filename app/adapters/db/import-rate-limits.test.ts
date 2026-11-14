import { eq } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import type { Db } from './client.js';
import { createApiKeyRateLimitRepository } from './repositories.js';
import { apiKeyRateLimitBuckets, tenantApiKeys, tenants } from './schema.js';
import { createTestDatabase } from './test-database-name.js';

const NOW = '1998-08-14T10:00:00.000Z';
const TENANT_ID = 'tenant-import-limits';
let db: Db;
let close: (() => Promise<void>) | undefined;

beforeAll(async () => {
  const database = await createTestDatabase(
    'together_import_limits_test',
    process.env['DATABASE_URL'] ?? 'postgres://together:together@localhost:48912/postgres',
  );
  db = database.db;
  close = database.close;
  await db.insert(tenants).values({ id: TENANT_ID, slug: 'import-limits', name: 'Import Limits', createdAt: NOW });
  await db.insert(tenantApiKeys).values(['key-a', 'key-b', 'key-concurrent'].map((id) => ({
    id, tenantId: TENANT_ID, name: id, keyHash: id, createdAt: NOW,
  })));
}, 60_000);

afterAll(async () => { await close?.(); });

describe('import validation quota storage', () => {
  it('stores independent request and weighted record buckets using the current schema', async () => {
    const limits = createApiKeyRateLimitRepository(db);
    const requests = { apiKeyId: 'key-a', period: 'hour' as const, windowStartedAt: NOW, limit: 30 };
    const records = { ...requests, period: 'import-validate-records' as const, limit: 50_000, cost: 5_000 };
    for (let batch = 0; batch < 10; batch += 1) {
      expect(await limits.claim(TENANT_ID, requests)).toBe(true);
      expect(await limits.claim(TENANT_ID, records)).toBe(true);
    }
    expect(await limits.claim(TENANT_ID, { ...records, cost: 1 })).toBe(false);
    expect(await limits.claim(TENANT_ID, requests)).toBe(true);
    await limits.release(TENANT_ID, requests);
    const stored = await db.select().from(apiKeyRateLimitBuckets).where(eq(apiKeyRateLimitBuckets.apiKeyId, 'key-a'));
    expect(stored).toEqual(expect.arrayContaining([
      expect.objectContaining({ period: 'hour', count: 10 }),
      expect.objectContaining({ period: 'import-validate-records', count: 50_000 }),
    ]));
    expect(stored).toHaveLength(2);
    expect(await limits.claim(TENANT_ID, { ...records, windowStartedAt: '1998-08-14T11:00:00.000Z' })).toBe(true);
  });

  it('isolates record budgets by API key and enforces tenant ownership', async () => {
    const limits = createApiKeyRateLimitRepository(db);
    const records = { apiKeyId: 'key-b', period: 'import-validate-records' as const, windowStartedAt: NOW, limit: 50_000, cost: 50_000 };
    expect(await limits.claim('other-tenant', records)).toBe(false);
    expect(await limits.claim(TENANT_ID, records)).toBe(true);
    await limits.release('other-tenant', records);
    expect(await limits.claim(TENANT_ID, { ...records, cost: 1 })).toBe(false);
  });

  it('does not overdraw the weighted budget under concurrent claims', async () => {
    const limits = createApiKeyRateLimitRepository(db);
    const records = { apiKeyId: 'key-concurrent', period: 'import-validate-records' as const, windowStartedAt: NOW, limit: 50_000, cost: 5_000 };
    const claimed = await Promise.all(Array.from({ length: 20 }, () => limits.claim(TENANT_ID, records)));
    expect(claimed.filter(Boolean)).toHaveLength(10);
  });
});
