import { describe, expect, it, vi } from 'vitest';

import {
  DM_REPORT_SNAPSHOT_SIZE,
  NO_DM_BLOCKS,
  postReportSchema,
  tenantSettingsSchema,
  type Identity,
  type Post,
  type PostReport,
  type PostReportEvent,
  type DmConversation,
  type DmMessage,
  type DmReport,
  type DmReportStatus,
  type Language,
  type Space,
} from '#core/domain/index.js';

import type { Ctx } from '../context.js';
import type { DmReportRepository, PostReportRepository, RealtimeEvent } from '../ports.js';
import {
  listDmReports,
  listReports,
  openHeuristicReport,
  reportDmConversation,
  reportPost,
  resolveDmReport,
  resolveReport,
  type ModerationDeps,
} from './moderation.js';

const NOW = '2026-07-29T00:00:00.000Z';

const identity = (overrides: Partial<Identity> = {}): Identity => ({
  userId: 'member-user',
  email: 'member@example.com',
  name: 'Member One',
  emailVerified: true,
  tenantId: 'tenant-1',
  tenantSlug: 'tenant',
  tenantName: 'Tenant',
  staffRole: null,
  memberId: 'member-1',
  image: null,
  memberDisplayName: null,
  memberBannedAt: null,
  memberDmOptOutAt: null,
  memberLanguage: null,
  ...overrides,
});

const ctx = (overrides: Partial<Identity> = {}): Ctx => ({ identity: identity(overrides) });

const post = (overrides: Partial<Post> = {}): Post => ({
  id: 'post-1',
  tenantId: 'tenant-1',
  contextKind: 'space',
  contextId: 'space-1',
  parentPostId: null,
  rootPostId: 'post-1',
  authorUserId: 'author-user',
  authorDisplay: 'Post Author',
  authorIsStaff: false,
  body: 'A post that can be reviewed',
  createdAt: NOW,
  editedAt: null,
  deletedAt: null,
  pinnedAt: null,
  ...overrides,
});

const space = (overrides: Partial<Space> = {}): Space => ({
  id: 'space-1',
  tenantId: 'tenant-1',
  slug: 'general',
  name: 'General',
  description: null,
  visibility: 'members',
  productIds: [],
  publicReadOnly: false,
  position: 0,
  archivedAt: null,
  createdAt: NOW,
  ...overrides,
});

class SequenceIds {
  private value = 0;

  nextId(): string {
    this.value += 1;
    return `id-${this.value}`;
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
    const duplicate = this.rows.some((row) =>
      row.postId === report.postId &&
      (
        (report.source === 'heuristic' && row.source === 'heuristic') ||
        (
          report.reporterUserId !== null &&
          row.reporterUserId === report.reporterUserId
        )
      ));
    if (duplicate) return null;
    this.rows.push(report);
    this.events.push(event);
    return report;
  }

  async findById(tenantId: string, id: string): Promise<PostReport | null> {
    return this.rows.find((row) => row.tenantId === tenantId && row.id === id) ?? null;
  }

  async listByStatus(
    tenantId: string,
    query: { status: PostReport['status']; cursor?: string; limit: number },
  ): Promise<{ reports: PostReport[]; nextCursor: string | null }> {
    return {
      reports: this.rows
        .filter((row) => row.tenantId === tenantId && row.status === query.status)
        .slice(0, query.limit),
      nextCursor: null,
    };
  }

  async countOpenByPost(tenantId: string, postIds: string[]): Promise<Map<string, number>> {
    return new Map(postIds.map((postId) => [
      postId,
      this.rows.filter(
        (row) => row.tenantId === tenantId && row.postId === postId && row.status === 'open',
      ).length,
    ]));
  }

  async countOpen(tenantId: string): Promise<number> {
    return this.rows.filter((row) => row.tenantId === tenantId && row.status === 'open').length;
  }

