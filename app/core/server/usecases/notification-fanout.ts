import {
  DEFAULT_LANGUAGE,
  err,
  internal,
  notificationFanoutBackoffAt,
  notificationSourceKey,
  NOTIFICATION_FANOUT_ATTEMPTS_CAP,
  NOTIFICATION_FANOUT_BATCH_SIZE,
  NOTIFICATION_FANOUT_LEASE_MS,
  ok,
  postSnippet,
  type AppError,
  type Notification,
  type NotificationFanoutJob,
  type NotificationFanoutKind,
  type Post,
  type Result,
  type Space,
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
  MemberBlockRepository,
  NotificationChannelPort,
  NotificationFanoutJobRepository,
  NotificationRepository,
  PostRepository,
  ProductGrantRepository,
  SpaceEventRepository,
  SpaceRepository,
  SpaceSubscriptionRepository,
  TenantAccessReader,
  ThreadSubscriptionRepository,
} from '../ports.js';
import { avatarUrlForAuthor } from './avatar.js';
import { notificationRecipient, spaceNotificationRecipient } from './community-access.js';
import { subscriberCanAccessContext, threadContextInfo } from './thread-context.js';

const JOBS_PER_RUN = 10;
const BATCHES_PER_RUN = 8;
const RUN_BUDGET_MS = 12_000;

export interface PostFanoutDeps {
  fanoutJobs: NotificationFanoutJobRepository;
  notifications: NotificationRepository;
  notificationChannels: NotificationChannelPort[];
  spaceSubscriptions: SpaceSubscriptionRepository;
  threadSubscriptions: ThreadSubscriptionRepository;
  memberBlocks: MemberBlockRepository;
  spaces: SpaceRepository;
  posts: PostRepository;
  courses: CourseRepository;
  modules: CourseModuleRepository;
  lessons: CourseLessonRepository;
  grants: ProductGrantRepository;
  tenantAccess: TenantAccessReader;
  links: DiscussionLinkPort;
  ids: IdGenerator;
  clock: Clock;
  avatarSources: AvatarSourceReader;
  contentHash: ContentHash;
}

export interface EventFanoutDeps {
  fanoutJobs: NotificationFanoutJobRepository;
  notifications: NotificationRepository;
  notificationChannels: NotificationChannelPort[];
  spaceSubscriptions: SpaceSubscriptionRepository;
  memberBlocks: MemberBlockRepository;
  spaces: SpaceRepository;
  events: SpaceEventRepository;
  grants: ProductGrantRepository;
  tenantAccess: TenantAccessReader;
  links: DiscussionLinkPort;
  ids: IdGenerator;
  clock: Clock;
  avatarSources: AvatarSourceReader;
  contentHash: ContentHash;
}

export type NotificationFanoutDeps = PostFanoutDeps & EventFanoutDeps;

export interface NotificationFanoutOptions {
  batchSize?: number;
  maxBatches?: number;
  budgetMs?: number;
  deadlineAt?: number;
}

export interface NotificationFanoutJobResult {
  created: number;
  completed: boolean;
}

export interface NotificationFanoutDrainResult {
  jobsClaimed: number;
  notificationsCreated: number;
  jobsFailed: number;
}

interface Recipient {
  userId: string;
  email: string | null;
}

interface RecipientPage {
  recipients: Recipient[];
  nextCursorUserId: string | null;
  exhausted: boolean;
}

interface FanoutPlan {
  notificationKind: Notification['kind'];
  payload: Notification['payload'];
  contextName: string;
  contextUrl: string;
  listRecipients: (afterUserId: string | null, limit: number) => Promise<RecipientPage>;
}

export const buildNotificationFanoutJob = (input: {
  id: string;
  tenantId: string;
  kind: NotificationFanoutKind;
  sourceId: string;
  tenantName: string;
  tenantSlug: string | null;
  authorDisplay: string | null;
  now: string;
}): NotificationFanoutJob => ({
  id: input.id,
  tenantId: input.tenantId,
  kind: input.kind,
  sourceKey: notificationSourceKey(input.kind, input.sourceId),
  payload: {
    postId: input.kind === 'space-event' ? null : input.sourceId,
    eventId: input.kind === 'space-event' ? input.sourceId : null,
    tenantName: input.tenantName,
    tenantSlug: input.tenantSlug,
    authorDisplay: input.authorDisplay,
  },
  status: 'pending',
  attempts: 0,
  cursorUserId: null,
  nextAttemptAt: input.now,
  createdAt: input.now,
  updatedAt: input.now,
});

