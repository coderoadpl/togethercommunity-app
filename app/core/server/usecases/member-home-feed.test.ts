import { describe, expect, it } from 'vitest';

import type {
  Identity,
  Post,
  ProductGrant,
  ReactionSummary,
  Space,
} from '#core/domain/index.js';

import type { Ctx } from '../context.js';
import type {
  PostReactionRepository,
  PostRepository,
  ProductGrantRepository,
  SpaceRepository,
} from '../ports.js';
import { getMemberHomeFeed, type MemberHomeFeedDeps } from './member-home-feed.js';

const NOW = '2026-07-15T10:00:00.000Z';

const identity = (overrides: Partial<Identity>): Identity => ({
  userId: 'u1',
  email: 'u1@example.com',
  name: 'User One',
  emailVerified: true,
  tenantId: 't1',
  tenantSlug: 'tenant',
  tenantName: 'Tenant',
  staffRole: null,
  memberId: 'm1',
  memberBannedAt: null,
  ...overrides,
});

const ctx = (overrides: Partial<Identity> = {}): Ctx => ({ identity: identity(overrides) });

const space = (id: string, overrides: Partial<Space> = {}): Space => ({
  id,
  tenantId: 't1',
  slug: id,
  name: `Space ${id}`,
  description: null,
  visibility: 'members',
  productIds: [],
  position: 0,
  archivedAt: null,
  createdAt: NOW,
  ...overrides,
});

const post = (
  id: string,
  contextId: string,
  createdAt: string,
  overrides: Partial<Post> = {},
): Post => ({
  id,
  tenantId: 't1',
  contextKind: 'space',
  contextId,
  parentPostId: null,
  rootPostId: id,
  authorUserId: 'u2',
  authorDisplay: 'Autor',
  authorIsStaff: false,
  body: `Body ${id}`,
  createdAt,
  editedAt: null,
  deletedAt: null,
  pinnedAt: null,
  ...overrides,
});

const grant = (memberId: string, productId: string): ProductGrant => ({
  id: `grant-${memberId}-${productId}`,
  tenantId: 't1',
  memberId,
  productId,
  source: 'manual',
  startsAt: '2026-01-01T00:00:00.000Z',
  expiresAt: null,
  legacyId: null,
  createdAt: NOW,
});

const cursorOf = (row: Post): string => `${row.createdAt}|${row.id}`;

const postsRepository = (rows: Post[]) => {
  let calls = 0;
  const repo: PostRepository = {
    createPost: async (_tenantId, value) => value,
    findById: async () => null,
    findByIds: async () => [],
    countByAuthorSince: async () => 0,
    listRecentBodiesByAuthor: async () => [],
    listByAuthor: async () => [],
    listThreadsForContext: async () => ({ threads: [], nextCursor: null }),
    listThreadsForSpaces: async (tenantId, query) => {
      calls += 1;
      const roots = rows
        .filter(
          (row) =>
            row.tenantId === tenantId &&
            row.contextKind === 'space' &&
            query.spaceIds.includes(row.contextId) &&
            row.parentPostId === null &&
            (query.cursor === undefined || cursorOf(row) < query.cursor),
        )
        .sort((a, b) => cursorOf(b).localeCompare(cursorOf(a)));
      const page = roots.slice(0, query.limit);
      const last = page.at(-1);
      return {
        threads: page.map((row) => ({
          post: row,
          replyCount: rows.filter(
            (reply) => reply.rootPostId === row.rootPostId && reply.id !== row.id,
          ).length,
        })),
        nextCursor: roots[query.limit] !== undefined && last !== undefined ? cursorOf(last) : null,
      };
    },
    listReplies: async () => [],
    updateBody: async () => null,
    softDelete: async () => null,
    setPinned: async () => null,
    listPinnedForContext: async () => [],
    countPinnedForContext: async () => 0,
    latestRootPostAt: async () => new Map(),
    search: async () => [],
  };
  return { repo, callCount: () => calls };
};

const spacesRepository = (rows: Space[]): SpaceRepository => ({
  list: async (tenantId, options) =>
    rows.filter(
      (row) => row.tenantId === tenantId && (options?.includeArchived === true || row.archivedAt === null),
    ),
  findById: async (tenantId, id) => rows.find((row) => row.tenantId === tenantId && row.id === id) ?? null,
  findBySlug: async () => null,
  create: async () => undefined,
  update: async () => null,
  setArchived: async () => null,
  delete: async () => false,
  stats: async () => new Map(),
});

