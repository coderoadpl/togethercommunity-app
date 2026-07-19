import { describe, expect, it } from 'vitest';

import {
  type Identity,
  type Member,
  type Notification,
  type Post,
  type PostContextKind,
  type Product,
  type ProductGrant,
  type ReactionEmoji,
  type ReactionSummary,
  type Space,
} from '@core/domain/index.js';

import type { Ctx } from '../context.js';
import type {
  Clock,
  CourseLessonRepository,
  CourseModuleRepository,
  CourseRepository,
  IdGenerator,
  NotificationChannelPort,
  NotificationRepository,
  PostReactionRepository,
  PostRepository,
  ProductGrantRepository,
  SpaceRepository,
  SpaceSubscription,
  SpaceSubscriptionRepository,
  TenantAccessReader,
  ThreadSubscription,
  ThreadSubscriptionRepository,
} from '../ports.js';
import { createPost, type CommunityDeps } from './community.js';
import {
  createSpace,
  deleteSpace,
  followSpace,
  getSpaceFeed,
  listSpacesForMember,
  reactToPost,
  unfollowSpace,
  unreactToPost,
  updateSpace,
  type SpacesDeps,
} from './spaces.js';

const NOW = '2026-07-15T10:00:00.000Z';

const identity = (overrides: Partial<Identity>): Identity => ({
  userId: 'u1',
  email: 'u1@example.com',
  name: 'User One',
  tenantId: 't1',
  tenantSlug: 'tenant',
  tenantName: 'Tenant',
  staffRole: null,
  memberId: 'm1',
  ...overrides,
});

const ctx = (overrides: Partial<Identity> = {}): Ctx => ({ identity: identity(overrides) });

const space = (overrides: Partial<Space>): Space => ({
  id: 's1',
  tenantId: 't1',
  slug: 's1',
  name: 'Space One',
  description: null,
  visibility: 'members',
  productIds: [],
  position: 0,
  createdAt: NOW,
  ...overrides,
});

const product = (id: string): Product => ({
  id,
  tenantId: 't1',
  title: id,
  description: '',
  priceCents: 0,
  currency: 'PLN',
  published: true,
  accessItems: [],
  legacyId: null,
  createdAt: NOW,
});

const grant = (memberId: string, productId: string, expiresAt: string | null = null): ProductGrant => ({
  id: `grant-${memberId}-${productId}`,
  tenantId: 't1',
  memberId,
  productId,
  source: 'manual',
  startsAt: '2026-01-01T00:00:00.000Z',
  expiresAt,
  legacyId: null,
  createdAt: NOW,
});

class SequenceIds implements IdGenerator {
  private next = 1;

  nextId(): string {
    const id = `id-${this.next}`;
    this.next += 1;
    return id;
  }
}

class MutableClock implements Clock {
  private tick = 0;

  nowIso(): string {
    const stamp = new Date(Date.parse(NOW) + this.tick * 1000).toISOString();
    this.tick += 1;
    return stamp;
  }
}

class FakeSpaces implements SpaceRepository {
  constructor(readonly rows: Space[]) {}

  async list(tenantId: string): Promise<Space[]> {
    return this.rows
      .filter((item) => item.tenantId === tenantId)
      .sort((a, b) => a.position - b.position);
  }

  async findById(tenantId: string, id: string): Promise<Space | null> {
    return this.rows.find((item) => item.tenantId === tenantId && item.id === id) ?? null;
  }

  async findBySlug(tenantId: string, slug: string): Promise<Space | null> {
    return this.rows.find((item) => item.tenantId === tenantId && item.slug === slug) ?? null;
  }

  async create(_tenantId: string, item: Space): Promise<void> {
    this.rows.push(item);
  }

  async update(tenantId: string, item: Space): Promise<Space | null> {
    const index = this.rows.findIndex((row) => row.tenantId === tenantId && row.id === item.id);
    if (index < 0) return null;
    this.rows[index] = item;
    return item;
  }

  async delete(tenantId: string, id: string): Promise<boolean> {
    const index = this.rows.findIndex((row) => row.tenantId === tenantId && row.id === id);
    if (index < 0) return false;
    this.rows.splice(index, 1);
    return true;
  }
}