const withoutAuthorBlockers = async (
  tenantId: string,
  authorUserId: string,
  candidates: readonly Recipient[],
  deps: { memberBlocks: MemberBlockRepository },
): Promise<Recipient[]> => {
  if (candidates.length === 0) return [];
  const directions = await deps.memberBlocks.findDirections(tenantId, {
    viewerUserId: authorUserId,
    otherUserIds: candidates.map((candidate) => candidate.userId),
  });
  return candidates.filter((candidate) => directions.get(candidate.userId)?.blocksViewer !== true);
};

const spaceRecipients =
  (tenantId: string, space: Space, authorUserId: string, deps: PostFanoutDeps | EventFanoutDeps) =>
  async (afterUserId: string | null, limit: number): Promise<RecipientPage> => {
    const followers = await deps.spaceSubscriptions.listFollowersPage(tenantId, {
      spaceId: space.id,
      afterUserId,
      limit,
    });
    const candidates: Recipient[] = [];
    for (const follower of followers) {
      if (follower.userId === authorUserId) continue;
      const eligible = await spaceNotificationRecipient(tenantId, follower.userId, space, deps);
      if (eligible === null) continue;
      candidates.push({ userId: follower.userId, email: eligible.email });
    }
    return {
      recipients: await withoutAuthorBlockers(tenantId, authorUserId, candidates, deps),
      nextCursorUserId: followers.at(-1)?.userId ?? null,
      exhausted: followers.length < limit,
    };
  };

const postPlan = async (
  job: NotificationFanoutJob,
  post: Post,
  deps: PostFanoutDeps,
): Promise<FanoutPlan | null> => {
  const authorAvatarUrl = await avatarUrlForAuthor(job.tenantId, post.authorUserId, deps);
  const snippet = postSnippet(post.body);
  if (job.kind === 'space-post') {
    const space = await deps.spaces.findById(job.tenantId, post.contextId);
    if (space === null) return null;
    return {
      notificationKind: 'space-post',
      payload: {
        rootPostId: post.rootPostId,
        postId: post.id,
        contextKind: 'space',
        contextId: space.id,
        courseId: null,
        eventId: null,
        lessonName: space.name,
        authorDisplay: post.authorDisplay,
        authorAvatarUrl,
        snippet,
      },
      contextName: space.name,
      contextUrl: deps.links.spaceUrl({
        tenantSlug: job.payload.tenantSlug,
        spaceId: space.id,
        rootPostId: post.rootPostId,
      }),
      listRecipients: spaceRecipients(job.tenantId, space, post.authorUserId, deps),
    };
  }
  const context = await threadContextInfo(job.tenantId, post, deps, job.payload.tenantSlug);
  return {
    notificationKind: 'thread-reply',
    payload: {
      rootPostId: post.rootPostId,
      postId: post.id,
      contextKind: post.contextKind,
      contextId: post.contextId,
      courseId: context.courseId,
      eventId: null,
      lessonName: context.contextName,
      authorDisplay: post.authorDisplay,
      authorAvatarUrl,
      snippet,
    },
    contextName: context.contextName,
    contextUrl: context.contextUrl,
    listRecipients: async (afterUserId, limit) => {
      const subscribers = await deps.threadSubscriptions.listSubscribersPage(job.tenantId, {
        rootPostId: post.rootPostId,
        afterUserId,
        limit,
      });
      const candidates: Recipient[] = [];
      for (const subscriber of subscribers) {
        if (subscriber.userId === post.authorUserId || subscriber.mutedAt !== null) continue;
        const recipient = await notificationRecipient(job.tenantId, subscriber.userId, deps);
        if (recipient === null) continue;
        const canAccess =
          recipient.isStaff ||
          (recipient.memberId !== null &&
            (await subscriberCanAccessContext(job.tenantId, recipient.memberId, post, deps)));
        if (!canAccess) continue;
        candidates.push({ userId: subscriber.userId, email: recipient.email });
      }
      return {
        recipients: await withoutAuthorBlockers(job.tenantId, post.authorUserId, candidates, deps),
        nextCursorUserId: subscribers.at(-1)?.userId ?? null,
        exhausted: subscribers.length < limit,
      };
    },
  };
};

