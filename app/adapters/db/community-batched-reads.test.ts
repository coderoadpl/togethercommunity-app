import { and, eq } from 'drizzle-orm';
import { drizzle } from 'drizzle-orm/node-postgres';
import pg from 'pg';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';

import { postSchema, type Post, type Tenant } from '#core/domain/index.js';
import type { Ctx } from '#core/server/context.js';
import type { PostRepository } from '#core/server/ports.js';
import { listAccessibleSpaces, spaceVisibleToMemberScope } from '#core/server/usecases/community-access.js';
import { listDiscussion, type CommunityDeps } from '#core/server/usecases/community.js';
import { getPublicSpaceFeed, getPublicSpaceThread } from '#core/server/usecases/public-surface.js';
import { getSpaceFeed, type SpacesDeps } from '#core/server/usecases/spaces.js';

import type { Db } from './client.js';
import {
  createAvatarSourceReader, createCourseLessonRepository, createCourseModuleRepository,
  createCourseRepository, createMemberBlockRepository, createNotificationRepository,
  createPostReactionRepository, createPostReportRepository, createPostRepository,
  createProductGrantRepository, createProductRepository, createSpaceRepository,
  createSpaceSeenRepository, createSpaceSubscriptionRepository, createTenantAccessReader,
  createTenantRepository, createThreadSubscriptionRepository,
} from './repositories.js';
import * as schema from './schema.js';
import { createTestDatabase } from './test-database-name.js';

const NOW = '2026-10-01T12:00:00.000Z';
const TENANT = 'community-read-spec';
const OTHER = 'other-community';
const AVATAR = '/api/public/assets/avatar/10000000-0000-4000-8000-000000000001.webp';
const tenant: Tenant = { id: TENANT, slug: TENANT, name: 'Community', status: 'active', plan: 'hosted', contentVersion: 1 };
const ctx: Ctx = {
  identity: {
    userId: 'reader', email: 'reader@example.test', name: 'Reader', emailVerified: true,
    tenantAccess: 'member', tenantId: TENANT, tenantSlug: TENANT, tenantName: 'Community',
    staffRole: null, memberId: 'reader-member', image: null, memberDisplayName: null,
    memberBannedAt: null, memberDmOptOutAt: null, memberLanguage: null, memberVideoAutoplay: false,
  },
};
const staff: Ctx = { identity: { ...ctx.identity, tenantAccess: 'staff', staffRole: 'admin' } };
let db: Db;
let pool: pg.Pool | undefined;
let close: (() => Promise<void>) | undefined;
const reads: string[] = [];

const post = (id: string, overrides: Partial<Post> = {}): Post => postSchema.parse({
  id, tenantId: TENANT, contextKind: 'space', contextId: 'open', parentPostId: null,
  rootPostId: id, authorUserId: 'reader', authorDisplay: 'Reader', body: `Body ${id}`,
  createdAt: NOW, editedAt: null, deletedAt: null, ...overrides,
});

