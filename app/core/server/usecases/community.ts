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
  Clock,
  CourseLessonRepository,
  CourseModuleRepository,
  CourseRepository,
  DiscussionLinkPort,
  IdGenerator,
  NotificationChannelPort,
  NotificationRepository,
  PostRepository,
  PostReportRepository,
  ProductGrantRepository,
  SpaceRepository,
  SpaceSubscriptionRepository,
  TenantAccessReader,
  ThreadSubscriptionRepository,
} from '../ports.js';
import { isLessonAccessibleByLookup, locateLesson } from './access.js';
import {
  accessibleLessonIds,
  lessonContextAccess,
  listAccessibleSpaces,
  requireActor,
  requireMemberOrStaff,
  requireUnbannedMember,
  requireTenant,
  spaceContextAccess,
  spaceVisibleToMemberScope,
} from './community-access.js';
import { resolveMemberAccessLookup } from './entitlements.js';
import { openHeuristicReport } from './moderation-heuristics.js';
import { notifySpaceFollowers } from './spaces.js';

export interface CommunityDeps {
  posts: PostRepository;
  reports: PostReportRepository;
  threadSubscriptions: ThreadSubscriptionRepository;
  spaceSubscriptions: SpaceSubscriptionRepository;
  spaces: SpaceRepository;
  notifications: NotificationRepository;
  notificationChannels: NotificationChannelPort[];
  courses: CourseRepository;
  modules: CourseModuleRepository;
  lessons: CourseLessonRepository;
  grants: ProductGrantRepository;
  tenantAccess: TenantAccessReader;
  links: DiscussionLinkPort;
  ids: IdGenerator;
  clock: Clock;
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

const nestReplies = (rootId: string, replies: Post[], viewerUserId: string): DiscussionPost[] => {
  const byParent = new Map<string, Post[]>();
  for (const reply of replies) {
    const parentId = reply.parentPostId ?? rootId;
    byParent.set(parentId, [...(byParent.get(parentId) ?? []), reply]);
  }
  const build = (post: Post): DiscussionPost => {
    const children = byParent.get(post.id) ?? [];
    return {
      ...toPublicPost(renderPost(post), viewerUserId),
      replyCount: children.length,
      replies: children.map(build),
    };
  };
  return (byParent.get(rootId) ?? []).map(build);
};

interface ThreadContextInfo {
  courseId: string | null;
  contextName: string;
  contextUrl: string;
}

const threadContextInfo = async (
  tenantId: string,
  post: Post,
  deps: CommunityDeps,
  tenantSlug: string | null,
): Promise<ThreadContextInfo> => {
  if (post.contextKind === 'space') {
    const space = await deps.spaces.findById(tenantId, post.contextId);
    return {
      courseId: null,
      contextName: space?.name ?? '',
      contextUrl: deps.links.spaceUrl({
        tenantSlug,
        spaceId: post.contextId,
        rootPostId: post.rootPostId,
      }),
    };
  }
  const [courses, modules, lesson] = await Promise.all([
    deps.courses.list(tenantId),
    deps.modules.list(tenantId),
    deps.lessons.findById(tenantId, post.contextId),
  ]);
  const location = locateLesson(post.contextId, courses, modules);
  const courseId = location?.course.id ?? null;
  return {
    courseId,
    contextName: lesson?.name ?? '',
    contextUrl: deps.links.lessonDiscussionUrl({ tenantSlug, courseId, lessonId: post.contextId }),
  };
};

const subscriberCanAccessContext = async (
  tenantId: string,
  memberId: string,
  post: Post,
  deps: CommunityDeps,
): Promise<boolean> => {
  if (post.contextKind === 'space') {
    const space = await deps.spaces.findById(tenantId, post.contextId);
    return space !== null && (await spaceVisibleToMemberScope({ tenantId, memberId }, space, deps));
  }
  const [courses, modules] = await Promise.all([deps.courses.list(tenantId), deps.modules.list(tenantId)]);
  const location = locateLesson(post.contextId, courses, modules);
  if (!location) return false;
  const lookup = await resolveMemberAccessLookup({ tenantId, memberId }, deps);
  return isLessonAccessibleByLookup(lookup, {
    courseId: location.course.id,
    moduleId: location.moduleId,
    lessonId: post.contextId,
  });
};

const notifySubscribers = async (
  tenantId: string,
  post: Post,
  deps: CommunityDeps,
  tenant: { tenantName: string; tenantSlug: string | null },
): Promise<Result<void, AppError>> => {
  const subscribers = await deps.threadSubscriptions.listSubscribersForRoot(tenantId, post.rootPostId);
  if (subscribers.length === 0) return ok(undefined);
  const context = await threadContextInfo(tenantId, post, deps, tenant.tenantSlug);
  for (const subscriber of subscribers) {
    if (subscriber.userId === post.authorUserId || subscriber.mutedAt !== null) continue;
    const [staffGrant, member] = await Promise.all([
      deps.tenantAccess.findStaffGrant(subscriber.userId, { tenantId }),
      deps.tenantAccess.findMember(subscriber.userId, tenantId),
    ]);
    const memberCanAccess =
      member !== null && (await subscriberCanAccessContext(tenantId, member.id, post, deps));
    if (staffGrant === null && !memberCanAccess) continue;
    const notification: Notification = {
      id: deps.ids.nextId(),
      tenantId,
      recipientUserId: subscriber.userId,
      kind: 'thread-reply',
      payload: {
        rootPostId: post.rootPostId,
        postId: post.id,
        contextKind: post.contextKind,
        contextId: post.contextId,
        courseId: context.courseId,
        lessonName: context.contextName,
        authorDisplay: post.authorDisplay,
        snippet: postSnippet(post.body),
      },
      readAt: null,
      createdAt: deps.clock.nowIso(),
    };
    const inserted = await deps.notifications.insert(tenantId, notification);
    const recipientEmail = member?.email ?? null;
    for (const channel of deps.notificationChannels) {
      const delivered = await channel.deliver(inserted, {
        recipientEmail,
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

const notifyLessonQuestionStaff = async (
  tenantId: string,
  post: Post,
  deps: CommunityDeps,
  tenant: { tenantName: string; tenantSlug: string | null },
): Promise<Result<void, AppError>> => {
  const staff = await deps.tenantAccess.listStaffForTenant(tenantId);
  if (staff.length === 0) return ok(undefined);
  const context = await threadContextInfo(tenantId, post, deps, tenant.tenantSlug);
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
        lessonName: context.contextName,
        authorDisplay: post.authorDisplay,
        snippet: postSnippet(post.body),
      },
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
    const member = await deps.tenantAccess.findMember(ctx.identity.userId, tenantId);
    const override = member?.displayName?.trim() ?? '';
    if (override.length > 0) return override;
  }
  return resolveAuthorDisplay(ctx.identity);
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
  if (ctx.identity.staffRole === null) {
    const rateWindowStart = minutesBefore(now, POST_RATE_LIMIT.windowMinutes);
    const recentCount = await deps.posts.countByAuthorSince(actor.value.tenantId, {
      authorUserId: actor.value.userId,
      since: rateWindowStart,
    });
    if (recentCount >= POST_RATE_LIMIT.maxPosts) {
      return err(rateLimited('You are posting too quickly — take a short break'));
    }
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
  const created = await deps.posts.createPost(actor.value.tenantId, post);
  const signals = heuristicSignalsFor({ body: created.body, recentBodies });
  if (signals.length > 0) {
    await openHeuristicReport(actor.value.tenantId, created, signals, deps);
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
  if (parentPost !== null) {
    const notified = await notifySubscribers(actor.value.tenantId, created, deps, tenant);
    if (!notified.ok) return notified;
  } else if (created.contextKind === 'space') {
    const space = await deps.spaces.findById(actor.value.tenantId, created.contextId);
    if (space !== null) {
      const notified = await notifySpaceFollowers(actor.value.tenantId, created, space, deps, tenant);
      if (!notified.ok) return notified;
    }
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
  const threads = await Promise.all(
    listed.threads.map(async (thread) => ({
      ...toPublicPost(renderPost(thread.post), scope.value.userId),
      replyCount: thread.replyCount,
      replies: nestReplies(
        thread.post.id,
        await deps.posts.listReplies(scope.value.tenantId, thread.post.rootPostId),
        scope.value.userId,
      ),
    })),
  );
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
  if (post.authorUserId !== actor.value.userId) return err(forbidden('Only the author can edit this post'));
  const body = sanitizeBody(parsed.data.body);
  if (body.length === 0) return err(validation('Post body is required after sanitization'));
  const updated = await deps.posts.updateBody(actor.value.tenantId, {
    id: post.id,
    body,
    editedAt: deps.clock.nowIso(),
  });
  return updated ? ok(toPublicPost(updated, actor.value.userId)) : err(validation('Post not found'));
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
  const actor = requireMemberOrStaff(ctx, 'community:write');
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
  return ok(
    rows.map(
      (row): PostSearchHit => ({
        post: toPublicPost(row.post, ctx.identity.userId),
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