const eventPlan = async (
  job: NotificationFanoutJob,
  deps: EventFanoutDeps,
): Promise<FanoutPlan | null> => {
  if (job.payload.eventId === null) return null;
  const event = await deps.events.findById(job.tenantId, job.payload.eventId);
  if (event === null || event.deletedAt !== null) return null;
  const space = await deps.spaces.findById(job.tenantId, event.spaceId);
  if (space === null) return null;
  const authorAvatarUrl = await avatarUrlForAuthor(job.tenantId, event.createdByUserId, deps);
  const reference = event.discussionRootPostId ?? event.id;
  return {
    notificationKind: 'space-event',
    payload: {
      rootPostId: reference,
      postId: reference,
      contextKind: 'space',
      contextId: space.id,
      courseId: null,
      eventId: event.id,
      lessonName: space.name,
      authorDisplay: job.payload.authorDisplay ?? '',
      authorAvatarUrl,
      snippet: postSnippet(`${event.title} · ${event.startsAt}`),
    },
    contextName: space.name,
    contextUrl: deps.links.eventUrl({
      tenantSlug: job.payload.tenantSlug,
      spaceId: space.id,
      eventId: event.id,
    }),
    listRecipients: spaceRecipients(job.tenantId, space, event.createdByUserId, deps),
  };
};

const resolvePostPlan = async (
  job: NotificationFanoutJob,
  deps: PostFanoutDeps,
): Promise<FanoutPlan | null> => {
  if (job.payload.postId === null) return null;
  const post = await deps.posts.findById(job.tenantId, job.payload.postId);
  if (post === null || post.deletedAt !== null) return null;
  return postPlan(job, post, deps);
};

interface FanoutCoreDeps {
  fanoutJobs: NotificationFanoutJobRepository;
  notifications: NotificationRepository;
  notificationChannels: NotificationChannelPort[];
  ids: IdGenerator;
  clock: Clock;
}

const runFanout = async (
  job: NotificationFanoutJob,
  resolvePlan: () => Promise<FanoutPlan | null>,
  deps: FanoutCoreDeps,
  options: NotificationFanoutOptions,
): Promise<Result<NotificationFanoutJobResult, AppError>> => {
  const batchSize = options.batchSize ?? NOTIFICATION_FANOUT_BATCH_SIZE;
  const maxBatches = options.maxBatches ?? BATCHES_PER_RUN;
  const deadlineAt =
    options.deadlineAt ?? Date.parse(deps.clock.nowIso()) + (options.budgetMs ?? RUN_BUDGET_MS);
  let cursorUserId = job.cursorUserId;
  let created = 0;

  const save = async (input: {
    status: NotificationFanoutJob['status'];
    attempts: number;
    nextAttemptAt: string;
  }): Promise<void> => {
    await deps.fanoutJobs.save(job.tenantId, {
      id: job.id,
      status: input.status,
      attempts: input.attempts,
      cursorUserId,
      nextAttemptAt: input.nextAttemptAt,
      updatedAt: deps.clock.nowIso(),
    });
  };
  const abandon = async (error: AppError): Promise<Result<NotificationFanoutJobResult, AppError>> => {
    const attempts = Math.max(job.attempts, 1);
    await save({
      status: attempts >= NOTIFICATION_FANOUT_ATTEMPTS_CAP ? 'failed' : 'pending',
      attempts,
      nextAttemptAt: notificationFanoutBackoffAt(deps.clock.nowIso(), attempts),
    });
    return err(error);
  };
  const finish = async (completed: boolean): Promise<Result<NotificationFanoutJobResult, AppError>> => {
    await save({
      status: completed ? 'completed' : 'pending',
      attempts: 0,
      nextAttemptAt: deps.clock.nowIso(),
    });
    return ok({ created, completed });
  };

  let plan: FanoutPlan | null;
  try {
    plan = await resolvePlan();
  } catch (cause) {
    return abandon(internal(`Fan-out source lookup failed: ${String(cause)}`));
  }
  if (plan === null) return finish(true);
  const resolved = plan;

  for (let batch = 0; batch < maxBatches; batch += 1) {
    if (batch > 0 && Date.parse(deps.clock.nowIso()) >= deadlineAt) return finish(false);
    let page: RecipientPage;
    try {
      page = await resolved.listRecipients(cursorUserId, batchSize);
    } catch (cause) {
      return abandon(internal(`Fan-out recipient page failed: ${String(cause)}`));
    }
    const { recipients } = page;
    if (recipients.length === 0) {
      cursorUserId = page.nextCursorUserId ?? cursorUserId;
      if (page.exhausted) return finish(true);
      continue;
    }
    const now = deps.clock.nowIso();
    const rows: Notification[] = recipients.map((recipient) => ({
      id: deps.ids.nextId(),
      tenantId: job.tenantId,
      recipientUserId: recipient.userId,
      kind: resolved.notificationKind,
      payload: resolved.payload,
      sourceKey: job.sourceKey,
      readAt: null,
      createdAt: now,
    }));
    let inserted: Notification[];
    try {
      inserted = await deps.notifications.insertMany(job.tenantId, rows);
    } catch (cause) {
      return abandon(internal(`Fan-out notification insert failed: ${String(cause)}`));
    }
    created += inserted.length;
    const emails = new Map(recipients.map((recipient) => [recipient.userId, recipient.email]));
    for (const notification of inserted) {
      for (const channel of deps.notificationChannels) {
        const delivered = await channel.deliver(notification, {
          recipientEmail: emails.get(notification.recipientUserId) ?? null,
          tenantName: job.payload.tenantName,
          contextName: resolved.contextName,
          contextUrl: resolved.contextUrl,
          language: DEFAULT_LANGUAGE,
        });
        if (!delivered.ok) return abandon(delivered.error);
      }
    }
    cursorUserId = page.nextCursorUserId ?? cursorUserId;
    if (page.exhausted) return finish(true);
  }
  return finish(false);
};