class FakePosts implements PostRepository {
  readonly rows: Post[] = [];

  async createPost(_tenantId: string, post: Post): Promise<Post> {
    this.rows.push(post);
    return post;
  }

  async findById(tenantId: string, id: string): Promise<Post | null> {
    return this.rows.find((post) => post.tenantId === tenantId && post.id === id) ?? null;
  }

  async listThreadsForContext(
    tenantId: string,
    query: {
      contextKind: PostContextKind;
      contextId: string;
      cursor?: string;
      limit: number;
      order?: 'asc' | 'desc';
    },
  ): Promise<{ threads: Array<{ post: Post; replyCount: number }>; nextCursor: string | null }> {
    const descending = query.order === 'desc';
    const roots = this.rows
      .filter(
        (post) =>
          post.tenantId === tenantId &&
          post.contextKind === query.contextKind &&
          post.contextId === query.contextId &&
          post.parentPostId === null &&
          (query.cursor === undefined ||
            (descending ? post.createdAt < query.cursor : post.createdAt > query.cursor)),
      )
      .sort((a, b) =>
        descending ? b.createdAt.localeCompare(a.createdAt) : a.createdAt.localeCompare(b.createdAt),
      );
    const page = roots.slice(0, query.limit);
    const overflow = roots[query.limit];
    return {
      threads: page.map((post) => ({
        post,
        replyCount: this.rows.filter(
          (reply) => reply.tenantId === tenantId && reply.rootPostId === post.rootPostId && reply.id !== post.id,
        ).length,
      })),
      nextCursor: overflow ? (page.at(-1)?.createdAt ?? null) : null,
    };
  }

  async listReplies(tenantId: string, rootPostId: string): Promise<Post[]> {
    return this.rows.filter(
      (post) => post.tenantId === tenantId && post.rootPostId === rootPostId && post.parentPostId !== null,
    );
  }

  async updateBody(): Promise<Post | null> {
    return null;
  }

  async softDelete(tenantId: string, input: { id: string; deletedAt: string }): Promise<Post | null> {
    const post = await this.findById(tenantId, input.id);
    if (!post) return null;
    const next = { ...post, deletedAt: input.deletedAt };
    const index = this.rows.findIndex((item) => item.id === post.id);
    this.rows[index] = next;
    return next;
  }

  async search(): Promise<[]> {
    return [];
  }
}

class FakeReactions implements PostReactionRepository {
  readonly rows: Array<{ tenantId: string; postId: string; userId: string; emoji: ReactionEmoji }> = [];

  async add(
    tenantId: string,
    input: { postId: string; userId: string; emoji: ReactionEmoji; createdAt: string },
  ): Promise<boolean> {
    const exists = this.rows.some(
      (row) => row.postId === input.postId && row.userId === input.userId && row.emoji === input.emoji,
    );
    if (exists) return false;
    this.rows.push({ tenantId, postId: input.postId, userId: input.userId, emoji: input.emoji });
    return true;
  }

  async remove(
    _tenantId: string,
    input: { postId: string; userId: string; emoji: ReactionEmoji },
  ): Promise<boolean> {
    const index = this.rows.findIndex(
      (row) => row.postId === input.postId && row.userId === input.userId && row.emoji === input.emoji,
    );
    if (index < 0) return false;
    this.rows.splice(index, 1);
    return true;
  }

  async summarize(
    tenantId: string,
    input: { postIds: string[]; viewerUserId: string },
  ): Promise<Map<string, ReactionSummary[]>> {
    const byPost = new Map<string, ReactionSummary[]>();
    for (const postId of input.postIds) {
      const rows = this.rows.filter((row) => row.tenantId === tenantId && row.postId === postId);
      const emojis = [...new Set(rows.map((row) => row.emoji))];
      const summaries = emojis.map(
        (emoji): ReactionSummary => ({
          emoji,
          count: rows.filter((row) => row.emoji === emoji).length,
          viewerReacted: rows.some((row) => row.emoji === emoji && row.userId === input.viewerUserId),
        }),
      );
      if (summaries.length > 0) byPost.set(postId, summaries);
    }
    return byPost;
  }
}

