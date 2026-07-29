import { drizzle } from 'drizzle-orm/node-postgres';
import { migrate } from 'drizzle-orm/node-postgres/migrator';
import pg from 'pg';
import { beforeAll, describe, expect, it } from 'vitest';

import type { Post } from '#core/domain/index.js';

import { createDb, type Db } from './client.js';
import { createPostRepository } from './repositories.js';
import { tenants } from './schema.js';

const TEST_DB = 'together_post_search_test';
const baseDatabaseUrl =
  process.env['DATABASE_URL'] ?? 'postgres://together:together@localhost:48912/together';
const testUrl = (() => {
  const url = new URL(baseDatabaseUrl);
  url.pathname = `/${TEST_DB}`;
  return url.toString();
})();

const TENANT_ID = 'tenant-search-spec';
const LESSON_ID = 'lesson-1';

let db: Db;

const post = (id: string, body: string): Post => ({
  id,
  tenantId: TENANT_ID,
  contextKind: 'lesson',
  contextId: LESSON_ID,
  parentPostId: null,
  rootPostId: id,
  authorUserId: 'user-1',
  authorDisplay: 'Autor',
  authorIsStaff: false,
  body,
  createdAt: '2026-07-15T08:00:00.000Z',
  editedAt: null,
  deletedAt: null,
  pinnedAt: null,
});

const bodiesFor = async (query: string): Promise<string[]> => {
  const hits = await createPostRepository(db).search(TENANT_ID, {
    query,
    lessonIds: [LESSON_ID],
    spaceIds: [],
    limit: 50,
  });
  return hits.map((hit) => hit.post.body).sort();
};

beforeAll(async () => {
  const admin = new pg.Client({ connectionString: baseDatabaseUrl });
  await admin.connect();
  await admin.query(`DROP DATABASE IF EXISTS ${TEST_DB} WITH (FORCE)`);
  await admin.query(`CREATE DATABASE ${TEST_DB}`);
  await admin.end();

  const migrationPool = new pg.Pool({ connectionString: testUrl });
  await migrate(drizzle(migrationPool), { migrationsFolder: 'drizzle' });
  await migrationPool.end();

  db = createDb('node-postgres', testUrl);
  await db.insert(tenants).values({
    id: TENANT_ID,
    slug: 'search-spec',
    name: 'Search Spec',
    createdAt: '2026-07-15T08:00:00.000Z',
  });

  const repo = createPostRepository(db);
  await repo.createPost(TENANT_ID, post('p1', 'Zakres zmiennych w JavaScript'));
  await repo.createPost(TENANT_ID, post('p2', 'Deklaracja zmienna i typy'));
  await repo.createPost(TENANT_ID, post('p3', 'Funkcje wyższego rzędu'));
});

describe('post search — Polish inflections via prefix matching', () => {
  it('matches every inflected form from a shared stem', async () => {
    expect(await bodiesFor('zmienn')).toEqual([
      'Deklaracja zmienna i typy',
      'Zakres zmiennych w JavaScript',
    ]);
  });

  it('still matches a fully typed word', async () => {
    expect(await bodiesFor('funkcje')).toEqual(['Funkcje wyższego rzędu']);
  });

  it('ANDs multiple terms, prefix-matching only the last', async () => {
    expect(await bodiesFor('deklaracja zmienn')).toEqual(['Deklaracja zmienna i typy']);
  });

  it('returns nothing for an unrelated stem', async () => {
    expect(await bodiesFor('kamper')).toEqual([]);
  });
});