  async resolve(
    tenantId: string,
    input: {
      id: string;
      status: 'dismissed' | 'resolved';
      resolvedAt: string;
      resolvedByUserId: string;
    },
    event: PostReportEvent,
  ): Promise<PostReport | null> {
    const index = this.rows.findIndex(
      (row) => row.tenantId === tenantId && row.id === input.id && row.status === 'open',
    );
    if (index < 0) return null;
    const current = this.rows[index];
    if (current === undefined) return null;
    const next = {
      ...current,
      status: input.status,
      resolvedAt: input.resolvedAt,
      resolvedByUserId: input.resolvedByUserId,
    };
    this.rows[index] = next;
    this.events.push(event);
    return next;
  }

  async resolveAllForPost(
    tenantId: string,
    input: { postId: string; resolvedAt: string; resolvedByUserId: string },
    event: (reportId: string) => PostReportEvent,
  ): Promise<number> {
    let count = 0;
    for (const [index, row] of this.rows.entries()) {
      if (row.tenantId !== tenantId || row.postId !== input.postId || row.status !== 'open') continue;
      this.rows[index] = {
        ...row,
        status: 'resolved',
        resolvedAt: input.resolvedAt,
        resolvedByUserId: input.resolvedByUserId,
      };
      this.events.push(event(row.id));
      count += 1;
    }
    return count;
  }
}

const report = (overrides: Partial<PostReport> = {}): PostReport => postReportSchema.parse({
  id: 'report-1',
  tenantId: 'tenant-1',
  postId: 'post-1',
  reporterUserId: 'member-user',
  reporterDisplay: 'Member One',
  source: 'member',
  reason: 'spam',
  note: null,
  signals: null,
  status: 'open',
  createdAt: NOW,
  resolvedAt: null,
  resolvedByUserId: null,
  ...overrides,
});

class FakeDmReports implements DmReportRepository {
  readonly rows: DmReport[] = [];

  async open(tenantId: string, report: DmReport): Promise<DmReport | null> {
    const duplicate = this.rows.some(
      (row) =>
        row.tenantId === tenantId &&
        row.conversationId === report.conversationId &&
        row.reporterUserId === report.reporterUserId &&
        row.status === 'open',
    );
    if (duplicate) return null;
    const stored = { ...report, tenantId };
    this.rows.push(stored);
    return stored;
  }

  async listByStatus(
    tenantId: string,
    query: { status: DmReportStatus; cursor?: string; limit: number },
  ): Promise<{ reports: DmReport[]; nextCursor: string | null }> {
    return {
      reports: this.rows.filter((row) => row.tenantId === tenantId && row.status === query.status),
      nextCursor: null,
    };
  }

  async countOpen(tenantId: string): Promise<number> {
    return this.rows.filter((row) => row.tenantId === tenantId && row.status === 'open').length;
  }

  async resolve(
    tenantId: string,
    input: { id: string; resolvedAt: string; resolvedByUserId: string },
  ): Promise<DmReport | null> {
    const index = this.rows.findIndex(
      (row) => row.tenantId === tenantId && row.id === input.id && row.status === 'open',
    );
    const current = this.rows[index];
    if (index === -1 || current === undefined) return null;
    const next: DmReport = {
      ...current,
      status: 'resolved',
      resolvedAt: input.resolvedAt,
      resolvedByUserId: input.resolvedByUserId,
    };
    this.rows[index] = next;
    return next;
  }
}

interface DmOptions {
  dmReports?: FakeDmReports;
  dmConversations?: DmConversation[];
  dmMessages?: DmMessage[];
  directMessagesEnabled?: boolean;
  staff?: Array<{ userId: string; email: string; language: Language | null }>;
  published?: RealtimeEvent[];
}

