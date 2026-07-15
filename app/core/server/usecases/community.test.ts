import { describe, expect, it } from 'vitest';

import {
  computeCourseModuleName,
  type Course,
  type CourseLesson,
  type CourseModule,
  type Identity,
  type Member,
  type Notification,
  type Post,
  type Product,
  type ProductGrant,
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
  PostRepository,
  ProductGrantRepository,
  TenantAccessReader,
  ThreadSubscription,
  ThreadSubscriptionRepository,
} from '../ports.js';
import {
  createPost,
  deletePost,
  listDiscussion,
  listNotifications,
  markAllNotificationsRead,
  markNotificationRead,
  muteThread,
  searchPosts,
  subscribeThread,
  unreadNotificationCount,
  type CommunityDeps,
} from './community.js';

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

const course: Course = {
  id: 'c1',
  tenantId: 't1',
  name: 'Course',
  description: '',
  imageUrl: null,
  moduleOrder: ['mod1'],
  legacyId: null,
  createdAt: NOW,
};

const moduleRow: CourseModule = {
  id: 'mod1',
  tenantId: 't1',
  courseIds: ['c1'],
  title: 'Module',
  prefix: null,
  name: computeCourseModuleName(null, 'Module'),
  chapters: [
    {
      id: 'ch1',
      name: 'Chapter',
      contents: [
        { id: 'content-l1', name: 'Lesson 1', lessonId: 'l1' },
        { id: 'content-l2', name: 'Lesson 2', lessonId: 'l2' },
      ],
    },
  ],
  legacyId: null,
  createdAt: NOW,
};

const lesson = (id: string): CourseLesson => ({
  id,
  tenantId: 't1',
  name: id,
  contents: [],
  legacyId: null,
  createdAt: NOW,
});

const product = (id: string, accessItems: Product['accessItems']): Product => ({
  id,
  tenantId: 't1',
  title: id,
  description: '',
  priceCents: 0,
  currency: 'PLN',
  published: true,
  accessItems,
  legacyId: null,
  createdAt: NOW,
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

class SequenceIds implements IdGenerator {
  private next = 1;

  nextId(): string {
    const id = `id-${this.next}`;
    this.next += 1;
    return id;
  }
}

const clock: Clock = { nowIso: () => NOW };

const coursesRepo: CourseRepository = {
  list: async (tenantId) => (tenantId === 't1' ? [course] : []),
  findById: async (_tenantId, id) => (id === course.id ? course : null),
  findByIds: async () => [course],
  create: async () => undefined,
  update: async () => null,
  delete: async () => false,
};

const modulesRepo: CourseModuleRepository = {
  list: async (tenantId) => (tenantId === 't1' ? [moduleRow] : []),
  findById: async (_tenantId, id) => (id === moduleRow.id ? moduleRow : null),
  findByIds: async () => [moduleRow],
  create: async () => undefined,
  update: async () => null,
  delete: async () => false,
};

const lessonsRepo: CourseLessonRepository = {
  list: async (tenantId) => (tenantId === 't1' ? [lesson('l1'), lesson('l2')] : []),
  findById: async (tenantId, id) => (tenantId === 't1' && ['l1', 'l2'].includes(id) ? lesson(id) : null),
  findByIds: async (_tenantId, ids) => ids.map(lesson),
  create: async () => undefined,
  update: async () => null,
  delete: async () => false,
};

const grantRepo = (grants: ProductGrant[], products: Product[]): ProductGrantRepository => ({
  findById: async (_tenantId, id) => grants.find((item) => item.id === id) ?? null,
  findGrant: async () => null,
  createGrant: async () => true,
  setGrantWindow: async () => null,
  revokeGrant: async () => null,
  listForMemberWithProductNames: async () => [],
  listActiveForMember: async (tenantId, memberId) =>
    grants.filter((item) => item.tenantId === tenantId && item.memberId === memberId),
  listGrantedProducts: async (tenantId, memberId) => {
    const ids = new Set(
      grants.filter((item) => item.tenantId === tenantId && item.memberId === memberId).map((item) => item.productId),
    );
    return products.filter((item) => item.tenantId === tenantId && ids.has(item.id));
  },
});

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
    query: { contextKind: 'lesson'; contextId: string; cursor?: string; limit: number },
  ): Promise<{ threads: Array<{ post: Post; replyCount: number }>; nextCursor: string | null }> {
    const roots = this.rows
      .filter(
        (post) =>
          post.tenantId === tenantId &&
          post.contextKind === query.contextKind &&
          post.contextId === query.contextId &&
          post.parentPostId === null,
      )
      .slice(0, query.limit);
    return {
      threads: roots.map((post) => ({
        post,
        replyCount: this.rows.filter((reply) => reply.tenantId === tenantId && reply.rootPostId === post.rootPostId && reply.id !== post.id).length,
      })),
      nextCursor: null,
    };
  }

  async listReplies(tenantId: string, rootPostId: string): Promise<Post[]> {
    return this.rows.filter((post) => post.tenantId === tenantId && post.rootPostId === rootPostId && post.parentPostId !== null);
  }

  async updateBody(tenantId: string, input: { id: string; body: string; editedAt: string }): Promise<Post | null> {
    const post = await this.findById(tenantId, input.id);
    if (!post) return null;
    const next = { ...post, body: input.body, editedAt: input.editedAt };
    this.replace(next);
    return next;
  }

  async softDelete(tenantId: string, input: { id: string; deletedAt: string }): Promise<Post | null> {
    const post = await this.findById(tenantId, input.id);
    if (!post) return null;
    const next = { ...post, deletedAt: input.deletedAt };
    this.replace(next);
    return next;
  }

  async search(tenantId: string, query: { query: string; lessonIds: string[]; limit: number }) {
    return this.rows
      .filter(
        (post) =>
          post.tenantId === tenantId &&
          post.deletedAt === null &&
          query.lessonIds.includes(post.contextId) &&
          post.body.toLowerCase().includes(query.query.toLowerCase()),
      )
      .slice(0, query.limit)
      .map((post) => ({ post, lessonId: post.contextId, snippet: post.body }));
  }

  private replace(post: Post): void {
    const index = this.rows.findIndex((item) => item.id === post.id);
    if (index >= 0) this.rows[index] = post;
  }
}

