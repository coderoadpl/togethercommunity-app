import {
  createPostInputSchema,
  DEFAULT_LANGUAGE,
  deletePostInputSchema,
  DUPLICATE_BODY_WINDOW_MINUTES,
  err,
  forbidden,
  heuristicSignalsFor,
  internal,
  listDiscussionInputSchema,
  muteThreadInputSchema,
  notificationListInputSchema,
  notificationMarkReadInputSchema,
  ok,
  POST_RATE_LIMIT,
  postSchema,
  postSnippet,
  renderPost,
  rateLimited,
  searchPostsInputSchema,
  subscribeThreadInputSchema,
  toPublicPost,
  updatePostInputSchema,
  validation,
  type AppError,
  type Discussion,
  type DiscussionPost,
  type Language,
  type Notification,
  type Post,
  type PostSearchHit,
  type PublicPost,
  type Result,
  type ThreadSubscriptionState,
} from '#core/domain/index.js';

import type { Ctx } from '../context.js';
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
  PostReportRepository,
  ProductGrantRepository,
  SpaceRepository,
  SpaceSubscriptionRepository,
  TenantAccessReader,
  ThreadSubscriptionRepository,
} from '../ports.js';
import { avatarUrlForAuthor, avatarUrlsFor, type AvatarUrlMap } from './avatar.js';
import {
  accessibleLessonIds,
  lessonContextAccess,
  listAccessibleSpaces,
  requireActor,
  requireMemberOrStaff,
  requireUnbannedMember,
  requireTenant,
  spaceContextAccess,
} from './community-access.js';
import { openHeuristicReport } from './moderation-heuristics.js';
import {
  buildNotificationFanoutJob,
  drainPostFanoutInline,
} from './notification-fanout.js';
import { threadContextInfo } from './thread-context.js';

