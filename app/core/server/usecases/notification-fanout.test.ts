import { fakeFanoutBatches } from '../testing/fanout-batches.js';
import { describe, expect, it, vi } from 'vitest';

import { err, internal, ok, NOTIFICATION_FANOUT_BATCH_SIZE } from '#core/domain/index.js';
import type {
  Language,
  Member,
  Notification,
  NotificationFanoutJob,
  Post,
  Space,
  SpaceEvent,
  TenantSettings,
} from '#core/domain/index.js';

import type {
  AvatarSourceReader,
  Clock,
  CourseLessonRepository,
  CourseModuleRepository,
  CourseRepository,
  DiscussionLinkPort,
  IdGenerator,
  MemberBlockRepository,
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
  name: 'General',
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
  body: 'New post',
  bodyFormat: 'plain',
  createdAt: NOW,
  editedAt: null,
  deletedAt: null,
  pinnedAt: null,
};

const member = (userId: string, language: Language | null = null): Member => ({
  id: `m-${userId}`,
  tenantId: TENANT,
  userId,
  email: `${userId}@example.com`,
  displayName: null,
  language,
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
  listRepliesForRoots: async () => new Map(),
  countRepliesIncludingDeleted: async () => new Map(),
  listReplies: async () => [],
  updateBody: async () => null,
  softDelete: async () => null,
  purge: async () => false,
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
  lessonDiscussionUrl: async () => 'http://tenant.localhost/lesson',
  spaceUrl: async ({ spaceId }) => `http://tenant.localhost/community/${spaceId}`,
  conversationUrl: async () => 'http://tenant.localhost/messages',
  eventUrl: async () => 'http://tenant.localhost/event',
};

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

const tenantSettings = (defaultLanguage: Language | undefined): TenantSettings => ({
  name: 'Tenant',
  defaultLanguage,
  socialLinks: [],
  signInNotice: { enabled: false, text: '' },
  billingPortalUrl: null,
  bunnyStreamLibraryId: null,
  bunnyStreamCdnHostname: null,
  logoUrl: null,
  logoDarkUrl: null,
  accentColor: null,
  accentLight: null,
  faviconUrl: null,
  ogTitle: null,
  ogDescription: null,
  ogImageUrl: null,
  supportEmail: null,
  supportUrl: null,
  termsUrl: null,
  privacyUrl: null,
  defaultHomeSpaceId: null,
});

const fixture = (input: {
  followers: string[];
  memberUserIds?: string[];
  memberLanguage?: Language;
  tenantDefaultLanguage?: Language;
  tenantSettingsFailure?: Error;
  deliver?: NotificationChannelPort['deliver'];
  claimable?: NotificationFanoutJob[];
  clock?: Clock;
  authorBlockedBy?: string[];
}) => {
  const memberUserIds = new Set(input.memberUserIds ?? input.followers);
  const pages: Array<{ afterUserId: string | null; limit: number }> = [];
  const delivered: string[] = [];
  const languages: string[] = [];
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

  const memberBlocks: MemberBlockRepository = {
    block: async () => true,
    unblock: async () => true,
    findDirections: async (_tenantId, query) =>
      new Map(
        query.otherUserIds.map((userId) => [
          userId,
          {
            blockedByViewer: false,
            blocksViewer: (input.authorBlockedBy ?? []).includes(userId),
          },
        ]),
      ),
  };

  const tenantAccess: TenantAccessReader = {
    listTenantsForStaff: async () => [],
    listStaffForTenant: async () => [],
    findStaffGrant: async () => null,
    findMember: async (_tenantId, userId) =>
      memberUserIds.has(userId) ? member(userId, input.memberLanguage ?? null) : null,
  };

  const avatarSources: AvatarSourceReader = {
    listAvatarSources: async (_tenantId, userIds) =>
      userIds.map((userId) => ({ userId, email: `${userId}@example.com`, image: null })),
  };

  const claimable = [...(input.claimable ?? [])];
  const fanoutJobs: NotificationFanoutJobRepository = {
    claimDue: async ({ limit }) => claimable.splice(0, limit),
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
    fanoutBatches: fakeFanoutBatches(() => deps),
    notifications,
    notificationChannels: [
      {
        deliver: input.deliver ?? (async (notification, context) => {
          delivered.push(notification.recipientUserId);
          languages.push(context.language);
          return ok(undefined);
        }),
      },
    ],
    spaceSubscriptions,
    threadSubscriptions,
    memberBlocks,
    spaces: { ...unusedSpaces, findById: async () => space },
    posts: { ...unusedPosts, findById: async () => post },
    courses,
    modules,
    lessons,
    grants,
    events,
    tenants: {
      findSettings: async () => {
        if (input.tenantSettingsFailure) throw input.tenantSettingsFailure;
        return tenantSettings(input.tenantDefaultLanguage);
      },
    },
    tenantAccess,
    links,
    ids,
    clock: input.clock ?? clock,
    avatarSources,
  };
  return { deps, notifications, pages, delivered, languages, saves };
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
  it.each(['result', 'throw'])('replays persisted notifications after a partial channel failure: %s', async (failure) => {
    const f = fixture({ followers: followerIds(3) });
    const delivered: string[] = [];
    let fail = true;
    f.deps.notificationChannels = [{ deliver: async (notification) => {
      if (notification.recipientUserId === 'u002' && fail) {
        fail = false;
        if (failure === 'throw') throw new Error('channel unavailable');
        return err(internal('channel unavailable'));
      }
      delivered.push(notification.id);
      return ok(undefined);
    } }];
    expect((await runPostFanoutJob(job, f.deps)).ok).toBe(false);
    expect(f.notifications.rows).toHaveLength(3);
    expect(delivered).toHaveLength(1);
    expect(f.saves[0]?.cursorUserId).toBeNull();

    expect(await runPostFanoutJob({ ...job, attempts: 1 }, f.deps)).toMatchObject({ ok: true, value: { created: 0, completed: true } });
    expect(f.notifications.rows).toHaveLength(3);
    expect(new Set(delivered)).toEqual(new Set(f.notifications.rows.map((row) => row.id)));
  });

  it('pages lesson-question staff and reuses their notification source keys on retry', async () => {
    const f = fixture({ followers: [] });
    f.deps.posts.findById = async () => ({ ...post, contextKind: 'lesson', contextId: 'lesson-1' });
    f.deps.tenantAccess.listStaffForTenant = async () => [AUTHOR, ...followerIds(3)].map((userId) => ({
      userId, email: `${userId}@example.com`, staffRole: 'admin', language: null,
    }));
    const subscribed: string[] = [];
    f.deps.fanoutBatches.subscribeStaff = async (_tenantId, input) => { subscribed.push(...input.userIds); };
    const question = { ...job, kind: 'lesson-question' as const, sourceKey: 'lesson-question:post-1' };
    const coursesRead = vi.spyOn(f.deps.courses, 'list');
    const modulesRead = vi.spyOn(f.deps.modules, 'list');

    expect((await runPostFanoutJob(question, f.deps, { batchSize: 2 })).ok).toBe(true);
    expect(subscribed).toEqual([]);
    expect(f.notifications.rows).toHaveLength(3);
    expect(coursesRead).toHaveBeenCalledTimes(1);
    expect(modulesRead).toHaveBeenCalledTimes(1);
    expect(f.notifications.rows.every((row) => row.kind === 'lesson-question' && row.sourceKey === question.sourceKey)).toBe(true);
    await runPostFanoutJob(question, f.deps, { batchSize: 2 });
    expect(f.notifications.rows).toHaveLength(3);
    coursesRead.mockRestore();
    modulesRead.mockRestore();
  });

  it.each([1, 49, 120])('reads eligibility once per batch and the lesson catalogue once for %i subscribers', async (count) => {
    const f = fixture({ followers: [] });
    const users = followerIds(count);
    f.deps.posts.findById = async () => ({ ...post, contextKind: 'lesson', contextId: 'lesson-1' });
    f.deps.threadSubscriptions = { ...threadSubscriptions, listSubscribersPage: async (tenantId, input) => users
      .filter((userId) => input.afterUserId === null || userId > input.afterUserId).slice(0, input.limit)
      .map((userId) => ({ tenantId, userId, rootPostId: post.id, mutedAt: null, createdAt: NOW })) };
    const batchRead = vi.fn<NotificationFanoutDeps['fanoutBatches']['listAccessForUsers']>(async (_tenantId, userIds) =>
      userIds.map((userId) => ({ userId, member: null, isStaff: true, activeProductIds: [], accessItems: [] })));
    f.deps.fanoutBatches.listAccessForUsers = batchRead;
    const coursesRead = vi.spyOn(f.deps.courses, 'list');
    const modulesRead = vi.spyOn(f.deps.modules, 'list');
    const staffRead = vi.spyOn(f.deps.tenantAccess, 'findStaffGrant');
    const memberRead = vi.spyOn(f.deps.tenantAccess, 'findMember');
    const grantsRead = vi.spyOn(f.deps.grants, 'listActiveForMember');

    const result = await runPostFanoutJob({ ...job, kind: 'thread-reply' }, f.deps);

    expect(result).toMatchObject({ ok: true, value: { created: count } });
    expect(batchRead).toHaveBeenCalledTimes(Math.ceil(count / 50));
    expect(coursesRead).toHaveBeenCalledTimes(1);
    expect(modulesRead).toHaveBeenCalledTimes(1);
    expect(staffRead).not.toHaveBeenCalled();
    expect(memberRead).not.toHaveBeenCalled();
    expect(grantsRead).not.toHaveBeenCalled();
    vi.restoreAllMocks();
  });

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

  it('skips followers who blocked the author', async () => {
    const followers = followerIds(3);
    const { deps, notifications, delivered } = fixture({
      followers,
      authorBlockedBy: ['u002'],
    });

    const result = await runPostFanoutJob(job, deps);

    expect(result).toMatchObject({ ok: true, value: { created: 2, completed: true } });
    expect(notifications.rows.map((row) => row.recipientUserId)).toEqual(['u001', 'u003']);
    expect(delivered).toEqual(['u001', 'u003']);
  });

  it('re-running a completed job inserts and delivers nothing', async () => {
    const followers = followerIds(3);
    const { deps, notifications, delivered } = fixture({ followers });

    await runPostFanoutJob(job, deps);
    const replay = await runPostFanoutJob({ ...job, status: 'completed' }, deps);

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

  it('delivers in the recipient language and falls back to the tenant default', async () => {
    const preferred = fixture({
      followers: ['u001'],
      memberLanguage: 'en',
      tenantDefaultLanguage: 'pl',
    });
    const inherited = fixture({ followers: ['u001'], tenantDefaultLanguage: 'en' });
    const unset = fixture({ followers: ['u001'] });

    await runPostFanoutJob(job, preferred.deps);
    await runPostFanoutJob(job, inherited.deps);
    await runPostFanoutJob(job, unset.deps);

    expect(preferred.languages).toEqual(['en']);
    expect(inherited.languages).toEqual(['en']);
    expect(unset.languages).toEqual(['en']);
  });

  it('reads the tenant default once per job, not once per recipient', async () => {
    const { deps } = fixture({ followers: followerIds(60), tenantDefaultLanguage: 'en' });
    let reads = 0;
    const settings = deps.tenants.findSettings;
    deps.tenants = {
      findSettings: async (tenantId) => {
        reads += 1;
        return settings(tenantId);
      },
    };

    await runPostFanoutJob(job, deps);

    expect(reads).toBe(1);
  });

  it('backs off instead of throwing when the tenant settings read fails', async () => {
    const { deps, saves } = fixture({
      followers: followerIds(3),
      tenantSettingsFailure: new Error('connection reset'),
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

    expect(result).toMatchObject({ ok: true, value: { jobsClaimed: 1, notificationsCreated: 2 } });
    expect(notifications.rows.map((row) => row.sourceKey)).toEqual([job.sourceKey, job.sourceKey]);
    expect(await deps.fanoutJobs.claimDue({ now: advancing.nowIso(), limit: 1, leaseUntil: advancing.nowIso() })).toEqual([later]);
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
