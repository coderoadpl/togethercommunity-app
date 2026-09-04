import { describe, expect, it } from 'vitest';

import {
  computeCourseModuleName,
  POST_RATE_LIMIT,
  renderPost,
  type Course,
  type CourseLesson,
  type CourseModule,
  type DmBlockDirections,
  type Identity,
  type Member,
  type MemberBlock,
  type Notification,
  type Post,
  type PostContextKind,
  type PostReport,
  type PostReportEvent,
  type Product,
  type ProductGrant,
} from '#core/domain/index.js';

import type { Ctx } from '../context.js';
import type {
  AvatarSourceReader,
  Clock,
  ContentHash,
  CourseLessonRepository,
  CourseModuleRepository,
  CourseRepository,
  IdGenerator,
  MemberBlockRepository,
  NotificationChannelPort,
  NotificationFanoutJobRepository,
  NotificationRepository,
  PostRepository,
  PostReportRepository,
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
import { openHeuristicReport } from './moderation.js';

const NOW = '2026-07-15T10:00:00.000Z';

const contentHash: ContentHash = { sha256: (content) => `digest(${String(content)})` };

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
  image: null,
  memberDisplayName: null,
  memberBannedAt: null,
  memberDmOptOutAt: null,
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
  publiclyVisible: false,
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
  isPreview: false,
  contents: [],
  legacyId: null,
  createdAt: NOW,
});