class FakeSpaceSubscriptions implements SpaceSubscriptionRepository {
  readonly rows: SpaceSubscription[] = [];

  async follow(tenantId: string, input: { userId: string; spaceId: string; createdAt: string }): Promise<void> {
    const exists = this.rows.some(
      (item) => item.tenantId === tenantId && item.userId === input.userId && item.spaceId === input.spaceId,
    );
    if (!exists) this.rows.push({ tenantId, userId: input.userId, spaceId: input.spaceId, createdAt: input.createdAt });
  }

  async unfollow(tenantId: string, input: { userId: string; spaceId: string }): Promise<boolean> {
    const index = this.rows.findIndex(
      (item) => item.tenantId === tenantId && item.userId === input.userId && item.spaceId === input.spaceId,
    );
    if (index < 0) return false;
    this.rows.splice(index, 1);
    return true;
  }

  async listFollowersForSpace(tenantId: string, spaceId: string): Promise<SpaceSubscription[]> {
    return this.rows.filter((item) => item.tenantId === tenantId && item.spaceId === spaceId);
  }

  async listForUser(tenantId: string, input: { userId: string; spaceIds: string[] }): Promise<SpaceSubscription[]> {
    return this.rows.filter(
      (item) => item.tenantId === tenantId && item.userId === input.userId && input.spaceIds.includes(item.spaceId),
    );
  }
}

class FakeThreadSubscriptions implements ThreadSubscriptionRepository {
  readonly rows: ThreadSubscription[] = [];

  async upsert(
    tenantId: string,
    input: { userId: string; rootPostId: string; createdAt: string },
  ): Promise<ThreadSubscription> {
    const existing = this.rows.find(
      (item) => item.tenantId === tenantId && item.userId === input.userId && item.rootPostId === input.rootPostId,
    );
    if (existing) return existing;
    const row = { tenantId, userId: input.userId, rootPostId: input.rootPostId, createdAt: input.createdAt, mutedAt: null };
    this.rows.push(row);
    return row;
  }

  async mute(): Promise<ThreadSubscription | null> {
    return null;
  }

  async listSubscribersForRoot(tenantId: string, rootPostId: string): Promise<ThreadSubscription[]> {
    return this.rows.filter((item) => item.tenantId === tenantId && item.rootPostId === rootPostId);
  }

  async listForUser(tenantId: string, input: { userId: string; rootPostIds: string[] }): Promise<ThreadSubscription[]> {
    return this.rows.filter(
      (item) => item.tenantId === tenantId && item.userId === input.userId && input.rootPostIds.includes(item.rootPostId),
    );
  }
}

class FakeNotifications implements NotificationRepository {
  readonly rows: Notification[] = [];

  async insert(_tenantId: string, notification: Notification): Promise<Notification> {
    this.rows.push(notification);
    return notification;
  }

  async listForRecipient(): Promise<{ notifications: Notification[]; nextCursor: string | null }> {
    return { notifications: this.rows, nextCursor: null };
  }

  async markRead(): Promise<Notification | null> {
    return null;
  }

  async markAllRead(): Promise<number> {
    return 0;
  }

  async unreadCount(): Promise<number> {
    return 0;
  }
}

const emptyCourses: CourseRepository = {
  list: async () => [],
  findById: async () => null,
  findByIds: async () => [],
  create: async () => undefined,
  update: async () => null,
  delete: async () => false,
};

const emptyModules: CourseModuleRepository = {
  list: async () => [],
  findById: async () => null,
  findByIds: async () => [],
  create: async () => undefined,
  update: async () => null,
  delete: async () => false,
};

const emptyLessons: CourseLessonRepository = {
  list: async () => [],
  findById: async () => null,
  findByIds: async () => [],
  create: async () => undefined,
  update: async () => null,
  delete: async () => false,
};

