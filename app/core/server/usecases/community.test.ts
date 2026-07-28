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
  type PostContextKind,
  type Product,
  type ProductGrant,
} from '#core/domain/index.js';

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
  SpaceRepository,
  SpaceSubscription,
  SpaceSubscriptionRepository,
  TenantAccessReader,
  ThreadSubscription,
  ThreadSubscriptionRepository,
} from '../ports.js';
import {
  createPost,
  deletePost,
  editPost,
  listDiscussion,
  listNotifications,
  markAllNotificationsRead,
  markNotificationRead,
  muteThread,
  resolveAuthorDisplay,
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

class FakePosts implements PostRepository {
  readonly rows: Post[] = [];

  async createPost(_tenantId: string, post: Post): Promise<Post> {
    this.rows.push(post);
    return post;
  }

  async findById(tenantId: string, id: string): Promise<Post | null> {
    return this.rows.find((post) => post.tenantId === tenantId && post.id === id) ?? null;
  }

  async listByAuthor(tenantId: string, authorUserId: string): Promise<Post[]> {
    return this.rows.filter(
      (post) => post.tenantId === tenantId && post.authorUserId === authorUserId,
    );
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
    const next = { ...post, deletedAt: input.deletedAt, pinnedAt: null };
    this.replace(next);
    return next;
  }

  async setPinned(tenantId: string, input: { id: string; pinnedAt: string | null }): Promise<Post | null> {
    const post = await this.findById(tenantId, input.id);
    if (post === null) return null;
    const next = { ...post, pinnedAt: input.pinnedAt };
    this.replace(next);
    return next;
  }

  async listPinnedForContext(
    tenantId: string,
    query: { contextKind: PostContextKind; contextId: string; limit: number },
  ): Promise<Post[]> {
    return this.rows
      .filter(
        (post) =>
          post.tenantId === tenantId &&
          post.contextKind === query.contextKind &&
          post.contextId === query.contextId &&
          post.pinnedAt !== null,
      )
      .slice(0, query.limit);
  }

  async countPinnedForContext(
    tenantId: string,
    query: { contextKind: PostContextKind; contextId: string },
  ): Promise<number> {
    return (await this.listPinnedForContext(tenantId, { ...query, limit: this.rows.length })).length;
  }

  async search(
    tenantId: string,
    query: { query: string; lessonIds: string[]; spaceIds: string[]; limit: number },
  ) {
    return this.rows
      .filter(
        (post) =>
          post.tenantId === tenantId &&
          post.deletedAt === null &&
          (post.contextKind === 'lesson'
            ? query.lessonIds.includes(post.contextId)
            : query.spaceIds.includes(post.contextId)) &&
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

const emptySpacesRepo: SpaceRepository = {
  list: async () => [],
  findById: async () => null,
  findBySlug: async () => null,
  create: async () => undefined,
  update: async () => null,
  setArchived: async () => null,
  delete: async () => false,
  stats: async () => new Map(),
};

const deps = (
  accessProducts: Product[],
  accessGrants: ProductGrant[] = [],
  staffUserIds: string[] = [],
): CommunityDeps => {
  const members: Member[] = [
    { id: 'm1', tenantId: 't1', userId: 'u1', email: 'u1@example.com', displayName: null, tags: [], marketingConsents: {}, externalCustomerIds: {}, createdAt: NOW, deletedAt: null },
    { id: 'm2', tenantId: 't1', userId: 'u2', email: 'u2@example.com', displayName: null, tags: [], marketingConsents: {}, externalCustomerIds: {}, createdAt: NOW, deletedAt: null },
    { id: 'm3', tenantId: 't1', userId: 'u3', email: 'u3@example.com', displayName: null, tags: [], marketingConsents: {}, externalCustomerIds: {}, createdAt: NOW, deletedAt: null },
    { id: 'm4', tenantId: 't1', userId: 'u4', email: 'u4@example.com', displayName: 'Kapitan Świt', tags: [], marketingConsents: {}, externalCustomerIds: {}, createdAt: NOW, deletedAt: null },
  ];
  const tenantAccess: TenantAccessReader = {
    listTenantsForStaff: async () => [],
    listStaffForTenant: async (tenantId) =>
      tenantId === 't1'
        ? staffUserIds.map((userId) => ({
            userId,
            email: members.find((member) => member.userId === userId)?.email ?? `${userId}@example.com`,
          }))
        : [],
    findStaffGrant: async (userId, lookup) =>
      'tenantId' in lookup && lookup.tenantId === 't1' && staffUserIds.includes(userId)
        ? {
            tenant: { id: 't1', slug: 'tenant', name: 'Tenant', contentVersion: 1 },
            staffRole: 'admin',
          }
        : null,
    findMember: async (userId, tenantId) => members.find((member) => member.tenantId === tenantId && member.userId === userId) ?? null,
  };
  return {
    posts: new FakePosts(),
    threadSubscriptions: new FakeSubscriptions(),
    spaceSubscriptions: new FakeSpaceSubscriptions(),
    spaces: emptySpacesRepo,
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
      spaceUrl: ({ tenantSlug, spaceId, rootPostId }) =>
        `http://${tenantSlug ?? 'app'}.localhost/community/${spaceId}${rootPostId === undefined ? '' : `/posts/${rootPostId}`}`,
    },
    ids: new SequenceIds(),
    clock,
  };
};

const allAccess = product('all', [{ level: 'course', courseId: 'c1' }]);
const previewAccess = product('preview', [{ level: 'lessons', courseId: 'c1', lessonIds: ['l2'] }]);

describe('community use-cases', () => {
  it('resolves a non-empty post author from names, tagged e-mails, or a localized fallback', () => {
    expect(resolveAuthorDisplay({ name: '  Ada Lovelace  ', email: 'ignored@example.com' })).toBe(
      'Ada Lovelace',
    );
    expect(resolveAuthorDisplay({ name: '', email: 'audit-r3-member+jhkglk@example.com' })).toBe(
      'Audit R3 Member',
    );
    expect(resolveAuthorDisplay({ email: 'jan.kowalski@example.com' })).toBe('Jan Kowalski');
    expect(resolveAuthorDisplay({ name: '   ', email: '' })).toBe('Uczestnik');
    expect(resolveAuthorDisplay({}, 'en')).toBe('Participant');
  });

  it('never sends a blank author display across the post write boundary', async () => {
    const d = deps([allAccess], [grant('m1', 'all')]);
    const created = await createPost(
      ctx({ name: '', email: 'audit-r3-member+jhkglk@example.com' }),
      { contextKind: 'lesson', contextId: 'l1', body: 'hello' },
      d,
    );
    expect(created).toMatchObject({ ok: true, value: { authorDisplay: 'Audit R3 Member' } });
    expect(d.posts).toBeInstanceOf(FakePosts);
    if (!(d.posts instanceof FakePosts)) return;
    expect(d.posts.rows[0]?.authorDisplay).toBe('Audit R3 Member');
  });

  it('prefers the member displayName override over the account name', async () => {
    const d = deps([allAccess], [grant('m4', 'all')]);
    const created = await createPost(
      ctx({ userId: 'u4', memberId: 'm4', name: 'Jan Testowy', email: 'u4@example.com' }),
      { contextKind: 'lesson', contextId: 'l1', body: 'hello' },
      d,
    );
    expect(created).toMatchObject({ ok: true, value: { authorDisplay: 'Kapitan Świt' } });
  });

  it('projects posts to a public shape: isOwn per viewer, never the raw author id', async () => {
    const d = deps([allAccess], [grant('m1', 'all'), grant('m2', 'all')]);
    const mine = await createPost(
      ctx({ userId: 'u1', memberId: 'm1' }),
      { contextKind: 'lesson', contextId: 'l1', body: 'mine' },
      d,
    );
    expect(mine.ok).toBe(true);
    if (!mine.ok) return;
    expect(mine.value.isOwn).toBe(true);
    expect(mine.value).not.toHaveProperty('authorUserId');

    await createPost(
      ctx({ userId: 'u2', memberId: 'm2' }),
      { contextKind: 'lesson', contextId: 'l1', body: 'theirs' },
      d,
    );

    const listed = await listDiscussion(
      ctx({ userId: 'u2', memberId: 'm2' }),
      { contextKind: 'lesson', contextId: 'l1' },
      d,
    );
    expect(listed.ok).toBe(true);
    if (!listed.ok) return;
    const byBody = new Map(listed.value.threads.map((thread) => [thread.body, thread]));
    expect(byBody.get('mine')?.isOwn).toBe(false);
    expect(byBody.get('theirs')?.isOwn).toBe(true);
    for (const thread of listed.value.threads) {
      expect(thread).not.toHaveProperty('authorUserId');
    }
  });

  it('creates a 10-level reply chain with the root post id preserved', async () => {
    const d = deps([allAccess], [grant('m1', 'all')]);
    const root = await createPost(ctx(), { contextKind: 'lesson', contextId: 'l1', body: 'root' }, d);
    expect(root.ok).toBe(true);
    if (!root.ok) return;
    let parent = root.value;
    for (let level = 2; level <= 10; level += 1) {
      const reply = await createPost(
        ctx(),
        { contextKind: 'lesson', contextId: 'l1', parentPostId: parent.id, body: `level ${level}` },
        d,
      );
      expect(reply.ok).toBe(true);
      if (!reply.ok) return;
      expect(reply.value.rootPostId).toBe(root.value.id);
      parent = reply.value;
    }
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

  it('notifies and subscribes tenant staff when a member asks a lesson question', async () => {
    const d = deps([allAccess], [grant('m1', 'all')], ['u2', 'u3']);
    const delivered: Array<{ recipient: string; email: string | null }> = [];
    d.notificationChannels.push({
      deliver: async (notification, context) => {
        delivered.push({ recipient: notification.recipientUserId, email: context.recipientEmail });
        return { ok: true, value: undefined };
      },
    });

    const question = await createPost(
      ctx({ userId: 'u1', memberId: 'm1', name: 'Asker' }),
      { contextKind: 'lesson', contextId: 'l1', body: 'How does this work?' },
      d,
    );

    expect(question.ok).toBe(true);
    if (!question.ok) return;
    expect(d.notifications).toBeInstanceOf(FakeNotifications);
    if (!(d.notifications instanceof FakeNotifications)) return;
    expect(d.notifications.rows).toEqual([
      expect.objectContaining({ recipientUserId: 'u2', kind: 'lesson-question' }),
      expect.objectContaining({ recipientUserId: 'u3', kind: 'lesson-question' }),
    ]);
    expect(delivered).toEqual([
      { recipient: 'u2', email: 'u2@example.com' },
      { recipient: 'u3', email: 'u3@example.com' },
    ]);
    expect(await d.threadSubscriptions.listSubscribersForRoot('t1', question.value.rootPostId)).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ userId: 'u1' }),
        expect.objectContaining({ userId: 'u2' }),
        expect.objectContaining({ userId: 'u3' }),
      ]),
    );

    d.notifications.rows.splice(0);
    await createPost(
      ctx({ userId: 'u2', memberId: 'm2', staffRole: 'admin', name: 'Admin' }),
      {
        contextKind: 'lesson',
        contextId: 'l1',
        parentPostId: question.value.id,
        body: 'Here is the answer.',
      },
      d,
    );
    expect(d.notifications.rows).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ recipientUserId: 'u1', kind: 'thread-reply' }),
      ]),
    );
  });

  it('skips subscribers whose grant expired while still notifying staff subscribers', async () => {
    const expired = {
      ...grant('m2', 'all'),
      expiresAt: '2026-07-14T10:00:00.000Z',
    };
    const d = deps([allAccess], [grant('m1', 'all'), expired], ['u3']);
    const delivered: string[] = [];
    d.notificationChannels.push({
      deliver: async (notification) => {
        delivered.push(notification.recipientUserId);
        return { ok: true, value: undefined };
      },
    });
    const root = await createPost(
      ctx({ userId: 'u1', memberId: 'm1', name: 'One' }),
      { contextKind: 'lesson', contextId: 'l1', body: 'root' },
      d,
    );
    if (!root.ok) throw new Error('root failed');
    delivered.splice(0);
    if (d.notifications instanceof FakeNotifications) d.notifications.rows.splice(0);
    await d.threadSubscriptions.upsert('t1', {
      userId: 'u2',
      rootPostId: root.value.rootPostId,
      createdAt: NOW,
    });
    await d.threadSubscriptions.upsert('t1', {
      userId: 'u3',
      rootPostId: root.value.rootPostId,
      createdAt: NOW,
    });

    const reply = await createPost(
      ctx({ userId: 'u1', memberId: 'm1', name: 'One' }),
      { contextKind: 'lesson', contextId: 'l1', parentPostId: root.value.id, body: 'private reply' },
      d,
    );

    expect(reply.ok).toBe(true);
    expect(delivered).toEqual(['u3']);
    expect(d.notifications).toBeInstanceOf(FakeNotifications);
    if (!(d.notifications instanceof FakeNotifications)) return;
    expect(d.notifications.rows.map((notification) => notification.recipientUserId)).toEqual(['u3']);
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

describe('community guard and error branches', () => {
  const memberCtx = ctx();
  const access = () => deps([allAccess], [grant('m1', 'all')]);

  const seedPost = async (d: CommunityDeps): Promise<string> => {
    const created = await createPost(memberCtx, { contextKind: 'lesson', contextId: 'l1', body: 'Hello world' }, d);
    if (!created.ok) throw new Error('seed failed');
    return created.value.id;
  };

  it('forbids discussion use by a non-member non-staff identity and needs a tenant', async () => {
    const d = access();
    expect(
      await createPost(ctx({ memberId: null, staffRole: null }), { contextKind: 'lesson', contextId: 'l1', body: 'x' }, d),
    ).toMatchObject({ ok: false, error: { code: 'forbidden' } });
    expect(await listNotifications(ctx({ tenantId: null }), {}, d)).toMatchObject({
      ok: false,
      error: { code: 'tenant_not_found' },
    });
    expect(await searchPosts(ctx({ tenantId: null }), { query: 'x' }, d)).toMatchObject({
      ok: false,
      error: { code: 'tenant_not_found' },
    });
  });

  it('rejects malformed payloads with validation errors', async () => {
    const d = access();
    expect(await createPost(memberCtx, {}, d)).toMatchObject({ ok: false, error: { code: 'validation' } });
    expect(await editPost(memberCtx, {}, d)).toMatchObject({ ok: false, error: { code: 'validation' } });
    expect(await deletePost(memberCtx, {}, d)).toMatchObject({ ok: false, error: { code: 'validation' } });
    expect(await subscribeThread(memberCtx, {}, d)).toMatchObject({ ok: false, error: { code: 'validation' } });
    expect(await markNotificationRead(memberCtx, {}, d)).toMatchObject({ ok: false, error: { code: 'validation' } });
  });

  it('rejects a post whose body sanitizes to empty', async () => {
    const d = access();
    const result = await createPost(
      memberCtx,
      { contextKind: 'lesson', contextId: 'l1', body: '<script>alert(1)</script>' },
      d,
    );
    expect(result).toMatchObject({ ok: false, error: { code: 'validation' } });
  });

  it('rejects a reply whose parent belongs to another discussion', async () => {
    const d = access();
    const rootId = await seedPost(d);
    const result = await createPost(
      memberCtx,
      { contextKind: 'lesson', contextId: 'l2', body: 'reply', parentPostId: rootId },
      d,
    );
    expect(result).toMatchObject({ ok: false, error: { code: 'validation' } });
  });

  it('lets only the author edit, and the author or staff delete', async () => {
    const d = access();
    const id = await seedPost(d);
    expect(await editPost(ctx({ userId: 'u2', memberId: 'm2' }), { id, body: 'hijacked body' }, d)).toMatchObject({
      ok: false,
      error: { code: 'forbidden' },
    });
    expect(await editPost(memberCtx, { id, body: 'edited body text' }, d)).toMatchObject({ ok: true });
    expect(await deletePost(ctx({ userId: 'u3', memberId: 'm3' }), { id }, d)).toMatchObject({
      ok: false,
      error: { code: 'forbidden' },
    });
    expect(await deletePost(ctx({ userId: 'u9', memberId: null, staffRole: 'admin' }), { id }, d)).toMatchObject({
      ok: true,
    });
  });

  it('is a validation error to edit, delete or subscribe to a missing post', async () => {
    const d = access();
    expect(await editPost(memberCtx, { id: 'missing', body: 'some body text' }, d)).toMatchObject({
      ok: false,
      error: { code: 'validation' },
    });
    expect(await deletePost(memberCtx, { id: 'missing' }, d)).toMatchObject({ ok: false, error: { code: 'validation' } });
    expect(await subscribeThread(memberCtx, { rootPostId: 'missing' }, d)).toMatchObject({
      ok: false,
      error: { code: 'validation' },
    });
    expect(await markNotificationRead(memberCtx, { id: 'missing' }, d)).toMatchObject({
      ok: false,
      error: { code: 'validation' },
    });
  });

  it('mutes a thread and returns an empty search when the member has no lesson access', async () => {
    const d = deps([], []);
    expect(await muteThread(memberCtx, { rootPostId: 'id-1' }, d)).toMatchObject({ ok: true });
    expect(await searchPosts(memberCtx, { query: 'anything' }, d)).toMatchObject({ ok: true, value: [] });
  });
});
