import { describe, expect, it, vi } from 'vitest';

import {
  postReportSchema,
  type Identity,
  type Post,
  type PostReport,
  type PostReportEvent,
  type Space,
} from '#core/domain/index.js';

import type { Ctx } from '../context.js';
import type { PostReportRepository } from '../ports.js';
import {
  listReports,
  openHeuristicReport,
  reportPost,
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

const makeDeps = (
  reports = new FakeReports(),
  posts: Post[] = [post()],
  spaces: Space[] = [space()],
): ModerationDeps => {
  const ids = new SequenceIds();
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
      updateDisplayName: async () => null,
      updateDmOptOut: async () => null,
      setBanned: async () => null,
    },
    threadSubscriptions: {
      upsert: async (tenantId, input) => ({ tenantId, ...input, mutedAt: null }),
      mute: async () => null,
      listSubscribersForRoot: async () => [],
      listForUser: async () => [],
    },
    spaceSubscriptions: {
      follow: async () => undefined,
      unfollow: async () => false,
      listFollowersForSpace: async () => [],
      listForUser: async () => [],
    },
    notifications: {
      insert: async (_tenantId, notification) => notification,
      listForRecipient: async () => ({ notifications: [], nextCursor: null }),
      markRead: async () => null,
      markAllRead: async () => 0,
      unreadCount: async () => 0,
      hasUnreadDmNotification: async () => false,
      markDmConversationRead: async () => 0,
    },
    notificationChannels: [],
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
      listStaffForTenant: async () => [],
      findStaffGrant: async () => null,
      findMember: async () => null,
    },
    links: {
      conversationUrl: () => '',
      lessonDiscussionUrl: () => '',
      spaceUrl: () => '',
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
