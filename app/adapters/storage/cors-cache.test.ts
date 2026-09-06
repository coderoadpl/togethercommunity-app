import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import type { Db } from '../db/client.js';
import { tenants } from '../db/schema.js';
import { createTestDatabase } from '../db/test-database-name.js';
import { createStorageCorsCache } from './cors-cache.js';

const baseDatabaseUrl = process.env['DATABASE_URL'] ??
  'postgres://together:together@localhost:48912/together';

let db: Db;
let closeTestDatabase: () => Promise<void>;

beforeAll(async () => {
  const testDatabase = await createTestDatabase('together_storage_cors_cache_test', baseDatabaseUrl);
  db = testDatabase.db;
  closeTestDatabase = testDatabase.close;
  await db.insert(tenants).values({
    id: 'tenant-1',
    slug: 'acme',
    name: 'Acme',
    createdAt: '2026-09-07T00:00:00.000Z',
  });
});

afterAll(async () => {
  await closeTestDatabase();
});

describe('storage CORS cache', () => {
  it('shares the latest tenant result between adapter instances', async () => {
    const first = createStorageCorsCache(db);
    const second = createStorageCorsCache(db);
    const entry = {
      checkedAt: '2026-09-07T10:00:00.000Z',
      results: [{ origin: 'https://courses.example.org', status: 'ok' as const }],
    };

    await first.write('tenant-1', entry);

    await expect(second.read('tenant-1')).resolves.toEqual(entry);
  });
});
