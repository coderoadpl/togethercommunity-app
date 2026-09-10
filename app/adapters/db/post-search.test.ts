import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import type { Post } from '#core/domain/index.js';

import type { Db } from './client.js';
import { createPostRepository } from './repositories.js';
import { posts, tenants } from './schema.js';
import { createTestDatabase } from './test-database-name.js';

const baseDatabaseUrl =
  process.env['DATABASE_URL'] ?? 'postgres://together:together@localhost:48912/together';

const TENANT_ID = 'tenant-search-spec';
const LESSON_ID = 'lesson-1';

let db: Db;
let closeTestDatabase: () => Promise<void>;

afterAll(async () => {
  await closeTestDatabase();
});

const post = (id: string, body: string): Post => ({
  id,
  tenantId: TENANT_ID,
  contextKind: 'lesson',
  contextId: LESSON_ID,
  parentPostId: null,
  rootPostId: id,
  authorUserId: 'user-1',
  authorDisplay: 'Author',
  authorIsStaff: false,
  body,
  bodyFormat: 'plain',
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
  const testDatabase = await createTestDatabase('together_post_search_test', baseDatabaseUrl);
  db = testDatabase.db;
  closeTestDatabase = testDatabase.close;
  await db.insert(tenants).values({
    id: TENANT_ID,
    slug: 'search-spec',
    name: 'Search Spec',
    createdAt: '2026-07-15T08:00:00.000Z',
  });

  const repo = createPostRepository(db);
  await repo.createPost(TENANT_ID, post('p1', 'Variable scope in JavaScript'));
  await repo.createPost(TENANT_ID, post('p2', 'Variable declaration and types'));
  await repo.createPost(TENANT_ID, post('p3', 'Higher-order functions'));
  await db.insert(posts).values({
    ...post('p4', 'Legacy database default'),
    bodyFormat: undefined,
  });
  await repo.createPost(TENANT_ID, { ...post('p5', '**Markdown persistence**'), bodyFormat: 'markdown' });
});

describe('post search prefix matching', () => {
  it('matches every inflected form from a shared stem', async () => {
    expect(await bodiesFor('variabl')).toEqual([
      'Variable declaration and types',
      'Variable scope in JavaScript',
    ]);
  });

  it('still matches a fully typed word', async () => {
    expect(await bodiesFor('functions')).toEqual(['Higher-order functions']);
  });

  it('ANDs multiple terms, prefix-matching only the last', async () => {
    expect(await bodiesFor('declaration variabl')).toEqual(['Variable declaration and types']);
  });

  it('returns nothing for an unrelated stem', async () => {
    expect(await bodiesFor('camper')).toEqual([]);
  });

  it('persists explicit formats and reads the database default as plain', async () => {
    const repo = createPostRepository(db);
    await expect(repo.findById(TENANT_ID, 'p4')).resolves.toMatchObject({ bodyFormat: 'plain' });
    await expect(repo.findById(TENANT_ID, 'p5')).resolves.toMatchObject({ bodyFormat: 'markdown' });
  });
});