export interface CommunityDeps {
  posts: PostRepository;
  reports: PostReportRepository;
  threadSubscriptions: ThreadSubscriptionRepository;
  spaceSubscriptions: SpaceSubscriptionRepository;
  spaces: SpaceRepository;
  notifications: NotificationRepository;
  notificationChannels: NotificationChannelPort[];
  fanoutJobs: NotificationFanoutJobRepository;
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

const minutesBefore = (iso: string, minutes: number): string =>
  new Date(Date.parse(iso) - minutes * 60_000).toISOString();

interface DisplayNameIdentity {
  name?: string | null;
  email?: string | null;
}

const PARTICIPANT_DISPLAY: Record<Language, string> = {
  pl: 'Uczestnik',
  en: 'Participant',
};

const capitalizeDisplayPart = (part: string, language: Language): string => {
  const locale = language === 'pl' ? 'pl-PL' : 'en-US';
  const normalized = part.toLocaleLowerCase(locale);
  return `${normalized.slice(0, 1).toLocaleUpperCase(locale)}${normalized.slice(1)}`;
};

/** Resolve a stable, non-empty display name before a post crosses the write boundary. */
export const resolveAuthorDisplay = (
  identity: DisplayNameIdentity,
  language: Language = DEFAULT_LANGUAGE,
): string => {
  const name = identity.name?.trim() ?? '';
  if (name.length > 0) return name;

  const localPart = (identity.email?.trim().split('@')[0] ?? '').split('+')[0] ?? '';
  const fromEmail = localPart
    .split(/[._-]+/u)
    .filter((part) => part.length > 0)
    .map((part) => capitalizeDisplayPart(part, language))
    .join(' ')
    .trim();
  return fromEmail.length > 0 ? fromEmail : PARTICIPANT_DISPLAY[language];
};

const sanitizeBody = (body: string): string =>
  body
    .replace(/<script\b[^<]*(?:(?!<\/script>)<[^<]*)*<\/script>/gi, '')
    .replace(/\son[a-z]+\s*=\s*(?:"[^"]*"|'[^']*'|[^\s>]+)/gi, '')
    .replace(/<[^>]*>/g, '')
    .replace(/\r\n/g, '\n')
    .trim();

const contextAccess = async (
  ctx: Ctx,
  context: { contextKind: Post['contextKind']; contextId: string },
  deps: CommunityDeps,
): Promise<Result<void, AppError>> => {
  if (context.contextKind === 'lesson') return lessonContextAccess(ctx, context.contextId, deps);
  const space = await spaceContextAccess(ctx, context.contextId, deps);
  return space.ok ? ok(undefined) : space;
};

export const nestReplies = (
  rootId: string,
  replies: Post[],
  viewerUserId: string,
  avatarUrls: AvatarUrlMap = new Map(),
): DiscussionPost[] => {
  const byParent = new Map<string, Post[]>();
  for (const reply of replies) {
    const parentId = reply.parentPostId ?? rootId;
    byParent.set(parentId, [...(byParent.get(parentId) ?? []), reply]);
  }
  const build = (post: Post): DiscussionPost => {
    const children = byParent.get(post.id) ?? [];
    return {
      ...toPublicPost(renderPost(post), viewerUserId, avatarUrls.get(post.authorUserId) ?? null),
      replyCount: children.length,
      replies: children.map(build),
    };
  };
  return (byParent.get(rootId) ?? []).map(build);
};

const notifyLessonQuestionStaff = async (
  tenantId: string,
  post: Post,
  deps: CommunityDeps,
  tenant: { tenantName: string; tenantSlug: string | null },
): Promise<Result<void, AppError>> => {
  const staff = await deps.tenantAccess.listStaffForTenant(tenantId);
  if (staff.length === 0) return ok(undefined);
  const context = await threadContextInfo(tenantId, post, deps, tenant.tenantSlug);
  const authorAvatarUrl = await avatarUrlForAuthor(tenantId, post.authorUserId, deps);
  for (const recipient of staff) {
    if (recipient.userId === post.authorUserId) continue;
    await deps.threadSubscriptions.upsert(tenantId, {
      userId: recipient.userId,
      rootPostId: post.rootPostId,
      createdAt: post.createdAt,
    });
    const notification: Notification = {
      id: deps.ids.nextId(),
      tenantId,
      recipientUserId: recipient.userId,
      kind: 'lesson-question',
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
        snippet: postSnippet(post.body),
      },
      sourceKey: null,
      readAt: null,
      createdAt: deps.clock.nowIso(),
    };
    const inserted = await deps.notifications.insert(tenantId, notification);
    for (const channel of deps.notificationChannels) {
      const delivered = await channel.deliver(inserted, {
        recipientEmail: recipient.email,
        tenantName: tenant.tenantName,
        contextName: context.contextName,
        contextUrl: context.contextUrl,
        language: DEFAULT_LANGUAGE,
      });
      if (!delivered.ok) return delivered;
    }
  }
  return ok(undefined);
};

const resolvePostAuthorDisplay = async (ctx: Ctx, deps: CommunityDeps): Promise<string> => {
  const tenantId = ctx.identity.tenantId;
  if (tenantId !== null && ctx.identity.memberId !== null) {
    const member = await deps.tenantAccess.findMember(tenantId, ctx.identity.userId);
    const override = member?.displayName?.trim() ?? '';
    if (override.length > 0) return override;
  }
  return resolveAuthorDisplay(ctx.identity);
};

const postRateLimitExceeded = async (
  ctx: Ctx,
  author: { tenantId: string; userId: string },
  now: string,
  deps: Pick<CommunityDeps, 'posts'>,
): Promise<boolean> => {
  if (ctx.identity.staffRole !== null) return false;
  const recentCount = await deps.posts.countByAuthorSince(author.tenantId, {
    authorUserId: author.userId,
    since: minutesBefore(now, POST_RATE_LIMIT.windowMinutes),
  });
  return recentCount >= POST_RATE_LIMIT.maxPosts;
};

export const createPost = async (
  ctx: Ctx,
  input: unknown,
  deps: CommunityDeps,
): Promise<Result<PublicPost, AppError>> => {
  const actor = requireUnbannedMember(ctx, 'community:write');
  if (!actor.ok) return actor;
  const parsed = createPostInputSchema.safeParse(input);
  if (!parsed.success) return err(validation('Invalid post payload', parsed.error.flatten()));
  const access = await contextAccess(ctx, parsed.data, deps);
  if (!access.ok) return access;
  const body = sanitizeBody(parsed.data.body);
  if (body.length === 0) return err(validation('Post body is required after sanitization'));
  let parentPost: Post | null = null;
  let rootPostId = deps.ids.nextId();
  if (parsed.data.parentPostId !== undefined) {
    parentPost = await deps.posts.findById(actor.value.tenantId, parsed.data.parentPostId);
    if (!parentPost || parentPost.contextKind !== parsed.data.contextKind || parentPost.contextId !== parsed.data.contextId) {
      return err(validation('Parent post does not belong to this discussion'));
    }
    rootPostId = parentPost.rootPostId;
  }
  const now = deps.clock.nowIso();
  if (await postRateLimitExceeded(ctx, actor.value, now, deps)) {
    return err(rateLimited('You are posting too quickly — take a short break'));
  }
  const duplicateWindowStart = minutesBefore(now, DUPLICATE_BODY_WINDOW_MINUTES);
  const recentBodies = await deps.posts.listRecentBodiesByAuthor(actor.value.tenantId, {
    authorUserId: actor.value.userId,
    since: duplicateWindowStart,
    limit: 20,
  });
  const postRecord = postSchema.safeParse({
    id: parentPost === null ? rootPostId : deps.ids.nextId(),
    tenantId: actor.value.tenantId,
    contextKind: parsed.data.contextKind,
    contextId: parsed.data.contextId,
    parentPostId: parentPost?.id ?? null,
    rootPostId,
    authorUserId: actor.value.userId,
    authorDisplay: await resolvePostAuthorDisplay(ctx, deps),
    authorIsStaff: ctx.identity.staffRole !== null,
    body,
    createdAt: now,
    editedAt: null,
    deletedAt: null,
  });
  if (!postRecord.success) return err(internal('Could not create a valid discussion post'));
  const post = postRecord.data;
  const fanoutKind = parentPost !== null
    ? 'thread-reply'
    : post.contextKind === 'space'
      ? 'space-post'
      : null;
  const fanoutJob = fanoutKind === null
    ? null
    : buildNotificationFanoutJob({
        id: deps.ids.nextId(),
        tenantId: actor.value.tenantId,
        kind: fanoutKind,
        sourceId: post.id,
        tenantName: ctx.identity.tenantName ?? 'Together',
        tenantSlug: ctx.identity.tenantSlug,
        authorDisplay: null,
        now,
      });
  const created = fanoutJob === null
    ? await deps.posts.createPost(actor.value.tenantId, post)
    : await deps.posts.createPost(actor.value.tenantId, post, fanoutJob);
  const signals = heuristicSignalsFor({ body: created.body, recentBodies });
  if (signals.length > 0) {
    await openHeuristicReport(actor.value.tenantId, created, signals, deps).catch(() => undefined);
  }
  await deps.threadSubscriptions.upsert(actor.value.tenantId, {
    userId: actor.value.userId,
    rootPostId: created.rootPostId,
    createdAt: created.createdAt,
  });
  const tenant = {
    tenantName: ctx.identity.tenantName ?? 'Together',
    tenantSlug: ctx.identity.tenantSlug,
  };
  if (fanoutJob !== null) {
    await drainPostFanoutInline(fanoutJob, deps);
  } else {
    const notified = await notifyLessonQuestionStaff(actor.value.tenantId, created, deps, tenant);
    if (!notified.ok) return notified;
  }
  return ok(toPublicPost(created, actor.value.userId));
};

export const listDiscussion = async (
  ctx: Ctx,
  input: unknown,
  deps: CommunityDeps,
): Promise<Result<Discussion, AppError>> => {
  const scope = requireMemberOrStaff(ctx, 'community:read');
  if (!scope.ok) return scope;
  const parsed = listDiscussionInputSchema.safeParse(input);
  if (!parsed.success) return err(validation('Invalid discussion query', parsed.error.flatten()));
  const access = await contextAccess(ctx, parsed.data, deps);
  if (!access.ok) return access;
  const listed = await deps.posts.listThreadsForContext(scope.value.tenantId, {
    contextKind: parsed.data.contextKind,
    contextId: parsed.data.contextId,
    limit: parsed.data.limit,
    ...(parsed.data.cursor === undefined ? {} : { cursor: parsed.data.cursor }),
  });
  const repliesByThread = await Promise.all(
    listed.threads.map((thread) => deps.posts.listReplies(scope.value.tenantId, thread.post.rootPostId)),
  );
  const avatarUrls = await avatarUrlsFor(
    scope.value.tenantId,
    [...listed.threads.map((thread) => thread.post), ...repliesByThread.flat()].map(
      (post) => post.authorUserId,
    ),
    deps,
  );
  const threads = listed.threads.map((thread, index) => ({
    ...toPublicPost(
      renderPost(thread.post),
      scope.value.userId,
      avatarUrls.get(thread.post.authorUserId) ?? null,
    ),
    replyCount: thread.replyCount,
    replies: nestReplies(
      thread.post.id,
      repliesByThread[index] ?? [],
      scope.value.userId,
      avatarUrls,
    ),
  }));
  const subscriptions = await deps.threadSubscriptions.listForUser(scope.value.tenantId, {
    userId: scope.value.userId,
    rootPostIds: threads.map((thread) => thread.rootPostId),
  });
  const viewerSubscriptions: Record<string, ThreadSubscriptionState> = {};
  for (const subscription of subscriptions) {
    viewerSubscriptions[subscription.rootPostId] = subscription.mutedAt === null ? 'subscribed' : 'muted';
  }
  return ok({ threads, nextCursor: listed.nextCursor, viewerSubscriptions });
};

export const editPost = async (
  ctx: Ctx,
  input: unknown,
  deps: CommunityDeps,
): Promise<Result<PublicPost, AppError>> => {
  const actor = requireUnbannedMember(ctx, 'community:write');
  if (!actor.ok) return actor;
  const parsed = updatePostInputSchema.safeParse(input);
  if (!parsed.success) return err(validation('Invalid post update payload', parsed.error.flatten()));
  const post = await deps.posts.findById(actor.value.tenantId, parsed.data.id);
  if (!post) return err(validation('Post not found'));
  const access = await contextAccess(ctx, post, deps);
  if (!access.ok) return access;
  if (post.authorUserId !== actor.value.userId) return err(forbidden('Only the author can edit this post'));
  const body = sanitizeBody(parsed.data.body);
  if (body.length === 0) return err(validation('Post body is required after sanitization'));
  const now = deps.clock.nowIso();
  if (await postRateLimitExceeded(ctx, actor.value, now, deps)) {
    return err(rateLimited('You are posting too quickly — take a short break'));
  }
  const updated = await deps.posts.updateBody(actor.value.tenantId, {
    id: post.id,
    body,
    editedAt: now,
  });
  if (updated === null) return err(validation('Post not found'));
  const signals = heuristicSignalsFor({ body: updated.body, recentBodies: [] });
  if (signals.length > 0) {
    await openHeuristicReport(actor.value.tenantId, updated, signals, deps).catch(() => undefined);
  }
  return ok(toPublicPost(updated, actor.value.userId));
};

export const deletePost = async (
  ctx: Ctx,
  input: unknown,
  deps: CommunityDeps,
): Promise<Result<PublicPost, AppError>> => {
  const actor = requireActor(ctx, 'community:write');
  if (!actor.ok) return actor;
  const parsed = deletePostInputSchema.safeParse(input);
  if (!parsed.success) return err(validation('Invalid post delete payload', parsed.error.flatten()));
  const post = await deps.posts.findById(actor.value.tenantId, parsed.data.id);
  if (!post) return err(validation('Post not found'));
  if (post.authorUserId !== actor.value.userId && !ctx.identity.staffRole) {
    return err(forbidden('Only the author or staff can delete this post'));
  }
  const deleted = await deps.posts.softDelete(actor.value.tenantId, {
    id: post.id,
    deletedAt: deps.clock.nowIso(),
  });
  return deleted ? ok(toPublicPost(deleted, actor.value.userId)) : err(validation('Post not found'));
};

export const subscribeThread = async (
  ctx: Ctx,
  input: unknown,
  deps: CommunityDeps,
): Promise<Result<{ rootPostId: string }, AppError>> => {
  const actor = requireUnbannedMember(ctx, 'community:write');
  if (!actor.ok) return actor;
  const parsed = subscribeThreadInputSchema.safeParse(input);
  if (!parsed.success) return err(validation('Invalid thread subscription payload', parsed.error.flatten()));
  const root = await deps.posts.findById(actor.value.tenantId, parsed.data.rootPostId);
  if (!root) return err(validation('Thread not found'));
  const access = await contextAccess(ctx, root, deps);
  if (!access.ok) return access;
  await deps.threadSubscriptions.upsert(actor.value.tenantId, {
    userId: actor.value.userId,
    rootPostId: root.rootPostId,
    createdAt: deps.clock.nowIso(),
  });
  return ok({ rootPostId: root.rootPostId });
};

export const muteThread = async (
  ctx: Ctx,
  input: unknown,
  deps: CommunityDeps,
): Promise<Result<{ rootPostId: string }, AppError>> => {
  const actor = requireMemberOrStaff(ctx, 'community:write');
  if (!actor.ok) return actor;
  const parsed = muteThreadInputSchema.safeParse(input);
  if (!parsed.success) return err(validation('Invalid thread mute payload', parsed.error.flatten()));
  await deps.threadSubscriptions.mute(actor.value.tenantId, {
    userId: actor.value.userId,
    rootPostId: parsed.data.rootPostId,
    mutedAt: deps.clock.nowIso(),
  });
  return ok({ rootPostId: parsed.data.rootPostId });
};

export const searchPosts = async (
  ctx: Ctx,
  input: unknown,
  deps: CommunityDeps,
): Promise<Result<PostSearchHit[], AppError>> => {
  const tenant = requireTenant(ctx, 'community:read');
  if (!tenant.ok) return tenant;
  const parsed = searchPostsInputSchema.safeParse(input);
  if (!parsed.success) return err(validation('Invalid post search payload', parsed.error.flatten()));
  const accessible = await accessibleLessonIds(ctx, deps);
  if (!accessible.ok) return accessible;
  const visibleSpaces = await listAccessibleSpaces(ctx, deps);
  if (!visibleSpaces.ok) return visibleSpaces;
  const accessibleSpaceIds = new Set(visibleSpaces.value.map((space) => space.id));
  const requestedLessons = parsed.data.lessonIds ?? [...accessible.value];
  const requestedSpaces = parsed.data.spaceIds ?? [...accessibleSpaceIds];
  const lessonIds = requestedLessons.filter((lessonId) => accessible.value.has(lessonId));
  const spaceIds = requestedSpaces.filter((spaceId) => accessibleSpaceIds.has(spaceId));
  const onlyLessonsRequested = parsed.data.lessonIds !== undefined && parsed.data.spaceIds === undefined;
  const onlySpacesRequested = parsed.data.spaceIds !== undefined && parsed.data.lessonIds === undefined;
  const rows = await deps.posts.search(tenant.value.tenantId, {
    query: parsed.data.query,
    lessonIds: onlySpacesRequested ? [] : lessonIds,
    spaceIds: onlyLessonsRequested ? [] : spaceIds,
    limit: parsed.data.limit,
  });
  const avatarUrls = await avatarUrlsFor(
    tenant.value.tenantId,
    rows.map((row) => row.post.authorUserId),
    deps,
  );
  return ok(
    rows.map(
      (row): PostSearchHit => ({
        post: toPublicPost(
          row.post,
          ctx.identity.userId,
          avatarUrls.get(row.post.authorUserId) ?? null,
        ),
        lessonId: row.lessonId,
        snippet: row.snippet,
      }),
    ),
  );
};

export const listNotifications = async (
  ctx: Ctx,
  input: unknown,
  deps: CommunityDeps,
): Promise<Result<{ notifications: Notification[]; nextCursor: string | null }, AppError>> => {
  const actor = requireActor(ctx, 'notification:read');
  if (!actor.ok) return actor;
  const parsed = notificationListInputSchema.safeParse(input);
  if (!parsed.success) return err(validation('Invalid notifications query', parsed.error.flatten()));
  return ok(
    await deps.notifications.listForRecipient(actor.value.tenantId, {
      recipientUserId: actor.value.userId,
      limit: parsed.data.limit,
      ...(parsed.data.cursor === undefined ? {} : { cursor: parsed.data.cursor }),
    }),
  );
};

export const markNotificationRead = async (
  ctx: Ctx,
  input: unknown,
  deps: CommunityDeps,
): Promise<Result<Notification, AppError>> => {
  const actor = requireActor(ctx, 'notification:write');
  if (!actor.ok) return actor;
  const parsed = notificationMarkReadInputSchema.safeParse(input);
  if (!parsed.success) return err(validation('Invalid notification payload', parsed.error.flatten()));
  const notification = await deps.notifications.markRead(actor.value.tenantId, {
    id: parsed.data.id,
    recipientUserId: actor.value.userId,
    readAt: deps.clock.nowIso(),
  });
  return notification ? ok(notification) : err(validation('Notification not found'));
};

export const markAllNotificationsRead = async (
  ctx: Ctx,
  deps: CommunityDeps,
): Promise<Result<{ read: number }, AppError>> => {
  const actor = requireActor(ctx, 'notification:write');
  if (!actor.ok) return actor;
  return ok({
    read: await deps.notifications.markAllRead(actor.value.tenantId, {
      recipientUserId: actor.value.userId,
      readAt: deps.clock.nowIso(),
    }),
  });
};

export const unreadNotificationCount = async (
  ctx: Ctx,
  deps: CommunityDeps,
): Promise<Result<{ unread: number }, AppError>> => {
  const actor = requireActor(ctx, 'notification:read');
  if (!actor.ok) return actor;
  return ok({ unread: await deps.notifications.unreadCount(actor.value.tenantId, actor.value.userId) });
};