const grantRepo = (grants: ProductGrant[], products: Product[]): ProductGrantRepository => ({
  findById: async () => null,
  findGrant: async () => null,
  createGrant: async () => true,
  setGrantWindow: async () => null,
  revokeGrant: async () => null,
  listForMemberWithProductNames: async () => [],
  listActiveForMember: async (tenantId, memberId, now) =>
    grants.filter(
      (item) =>
        item.tenantId === tenantId &&
        item.memberId === memberId &&
        item.startsAt <= now &&
        (item.expiresAt === null || item.expiresAt >= now),
    ),
  listGrantedProducts: async (tenantId, memberId) => {
    const ids = new Set(
      grants.filter((item) => item.tenantId === tenantId && item.memberId === memberId).map((item) => item.productId),
    );
    return products.filter((item) => item.tenantId === tenantId && ids.has(item.id));
  },
});

interface Fixture {
  deps: SpacesDeps & CommunityDeps;
  posts: FakePosts;
  reactions: FakeReactions;
  spaceSubscriptions: FakeSpaceSubscriptions;
  notifications: FakeNotifications;
  delivered: string[];
}

const MEMBERS: Member[] = [
  { id: 'm1', tenantId: 't1', userId: 'u1', email: 'u1@example.com', displayName: null, tags: [], marketingConsents: {}, externalCustomerIds: {}, createdAt: NOW },
  { id: 'm2', tenantId: 't1', userId: 'u2', email: 'u2@example.com', displayName: null, tags: [], marketingConsents: {}, externalCustomerIds: {}, createdAt: NOW },
  { id: 'm5', tenantId: 't1', userId: 'u5', email: 'u5@example.com', displayName: null, tags: [], marketingConsents: {}, externalCustomerIds: {}, createdAt: NOW },
];

const fixture = (input: {
  spaces: Space[];
  grants?: ProductGrant[];
  products?: Product[];
  staffUserIds?: string[];
}): Fixture => {
  const posts = new FakePosts();
  const reactions = new FakeReactions();
  const spaceSubscriptions = new FakeSpaceSubscriptions();
  const notifications = new FakeNotifications();
  const delivered: string[] = [];
  const channel: NotificationChannelPort = {
    deliver: async (notification) => {
      delivered.push(notification.recipientUserId);
      return { ok: true, value: undefined };
    },
  };
  const tenantAccess: TenantAccessReader = {
    listTenantsForStaff: async () => [],
    findStaffGrant: async (userId, lookup) =>
      'tenantId' in lookup && lookup.tenantId === 't1' && (input.staffUserIds ?? []).includes(userId)
        ? { tenant: { id: 't1', slug: 'tenant', name: 'Tenant', contentVersion: 1 }, staffRole: 'admin' }
        : null,
    findMember: async (userId, tenantId) =>
      MEMBERS.find((member) => member.tenantId === tenantId && member.userId === userId) ?? null,
  };
  const deps: SpacesDeps & CommunityDeps = {
    spaces: new FakeSpaces(input.spaces),
    posts,
    reactions,
    spaceSubscriptions,
    threadSubscriptions: new FakeThreadSubscriptions(),
    notifications,
    notificationChannels: [channel],
    courses: emptyCourses,
    modules: emptyModules,
    lessons: emptyLessons,
    grants: grantRepo(input.grants ?? [], input.products ?? []),
    tenantAccess,
    links: {
      lessonDiscussionUrl: ({ lessonId }) => `http://tenant.localhost/my/lessons/${lessonId}`,
      spaceUrl: ({ spaceId }) => `http://tenant.localhost/my/spaces/${spaceId}`,
    },
    ids: new SequenceIds(),
    clock: new MutableClock(),
  };
  return { deps, posts, reactions, spaceSubscriptions, notifications, delivered };
};

const membersSpace = space({ id: 's-open', slug: 'open', name: 'Otwarta', visibility: 'members' });
const gatedSpace = space({
  id: 's-club',
  slug: 'club',
  name: 'Klub',
  visibility: 'product',
  productIds: ['p-club'],
  position: 1,
});