beforeAll(async () => {
  const database = await createTestDatabase('together_community_reads', 'postgres://together:together@localhost:48912/postgres');
  close = database.close;
  pool = new pg.Pool({ connectionString: database.url });
  db = drizzle(pool, {
    schema,
    logger: { logQuery: (query) => { if (query.startsWith('select ')) reads.push(query); } },
  });
  await db.insert(schema.tenants).values([TENANT, OTHER].map((id) => ({ id, slug: id, name: id, createdAt: NOW })));
  await db.insert(schema.user).values({ id: 'reader', name: 'Reader', email: 'reader@example.test' });
  await db.insert(schema.members).values({ id: 'reader-member', tenantId: TENANT, userId: 'reader', email: 'reader@example.test', avatarUrl: AVATAR, createdAt: NOW });
  await db.insert(schema.spaces).values([
    { id: 'open', tenantId: TENANT, slug: 'open', name: 'Open', visibility: 'members', publicReadOnly: true, createdAt: NOW },
    { id: 'private', tenantId: TENANT, slug: 'private', name: 'Private', visibility: 'product', productIds: ['missing'], createdAt: NOW },
    { id: 'archived', tenantId: TENANT, slug: 'archived', name: 'Archived', visibility: 'members', publicReadOnly: true, archivedAt: NOW, createdAt: NOW },
    { id: 'foreign', tenantId: OTHER, slug: 'foreign', name: 'Foreign', visibility: 'members', publicReadOnly: true, createdAt: NOW },
  ]);
  const rows: Post[] = [];
  for (const contextKind of ['space', 'lesson'] as const) {
    for (let index = 0; index < 6; index += 1) {
      const root = post(`${contextKind}-${String(index)}`, {
        contextKind, contextId: contextKind === 'space' ? 'open' : 'lesson',
        deletedAt: index === 5 ? NOW : null,
      });
      rows.push(root);
      if (index === 4) continue;
      rows.push(
        post(`${root.id}-c`, { ...root, id: `${root.id}-c`, parentPostId: root.id, deletedAt: null }),
        post(`${root.id}-b`, { ...root, id: `${root.id}-b`, parentPostId: `${root.id}-a`, deletedAt: null }),
        post(`${root.id}-a`, { ...root, id: `${root.id}-a`, parentPostId: root.id, deletedAt: NOW, deletedBy: 'author' }),
      );
    }
  }
  rows.push(post('foreign-reply', { tenantId: OTHER, contextId: 'open', rootPostId: 'space-0', parentPostId: 'space-0' }));
  rows.push(post('private-root', { contextId: 'private' }));
  await db.insert(schema.posts).values(rows);
  await db.insert(schema.postReactions).values({ tenantId: TENANT, postId: 'space-0', userId: 'reader', emoji: '👍', createdAt: NOW });
  await db.insert(schema.spaceSubscriptions).values({ tenantId: TENANT, spaceId: 'open', userId: 'reader', createdAt: NOW });
  await db.insert(schema.threadSubscriptions).values({ tenantId: TENANT, rootPostId: 'space-0', userId: 'reader', createdAt: NOW });
});

afterAll(async () => { await pool?.end(); await close?.(); });

const deps = (): CommunityDeps & SpacesDeps => ({
  posts: createPostRepository(db), spaces: createSpaceRepository(db),
  reports: createPostReportRepository(db), reactions: createPostReactionRepository(db),
  threadSubscriptions: createThreadSubscriptionRepository(db), spaceSubscriptions: createSpaceSubscriptionRepository(db),
  spaceSeen: createSpaceSeenRepository(db), memberBlocks: createMemberBlockRepository(db),
  notifications: createNotificationRepository(db), notificationChannels: [],
  fanoutJobs: { claimDue: async () => [], save: async () => undefined }, dispatchNotificationFanout: () => undefined,
  courses: createCourseRepository(db), modules: createCourseModuleRepository(db), lessons: createCourseLessonRepository(db),
  grants: createProductGrantRepository(db), products: createProductRepository(db),
  tenantAccess: createTenantAccessReader(db), tenants: createTenantRepository(db),
  links: {
    lessonDiscussionUrl: async () => 'https://example.test/lesson',
    spaceUrl: async () => 'https://example.test/space',
    conversationUrl: async () => 'https://example.test/conversation',
    eventUrl: async () => 'https://example.test/event',
  },
  ids: { nextId: () => crypto.randomUUID() }, clock: { nowIso: () => NOW },
  avatarSources: createAvatarSourceReader(db),
});

const legacyPosts = (repo: PostRepository): PostRepository => {
  const withLegacyCounts = async (page: Awaited<ReturnType<PostRepository['listThreadsForContext']>>) => ({
    ...page,
    threads: await Promise.all(page.threads.map(async ({ post }) => ({
      post,
      replyCount: (await repo.listReplies(TENANT, post.rootPostId)).filter((reply) => reply.deletedAt === null).length,
    }))),
  });
  return {
    ...repo,
    listThreadsForContext: async (tenantId, query) => withLegacyCounts(await repo.listThreadsForContext(tenantId, query)),
    listThreadsForSpaces: async (tenantId, query) => withLegacyCounts(await repo.listThreadsForSpaces(tenantId, query)),
    listRepliesForRoots: async (tenantId, rootPostIds) => new Map(await Promise.all(rootPostIds.map(async (id) => [id, await repo.listReplies(tenantId, id)] as const))),
    countRepliesIncludingDeleted: async (tenantId, rootPostIds) => new Map(await Promise.all(rootPostIds.map(async (id) => [id, (await repo.listReplies(tenantId, id)).length] as const))),
  };
};