export const runPostFanoutJob = async (
  job: NotificationFanoutJob,
  deps: PostFanoutDeps,
  options: NotificationFanoutOptions = {},
): Promise<Result<NotificationFanoutJobResult, AppError>> =>
  runFanout(job, async () => resolvePostPlan(job, deps), deps, options);

export const runEventFanoutJob = async (
  job: NotificationFanoutJob,
  deps: EventFanoutDeps,
  options: NotificationFanoutOptions = {},
): Promise<Result<NotificationFanoutJobResult, AppError>> =>
  runFanout(job, async () => eventPlan(job, deps), deps, options);

/** Keeps small spaces instant; anything past the first page is the scheduler's, as is every retry. */
export const drainPostFanoutInline = async (
  job: NotificationFanoutJob,
  deps: PostFanoutDeps,
): Promise<void> => {
  await runPostFanoutJob(job, deps, { maxBatches: 1 }).catch(() => undefined);
};

export const drainEventFanoutInline = async (
  job: NotificationFanoutJob,
  deps: EventFanoutDeps,
): Promise<void> => {
  await runEventFanoutJob(job, deps, { maxBatches: 1 }).catch(() => undefined);
};

export const drainNotificationFanoutJobs = async (
  deps: NotificationFanoutDeps,
  options: NotificationFanoutOptions & { jobLimit?: number } = {},
): Promise<Result<NotificationFanoutDrainResult, AppError>> => {
  const now = deps.clock.nowIso();
  const claimed = await deps.fanoutJobs.claimDue({
    now,
    limit: options.jobLimit ?? JOBS_PER_RUN,
    leaseUntil: new Date(Date.parse(now) + NOTIFICATION_FANOUT_LEASE_MS).toISOString(),
  });
  const deadlineAt =
    options.deadlineAt ?? Date.parse(now) + (options.budgetMs ?? RUN_BUDGET_MS);
  let notificationsCreated = 0;
  let jobsFailed = 0;
  for (const job of claimed) {
    if (Date.parse(deps.clock.nowIso()) >= deadlineAt) break;
    const jobOptions = { ...options, deadlineAt };
    const result = job.kind === 'space-event'
      ? await runEventFanoutJob(job, deps, jobOptions)
      : await runPostFanoutJob(job, deps, jobOptions);
    if (result.ok) notificationsCreated += result.value.created;
    else jobsFailed += 1;
  }
  return ok({ jobsClaimed: claimed.length, notificationsCreated, jobsFailed });
};