describe('space visibility', () => {
  const spaces = () => [space({ ...membersSpace }), space({ ...gatedSpace })];

  it('shows a member without the product only members-visibility spaces', async () => {
    const f = fixture({ spaces: spaces() });
    const listed = await listSpacesForMember(ctx(), f.deps);
    expect(listed.ok).toBe(true);
    if (!listed.ok) return;
    expect(listed.value.map((item) => item.id)).toEqual(['s-open']);
  });

  it('shows a member with an active grant the product-gated space', async () => {
    const f = fixture({
      spaces: spaces(),
      grants: [grant('m1', 'p-club')],
      products: [product('p-club')],
    });
    const listed = await listSpacesForMember(ctx(), f.deps);
    expect(listed.ok).toBe(true);
    if (!listed.ok) return;
    expect(listed.value.map((item) => item.id)).toEqual(['s-open', 's-club']);
  });

  it('hides the product-gated space once the grant expired', async () => {
    const f = fixture({
      spaces: spaces(),
      grants: [grant('m1', 'p-club', '2026-07-14T00:00:00.000Z')],
      products: [product('p-club')],
    });
    const listed = await listSpacesForMember(ctx(), f.deps);
    expect(listed).toMatchObject({ ok: true });
    if (!listed.ok) return;
    expect(listed.value.map((item) => item.id)).toEqual(['s-open']);
    const feed = await getSpaceFeed(ctx(), { spaceId: 's-club' }, f.deps);
    expect(feed).toMatchObject({ ok: false, error: { code: 'forbidden' } });
    const posted = await createPost(ctx(), { contextKind: 'space', contextId: 's-club', body: 'hi' }, f.deps);
    expect(posted).toMatchObject({ ok: false, error: { code: 'forbidden' } });
  });

  it('always admits staff, and rejects visitors who are neither member nor staff', async () => {
    const f = fixture({ spaces: spaces() });
    const staffListed = await listSpacesForMember(ctx({ staffRole: 'owner', memberId: null }), f.deps);
    expect(staffListed.ok).toBe(true);
    if (!staffListed.ok) return;
    expect(staffListed.value.map((item) => item.id)).toEqual(['s-open', 's-club']);
    const visitor = await listSpacesForMember(ctx({ memberId: null }), f.deps);
    expect(visitor).toMatchObject({ ok: false, error: { code: 'forbidden' } });
  });

  it('lets an entitled member see and post to the gated space', async () => {
    const f = fixture({
      spaces: spaces(),
      grants: [grant('m1', 'p-club')],
      products: [product('p-club')],
    });
    const posted = await createPost(ctx(), { contextKind: 'space', contextId: 's-club', body: 'hej' }, f.deps);
    expect(posted).toMatchObject({ ok: true, value: { contextKind: 'space', contextId: 's-club' } });
  });
});

describe('space CRUD', () => {
  it('is staff-only and rejects duplicate slugs', async () => {
    const f = fixture({ spaces: [space({ ...membersSpace })] });
    const denied = await createSpace(ctx(), { slug: 'x', name: 'X', visibility: 'members' }, f.deps);
    expect(denied).toMatchObject({ ok: false, error: { code: 'forbidden' } });
    const staff = ctx({ staffRole: 'owner', memberId: null });
    const duplicate = await createSpace(staff, { slug: 'open', name: 'Y', visibility: 'members' }, f.deps);
    expect(duplicate).toMatchObject({ ok: false, error: { code: 'conflict' } });
    const created = await createSpace(staff, { slug: 'x', name: 'X', visibility: 'members' }, f.deps);
    expect(created).toMatchObject({ ok: true, value: { slug: 'x', position: 1 } });
  });

  it('requires products for product-gated spaces and round-trips update/delete', async () => {
    const f = fixture({ spaces: [] });
    const staff = ctx({ staffRole: 'owner', memberId: null });
    const invalid = await createSpace(staff, { slug: 'club', name: 'Klub', visibility: 'product' }, f.deps);
    expect(invalid).toMatchObject({ ok: false, error: { code: 'validation' } });
    const created = await createSpace(
      staff,
      { slug: 'club', name: 'Klub', visibility: 'product', productIds: ['p1'] },
      f.deps,
    );
    expect(created.ok).toBe(true);
    if (!created.ok) return;
    const updated = await updateSpace(staff, { id: created.value.id, name: 'Klub 2.0' }, f.deps);
    expect(updated).toMatchObject({ ok: true, value: { name: 'Klub 2.0', visibility: 'product' } });
    const deleted = await deleteSpace(staff, { id: created.value.id }, f.deps);
    expect(deleted).toMatchObject({ ok: true, value: { spaceId: created.value.id } });
    expect(await deleteSpace(staff, { id: created.value.id }, f.deps)).toMatchObject({
      ok: false,
      error: { code: 'not_found' },
    });
  });
});