const makeDeps = (
  reports = new FakeReports(),
  posts: Post[] = [post()],
  spaces: Space[] = [space()],
  options: DmOptions = {},
): ModerationDeps => {
  const ids = new SequenceIds();
  const dmReports = options.dmReports ?? new FakeDmReports();
  const dmConversations = options.dmConversations ?? [];
  const dmMessages = options.dmMessages ?? [];
  const published = options.published ?? [];
  return {
    reports,
    posts: {
      createPost: async (_tenantId, value) => value,
      findById: async (tenantId: string, id: string) =>
        posts.find((row) => row.tenantId === tenantId && row.id === id) ?? null,
      findByIds: async (tenantId: string, ids: string[]) =>
        posts.filter((row) => row.tenantId === tenantId && ids.includes(row.id)),
      countByAuthorSince: async () => 0,
      listRecentBodiesByAuthor: async () => [],
      listByAuthor: async () => [],
      listThreadsForContext: async () => ({ threads: [], nextCursor: null }),
      listThreadsForSpaces: async () => ({ threads: [], nextCursor: null }),
      listReplies: async () => [],
      updateBody: async () => null,
      softDelete: async (tenantId: string, input: { id: string; deletedAt: string }) => {
        const index = posts.findIndex((row) => row.tenantId === tenantId && row.id === input.id);
        const current = posts[index];
        if (index < 0 || current === undefined) return null;
        const next = { ...current, deletedAt: input.deletedAt, pinnedAt: null };
        posts[index] = next;
        return next;
      },
      setPinned: async () => null,
      listPinnedForContext: async () => [],
      countPinnedForContext: async () => 0,
      latestRootPostAt: async () => new Map(),
      search: async () => [],
    },
    spaces: {
      list: async () => spaces,
      findById: async (tenantId: string, id: string) =>
        spaces.find((row) => row.tenantId === tenantId && row.id === id) ?? null,
      findBySlug: async () => null,
      create: async () => undefined,
      update: async () => null,
      setArchived: async () => null,
      delete: async () => false,
      stats: async () => new Map(),
    },
    grants: {
      findById: async () => null,
      findGrant: async () => null,
      createGrant: async () => false,
      setGrantWindow: async () => null,
      revokeGrant: async () => null,
      listForMemberWithProductNames: async () => [],
      listActiveForMember: async () => [],
      listGrantedProducts: async () => [],
    },
    members: {
      findById: async () => null,
      findByEmail: async () => null,
      listWithProductIds: async () => [],
      create: async () => undefined,
      updateEmail: async () => null,
      updateLanguage: async () => null,
      updateDisplayName: async () => null,
      updateDmOptOut: async () => null,
      setBanned: async () => null,
    },
    threadSubscriptions: {
      upsert: async (tenantId, input) => ({ tenantId, ...input, mutedAt: null }),
      mute: async () => null,
      listSubscribersPage: async () => [],
      listForUser: async () => [],
    },
    spaceSubscriptions: {
      follow: async () => undefined,
      unfollow: async () => false,
      listFollowersPage: async () => [],
      listForUser: async () => [],
    },
    memberBlocks: {
      block: async () => true,
      unblock: async () => true,
      findDirections: async (_tenantId, query) =>
        new Map(query.otherUserIds.map((userId) => [userId, NO_DM_BLOCKS])),
    },
    notifications: {
      insert: async (_tenantId, notification) => notification,
      insertMany: async (_tenantId, batch) => batch,
      listForRecipient: async () => ({ notifications: [], nextCursor: null }),
      markRead: async () => null,
      markAllRead: async () => 0,
      unreadCount: async () => 0,
      hasUnreadDmNotification: async () => false,
      markDmConversationRead: async () => 0,
    },
    notificationChannels: [],
    fanoutJobs: { claimDue: async () => [], save: async () => undefined },
    courses: {
      list: async () => [],
      findById: async () => null,
      findByIds: async () => [],
      create: async () => undefined,
      update: async () => null,
      delete: async () => false,
    },
    modules: {
      list: async () => [],
      findById: async () => null,
      findByIds: async () => [],
      create: async () => undefined,
      update: async () => null,
      delete: async () => false,
    },
    lessons: {
      list: async () => [],
      listPreviews: async () => [],
      findById: async () => null,
      findByIds: async () => [],
      create: async () => undefined,
      update: async () => null,
      delete: async () => false,
    },
    tenantAccess: {
      listTenantsForStaff: async () => [],
      listStaffForTenant: async () => options.staff ?? [],
      findStaffGrant: async () => null,
      findMember: async () => null,
    },
    links: {
      conversationUrl: () => '',
      eventUrl: () => '',
      lessonDiscussionUrl: () => '',
      spaceUrl: () => '',
    },
    dmReports,
    dmConversations: {
      findById: async (tenantId: string, id: string) =>
        dmConversations.find((row) => row.tenantId === tenantId && row.id === id) ?? null,
      findByParticipants: async () => null,
      insert: async (_tenantId, conversation) => conversation,
      listForParticipant: async () => ({ conversations: [], nextCursor: null }),
      countCreatedBySince: async () => 0,
      countUnreadForParticipant: async () => 0,
      applyLastMessage: async () => null,
    },
    dmMessages: {
      insert: async (_tenantId, message) => message,
      listForConversation: async (tenantId: string, query) => ({
        messages: dmMessages
          .filter((row) => row.tenantId === tenantId && row.conversationId === query.conversationId)
          .sort((left, right) => right.createdAt.localeCompare(left.createdAt))
          .slice(0, query.limit),
        nextCursor: null,
      }),
      countRecentBySender: async () => 0,
    },
    tenants: {
      findById: async () => null,
      findBySlug: async () => null,
      findSole: async () => null,
      findSettings: async () =>
        tenantSettingsSchema.parse({
          name: 'Tenant',
          billingPortalUrl: null,
          bunnyStreamLibraryId: null,
          directMessagesEnabled: options.directMessagesEnabled ?? true,
        }),
      updateSettings: async (_tenantId, settings) => settings,
      createTenantWithOwnerGrant: async () => null,
      hasAny: async () => true,
    },
    userDisplays: {
      findDisplayNames: async (_tenantId, userIds: string[]) =>
        new Map(userIds.map((userId) => [userId, `Osoba ${userId}`])),
    },
    realtimeBus: {
      publish: (event) => {
        published.push(event);
      },
      subscribe: () => () => undefined,
    },
    ids,
    clock: { nowIso: () => NOW },
    avatarSources: { listAvatarSources: async () => [] },
    contentHash: { sha256: (content) => `digest(${String(content)})` },
  };
};

