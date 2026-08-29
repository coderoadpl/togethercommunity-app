import { describe, expect, it } from 'vitest';

import { err, internal, ok, NOTIFICATION_FANOUT_BATCH_SIZE } from '#core/domain/index.js';
import type {
  Member,
  Notification,
  NotificationFanoutJob,
  Post,
  Space,
  SpaceEvent,
} from '#core/domain/index.js';

import type {
  AvatarSourceReader,
  Clock,
  ContentHash,
  CourseLessonRepository,
  CourseModuleRepository,
  CourseRepository,
  DiscussionLinkPort,
  IdGenerator,
  NotificationChannelPort,
  NotificationFanoutJobRepository,
  NotificationRepository,
  PostRepository,
  ProductGrantRepository,
  SpaceEventRepository,
  SpaceRepository,
  SpaceSubscription,
  SpaceSubscriptionRepository,
  TenantAccessReader,
  ThreadSubscriptionRepository,
} from '../ports.js';
import {
  buildNotificationFanoutJob,
  drainNotificationFanoutJobs,
  runEventFanoutJob,
  runPostFanoutJob,
  type NotificationFanoutDeps,
} from './notification-fanout.js';

const NOW = '2026-08-28T10:00:00.000Z';
const TENANT = 't1';
const AUTHOR = 'author';

const followerIds = (count: number): string[] =>
  Array.from({ length: count }, (_, index) => `u${String(index + 1).padStart(3, '0')}`);

const space: Space = {
  id: 'space-1',
  tenantId: TENANT,
  slug: 'space-1',
  name: 'Ogólny',
  description: null,
  visibility: 'members',
  productIds: [],
  publicReadOnly: false,
  position: 0,
  archivedAt: null,
  createdAt: NOW,
};

const post: Post = {
  id: 'post-1',
  tenantId: TENANT,
  contextKind: 'space',
  contextId: space.id,
  parentPostId: null,
  rootPostId: 'post-1',
  authorUserId: AUTHOR,
  authorDisplay: 'Autorka',
  authorIsStaff: false,
  body: 'Nowy wpis',
  createdAt: NOW,
  editedAt: null,
  deletedAt: null,
  pinnedAt: null,
};

const member = (userId: string): Member => ({
  id: `m-${userId}`,
  tenantId: TENANT,
  userId,
  email: `${userId}@example.com`,
  displayName: null,
  tags: [],
  marketingConsents: {},
  externalCustomerIds: {},
  createdAt: NOW,
  deletedAt: null,
  bannedAt: null,
  bannedReason: null,
  bannedByUserId: null,
  dmOptOutAt: null,
});

const unusedSpaces: Omit<SpaceRepository, 'findById'> = {
  list: async () => [],
  findBySlug: async () => null,
  create: async () => undefined,
  update: async () => null,
  setArchived: async () => null,
  delete: async () => false,
  stats: async () => new Map(),
};

const unusedPosts: Omit<PostRepository, 'findById'> = {
  createPost: async (_tenantId, created) => created,
  findByIds: async () => [],
  countByAuthorSince: async () => 0,
  listRecentBodiesByAuthor: async () => [],
  listByAuthor: async () => [],
  listThreadsForContext: async () => ({ threads: [], nextCursor: null }),
  listThreadsForSpaces: async () => ({ threads: [], nextCursor: null }),
  listReplies: async () => [],
  updateBody: async () => null,
  softDelete: async () => null,
  setPinned: async () => null,
  listPinnedForContext: async () => [],
  countPinnedForContext: async () => 0,
  latestRootPostAt: async () => new Map(),
  search: async () => [],
};

const courses: CourseRepository = {
  list: async () => [],
  findById: async () => null,
  findByIds: async () => [],
  create: async () => undefined,
  update: async () => null,
  delete: async () => false,
};

const modules: CourseModuleRepository = {
  list: async () => [],
  findById: async () => null,
  findByIds: async () => [],
  create: async () => undefined,
  update: async () => null,
  delete: async () => false,
};

const lessons: CourseLessonRepository = {
  list: async () => [],
  listPreviews: async () => [],
  findById: async () => null,
  findByIds: async () => [],
  create: async () => undefined,
  update: async () => null,
  delete: async () => false,
};