describe('space feed', () => {
  it('paginates newest-first with reply counts and reaction summaries', async () => {
    const f = fixture({ spaces: [space({ ...membersSpace })] });
    const bodies = ['pierwszy', 'drugi', 'trzeci'];
    for (const body of bodies) {
      const created = await createPost(ctx(), { contextKind: 'space', contextId: 's-open', body }, f.deps);
      expect(created.ok).toBe(true);
    }
    const roots = f.posts.rows.filter((post) => post.parentPostId === null);
    const first = roots[0];
    if (!first) throw new Error('no root post');
    await createPost(
      ctx({ userId: 'u2', memberId: 'm2' }),
      { contextKind: 'space', contextId: 's-open', parentPostId: first.id, body: 'odpowiedź' },
      f.deps,
    );
    await reactToPost(ctx({ userId: 'u2', memberId: 'm2' }), { postId: first.id, emoji: '👍' }, f.deps);

    const pageOne = await getSpaceFeed(ctx(), { spaceId: 's-open', limit: 2 }, f.deps);
    expect(pageOne.ok).toBe(true);
    if (!pageOne.ok) return;
    expect(pageOne.value.items.map((item) => item.body)).toEqual(['trzeci', 'drugi']);
    expect(pageOne.value.nextCursor).not.toBeNull();

    const pageTwo = await getSpaceFeed(
      ctx(),
      { spaceId: 's-open', limit: 2, cursor: pageOne.value.nextCursor ?? '' },
      f.deps,
    );
    expect(pageTwo.ok).toBe(true);
    if (!pageTwo.ok) return;
    expect(pageTwo.value.items.map((item) => item.body)).toEqual(['pierwszy']);
    expect(pageTwo.value.nextCursor).toBeNull();
    const firstItem = pageTwo.value.items[0];
    expect(firstItem?.replyCount).toBe(1);
    expect(firstItem?.reactions).toEqual([{ emoji: '👍', count: 1, viewerReacted: false }]);
  });
});

describe('reactions', () => {
  it('is idempotent for both react and unreact and keeps counts per emoji', async () => {
    const f = fixture({ spaces: [space({ ...membersSpace })] });
    const created = await createPost(ctx(), { contextKind: 'space', contextId: 's-open', body: 'post' }, f.deps);
    expect(created.ok).toBe(true);
    if (!created.ok) return;
    const postId = created.value.id;

    await reactToPost(ctx(), { postId, emoji: '👍' }, f.deps);
    const again = await reactToPost(ctx(), { postId, emoji: '👍' }, f.deps);
    expect(again).toMatchObject({
      ok: true,
      value: { reactions: [{ emoji: '👍', count: 1, viewerReacted: true }] },
    });

    const other = await reactToPost(ctx({ userId: 'u2', memberId: 'm2' }), { postId, emoji: '👍' }, f.deps);
    expect(other).toMatchObject({ ok: true, value: { reactions: [{ emoji: '👍', count: 2 }] } });

    const removed = await unreactToPost(ctx(), { postId, emoji: '👍' }, f.deps);
    expect(removed).toMatchObject({
      ok: true,
      value: { reactions: [{ emoji: '👍', count: 1, viewerReacted: false }] },
    });
    const removedAgain = await unreactToPost(ctx(), { postId, emoji: '👍' }, f.deps);
    expect(removedAgain).toMatchObject({ ok: true, value: { reactions: [{ emoji: '👍', count: 1 }] } });
  });

  it('rejects reactions on posts in inaccessible contexts and unknown emojis', async () => {
    const f = fixture({
      spaces: [space({ ...gatedSpace })],
      grants: [grant('m2', 'p-club')],
      products: [product('p-club')],
    });
    const created = await createPost(
      ctx({ userId: 'u2', memberId: 'm2' }),
      { contextKind: 'space', contextId: 's-club', body: 'klubowy' },
      f.deps,
    );
    expect(created.ok).toBe(true);
    if (!created.ok) return;
    const denied = await reactToPost(ctx(), { postId: created.value.id, emoji: '👍' }, f.deps);
    expect(denied).toMatchObject({ ok: false, error: { code: 'forbidden' } });
    const invalid = await reactToPost(
      ctx({ userId: 'u2', memberId: 'm2' }),
      { postId: created.value.id, emoji: '🤖' },
      f.deps,
    );
    expect(invalid).toMatchObject({ ok: false, error: { code: 'validation' } });
  });
});

