import { eq } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import type { Post, TenantAuditEventInput } from '#core/domain/index.js';

import type { Db } from './client.js';
import { createPostRepository } from './repositories.js';
import {
  notificationFanoutJobs, notifications, postReactions, postReportEvents, postReports,
  posts, spaceEvents, spaces, tenantAuditEvents, tenants, threadSubscriptions,
} from './schema.js';
import { createTestDatabase } from './test-database-name.js';

const NOW = '2026-09-01T10:00:00.000Z';
const TENANT = 'purge-spec';
let db: Db;
let close: (() => Promise<void>) | undefined;

beforeAll(async () => {
  const database = await createTestDatabase('together_post_purge_test', process.env['DATABASE_URL'] ?? 'postgres://together:together@localhost:48912/together');
  db = database.db;
  close = database.close;
  await db.insert(tenants).values([
    { id: TENANT, slug: TENANT, name: 'Purge Spec', createdAt: NOW },
    { id: 'other', slug: 'other', name: 'Other', createdAt: NOW },
  ]);
});
afterAll(async () => { await close?.(); });

const post = (id: string, overrides: Partial<Post> = {}): Post => ({
  id, tenantId: TENANT, contextKind: 'space', contextId: 'space', parentPostId: null,
  rootPostId: id, authorUserId: 'author', authorDisplay: 'Author', authorIsStaff: false,
  body: 'Original content', createdAt: NOW, editedAt: null, deletedAt: null, pinnedAt: null,
  ...overrides,
});
const audit = (id: string): TenantAuditEventInput => ({
  id: `audit-${id}`, tenantId: TENANT, kind: 'post_purged', actorUserId: 'staff',
  actorEmail: 'staff@example.test', subjectMemberId: null, reason: id, at: NOW,
});

describe('post purge and visibility', () => {
  it('lists deleted roots before pagination and counts only live replies', async () => {
    const repo = createPostRepository(db);
    await repo.createPost(TENANT, post('legacy', { contextId: 'visibility', deletedAt: NOW }));
    await repo.createPost(TENANT, post('deleted-reply', { contextId: 'visibility', rootPostId: 'legacy', parentPostId: 'legacy', deletedAt: NOW }));
    await repo.createPost('other', post('foreign-reply', { tenantId: 'other', rootPostId: 'legacy', parentPostId: 'legacy' }));
    await repo.createPost(TENANT, post('visible', { contextId: 'visibility' }));
    const query = { contextKind: 'space', contextId: 'visibility', limit: 1 } as const;
    expect(await repo.listThreadsForContext(TENANT, query)).toMatchObject({ threads: [{ post: { id: 'legacy' }, replyCount: 0 }], nextCursor: expect.any(String) });
    expect(await repo.listThreadsForSpaces(TENANT, { spaceIds: ['visibility'], limit: 1 })).toMatchObject({ threads: [{ post: { id: 'visible' } }], nextCursor: expect.any(String) });
    await repo.createPost(TENANT, post('live-reply', { contextId: 'visibility', rootPostId: 'legacy', parentPostId: 'deleted-reply' }));
    expect(await repo.listThreadsForContext(TENANT, { ...query, limit: 10 })).toMatchObject({ threads: [
      { post: { id: 'legacy', deletedBy: null }, replyCount: 1 }, { post: { id: 'visible' } },
    ] });
  });

  it('purges roots with all references and commits an audit entry without content', async () => {
    const repo = createPostRepository(db);
    for (const row of [post('root', { deletedAt: NOW }), post('reply', { rootPostId: 'root', parentPostId: 'root' }), post('nested', { rootPostId: 'root', parentPostId: 'reply' })]) {
      await repo.createPost(TENANT, row);
      await db.insert(postReactions).values({ tenantId: TENANT, postId: row.id, userId: 'reader', emoji: '👍', createdAt: NOW });
      await db.insert(postReports).values({ id: `report-${row.id}`, tenantId: TENANT, postId: row.id, reporterUserId: 'reader', reporterDisplay: 'Reader', source: 'member', reason: 'spam', status: 'open', createdAt: NOW });
      await db.insert(postReportEvents).values({ id: `report-event-${row.id}`, tenantId: TENANT, postId: row.id, reportId: `report-${row.id}`, type: 'opened', occurredAt: NOW });
      await db.insert(notifications).values({ id: `notification-${row.id}`, tenantId: TENANT, recipientUserId: 'reader', kind: 'thread-reply', payload: { postId: row.id, rootPostId: 'root', snippet: 'Original content' }, createdAt: NOW });
      await db.insert(notificationFanoutJobs).values({ id: `fanout-${row.id}`, tenantId: TENANT, kind: 'thread-reply', sourceKey: row.id, payload: { postId: row.id }, status: 'pending', nextAttemptAt: NOW, createdAt: NOW, updatedAt: NOW });
    }
    await db.insert(threadSubscriptions).values({ tenantId: TENANT, rootPostId: 'root', userId: 'reader', createdAt: NOW });
    await db.insert(spaces).values({ id: 'space', tenantId: TENANT, slug: 'general', name: 'General', visibility: 'members', productIds: [], createdAt: NOW });
    await db.insert(spaceEvents).values({ id: 'event', tenantId: TENANT, spaceId: 'space', title: 'Event', startsAt: NOW, endsAt: NOW, createdByUserId: 'staff', createdAt: NOW, discussionRootPostId: 'root' });
    await repo.createPost('other', post('unrelated', { tenantId: 'other' }));
    expect(await repo.purge('other', 'root', audit('wrong-tenant'))).toBe(false);
    expect(await repo.purge(TENANT, 'reply', audit('live'))).toBe(false);
    expect(await repo.purge(TENANT, 'root', audit('root'))).toBe(true);
    expect(await repo.findByIds(TENANT, ['root', 'reply', 'nested'])).toEqual([]);
    for (const table of [postReactions, postReportEvents, postReports, notifications, notificationFanoutJobs, threadSubscriptions]) {
      expect(await db.select().from(table)).toEqual([]);
    }
    expect(await db.select().from(spaceEvents)).toMatchObject([{ discussionRootPostId: null }]);
    expect(await repo.findById('other', 'unrelated')).not.toBeNull();
    expect(await db.select().from(tenantAuditEvents)).toEqual([audit('root')]);
    expect(await repo.purge(TENANT, 'root', audit('repeat'))).toBe(false);
  });

  it('purges a reply subtree while retaining the root and sibling', async () => {
    const repo = createPostRepository(db);
    for (const row of [post('keep-root'), post('remove-reply', { rootPostId: 'keep-root', parentPostId: 'keep-root', deletedAt: NOW }), post('remove-nested', { rootPostId: 'keep-root', parentPostId: 'remove-reply' }), post('keep-sibling', { rootPostId: 'keep-root', parentPostId: 'keep-root' })]) await repo.createPost(TENANT, row);
    expect(await repo.purge(TENANT, 'remove-reply', audit('remove-reply'))).toBe(true);
    expect((await repo.listReplies(TENANT, 'keep-root')).map((row) => row.id)).toEqual(['keep-sibling']);
    expect(await repo.findById(TENANT, 'keep-root')).not.toBeNull();
  });

  it('rolls back deletion when the audit cannot be appended', async () => {
    const repo = createPostRepository(db);
    await repo.createPost(TENANT, post('rollback', { deletedAt: NOW }));
    await db.insert(tenantAuditEvents).values(audit('duplicate'));
    await expect(repo.purge(TENANT, 'rollback', audit('duplicate'))).rejects.toThrow();
    expect(await db.select().from(posts).where(eq(posts.id, 'rollback'))).toHaveLength(1);
  });
});