describe('moderation use-cases', () => {
  it('opens one member report with its event and rejects a duplicate', async () => {
    const deps = makeDeps();

    const first = await reportPost(ctx(), { postId: 'post-1', reason: 'spam' }, deps);
    const second = await reportPost(ctx(), { postId: 'post-1', reason: 'spam' }, deps);

    expect(first).toMatchObject({ ok: true, value: { status: 'open', source: 'member' } });
    expect(second).toMatchObject({ ok: false, error: { code: 'conflict' } });
    expect(deps.reports).toMatchObject({
      rows: [{ reporterDisplay: 'Member One' }],
      events: [{ type: 'opened' }],
    });
  });

  it('rejects inaccessible, self-authored, and banned-member reports', async () => {
    const inaccessible = makeDeps(
      new FakeReports(),
      [post()],
      [space({ visibility: 'product', productIds: ['product-1'] })],
    );
    await expect(
      reportPost(ctx(), { postId: 'post-1', reason: 'spam' }, inaccessible),
    ).resolves.toMatchObject({ ok: false, error: { code: 'forbidden' } });

    const selfAuthored = makeDeps(new FakeReports(), [post({ authorUserId: 'member-user' })]);
    await expect(
      reportPost(ctx(), { postId: 'post-1', reason: 'spam' }, selfAuthored),
    ).resolves.toMatchObject({ ok: false, error: { code: 'validation' } });

    await expect(
      reportPost(ctx({ memberBannedAt: NOW }), { postId: 'post-1', reason: 'spam' }, makeDeps()),
    ).resolves.toMatchObject({ ok: false, error: { code: 'banned' } });
  });

  it('allows staff to list reports while refusing members', async () => {
    const reports = new FakeReports();
    reports.rows.push(report());
    const deps = makeDeps(reports);

    await expect(listReports(ctx(), {}, deps)).resolves.toMatchObject({
      ok: false,
      error: { code: 'forbidden' },
    });
    await expect(
      listReports(ctx({ staffRole: 'admin', memberId: null }), {}, deps),
    ).resolves.toMatchObject({
      ok: true,
      value: {
        openCount: 1,
        items: [{ spaceName: 'General', openReportsForPost: 1 }],
      },
    });
  });

  it('reports zero open reports for a post in a dismissed queue', async () => {
    const reports = new FakeReports();
    reports.rows.push(report({
      status: 'dismissed',
      resolvedAt: NOW,
      resolvedByUserId: 'staff-user',
    }));

    await expect(
      listReports(
        ctx({ staffRole: 'admin', memberId: null }),
        { status: 'dismissed' },
        makeDeps(reports),
      ),
    ).resolves.toMatchObject({
      ok: true,
      value: {
        openCount: 0,
        items: [{ openReportsForPost: 0 }],
      },
    });
  });

  it('batch-loads posts and spaces for the moderation queue', async () => {
    const reports = new FakeReports();
    reports.rows.push(
      report(),
      report({ id: 'report-2', postId: 'post-2', reporterUserId: 'member-user-2' }),
    );
    const deps = makeDeps(
      reports,
      [
        post(),
        post({ id: 'post-2', rootPostId: 'post-2', contextId: 'space-2' }),
      ],
      [
        space(),
        space({ id: 'space-2', name: 'Support' }),
      ],
    );
    const findPosts = vi.spyOn(deps.posts, 'findByIds');
    const findPost = vi.spyOn(deps.posts, 'findById');
    const listSpaces = vi.spyOn(deps.spaces, 'list');
    const findSpace = vi.spyOn(deps.spaces, 'findById');

    await expect(
      listReports(ctx({ staffRole: 'admin', memberId: null }), {}, deps),
    ).resolves.toMatchObject({
      ok: true,
      value: {
        items: [
          { spaceName: 'General' },
          { spaceName: 'Support' },
        ],
      },
    });
    expect(findPosts).toHaveBeenCalledTimes(1);
    expect(findPosts).toHaveBeenCalledWith('tenant-1', ['post-1', 'post-2']);
    expect(findPost).not.toHaveBeenCalled();
    expect(listSpaces).toHaveBeenCalledTimes(1);
    expect(findSpace).not.toHaveBeenCalled();
  });

  it('dismisses a report without deleting the post', async () => {
    const reports = new FakeReports();
    reports.rows.push(report());
    const posts = [post()];
    const deps = makeDeps(reports, posts);

    await expect(
      resolveReport(
        ctx({ staffRole: 'admin', memberId: null }),
        { reportId: 'report-1', action: 'dismiss' },
        deps,
      ),
    ).resolves.toMatchObject({ ok: true, value: { status: 'dismissed' } });
    expect(posts[0]?.deletedAt).toBeNull();
    expect(reports.events).toMatchObject([{ type: 'dismissed' }]);
  });

  it('deletes a reported post and resolves every open report on it', async () => {
    const reports = new FakeReports();
    reports.rows.push(
      report(),
      report({ id: 'report-2', reporterUserId: 'other-member' }),
    );
    const posts = [post()];
    const deps = makeDeps(reports, posts);
    const staff = ctx({ userId: 'staff-user', staffRole: 'admin', memberId: null });

    await expect(
      resolveReport(staff, { reportId: 'report-1', action: 'delete-post' }, deps),
    ).resolves.toMatchObject({ ok: true, value: { status: 'resolved' } });
    expect(posts[0]?.deletedAt).toBe(NOW);
    expect(reports.rows).toMatchObject([
      { status: 'resolved', resolvedByUserId: 'staff-user' },
      { status: 'resolved', resolvedByUserId: 'staff-user' },
    ]);
    expect(reports.events).toMatchObject([
      { type: 'post_removed' },
      { type: 'post_removed' },
    ]);
  });

  it('opens at most one heuristic report per post', async () => {
    const reports = new FakeReports();
    const deps = makeDeps(reports);
    const target = post();

    await openHeuristicReport('tenant-1', target, ['link-flood'], deps);
    await openHeuristicReport('tenant-1', target, ['duplicate-body'], deps);

    expect(reports.rows).toMatchObject([{ source: 'heuristic', signals: ['link-flood'] }]);
    expect(reports.events).toHaveLength(1);
  });
});