const grants: ProductGrantRepository = {
  findById: async () => null,
  findGrant: async () => null,
  createGrant: async () => false,
  setGrantWindow: async () => null,
  revokeGrant: async () => null,
  listForMemberWithProductNames: async () => [],
  listActiveForMember: async () => [],
  listGrantedProducts: async () => [],
};

const spaceEvent: SpaceEvent = {
  id: 'event-1',
  tenantId: TENANT,
  spaceId: space.id,
  title: 'Live Q&A',
  description: null,
  startsAt: '2026-09-01T17:00:00.000Z',
  endsAt: '2026-09-01T18:00:00.000Z',
  location: null,
  url: null,
  liveEmbedUrl: null,
  replayUrl: null,
  discussionRootPostId: null,
  createdByUserId: AUTHOR,
  createdAt: NOW,
  updatedAt: null,
  deletedAt: null,
};

const events: SpaceEventRepository = {
  findById: async () => spaceEvent,
  insert: async (_tenantId, event) => event,
  update: async () => null,
  softDelete: async () => null,
  listForSpace: async () => ({ events: [], nextCursor: null }),
  listUpcomingForSpaces: async () => [],
};

const threadSubscriptions: ThreadSubscriptionRepository = {
  upsert: async (tenantId, input) => ({ tenantId, ...input, mutedAt: null }),
  mute: async () => null,
  listSubscribersPage: async () => [],
  listForUser: async () => [],
};

const links: DiscussionLinkPort = {
  lessonDiscussionUrl: () => 'http://tenant.localhost/lesson',
  spaceUrl: ({ spaceId }) => `http://tenant.localhost/community/${spaceId}`,
  conversationUrl: () => 'http://tenant.localhost/messages',
  eventUrl: () => 'http://tenant.localhost/event',
};

const contentHash: ContentHash = { sha256: () => 'hash' };
const clock: Clock = { nowIso: () => NOW };

class RecordingNotifications implements NotificationRepository {
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

  async hasUnreadDmNotification(): Promise<boolean> {
    return false;
  }

  async markDmConversationRead(): Promise<number> {
    return 0;
  }
}

interface SavedJobState {
  status: NotificationFanoutJob['status'];
  attempts: number;
  cursorUserId: string | null;
  nextAttemptAt: string;
}

const fixture = (input: {
  followers: string[];
  memberUserIds?: string[];
  deliver?: NotificationChannelPort['deliver'];
  claimable?: NotificationFanoutJob[];
  clock?: Clock;
}) => {
  const memberUserIds = new Set(input.memberUserIds ?? input.followers);
  const pages: Array<{ afterUserId: string | null; limit: number }> = [];
  const delivered: string[] = [];
  const saves: SavedJobState[] = [];

  const spaceSubscriptions: SpaceSubscriptionRepository = {
    follow: async () => undefined,
    unfollow: async () => false,
    listFollowersPage: async (_tenantId, query) => {
      pages.push({ afterUserId: query.afterUserId, limit: query.limit });
      return [...input.followers]
        .sort((left, right) => left.localeCompare(right))
        .filter((userId) => query.afterUserId === null || userId > query.afterUserId)
        .slice(0, query.limit)
        .map((userId): SpaceSubscription => ({
          tenantId: TENANT,
          userId,
          spaceId: space.id,
          createdAt: NOW,
        }));
    },
    listForUser: async () => [],
  };

  const tenantAccess: TenantAccessReader = {
    listTenantsForStaff: async () => [],
    listStaffForTenant: async () => [],
    findStaffGrant: async () => null,
    findMember: async (_tenantId, userId) => (memberUserIds.has(userId) ? member(userId) : null),
  };

  const avatarSources: AvatarSourceReader = {
    listAvatarSources: async (_tenantId, userIds) =>
      userIds.map((userId) => ({ userId, email: `${userId}@example.com`, image: null })),
  };

  const fanoutJobs: NotificationFanoutJobRepository = {
    claimDue: async () => input.claimable ?? [],
    save: async (_tenantId, saved) => {
      saves.push({
        status: saved.status,
        attempts: saved.attempts,
        cursorUserId: saved.cursorUserId,
        nextAttemptAt: saved.nextAttemptAt,
      });
    },
  };

  let sequence = 0;
  const ids: IdGenerator = {
    nextId: () => {
      sequence += 1;
      return `id-${sequence}`;
    },
  };

  const notifications = new RecordingNotifications();
  const deps: NotificationFanoutDeps = {
    fanoutJobs,
    notifications,
    notificationChannels: [
      {
        deliver: input.deliver ?? (async (notification) => {
          delivered.push(notification.recipientUserId);
          return ok(undefined);
        }),
      },
    ],
    spaceSubscriptions,
    threadSubscriptions,
    spaces: { ...unusedSpaces, findById: async () => space },
    posts: { ...unusedPosts, findById: async () => post },
    courses,
    modules,
    lessons,
    grants,
    events,
    tenantAccess,
    links,
    ids,
    clock: input.clock ?? clock,
    avatarSources,
    contentHash,
  };
  return { deps, notifications, pages, delivered, saves };
};