const product = (id: string, accessItems: Product['accessItems']): Product => ({
  id,
  tenantId: 't1',
  type: 'course',
  slug: id,
  title: id,
  description: '',
  coverUrl: null,
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
  listPreviews: async () => [],
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

  async findByIds(tenantId: string, ids: string[]): Promise<Post[]> {
    return this.rows.filter((post) => post.tenantId === tenantId && ids.includes(post.id));
  }

  async countByAuthorSince(
    tenantId: string,
    query: { authorUserId: string; since: string },
  ): Promise<number> {
    return this.rows.filter(
      (post) =>
        post.tenantId === tenantId &&
        post.authorUserId === query.authorUserId &&
        post.createdAt >= query.since &&
        post.deletedAt === null,
    ).length;
  }

  async listRecentBodiesByAuthor(
    tenantId: string,
    query: { authorUserId: string; since: string; limit: number },
  ): Promise<string[]> {
    return this.rows
      .filter(
        (post) =>
          post.tenantId === tenantId &&
          post.authorUserId === query.authorUserId &&
          post.createdAt >= query.since &&
          post.deletedAt === null,
      )
      .slice(-query.limit)
      .map((post) => post.body);
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

  async listThreadsForSpaces(
    tenantId: string,
    query: { spaceIds: string[]; cursor?: string; limit: number },
  ): Promise<{ threads: Array<{ post: Post; replyCount: number }>; nextCursor: string | null }> {
    const roots = this.rows
      .filter(
        (post) =>
          post.tenantId === tenantId &&
          post.contextKind === 'space' &&
          query.spaceIds.includes(post.contextId) &&
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

  async latestRootPostAt(tenantId: string, spaceIds: string[]): Promise<Map<string, string>> {
    const latest = new Map<string, string>();
    for (const post of this.rows) {
      const eligible =
        post.tenantId === tenantId &&
        post.contextKind === 'space' &&
        spaceIds.includes(post.contextId) &&
        post.parentPostId === null &&
        post.deletedAt === null;
      const current = latest.get(post.contextId);
      if (eligible && (current === undefined || post.createdAt > current)) {
        latest.set(post.contextId, post.createdAt);
      }
    }
    return latest;
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

class FakeReports implements PostReportRepository {
  readonly rows: PostReport[] = [];
  readonly events: PostReportEvent[] = [];

  async open(
    _tenantId: string,
    report: PostReport,
    event: PostReportEvent,
  ): Promise<PostReport | null> {
    if (
      report.source === 'heuristic' &&
      this.rows.some((row) => row.source === 'heuristic' && row.postId === report.postId)
    ) {
      return null;
    }
    this.rows.push(report);
    this.events.push(event);
    return report;
  }

  async findById(tenantId: string, id: string): Promise<PostReport | null> {
    return this.rows.find((report) => report.tenantId === tenantId && report.id === id) ?? null;
  }

  async listByStatus(
    tenantId: string,
    query: { status: PostReport['status']; cursor?: string; limit: number },
  ): Promise<{ reports: PostReport[]; nextCursor: string | null }> {
    return {
      reports: this.rows
        .filter((report) => report.tenantId === tenantId && report.status === query.status)
        .slice(0, query.limit),
      nextCursor: null,
    };
  }

  async countOpenByPost(tenantId: string, postIds: string[]): Promise<Map<string, number>> {
    return new Map(postIds.map((postId) => [
      postId,
      this.rows.filter(
        (report) =>
          report.tenantId === tenantId &&
          report.postId === postId &&
          report.status === 'open',
      ).length,
    ]));
  }

  async countOpen(tenantId: string): Promise<number> {
    return this.rows.filter(
      (report) => report.tenantId === tenantId && report.status === 'open',
    ).length;
  }

  async resolve(): Promise<PostReport | null> {
    return null;
  }

  async resolveAllForPost(): Promise<number> {
    return 0;
  }
}

const fakeFanoutJobs = (): NotificationFanoutJobRepository => ({
  claimDue: async () => [],
  save: async () => undefined,
});

class FakeMemberBlocks implements MemberBlockRepository {
  private readonly rows: MemberBlock[] = [];

  async block(tenantId: string, row: MemberBlock): Promise<boolean> {
    this.rows.push({ ...row, tenantId });
    return true;
  }

  async unblock(): Promise<boolean> {
    return false;
  }

  async findDirections(
    tenantId: string,
    query: { viewerUserId: string; otherUserIds: string[] },
  ): Promise<Map<string, DmBlockDirections>> {
    return new Map(
      query.otherUserIds.map((otherUserId) => [
        otherUserId,
        {
          blockedByViewer: this.rows.some(
            (row) =>
              row.tenantId === tenantId &&
              row.blockerUserId === query.viewerUserId &&
              row.blockedUserId === otherUserId,
          ),
          blocksViewer: this.rows.some(
            (row) =>
              row.tenantId === tenantId &&
              row.blockerUserId === otherUserId &&
              row.blockedUserId === query.viewerUserId,
          ),
        },
      ]),
    );
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

  async listSubscribersPage(
    tenantId: string,
    query: { rootPostId: string; afterUserId: string | null; limit: number },
  ): Promise<ThreadSubscription[]> {
    return this.rows
      .filter((item) => item.tenantId === tenantId && item.rootPostId === query.rootPostId)
      .filter((item) => query.afterUserId === null || item.userId > query.afterUserId)
      .sort((left, right) => left.userId.localeCompare(right.userId))
      .slice(0, query.limit);
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

  async insertMany(tenantId: string, batch: Notification[]): Promise<Notification[]> {
    const inserted: Notification[] = [];
    for (const notification of batch) {
      const duplicate = notification.sourceKey !== null && this.rows.some(
        (row) => row.tenantId === tenantId
          && row.recipientUserId === notification.recipientUserId
          && row.sourceKey === notification.sourceKey,
      );
      if (duplicate) continue;
      this.rows.push(notification);
      inserted.push(notification);
    }
    return inserted;
  }

  async listForRecipient(
    tenantId: string,
    query: { recipientUserId: string; cursor?: string; limit: number; excludeDms?: boolean },
  ): Promise<{ notifications: Notification[]; nextCursor: string | null }> {
    return {
      notifications: this.rows
        .filter((item) => item.tenantId === tenantId && item.recipientUserId === query.recipientUserId)
        .filter((item) => query.excludeDms !== true || item.payload.contextKind !== 'dm')
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

  async unreadCount(
    tenantId: string,
    recipientUserId: string,
    options?: { excludeDms?: boolean },
  ): Promise<number> {
    return this.rows
      .filter((item) => item.tenantId === tenantId && item.recipientUserId === recipientUserId && item.readAt === null)
      .filter((item) => options?.excludeDms !== true || item.payload.contextKind !== 'dm')
      .length;
  }

  async hasUnreadDmNotification(): Promise<boolean> {
    return false;
  }

  async markDmConversationRead(): Promise<number> {
    return 0;
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

  async listFollowersPage(
    tenantId: string,
    query: { spaceId: string; afterUserId: string | null; limit: number },
  ): Promise<SpaceSubscription[]> {
    return this.rows
      .filter((item) => item.tenantId === tenantId && item.spaceId === query.spaceId)
      .filter((item) => query.afterUserId === null || item.userId > query.afterUserId)
      .sort((left, right) => left.userId.localeCompare(right.userId))
      .slice(0, query.limit);
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
  bannedUserIds: string[] = [],
): CommunityDeps => {
  const allMembers: Member[] = [
    { id: 'm1', tenantId: 't1', userId: 'u1', email: 'u1@example.com', displayName: null, tags: [], marketingConsents: {}, externalCustomerIds: {}, createdAt: NOW, deletedAt: null, bannedAt: null, bannedReason: null, bannedByUserId: null, dmOptOutAt: null },
    { id: 'm2', tenantId: 't1', userId: 'u2', email: 'u2@example.com', displayName: null, tags: [], marketingConsents: {}, externalCustomerIds: {}, createdAt: NOW, deletedAt: null, bannedAt: null, bannedReason: null, bannedByUserId: null, dmOptOutAt: null },
    { id: 'm3', tenantId: 't1', userId: 'u3', email: 'u3@example.com', displayName: null, tags: [], marketingConsents: {}, externalCustomerIds: {}, createdAt: NOW, deletedAt: null, bannedAt: null, bannedReason: null, bannedByUserId: null, dmOptOutAt: null },
    { id: 'm4', tenantId: 't1', userId: 'u4', email: 'u4@example.com', displayName: 'Kapitan Świt', tags: [], marketingConsents: {}, externalCustomerIds: {}, createdAt: NOW, deletedAt: null, bannedAt: null, bannedReason: null, bannedByUserId: null, dmOptOutAt: null },
  ];
  const members: Member[] = allMembers.map((member) =>
    bannedUserIds.includes(member.userId) ? { ...member, bannedAt: NOW } : member,
  );
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
            tenant: {
              id: 't1', slug: 'tenant', name: 'Tenant', status: 'active', plan: 'hosted', contentVersion: 1,
            },
            staffRole: 'admin',
          }
        : null,
    findMember: async (tenantId, userId) => members.find((member) => member.tenantId === tenantId && member.userId === userId) ?? null,
  };
  const avatarSources: AvatarSourceReader = {
    listAvatarSources: async (tenantId, userIds) =>
      members
        .filter((member) => member.tenantId === tenantId && userIds.includes(member.userId))
        .map((member) => ({ userId: member.userId, email: member.email, image: null })),
  };
  return {
    posts: new FakePosts(),
    reports: new FakeReports(),
    threadSubscriptions: new FakeSubscriptions(),
    spaceSubscriptions: new FakeSpaceSubscriptions(),
    memberBlocks: new FakeMemberBlocks(),
    spaces: emptySpacesRepo,
    notifications: new FakeNotifications(),
    notificationChannels: [],
    fanoutJobs: fakeFanoutJobs(),
    courses: coursesRepo,
    modules: modulesRepo,
    lessons: lessonsRepo,
    grants: grantRepo(accessGrants, accessProducts),
    tenantAccess,
    links: {
      lessonDiscussionUrl: ({ tenantSlug, courseId, lessonId }) =>
        `http://${tenantSlug ?? 'app'}.localhost/my/courses/${courseId ?? 'none'}/lessons/${lessonId}`,
      conversationUrl: ({ conversationId }) => `http://tenant.localhost/messages/${conversationId}`,
      eventUrl: ({ spaceId, eventId }) => `http://tenant.localhost/community/${spaceId}/events/${eventId}`,
      spaceUrl: ({ tenantSlug, spaceId, rootPostId }) =>
        `http://${tenantSlug ?? 'app'}.localhost/community/${spaceId}${rootPostId === undefined ? '' : `/posts/${rootPostId}`}`,
    },
    ids: new SequenceIds(),
    clock,
    avatarSources,
    contentHash,
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

  it('rate-limits the eleventh member post in ten minutes while exempting staff', async () => {
    const memberDeps = deps([allAccess], [grant('m1', 'all')]);
    for (let index = 0; index < POST_RATE_LIMIT.maxPosts; index += 1) {
      await expect(createPost(
        ctx(),
        { contextKind: 'lesson', contextId: 'l1', body: `post ${index}` },
        memberDeps,
      )).resolves.toMatchObject({ ok: true });
    }
    await expect(createPost(
      ctx(),
      { contextKind: 'lesson', contextId: 'l1', body: 'one post too many' },
      memberDeps,
    )).resolves.toMatchObject({ ok: false, error: { code: 'rate_limited' } });

    const staffDeps = deps([allAccess]);
    for (let index = 0; index <= POST_RATE_LIMIT.maxPosts; index += 1) {
      await expect(createPost(
        ctx({ staffRole: 'admin', memberId: null }),
        { contextKind: 'lesson', contextId: 'l1', body: `staff post ${index}` },
        staffDeps,
      )).resolves.toMatchObject({ ok: true });
    }
  });

  it('opens deduplicated heuristic reports for link floods and repeated content', async () => {
    const d = deps([allAccess], [grant('m1', 'all')]);
    const linked = await createPost(
      ctx(),
      {
        contextKind: 'lesson',
        contextId: 'l1',
        body: 'https://one.test https://two.test https://three.test',
      },
      d,
    );
    expect(linked).toMatchObject({ ok: true });
    if (!linked.ok || !(d.reports instanceof FakeReports) || !(d.posts instanceof FakePosts)) return;
    expect(d.reports.rows).toMatchObject([
      { postId: linked.value.id, source: 'heuristic', reason: 'spam', signals: ['link-flood'] },
    ]);

    const repeatedBody = 'This meaningful community message is repeated.';
    await createPost(
      ctx(),
      { contextKind: 'lesson', contextId: 'l1', body: repeatedBody },
      d,
    );
    const duplicate = await createPost(
      ctx(),
      { contextKind: 'lesson', contextId: 'l1', body: 'This meaningful community message is repeated!' },
      d,
    );
    expect(duplicate).toMatchObject({ ok: true });
    if (!duplicate.ok) return;
    expect(d.reports.rows).toContainEqual(expect.objectContaining({
      postId: duplicate.value.id,
      signals: ['duplicate-body'],
    }));

    const linkedPost = await d.posts.findById('t1', linked.value.id);
    if (linkedPost === null) return;
    await openHeuristicReport('t1', linkedPost, ['link-flood'], d);
    expect(d.reports.rows.filter((report) => report.postId === linked.value.id)).toHaveLength(1);
  });

  it('keeps a created post successful when heuristic report persistence fails', async () => {
    const d = deps([allAccess], [grant('m1', 'all')]);
    d.reports.open = async () => {
      throw new Error('report repository unavailable');
    };

    const created = await createPost(
      ctx(),
      {
        contextKind: 'lesson',
        contextId: 'l1',
        body: 'https://one.test https://two.test https://three.test',
      },
      d,
    );

    expect(created).toMatchObject({ ok: true });
    expect(d.posts).toBeInstanceOf(FakePosts);
    if (!(d.posts instanceof FakePosts)) return;
    expect(d.posts.rows).toHaveLength(1);
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
    expect(await d.threadSubscriptions.listSubscribersPage('t1', { rootPostId: root.value.rootPostId, afterUserId: null, limit: 50 })).toEqual(
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
    expect(await d.threadSubscriptions.listSubscribersPage('t1', { rootPostId: question.value.rootPostId, afterUserId: null, limit: 50 })).toEqual(
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

  it('hides direct-message notifications from the list and the unread badge under impersonation', async () => {
    const d = deps([allAccess], [grant('m1', 'all'), grant('m2', 'all')]);
    const root = await createPost(ctx({ userId: 'u1', memberId: 'm1' }), { contextKind: 'lesson', contextId: 'l1', body: 'root' }, d);
    if (!root.ok) throw new Error('root failed');
    await createPost(ctx({ userId: 'u2', memberId: 'm2' }), { contextKind: 'lesson', contextId: 'l1', parentPostId: root.value.id, body: 'reply' }, d);
    await d.notifications.insert('t1', {
      id: 'n-dm',
      tenantId: 't1',
      recipientUserId: 'u1',
      kind: 'dm-message',
      payload: {
        rootPostId: 'dm-1',
        postId: 'dm-1',
        contextKind: 'dm',
        contextId: 'conversation-1',
        courseId: null,
        eventId: null,
        lessonName: 'Ola',
        authorDisplay: 'Ola',
        authorAvatarUrl: null,
        snippet: 'private words',
      },
      sourceKey: null,
      readAt: null,
      createdAt: '1998-08-14T10:00:00.000Z',
    });

    const subject = ctx({ userId: 'u1', memberId: 'm1' });
    expect(await unreadNotificationCount(subject, d)).toEqual({ ok: true, value: { unread: 2 } });

    const impersonated: Ctx = {
      ...subject,
      impersonation: {
        id: 'imp-1',
        actorUserId: 'user-owner',
        actorEmail: 'owner@example.test',
        actorName: 'Owner',
        actorStaffRole: 'owner',
        subjectMemberId: 'm1',
        subjectName: 'Member',
        expiresAt: '1998-08-14T11:00:00.000Z',
      },
    };
    expect(await unreadNotificationCount(impersonated, d)).toEqual({ ok: true, value: { unread: 1 } });
    const listed = await listNotifications(impersonated, { limit: 10 }, d);
    if (!listed.ok) throw new Error('list failed');
    expect(listed.value.notifications.map((notification) => notification.kind)).toEqual([
      'thread-reply',
    ]);
  });

  it('resolves author avatars for threads, replies, search hits and notification payloads', async () => {
    const d = deps([allAccess], [grant('m1', 'all'), grant('m2', 'all')]);
    const root = await createPost(ctx({ userId: 'u1', memberId: 'm1' }), { contextKind: 'lesson', contextId: 'l1', body: 'needle root' }, d);
    if (!root.ok) throw new Error('root failed');
    await createPost(ctx({ userId: 'u2', memberId: 'm2' }), { contextKind: 'lesson', contextId: 'l1', parentPostId: root.value.id, body: 'reply' }, d);

    const avatarOf = (email: string) =>
      `https://www.gravatar.com/avatar/digest(${email})?d=404&s=160`;

    const listed = await listDiscussion(ctx({ userId: 'u1', memberId: 'm1' }), { contextKind: 'lesson', contextId: 'l1' }, d);
    expect(listed).toMatchObject({
      ok: true,
      value: {
        threads: [{
          authorAvatarUrl: avatarOf('u1@example.com'),
          replies: [{ authorAvatarUrl: avatarOf('u2@example.com') }],
        }],
      },
    });

    const hits = await searchPosts(ctx({ userId: 'u1', memberId: 'm1' }), { query: 'needle' }, d);
    expect(hits).toMatchObject({
      ok: true,
      value: [{ post: { authorAvatarUrl: avatarOf('u1@example.com') } }],
    });

    const notifications = await listNotifications(ctx({ userId: 'u1', memberId: 'm1' }), {}, d);
    expect(notifications).toMatchObject({
      ok: true,
      value: { notifications: [{ payload: { authorAvatarUrl: avatarOf('u2@example.com') } }] },
    });
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
    expect(await listNotifications(memberCtx, { cursor: 'not-a-cursor' }, d)).toMatchObject({
      ok: false,
      error: { code: 'validation' },
    });
    expect(await subscribeThread(memberCtx, {}, d)).toMatchObject({ ok: false, error: { code: 'validation' } });
    expect(await markNotificationRead(memberCtx, {}, d)).toMatchObject({ ok: false, error: { code: 'validation' } });
  });

  it('rejects a blank body', async () => {
    const d = access();
    const result = await createPost(
      memberCtx,
      { contextKind: 'lesson', contextId: 'l1', body: '   \r\n  ' },
      d,
    );
    expect(result).toMatchObject({ ok: false, error: { code: 'validation' } });
  });

  it('keeps angle-bracketed text in created and edited bodies', async () => {
    const d = access();
    const markupLike = 'Generic<T> renders <script>alert(1)</script> and <div class="x">';
    const created = await createPost(
      memberCtx,
      { contextKind: 'lesson', contextId: 'l1', body: markupLike },
      d,
    );
    expect(created).toMatchObject({ ok: true, value: { body: markupLike } });
    if (!created.ok) return;

    const edited = await editPost(memberCtx, { id: created.value.id, body: `${markupLike} onclick=1` }, d);
    expect(edited).toMatchObject({ ok: true, value: { body: `${markupLike} onclick=1` } });
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

  it('blocks a banned member from subscribing while muting stays open', async () => {
    const d = access();
    const rootPostId = await seedPost(d);
    const bannedMember = ctx({ memberBannedAt: NOW });
    expect(await subscribeThread(bannedMember, { rootPostId }, d)).toMatchObject({
      ok: false,
      error: { code: 'banned' },
    });
    expect(await muteThread(bannedMember, { rootPostId }, d)).toMatchObject({ ok: true });
  });

  it('drops a banned subscriber from the thread-reply fan-out', async () => {
    const d = deps([allAccess], [grant('m1', 'all'), grant('m2', 'all')], [], ['u2']);
    const delivered: string[] = [];
    d.notificationChannels.push({
      deliver: async (notification) => {
        delivered.push(notification.recipientUserId);
        return { ok: true, value: undefined };
      },
    });
    const root = await createPost(memberCtx, { contextKind: 'lesson', contextId: 'l1', body: 'root' }, d);
    if (!root.ok) throw new Error('root failed');
    await d.threadSubscriptions.upsert('t1', {
      userId: 'u2',
      rootPostId: root.value.rootPostId,
      createdAt: NOW,
    });

    const reply = await createPost(
      memberCtx,
      { contextKind: 'lesson', contextId: 'l1', parentPostId: root.value.id, body: 'reply' },
      d,
    );

    expect(reply).toMatchObject({ ok: true });
    expect(delivered).toEqual([]);
    expect(d.notifications).toBeInstanceOf(FakeNotifications);
    if (!(d.notifications instanceof FakeNotifications)) return;
    expect(d.notifications.rows).toEqual([]);
  });

  it('drops a subscriber who blocked the author from the thread-reply fan-out', async () => {
    const d = deps([allAccess], [grant('m1', 'all'), grant('m2', 'all')]);
    const delivered: string[] = [];
    d.notificationChannels.push({
      deliver: async (notification) => {
        delivered.push(notification.recipientUserId);
        return { ok: true, value: undefined };
      },
    });
    const root = await createPost(memberCtx, { contextKind: 'lesson', contextId: 'l1', body: 'root' }, d);
    if (!root.ok) throw new Error('root failed');
    await d.threadSubscriptions.upsert('t1', {
      userId: 'u2',
      rootPostId: root.value.rootPostId,
      createdAt: NOW,
    });
    await d.memberBlocks.block('t1', {
      tenantId: 't1',
      blockerUserId: 'u2',
      blockedUserId: 'u1',
      createdAt: NOW,
    });

    const reply = await createPost(
      memberCtx,
      { contextKind: 'lesson', contextId: 'l1', parentPostId: root.value.id, body: 'reply' },
      d,
    );

    expect(reply).toMatchObject({ ok: true });
    expect(delivered).toEqual([]);
    expect(d.notifications).toBeInstanceOf(FakeNotifications);
    if (!(d.notifications instanceof FakeNotifications)) return;
    expect(d.notifications.rows).toEqual([]);
  });

  it('rejects an edit once the author lost access to the lesson', async () => {
    const grants = [grant('m1', 'all')];
    const d = deps([allAccess], grants);
    const id = await seedPost(d);
    grants.splice(0);
    expect(await editPost(memberCtx, { id, body: 'edited body text' }, d)).toMatchObject({
      ok: false,
      error: { code: 'forbidden' },
    });
  });

  it('counts an edit against the member post rate limit', async () => {
    const d = access();
    const id = await seedPost(d);
    for (let index = 1; index < POST_RATE_LIMIT.maxPosts; index += 1) {
      await expect(
        createPost(memberCtx, { contextKind: 'lesson', contextId: 'l1', body: `post ${index}` }, d),
      ).resolves.toMatchObject({ ok: true });
    }
    expect(await editPost(memberCtx, { id, body: 'edited body text' }, d)).toMatchObject({
      ok: false,
      error: { code: 'rate_limited' },
    });
  });

  it('opens a heuristic report when an edit turns a post into a link flood', async () => {
    const d = access();
    const id = await seedPost(d);
    const edited = await editPost(
      memberCtx,
      { id, body: 'https://one.test https://two.test https://three.test' },
      d,
    );
    expect(edited).toMatchObject({ ok: true });
    expect(d.reports).toBeInstanceOf(FakeReports);
    if (!(d.reports instanceof FakeReports)) return;
    expect(d.reports.rows).toMatchObject([{ postId: id, source: 'heuristic', signals: ['link-flood'] }]);
  });

  it('blocks banned member writes while staff remain unaffected', async () => {
    const d = deps([allAccess], [grant('m1', 'all')]);
    const postId = await seedPost(d);
    const bannedMember = ctx({ memberBannedAt: NOW });
    await expect(
      createPost(bannedMember, { contextKind: 'lesson', contextId: 'l1', body: 'blocked' }, d),
    ).resolves.toMatchObject({ ok: false, error: { code: 'banned' } });
    await expect(
      editPost(bannedMember, { id: postId, body: 'blocked edit' }, d),
    ).resolves.toMatchObject({ ok: false, error: { code: 'banned' } });
    await expect(deletePost(bannedMember, { id: postId }, d)).resolves.toMatchObject({ ok: true });
    await expect(
      createPost(
        ctx({ staffRole: 'admin', memberId: null, memberBannedAt: NOW }),
        { contextKind: 'lesson', contextId: 'l1', body: 'staff post' },
        d,
      ),
    ).resolves.toMatchObject({ ok: true });
    await expect(
      createPost(ctx(), { contextKind: 'lesson', contextId: 'l1', body: 'restored' }, d),
    ).resolves.toMatchObject({ ok: true });
  });
});

describe('renderPost', () => {
  const softDeleted = (): Post => ({
    id: 'p1',
    tenantId: 't1',
    contextKind: 'lesson',
    contextId: 'l1',
    parentPostId: null,
    rootPostId: 'p1',
    authorUserId: 'u1',
    authorDisplay: 'Ala',
    authorIsStaff: false,
    body: 'sekret',
    createdAt: NOW,
    editedAt: null,
    deletedAt: NOW,
    pinnedAt: null,
  });

  it('replaces the body with the placeholder in both languages', () => {
    expect(renderPost(softDeleted()).body).toBe('Wpis usunięty');
    expect(renderPost(softDeleted(), 'en').body).toBe('Deleted post');
  });
});