const measured = async <T>(read: () => Promise<T>): Promise<{ result: T; queries: string[] }> => {
  reads.length = 0;
  const result = await read();
  return { result, queries: [...reads] };
};

const pin = async (ids: string[]): Promise<void> => {
  await db.update(schema.posts).set({ pinnedAt: null }).where(eq(schema.posts.tenantId, TENANT));
  const repo = createPostRepository(db);
  for (const id of ids) await repo.setPinned(TENANT, { id, pinnedAt: NOW });
};

describe('batched community reads', () => {
  it.each(['lesson', 'space'] as const)('preserves %s discussion output with one replies read and one grouped live count', async (contextKind) => {
    const d = deps();
    const viewer = contextKind === 'lesson' ? staff : ctx;
    const query = { contextKind, contextId: contextKind === 'space' ? 'open' : 'lesson' };
    const small = await measured(() => listDiscussion(viewer, { ...query, limit: 1 }, d));
    const large = await measured(() => listDiscussion(viewer, { ...query, limit: 6 }, d));
    expect(large.queries).toHaveLength(small.queries.length);
    expect(large.queries.filter((sql) => sql.includes('group by "posts"."root_post_id"'))).toHaveLength(1);
    expect(large.queries.filter((sql) => sql.includes('"parent_post_id" is not null'))).toHaveLength(1);
    expect(large.result).toEqual(await listDiscussion(viewer, { ...query, limit: 6 }, { ...d, posts: legacyPosts(d.posts) }));
    expect(large.result).toMatchObject({ ok: true, value: {
      threads: [
        { id: `${contextKind}-0`, replyCount: 2, authorAvatarUrl: AVATAR, replies: [
          { id: `${contextKind}-0-a`, deletedAt: NOW, replyCount: 1, replies: [{ id: `${contextKind}-0-b`, authorAvatarUrl: AVATAR }] },
          { id: `${contextKind}-0-c`, replies: [] },
        ] },
        { id: `${contextKind}-1` }, { id: `${contextKind}-2` }, { id: `${contextKind}-3` },
        { id: `${contextKind}-4`, replyCount: 0, replies: [] }, { id: `${contextKind}-5`, deletedAt: NOW, replyCount: 2 },
      ], nextCursor: null,
    } });
    expect(JSON.stringify(large.result)).not.toContain('foreign-reply');
    if (contextKind === 'space') expect(large.result).toMatchObject({ ok: true, value: { viewerSubscriptions: { 'space-0': 'subscribed' } } });
  });

  it.each(['member', 'public'] as const)('preserves %s feed output and keeps reads constant as the page and pins grow', async (reader) => {
    const d = deps();
    const read = (limit: number, posts = d.posts) => reader === 'member'
      ? getSpaceFeed(ctx, { spaceId: 'open', limit }, { ...d, posts })
      : getPublicSpaceFeed(tenant, { spaceId: 'open', limit }, { ...d, posts });
    await pin(['space-0']);
    const small = await measured(() => read(1));
    await pin(['space-0', 'space-1', 'space-2']);
    const large = await measured(() => read(6));
    expect(large.queries).toHaveLength(small.queries.length);
    expect(large.queries.filter((sql) => sql.includes('group by "posts"."root_post_id"'))).toHaveLength(2);
    expect(large.queries.filter((sql) => sql.includes('"parent_post_id" is not null'))).toHaveLength(1);
    expect(large.result).toEqual(await read(6, legacyPosts(d.posts)));
    expect(large.result).toMatchObject({ ok: true, value: {
      pinned: [
        { id: 'space-2', replyCount: 3 }, { id: 'space-1', replyCount: 3 },
        { id: 'space-0', replyCount: 3, reactions: [{ emoji: '👍', count: 1, viewerReacted: reader === 'member' }] },
      ],
      items: [{ id: 'space-5', deletedAt: NOW, replyCount: 2 }, { id: 'space-4', replyCount: 0 }, { id: 'space-3', replyCount: 2 }],
      nextCursor: null, isFollowing: reader === 'member',
    } });
    if (!large.result.ok) throw new Error('Feed failed');
    expect(large.result.value.pinned.every((row) => row.authorAvatarUrl === (reader === 'member' ? AVATAR : null))).toBe(true);
    expect(JSON.stringify(large.result)).not.toContain('foreign-reply');
  });

  it('preserves the public thread nesting and tombstone count with constant reads', async () => {
    const d = deps();
    const read = (postId: string, posts = d.posts) => getPublicSpaceThread(tenant, { spaceId: 'open', postId }, { ...d, posts });
    const empty = await measured(() => read('space-4'));
    const nested = await measured(() => read('space-0'));
    expect(nested.queries).toHaveLength(empty.queries.length);
    expect(nested.queries.filter((sql) => sql.includes('"parent_post_id" is not null'))).toHaveLength(1);
    expect(nested.result).toEqual(await read('space-0', legacyPosts(d.posts)));
    expect(nested.result).toMatchObject({ ok: true, value: { threads: [{
      id: 'space-0', replyCount: 3, authorAvatarUrl: null, replies: [
        { id: 'space-0-a', deletedAt: NOW, replyCount: 1, replies: [{ id: 'space-0-b', authorAvatarUrl: null }] },
        { id: 'space-0-c', replies: [] },
      ],
    }], nextCursor: null, viewerSubscriptions: {} } });
    expect(JSON.stringify(nested.result)).not.toContain('foreign-reply');
  });

  it('does not cap replies in discussions or public threads', async () => {
    await db.insert(schema.posts).values(Array.from({ length: 110 }, (_, index) => post(`extra-${String(index).padStart(3, '0')}`, {
      rootPostId: 'space-3', parentPostId: 'space-3',
    })));
    const d = deps();
    const thread = await getPublicSpaceThread(tenant, { spaceId: 'open', postId: 'space-3' }, d);
    const discussion = await listDiscussion(ctx, { contextKind: 'space', contextId: 'open', limit: 6 }, d);
    expect(thread).toMatchObject({ ok: true, value: { threads: [{ replyCount: 113 }] } });
    if (!thread.ok || !discussion.ok) throw new Error('Discussion failed');
    expect(thread.value.threads[0]?.replies).toHaveLength(112);
    const root = discussion.value.threads.find((row) => row.id === 'space-3');
    expect(root?.replyCount).toBe(112);
    expect(root?.replies).toHaveLength(112);
  });

  it('uses one grouped live-count read across accessible spaces and preserves pagination', async () => {
    const repo = createPostRepository(db);
    const small = await measured(() => repo.listThreadsForSpaces(TENANT, { spaceIds: ['open'], limit: 1 }));
    const large = await measured(() => repo.listThreadsForSpaces(TENANT, { spaceIds: ['open'], limit: 6 }));
    expect(large.queries).toHaveLength(2);
    expect(small.queries).toHaveLength(2);
    expect(large.result).toEqual(await legacyPosts(repo).listThreadsForSpaces(TENANT, { spaceIds: ['open'], limit: 6 }));
    expect(large.result.threads.map((row) => row.post.id)).toEqual(['space-5', 'space-4', 'space-3', 'space-2', 'space-1', 'space-0']);
    const next = await repo.listThreadsForSpaces(TENANT, { spaceIds: ['open'], cursor: small.result.nextCursor ?? '', limit: 6 });
    expect(next.threads).toEqual(large.result.threads.slice(1));
    expect(next.nextCursor).toBeNull();
  });

  it('short-circuits empty batches and scopes replies and counts to the tenant', async () => {
    const repo = createPostRepository(db);
    const empty = await measured(async () => [
      await repo.listRepliesForRoots(TENANT, []), await repo.countRepliesIncludingDeleted(TENANT, []),
      await repo.listThreadsForSpaces(TENANT, { spaceIds: [], limit: 6 }),
    ]);
    expect(empty.queries).toEqual([]);
    expect(empty.result).toEqual([new Map(), new Map(), { threads: [], nextCursor: null }]);
    const replies = await repo.listRepliesForRoots(TENANT, ['space-0', 'space-4', 'missing']);
    expect([...replies.keys()]).toEqual(['space-0']);
    expect(replies.get('space-0')?.map((row) => row.id)).toEqual(['space-0-a', 'space-0-b', 'space-0-c']);
    expect(await repo.countRepliesIncludingDeleted(TENANT, ['space-0', 'space-4', 'missing'])).toEqual(new Map([['space-0', 3]]));
    expect((await repo.listRepliesForRoots(OTHER, ['space-0'])).get('space-0')?.map((row) => row.id)).toEqual(['foreign-reply']);
  });

  it('checks tenant and space access before reading posts or replies', async () => {
    const d = deps();
    const roots = vi.spyOn(d.posts, 'listThreadsForContext');
    const replies = vi.spyOn(d.posts, 'listRepliesForRoots');
    const counts = vi.spyOn(d.posts, 'countRepliesIncludingDeleted');
    const find = vi.spyOn(d.posts, 'findById');
    for (const spaceId of ['private', 'archived', 'foreign', 'missing']) {
      expect(await listDiscussion(ctx, { contextKind: 'space', contextId: spaceId }, d)).toMatchObject({ ok: false });
      expect(await getSpaceFeed(ctx, { spaceId }, d)).toMatchObject({ ok: false });
      expect(await getPublicSpaceFeed(tenant, { spaceId }, d)).toMatchObject({ ok: false });
      expect(await getPublicSpaceThread(tenant, { spaceId, postId: 'space-0' }, d)).toMatchObject({ ok: false });
    }
    expect(roots).not.toHaveBeenCalled();
    expect(replies).not.toHaveBeenCalled();
    expect(counts).not.toHaveBeenCalled();
    expect(find).not.toHaveBeenCalled();
    expect(await getPublicSpaceThread(tenant, { spaceId: 'open', postId: 'private-root' }, d)).toMatchObject({ ok: false });
    expect(replies).not.toHaveBeenCalled();
  });

  it('fetches active grants once as product-gated spaces grow, preserving membership visibility and order', async () => {
    const d = deps();
    await db.insert(schema.products).values(['active', 'expired', 'future', 'test'].map((id) => ({
      id, tenantId: TENANT, type: 'course' as const, slug: id, title: id, description: '',
      priceCents: 0, currency: 'PLN', createdAt: NOW,
    })));
    await db.insert(schema.productGrants).values(['active', 'expired', 'future', 'test'].map((id) => ({
      id: `grant-${id}`, tenantId: TENANT, memberId: 'reader-member', productId: id,
      source: 'manual' as const, mode: id === 'test' ? 'test' as const : 'live' as const,
      startsAt: id === 'future' ? '2026-11-01T12:00:00.000Z' : '2026-09-01T12:00:00.000Z',
      expiresAt: id === 'expired' ? '2026-09-30T12:00:00.000Z' : null, createdAt: NOW,
    })));
    const small = await measured(() => listAccessibleSpaces(ctx, d));
    await db.insert(schema.spaces).values(['active', 'expired', 'future', 'test', 'missing'].map((id, index) => ({
      id: `gated-${id}`, tenantId: TENANT, slug: `gated-${id}`, name: id, visibility: 'product' as const,
      productIds: [id], position: index + 1, createdAt: NOW,
    })));
    const activeGrants = vi.spyOn(d.grants, 'listActiveForMember');
    const large = await measured(() => listAccessibleSpaces(ctx, d));
    expect(large.queries).toHaveLength(small.queries.length);
    expect(activeGrants).toHaveBeenCalledExactlyOnceWith(TENANT, 'reader-member', NOW);
    const listed = await d.spaces.list(TENANT);
    const legacy = [];
    for (const space of listed) {
      if (await spaceVisibleToMemberScope({ tenantId: TENANT, memberId: 'reader-member' }, space, d)) legacy.push(space);
    }
    expect(large.result).toEqual({ ok: true, value: legacy });
    expect(legacy.map((space) => space.id)).toEqual(['open', 'gated-active']);
    activeGrants.mockClear();
    expect(await listAccessibleSpaces(staff, d)).toEqual({ ok: true, value: listed });
    expect(activeGrants).not.toHaveBeenCalled();
    await db.update(schema.spaces).set({ archivedAt: NOW }).where(and(eq(schema.spaces.tenantId, TENANT), eq(schema.spaces.visibility, 'product')));
    await listAccessibleSpaces(ctx, d);
    expect(activeGrants).not.toHaveBeenCalled();
  });
});
