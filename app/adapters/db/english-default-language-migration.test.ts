import { readFileSync } from 'node:fs';

import { eq, sql } from 'drizzle-orm';
import { afterAll, beforeAll, expect, it } from 'vitest';

import { DELETED_MEMBER_DISPLAY, DELETED_POST_PLACEHOLDER } from '#core/domain/index.js';
import { deletedContentPl } from '#core/domain/deleted-content.pl.js';

import type { Db } from './client.js';
import { posts, tenants } from './schema.js';
import { createTestDatabase } from './test-database-name.js';

const migration = readFileSync('drizzle/0117_english_default_language.sql', 'utf8');
const now = '1998-08-14T10:00:00.000Z';
let db: Db;
let close: () => Promise<void>;

beforeAll(async () => {
  const database = await createTestDatabase(
    'together_language_migration',
    process.env['DATABASE_URL'] ?? 'postgres://together:together@localhost:48912/together',
  );
  db = database.db;
  close = database.close;
});

afterAll(async () => { await close(); });

it('preserves existing tenant languages and defaults new tenants to English', async () => {
  await db.execute(sql`ALTER TABLE tenants ALTER COLUMN default_language SET DEFAULT 'pl'`);
  await db.execute(sql`INSERT INTO tenants (id, slug, name, created_at) VALUES ('legacy', 'legacy', 'Legacy', ${now})`);
  await db.insert(tenants).values({ id: 'english', slug: 'english', name: 'English', defaultLanguage: 'en', createdAt: now });
  await db.execute(sql.raw(migration));
  await db.execute(sql`INSERT INTO tenants (id, slug, name, created_at) VALUES ('new', 'new', 'New', ${now})`);
  const languages = await db.select({ id: tenants.id, language: tenants.defaultLanguage }).from(tenants);
  expect(languages).toEqual(expect.arrayContaining([
    { id: 'legacy', language: 'pl' },
    { id: 'english', language: 'en' },
    { id: 'new', language: 'en' },
  ]));
});

it('rewrites persisted tombstones without replacing an active post body', async () => {
  for (const id of ['deleted', 'active']) {
    await db.insert(posts).values({
      id, tenantId: 'legacy', contextKind: 'space', contextId: 'general', rootPostId: id,
      authorUserId: 'erased', authorDisplay: deletedContentPl.member, body: deletedContentPl.post,
      createdAt: now, deletedAt: id === 'deleted' ? now : null,
    });
  }
  await db.execute(sql.raw(migration));
  await db.execute(sql.raw(migration));
  const rows = await db.select().from(posts).where(eq(posts.tenantId, 'legacy'));
  expect(rows.find((row) => row.id === 'deleted')).toMatchObject({
    authorDisplay: DELETED_MEMBER_DISPLAY, body: DELETED_POST_PLACEHOLDER,
  });
  expect(rows.find((row) => row.id === 'active')).toMatchObject({
    authorDisplay: DELETED_MEMBER_DISPLAY, body: deletedContentPl.post,
  });
});