class FakeSubscriptions implements ThreadSubscriptionRepository {
  readonly rows: ThreadSubscription[] = [];

  async upsert(tenantId: string, input: { userId: string; rootPostId: string; createdAt: string }): Promise<ThreadSubscription> {
    const existing = this.rows.find(
      (item) => item.tenantId === tenantId && item.userId === input.userId && item.rootPostId === input.rootPostId,
    );
    if (existing) {
      existing.mutedAt = null;
      return existing;
    }
    const row = { tenantId, userId: input.userId, rootPostId: input.rootPostId, createdAt: input.createdAt, mutedAt: null };
    this.rows.push(row);
    return row;
  }

  async mute(tenantId: string, input: { userId: string; rootPostId: string; mutedAt: string }): Promise<ThreadSubscription | null> {
    const existing = this.rows.find(
      (item) => item.tenantId === tenantId && item.userId === input.userId && item.rootPostId === input.rootPostId,
    );
    if (!existing) return null;
    existing.mutedAt = input.mutedAt;
    return existing;
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

  async listForRecipient(
    tenantId: string,
    query: { recipientUserId: string; cursor?: string; limit: number },
  ): Promise<{ notifications: Notification[]; nextCursor: string | null }> {
    return {
      notifications: this.rows
        .filter((item) => item.tenantId === tenantId && item.recipientUserId === query.recipientUserId)
        .slice(0, query.limit),
      nextCursor: null,
    };
  }

  async markRead(tenantId: string, input: { id: string; recipientUserId: string; readAt: string }): Promise<Notification | null> {
    const notification = this.rows.find(
      (item) => item.tenantId === tenantId && item.id === input.id && item.recipientUserId === input.recipientUserId,
    );
    if (!notification) return null;
    const next = { ...notification, readAt: input.readAt };
    this.replace(next);
    return next;
  }

  async markAllRead(tenantId: string, input: { recipientUserId: string; readAt: string }): Promise<number> {
    let count = 0;
    for (const notification of [...this.rows]) {
      if (notification.tenantId === tenantId && notification.recipientUserId === input.recipientUserId && notification.readAt === null) {
        this.replace({ ...notification, readAt: input.readAt });
        count += 1;
      }
    }
    return count;
  }

  async unreadCount(tenantId: string, recipientUserId: string): Promise<number> {
    return this.rows.filter((item) => item.tenantId === tenantId && item.recipientUserId === recipientUserId && item.readAt === null).length;
  }

  private replace(notification: Notification): void {
    const index = this.rows.findIndex((item) => item.id === notification.id);
    if (index >= 0) this.rows[index] = notification;
  }
}

const deps = (accessProducts: Product[], accessGrants: ProductGrant[] = []): CommunityDeps => {
  const members: Member[] = [
    { id: 'm1', tenantId: 't1', userId: 'u1', email: 'u1@example.com', displayName: null, tags: [], marketingConsents: {}, externalCustomerIds: {}, createdAt: NOW },
    { id: 'm2', tenantId: 't1', userId: 'u2', email: 'u2@example.com', displayName: null, tags: [], marketingConsents: {}, externalCustomerIds: {}, createdAt: NOW },
    { id: 'm3', tenantId: 't1', userId: 'u3', email: 'u3@example.com', displayName: null, tags: [], marketingConsents: {}, externalCustomerIds: {}, createdAt: NOW },
  ];
  const tenantAccess: TenantAccessReader = {
    listTenantsForStaff: async () => [],
    findStaffGrant: async () => null,
    findMember: async (userId, tenantId) => members.find((member) => member.tenantId === tenantId && member.userId === userId) ?? null,
  };
  return {
    posts: new FakePosts(),
    threadSubscriptions: new FakeSubscriptions(),
    notifications: new FakeNotifications(),
    notificationChannels: [],
    courses: coursesRepo,
    modules: modulesRepo,
    lessons: lessonsRepo,
    grants: grantRepo(accessGrants, accessProducts),
    tenantAccess,
    links: {
      lessonDiscussionUrl: ({ tenantSlug, courseId, lessonId }) =>
        `http://${tenantSlug ?? 'app'}.localhost/my/courses/${courseId ?? 'none'}/lessons/${lessonId}`,
    },
    ids: new SequenceIds(),
    clock,
  };
};

const allAccess = product('all', [{ level: 'course', courseId: 'c1' }]);
const previewAccess = product('preview', [{ level: 'lessons', courseId: 'c1', lessonIds: ['l2'] }]);

describe('community use-cases', () => {
  it('caps reply depth at 3', async () => {
    const d = deps([allAccess], [grant('m1', 'all')]);
    const root = await createPost(ctx(), { contextKind: 'lesson', contextId: 'l1', body: 'root' }, d);
    expect(root.ok).toBe(true);
    if (!root.ok) return;
    const second = await createPost(ctx(), { contextKind: 'lesson', contextId: 'l1', parentPostId: root.value.id, body: 'reply' }, d);
    expect(second.ok).toBe(true);
    if (!second.ok) return;
    const third = await createPost(ctx(), { contextKind: 'lesson', contextId: 'l1', parentPostId: second.value.id, body: 'nested' }, d);
    expect(third.ok).toBe(true);
    if (!third.ok) return;
    const fourth = await createPost(ctx(), { contextKind: 'lesson', contextId: 'l1', parentPostId: third.value.id, body: 'too deep' }, d);
    expect(fourth).toMatchObject({ ok: false, error: { code: 'validation' } });
  });

  it('guards lesson access and allows free-preview lesson grants', async () => {
    const d = deps([previewAccess], [grant('m1', 'preview')]);
    await expect(createPost(ctx(), { contextKind: 'lesson', contextId: 'l2', body: 'preview' }, d)).resolves.toMatchObject({ ok: true });
    await expect(createPost(ctx(), { contextKind: 'lesson', contextId: 'l1', body: 'locked' }, d)).resolves.toMatchObject({
      ok: false,
      error: { code: 'forbidden' },
    });
  });

  it('fan-out skips reply author and muted subscribers, and auto-subscribes reply author', async () => {
    const d = deps([allAccess], [grant('m1', 'all'), grant('m2', 'all'), grant('m3', 'all')]);
    const delivered: string[] = [];
    const channel: NotificationChannelPort = {
      deliver: async (notification) => {
        delivered.push(notification.recipientUserId);
        return { ok: true, value: undefined };
      },
    };
    d.notificationChannels.push(channel);
    const root = await createPost(ctx({ userId: 'u1', memberId: 'm1', name: 'One' }), { contextKind: 'lesson', contextId: 'l1', body: 'root' }, d);
    if (!root.ok) throw new Error('root failed');
    await subscribeThread(ctx({ userId: 'u2', memberId: 'm2', name: 'Two' }), { rootPostId: root.value.rootPostId }, d);
    await subscribeThread(ctx({ userId: 'u3', memberId: 'm3', name: 'Three' }), { rootPostId: root.value.rootPostId }, d);
    await muteThread(ctx({ userId: 'u3', memberId: 'm3', name: 'Three' }), { rootPostId: root.value.rootPostId }, d);
    const reply = await createPost(
      ctx({ userId: 'u2', memberId: 'm2', name: 'Two' }),
      { contextKind: 'lesson', contextId: 'l1', parentPostId: root.value.id, body: 'reply' },
      d,
    );
    expect(reply.ok).toBe(true);
    expect(delivered).toEqual(['u1']);
    expect(await d.threadSubscriptions.listSubscribersForRoot('t1', root.value.rootPostId)).toEqual(
      expect.arrayContaining([expect.objectContaining({ userId: 'u2', mutedAt: null })]),
    );
  });

  it('renders soft-deleted posts as placeholders', async () => {
    const d = deps([allAccess], [grant('m1', 'all')]);
    const root = await createPost(ctx(), { contextKind: 'lesson', contextId: 'l1', body: 'secret' }, d);
    if (!root.ok) throw new Error('root failed');
    await deletePost(ctx(), { id: root.value.id }, d);
    const listed = await listDiscussion(ctx(), { contextKind: 'lesson', contextId: 'l1' }, d);
    expect(listed).toMatchObject({ ok: true, value: { threads: [{ body: 'Wpis usunięty' }] } });
  });

  it('filters search results by lesson entitlements and tenant', async () => {
    const d = deps([previewAccess], [grant('m1', 'preview')]);
    await createPost(ctx({ staffRole: 'owner', memberId: null }), { contextKind: 'lesson', contextId: 'l1', body: 'needle locked' }, d);
    await createPost(ctx({ staffRole: 'owner', memberId: null }), { contextKind: 'lesson', contextId: 'l2', body: 'needle preview' }, d);
    const hits = await searchPosts(ctx(), { query: 'needle', limit: 10 }, d);
    expect(hits).toMatchObject({ ok: true, value: [{ lessonId: 'l2' }] });
    const isolated = await searchPosts(ctx({ tenantId: 't2' }), { query: 'needle', limit: 10 }, d);
    expect(isolated).toEqual({ ok: true, value: [] });
  });

  it('paginates notifications, counts unread and marks reads', async () => {
    const d = deps([allAccess], [grant('m1', 'all'), grant('m2', 'all')]);
    const root = await createPost(ctx({ userId: 'u1', memberId: 'm1' }), { contextKind: 'lesson', contextId: 'l1', body: 'root' }, d);
    if (!root.ok) throw new Error('root failed');
    await createPost(ctx({ userId: 'u2', memberId: 'm2' }), { contextKind: 'lesson', contextId: 'l1', parentPostId: root.value.id, body: 'first' }, d);
    await createPost(ctx({ userId: 'u2', memberId: 'm2' }), { contextKind: 'lesson', contextId: 'l1', parentPostId: root.value.id, body: 'second' }, d);
    expect(await unreadNotificationCount(ctx({ userId: 'u1', memberId: 'm1' }), d)).toEqual({ ok: true, value: { unread: 2 } });
    const listed = await listNotifications(ctx({ userId: 'u1', memberId: 'm1' }), { limit: 1 }, d);
    expect(listed).toMatchObject({ ok: true, value: { notifications: [expect.objectContaining({ readAt: null })] } });
    if (!listed.ok) return;
    await markNotificationRead(ctx({ userId: 'u1', memberId: 'm1' }), { id: listed.value.notifications[0]?.id }, d);
    expect(await unreadNotificationCount(ctx({ userId: 'u1', memberId: 'm1' }), d)).toEqual({ ok: true, value: { unread: 1 } });
    expect(await markAllNotificationsRead(ctx({ userId: 'u1', memberId: 'm1' }), d)).toEqual({ ok: true, value: { read: 1 } });
  });
});