const job = buildNotificationFanoutJob({
  id: 'job-1',
  tenantId: TENANT,
  kind: 'space-post',
  sourceId: post.id,
  tenantName: 'Tenant',
  tenantSlug: 'tenant',
  authorDisplay: null,
  now: NOW,
});

describe('notification fan-out', () => {
  it('keys the job and its notifications by the source event', async () => {
    const { deps, notifications } = fixture({ followers: ['u001'] });

    await runPostFanoutJob(job, deps);

    expect(job.sourceKey).toBe('space-post:post-1');
    expect(notifications.rows.map((row) => row.sourceKey)).toEqual(['space-post:post-1']);
  });

  it('walks every follower page and completes on the last partial page', async () => {
    const followers = [AUTHOR, ...followerIds(120)];
    const { deps, notifications, pages, delivered } = fixture({ followers });

    const result = await runPostFanoutJob(job, deps);

    expect(result).toMatchObject({ ok: true, value: { created: 120, completed: true } });
    expect(pages).toEqual([
      { afterUserId: null, limit: NOTIFICATION_FANOUT_BATCH_SIZE },
      { afterUserId: 'u049', limit: NOTIFICATION_FANOUT_BATCH_SIZE },
      { afterUserId: 'u099', limit: NOTIFICATION_FANOUT_BATCH_SIZE },
    ]);
    expect(notifications.rows).toHaveLength(120);
    expect(delivered).toHaveLength(120);
    expect(delivered).not.toContain(AUTHOR);
  });

  it('stops at the batch ceiling and resumes from the stored cursor', async () => {
    const followers = followerIds(120);
    const first = fixture({ followers });

    const partial = await runPostFanoutJob(job, first.deps, { maxBatches: 1 });

    expect(partial).toMatchObject({ ok: true, value: { created: 50, completed: false } });
    expect(first.saves).toEqual([
      { status: 'pending', attempts: 0, cursorUserId: 'u050', nextAttemptAt: NOW },
    ]);

    const second = fixture({ followers });
    const rest = await runPostFanoutJob({ ...job, cursorUserId: 'u050' }, second.deps);

    expect(rest).toMatchObject({ ok: true, value: { created: 70, completed: true } });
    expect(second.pages[0]).toEqual({ afterUserId: 'u050', limit: NOTIFICATION_FANOUT_BATCH_SIZE });
  });

  it('keeps paging past a page whose followers are all ineligible', async () => {
    const followers = followerIds(60);
    const { deps, notifications, pages } = fixture({
      followers,
      memberUserIds: followers.slice(50),
    });

    const result = await runPostFanoutJob(job, deps);

    expect(result).toMatchObject({ ok: true, value: { created: 10, completed: true } });
    expect(pages).toHaveLength(2);
    expect(notifications.rows.map((row) => row.recipientUserId)).toEqual(followers.slice(50));
  });

  it('re-running a completed job inserts and delivers nothing', async () => {
    const followers = followerIds(3);
    const { deps, notifications, delivered } = fixture({ followers });

    await runPostFanoutJob(job, deps);
    const replay = await runPostFanoutJob(job, deps);

    expect(replay).toMatchObject({ ok: true, value: { created: 0, completed: true } });
    expect(notifications.rows).toHaveLength(3);
    expect(delivered).toHaveLength(3);
  });

  it('backs a failed delivery off without advancing the cursor', async () => {
    const { deps, saves } = fixture({
      followers: followerIds(60),
      deliver: async () => err(internal('channel down')),
    });

    const result = await runPostFanoutJob({ ...job, attempts: 1 }, deps);

    expect(result.ok).toBe(false);
    expect(saves).toEqual([
      {
        status: 'pending',
        attempts: 1,
        cursorUserId: null,
        nextAttemptAt: '2026-08-28T10:01:00.000Z',
      },
    ]);
  });

  it('marks a job failed once the attempts cap is reached', async () => {
    const { deps, saves } = fixture({
      followers: followerIds(1),
      deliver: async () => err(internal('channel down')),
    });

    await runPostFanoutJob({ ...job, attempts: 5 }, deps);

    expect(saves[0]?.status).toBe('failed');
  });

  it('completes a job whose source post has been deleted', async () => {
    const { deps, notifications, saves } = fixture({ followers: followerIds(3) });
    deps.posts = { ...unusedPosts, findById: async () => ({ ...post, deletedAt: NOW }) };

    const result = await runPostFanoutJob(job, deps);

    expect(result).toMatchObject({ ok: true, value: { created: 0, completed: true } });
    expect(notifications.rows).toEqual([]);
    expect(saves[0]?.status).toBe('completed');
  });

  it('fans a space event out to the followers of its space', async () => {
    const { deps, notifications } = fixture({ followers: followerIds(3) });
    const eventJob = buildNotificationFanoutJob({
      id: 'job-2',
      tenantId: TENANT,
      kind: 'space-event',
      sourceId: spaceEvent.id,
      tenantName: 'Tenant',
      tenantSlug: 'tenant',
      authorDisplay: 'Autorka',
      now: NOW,
    });

    const result = await runEventFanoutJob(eventJob, deps);

    expect(eventJob.sourceKey).toBe('space-event:event-1');
    expect(result).toMatchObject({ ok: true, value: { created: 3, completed: true } });
    expect(notifications.rows.map((row) => row.kind)).toEqual([
      'space-event',
      'space-event',
      'space-event',
    ]);
    expect(notifications.rows[0]?.payload.eventId).toBe(spaceEvent.id);
  });

  it('drains the jobs the scheduler claims and totals the notifications created', async () => {
    const { deps, notifications } = fixture({ followers: followerIds(3), claimable: [job] });

    const result = await drainNotificationFanoutJobs(deps);

    expect(result).toMatchObject({
      ok: true,
      value: { jobsClaimed: 1, notificationsCreated: 3, jobsFailed: 0 },
    });
    expect(notifications.rows).toHaveLength(3);
  });

  it('stops draining once the shared time budget is spent', async () => {
    let tick = 0;
    const advancing: Clock = {
      nowIso: () => {
        const at = new Date(Date.parse(NOW) + tick * 10_000).toISOString();
        tick += 1;
        return at;
      },
    };
    const later = buildNotificationFanoutJob({
      id: 'job-3',
      tenantId: TENANT,
      kind: 'space-post',
      sourceId: 'post-2',
      tenantName: 'Tenant',
      tenantSlug: 'tenant',
      authorDisplay: null,
      now: NOW,
    });
    const { deps, notifications } = fixture({
      followers: followerIds(2),
      claimable: [job, later],
      clock: advancing,
    });

    const result = await drainNotificationFanoutJobs(deps, { budgetMs: 15_000 });

    expect(result).toMatchObject({ ok: true, value: { jobsClaimed: 2, notificationsCreated: 2 } });
    expect(notifications.rows.map((row) => row.sourceKey)).toEqual([job.sourceKey, job.sourceKey]);
  });

  it('counts a job whose channel fails as a failed drain without aborting the run', async () => {
    const { deps } = fixture({
      followers: followerIds(1),
      claimable: [job],
      deliver: async () => err(internal('channel down')),
    });

    const result = await drainNotificationFanoutJobs(deps);

    expect(result).toMatchObject({
      ok: true,
      value: { jobsClaimed: 1, notificationsCreated: 0, jobsFailed: 1 },
    });
  });
});