describe('space-post notifications', () => {
  it('notifies followers of a new root post, minus the author, gated by entitlement', async () => {
    const f = fixture({
      spaces: [space({ ...gatedSpace })],
      grants: [grant('m1', 'p-club'), grant('m2', 'p-club'), grant('m5', 'p-club', '2026-07-14T00:00:00.000Z')],
      products: [product('p-club')],
      staffUserIds: ['u9'],
    });
    for (const userId of ['u1', 'u2', 'u5', 'u9']) {
      await f.spaceSubscriptions.follow('t1', { userId, spaceId: 's-club', createdAt: NOW });
    }

    const created = await createPost(ctx(), { contextKind: 'space', contextId: 's-club', body: 'nowy wpis' }, f.deps);
    expect(created.ok).toBe(true);

    expect(f.delivered.sort()).toEqual(['u2', 'u9']);
    expect(f.notifications.rows.map((notification) => notification.kind)).toEqual(['space-post', 'space-post']);
    expect(f.notifications.rows[0]?.payload).toMatchObject({
      contextKind: 'space',
      contextId: 's-club',
      courseId: null,
      lessonName: 'Klub',
      snippet: 'nowy wpis',
    });
  });

  it('does not fan out space-post notifications for replies (thread machinery owns those)', async () => {
    const f = fixture({ spaces: [space({ ...membersSpace })] });
    await f.spaceSubscriptions.follow('t1', { userId: 'u2', spaceId: 's-open', createdAt: NOW });
    const root = await createPost(ctx(), { contextKind: 'space', contextId: 's-open', body: 'root' }, f.deps);
    expect(root.ok).toBe(true);
    if (!root.ok) return;
    expect(f.delivered).toEqual(['u2']);
    f.delivered.length = 0;

    const reply = await createPost(
      ctx({ userId: 'u2', memberId: 'm2' }),
      { contextKind: 'space', contextId: 's-open', parentPostId: root.value.id, body: 'reply' },
      f.deps,
    );
    expect(reply.ok).toBe(true);
    expect(f.notifications.rows.filter((notification) => notification.kind === 'space-post')).toHaveLength(1);
    const threadReplies = f.notifications.rows.filter((notification) => notification.kind === 'thread-reply');
    expect(threadReplies.map((notification) => notification.recipientUserId)).toEqual(['u1']);
    expect(threadReplies[0]?.payload).toMatchObject({ contextKind: 'space', lessonName: 'Otwarta' });
  });
});

describe('space follow toggle', () => {
  it('follows and unfollows idempotently and reflects state in the list', async () => {
    const f = fixture({ spaces: [space({ ...membersSpace })] });
    await followSpace(ctx(), { spaceId: 's-open' }, f.deps);
    await followSpace(ctx(), { spaceId: 's-open' }, f.deps);
    let listed = await listSpacesForMember(ctx(), f.deps);
    expect(listed).toMatchObject({ ok: true });
    if (!listed.ok) return;
    expect(listed.value[0]?.isFollowing).toBe(true);
    await unfollowSpace(ctx(), { spaceId: 's-open' }, f.deps);
    listed = await listSpacesForMember(ctx(), f.deps);
    if (!listed.ok) return;
    expect(listed.value[0]?.isFollowing).toBe(false);
  });
});