const dmConversation = (overrides: Partial<DmConversation> = {}): DmConversation => ({
  id: 'conversation-1',
  tenantId: 'tenant-1',
  participantLowUserId: 'member-user',
  participantHighUserId: 'other-user',
  createdByUserId: 'member-user',
  createdAt: NOW,
  lastMessageId: 'dm-2',
  lastMessageAt: NOW,
  lastMessageSnippet: 'Ostatnia',
  lastMessageSenderUserId: 'other-user',
  ...overrides,
});

const dmMessage = (id: string, senderUserId: string, createdAt: string): DmMessage => ({
  id,
  tenantId: 'tenant-1',
  conversationId: 'conversation-1',
  senderUserId,
  body: `Treść ${id}`,
  createdAt,
});

describe('direct message reports', () => {
  it('snapshots the conversation tail chronologically and notifies staff', async () => {
    const published: RealtimeEvent[] = [];
    const dmReports = new FakeDmReports();
    const deps = makeDeps(new FakeReports(), [post()], [space()], {
      dmReports,
      published,
      dmConversations: [dmConversation()],
      dmMessages: [
        dmMessage('dm-1', 'member-user', '2026-07-29T00:00:01.000Z'),
        dmMessage('dm-2', 'other-user', '2026-07-29T00:00:02.000Z'),
      ],
      staff: [{ userId: 'staff-user', email: 'staff@example.com', language: null }],
    });

    const result = await reportDmConversation(
      ctx(),
      { conversationId: 'conversation-1', reason: 'harassment' },
      deps,
    );

    const stored = dmReports.rows[0];
    expect(stored?.snapshot.map((message) => message.id)).toEqual(['dm-1', 'dm-2']);
    expect(stored?.snapshot.map((message) => message.senderIsReporter)).toEqual([true, false]);
    expect(stored).toMatchObject({ status: 'open', reportedUserId: 'other-user' });
    expect(result.ok && result.value).toEqual({
      id: stored?.id,
      conversationId: 'conversation-1',
      reason: 'harassment',
      status: 'open',
      createdAt: stored?.createdAt,
    });
    expect(published.map((event) => event.kind)).toEqual(['notification']);
  });

  it('keeps participant user ids and the evidence snapshot out of the reporter response', async () => {
    const dmReports = new FakeDmReports();
    const deps = makeDeps(new FakeReports(), [post()], [space()], {
      dmReports,
      dmConversations: [dmConversation()],
      dmMessages: [dmMessage('dm-1', 'other-user', '2026-07-29T00:00:01.000Z')],
    });

    const result = await reportDmConversation(
      ctx(),
      { conversationId: 'conversation-1', reason: 'harassment' },
      deps,
    );

    const serialized = JSON.stringify(result.ok ? result.value : {});
    expect(serialized).not.toContain('member-user');
    expect(serialized).not.toContain('other-user');
    expect(Object.keys(result.ok ? result.value : {}).sort()).toEqual([
      'conversationId',
      'createdAt',
      'id',
      'reason',
      'status',
    ]);
  });

  it('stores a reporter display derived like a post author, never the raw e-mail', async () => {
    const dmReports = new FakeDmReports();
    const deps = makeDeps(new FakeReports(), [post()], [space()], {
      dmReports,
      dmConversations: [dmConversation()],
      dmMessages: [dmMessage('dm-1', 'member-user', '2026-07-29T00:00:01.000Z')],
    });

    await reportDmConversation(
      ctx({ name: '   ', email: 'jan.kowalski@example.com' }),
      { conversationId: 'conversation-1', reason: 'spam' },
      deps,
    );

    expect(dmReports.rows[0]?.reporterDisplay).toBe('Jan Kowalski');
    expect(dmReports.rows[0]?.snapshot[0]?.senderDisplay).toBe('Jan Kowalski');
  });

  it('keeps the receipt once the report row is durable even if the staff notification fails', async () => {
    const dmReports = new FakeDmReports();
    const deps = makeDeps(new FakeReports(), [post()], [space()], {
      dmReports,
      dmConversations: [dmConversation()],
      dmMessages: [dmMessage('dm-1', 'other-user', '2026-07-29T00:00:01.000Z')],
      staff: [{ userId: 'staff-user', email: 'staff@example.com', language: null }],
    });
    deps.notifications = {
      ...deps.notifications,
      insertMany: async () => {
        throw new Error('notification store down');
      },
    };

    const result = await reportDmConversation(
      ctx(),
      { conversationId: 'conversation-1', reason: 'spam' },
      deps,
    );

    expect(result.ok).toBe(true);
    expect(dmReports.rows).toHaveLength(1);
  });

  it('caps the snapshot at the configured window', async () => {
    const dmReports = new FakeDmReports();
    const deps = makeDeps(new FakeReports(), [post()], [space()], {
      dmReports,
      dmConversations: [dmConversation()],
      dmMessages: Array.from({ length: DM_REPORT_SNAPSHOT_SIZE + 5 }, (_value, index) =>
        dmMessage(
          `dm-${String(index)}`,
          'other-user',
          `2026-07-29T00:00:${String(index).padStart(2, '0')}.000Z`,
        ),
      ),
    });

    await reportDmConversation(ctx(), { conversationId: 'conversation-1', reason: 'spam' }, deps);

    expect(dmReports.rows[0]?.snapshot).toHaveLength(DM_REPORT_SNAPSHOT_SIZE);
    expect(dmReports.rows[0]?.snapshot[0]?.id).toBe('dm-5');
  });

  it('lets only conversation participants report it', async () => {
    const deps = makeDeps(new FakeReports(), [post()], [space()], {
      dmConversations: [dmConversation()],
    });

    const stranger = await reportDmConversation(
      ctx({ userId: 'stranger-user', memberId: 'member-9' }),
      { conversationId: 'conversation-1', reason: 'spam' },
      deps,
    );
    const otherTenant = await reportDmConversation(
      ctx({ tenantId: 'tenant-2' }),
      { conversationId: 'conversation-1', reason: 'spam' },
      deps,
    );

    expect(stranger.ok ? null : stranger.error.code).toBe('not_found');
    expect(otherTenant.ok ? null : otherTenant.error.code).toBe('not_found');
  });

  it('refuses a second open report from the same reporter', async () => {
    const deps = makeDeps(new FakeReports(), [post()], [space()], {
      dmConversations: [dmConversation()],
    });
    const input = { conversationId: 'conversation-1', reason: 'spam' as const };

    await reportDmConversation(ctx(), input, deps);
    const duplicate = await reportDmConversation(ctx(), input, deps);

    expect(duplicate.ok ? null : duplicate.error.code).toBe('conflict');
  });

  it('refuses a report when the tenant turned direct messages off', async () => {
    const deps = makeDeps(new FakeReports(), [post()], [space()], {
      dmConversations: [dmConversation()],
      directMessagesEnabled: false,
    });

    const result = await reportDmConversation(
      ctx(),
      { conversationId: 'conversation-1', reason: 'spam' },
      deps,
    );

    expect(result.ok ? null : result.error.code).toBe('forbidden');
  });

  it('keeps the queue and the resolve action for staff only', async () => {
    const dmReports = new FakeDmReports();
    const deps = makeDeps(new FakeReports(), [post()], [space()], {
      dmReports,
      dmConversations: [dmConversation()],
    });
    const opened = await reportDmConversation(
      ctx(),
      { conversationId: 'conversation-1', reason: 'spam' },
      deps,
    );
    const reportId = opened.ok ? opened.value.id : '';
    const staff = ctx({ staffRole: 'admin', memberId: null });

    const memberQueue = await listDmReports(ctx(), {}, deps);
    const memberResolve = await resolveDmReport(ctx(), { reportId }, deps);
    const staffQueue = await listDmReports(staff, {}, deps);
    const staffResolve = await resolveDmReport(staff, { reportId }, deps);
    const resolvedTwice = await resolveDmReport(staff, { reportId }, deps);

    expect(memberQueue.ok ? null : memberQueue.error.code).toBe('forbidden');
    expect(memberResolve.ok ? null : memberResolve.error.code).toBe('forbidden');
    expect(staffQueue.ok && staffQueue.value).toMatchObject({ openCount: 1 });
    expect(staffQueue.ok && staffQueue.value.reports.map((report) => report.id)).toEqual([reportId]);
    expect(staffResolve.ok && staffResolve.value).toMatchObject({
      status: 'resolved',
      resolvedByUserId: 'member-user',
    });
    expect(resolvedTwice.ok ? null : resolvedTwice.error.code).toBe('not_found');
  });
});