const grantsRepository = (rows: ProductGrant[]): ProductGrantRepository => ({
  findById: async () => null,
  findGrant: async () => null,
  createGrant: async () => false,
  setGrantWindow: async () => null,
  revokeGrant: async () => null,
  listForMemberWithProductNames: async () => [],
  listActiveForMember: async (tenantId, memberId, now) =>
    rows.filter(
      (row) =>
        row.tenantId === tenantId &&
        row.memberId === memberId &&
        row.startsAt <= now &&
        (row.expiresAt === null || row.expiresAt >= now),
    ),
  listGrantedProducts: async () => [],
});

const reactionsRepository = (summaries: Map<string, ReactionSummary[]>): PostReactionRepository => ({
  add: async () => true,
  remove: async () => true,
  summarize: async (_tenantId, input) =>
    new Map(input.postIds.map((postId) => [postId, summaries.get(postId) ?? []])),
});

const fixture = (input: {
  spaces: Space[];
  posts: Post[];
  grants?: ProductGrant[];
  reactions?: Map<string, ReactionSummary[]>;
}) => {
  const posts = postsRepository(input.posts);
  const deps: MemberHomeFeedDeps = {
    spaces: spacesRepository(input.spaces),
    grants: grantsRepository(input.grants ?? []),
    clock: { nowIso: () => NOW },
    posts: posts.repo,
    reactions: reactionsRepository(input.reactions ?? new Map()),
  };
  return { deps, feedCalls: posts.callCount };
};

const openSpaces = () => [space('s1', { name: 'Ogólna' }), space('s2', { name: 'Klub', position: 1 })];

describe('member home feed', () => {
  it('interleaves root posts from every accessible space newest first', async () => {
    const f = fixture({
      spaces: openSpaces(),
      posts: [
        post('p1', 's1', '2026-07-10T10:00:00.000Z'),
        post('p2', 's2', '2026-07-12T10:00:00.000Z'),
        post('p3', 's1', '2026-07-11T10:00:00.000Z'),
        post('p2-reply', 's2', '2026-07-13T10:00:00.000Z', {
          parentPostId: 'p2',
          rootPostId: 'p2',
        }),
      ],
    });

    const feed = await getMemberHomeFeed(ctx(), {}, f.deps);

    expect(feed).toMatchObject({ ok: true });
    if (!feed.ok) return;
    expect(feed.value.items.map((item) => item.id)).toEqual(['p2', 'p3', 'p1']);
    expect(feed.value.items.map((item) => item.spaceName)).toEqual(['Klub', 'Ogólna', 'Ogólna']);
    expect(feed.value.items[0]).toMatchObject({ spaceId: 's2', replyCount: 1 });
    expect(feed.value.nextCursor).toBeNull();
  });

  it('hides posts from spaces the member is not entitled to and keeps members-visibility rooms', async () => {
    const gated = space('s-club', { name: 'Klub', visibility: 'product', productIds: ['p-club'] });
    const f = fixture({
      spaces: [space('s1', { name: 'Ogólna' }), gated],
      posts: [
        post('p-open', 's1', '2026-07-10T10:00:00.000Z'),
        post('p-gated', 's-club', '2026-07-12T10:00:00.000Z'),
      ],
    });

    const feed = await getMemberHomeFeed(ctx(), {}, f.deps);

    expect(feed).toMatchObject({ ok: true });
    if (!feed.ok) return;
    expect(feed.value.items.map((item) => item.id)).toEqual(['p-open']);
  });

  it('lets an entitled member and staff see the gated room', async () => {
    const gated = space('s-club', { name: 'Klub', visibility: 'product', productIds: ['p-club'] });
    const entitled = fixture({
      spaces: [gated],
      posts: [post('p-gated', 's-club', '2026-07-12T10:00:00.000Z')],
      grants: [grant('m1', 'p-club')],
    });
    const staff = fixture({
      spaces: [gated],
      posts: [post('p-gated', 's-club', '2026-07-12T10:00:00.000Z')],
    });

    const asMember = await getMemberHomeFeed(ctx(), {}, entitled.deps);
    const asStaff = await getMemberHomeFeed(
      ctx({ staffRole: 'owner', memberId: null }),
      {},
      staff.deps,
    );

    expect(asMember).toMatchObject({ ok: true, value: { items: [{ id: 'p-gated' }] } });
    expect(asStaff).toMatchObject({ ok: true, value: { items: [{ id: 'p-gated' }] } });
  });

  it('continues on the cursor without repeating the first page', async () => {
    const f = fixture({
      spaces: openSpaces(),
      posts: [
        post('p1', 's1', '2026-07-10T10:00:00.000Z'),
        post('p2', 's2', '2026-07-11T10:00:00.000Z'),
        post('p3', 's1', '2026-07-12T10:00:00.000Z'),
      ],
    });

    const first = await getMemberHomeFeed(ctx(), { limit: 2 }, f.deps);
    expect(first).toMatchObject({ ok: true });
    if (!first.ok || first.value.nextCursor === null) throw new Error('expected a next cursor');
    const second = await getMemberHomeFeed(
      ctx(),
      { limit: 2, cursor: first.value.nextCursor },
      f.deps,
    );

    expect(first.value.items.map((item) => item.id)).toEqual(['p3', 'p2']);
    expect(second).toMatchObject({ ok: true });
    if (!second.ok) return;
    expect(second.value.items.map((item) => item.id)).toEqual(['p1']);
    expect(second.value.nextCursor).toBeNull();
  });

  it('masks a deleted root and carries its reaction summary', async () => {
    const f = fixture({
      spaces: [space('s1', { name: 'Ogólna' })],
      posts: [
        post('p-del', 's1', '2026-07-12T10:00:00.000Z', { deletedAt: '2026-07-13T10:00:00.000Z' }),
        post('p-live', 's1', '2026-07-11T10:00:00.000Z'),
      ],
      reactions: new Map([['p-live', [{ emoji: '👍', count: 2, viewerReacted: true }]]]),
    });

    const feed = await getMemberHomeFeed(ctx(), {}, f.deps);

    expect(feed).toMatchObject({ ok: true });
    if (!feed.ok) return;
    expect(feed.value.items[0]).toMatchObject({ id: 'p-del', body: 'Wpis usunięty' });
    expect(feed.value.items[1]?.reactions).toEqual([
      { emoji: '👍', count: 2, viewerReacted: true },
    ]);
  });

  it('never leaks another tenant\'s posts', async () => {
    const f = fixture({
      spaces: [space('s1', { name: 'Ogólna' }), space('s-other', { tenantId: 't2' })],
      posts: [
        post('p-mine', 's1', '2026-07-10T10:00:00.000Z'),
        post('p-theirs', 's1', '2026-07-12T10:00:00.000Z', { tenantId: 't2' }),
      ],
    });

    const feed = await getMemberHomeFeed(ctx(), {}, f.deps);

    expect(feed).toMatchObject({ ok: true, value: { items: [{ id: 'p-mine' }] } });
  });

  it('rejects a visitor who is neither member nor staff', async () => {
    const f = fixture({ spaces: openSpaces(), posts: [] });

    const feed = await getMemberHomeFeed(ctx({ memberId: null }), {}, f.deps);

    expect(feed).toMatchObject({ ok: false, error: { code: 'forbidden' } });
    expect(f.feedCalls()).toBe(0);
  });

  it('rejects an unparseable page size', async () => {
    const f = fixture({ spaces: openSpaces(), posts: [] });

    const feed = await getMemberHomeFeed(ctx(), { limit: 500 }, f.deps);

    expect(feed).toMatchObject({ ok: false, error: { code: 'validation' } });
    expect(f.feedCalls()).toBe(0);
  });

  it('returns an empty feed without touching the post repository when no space is accessible', async () => {
    const f = fixture({
      spaces: [space('s-club', { visibility: 'product', productIds: ['p-club'] })],
      posts: [post('p-gated', 's-club', '2026-07-12T10:00:00.000Z')],
    });

    const feed = await getMemberHomeFeed(ctx(), {}, f.deps);

    expect(feed).toMatchObject({ ok: true, value: { items: [], nextCursor: null } });
    expect(f.feedCalls()).toBe(0);
  });
});
