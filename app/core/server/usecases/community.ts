import {
  createPostInputSchema,
  deletePostInputSchema,
  err,
  forbidden,
  listDiscussionInputSchema,
  muteThreadInputSchema,
  notificationListInputSchema,
  notificationMarkReadInputSchema,
  ok,
  searchPostsInputSchema,
  subscribeThreadInputSchema,
  tenantNotFound,
  updatePostInputSchema,
  validation,
  type AppError,
  type Course,
  type CourseLesson,
  type CourseModule,
  type Discussion,
  type DiscussionPost,
  type Notification,
  type Post,
  type PostSearchHit,
  type Result,
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
  ThreadSubscriptionRepository,
} from '../ports.js';
import { isLessonAccessibleByLookup, locateLesson, type AccessLookup } from './access.js';
import { resolveMemberAccessLookup } from './entitlements.js';

export interface CommunityDeps {
  posts: PostRepository;
  threadSubscriptions: ThreadSubscriptionRepository;
  notifications: NotificationRepository;
  notificationChannels: NotificationChannelPort[];
  courses: CourseRepository;
  modules: CourseModuleRepository;
  lessons: CourseLessonRepository;
  grants: ProductGrantRepository;
  tenantAccess: TenantAccessReader;
  ids: IdGenerator;
  clock: Clock;
}

interface TenantScope {
  tenantId: string;
}

interface ActorScope extends TenantScope {
  userId: string;
}

interface MemberScope extends ActorScope {
  memberId: string;
}

const requireTenant = (ctx: Ctx): Result<TenantScope, AppError> =>
  ctx.identity.tenantId ? ok({ tenantId: ctx.identity.tenantId }) : err(tenantNotFound('Select a tenant'));

const requireActor = (ctx: Ctx): Result<ActorScope, AppError> => {
  const tenant = requireTenant(ctx);
  if (!tenant.ok) return tenant;
  return ok({ tenantId: tenant.value.tenantId, userId: ctx.identity.userId });
};

const requireMemberOrStaff = (ctx: Ctx): Result<ActorScope, AppError> => {
  const actor = requireActor(ctx);
  if (!actor.ok) return actor;
  if (!ctx.identity.staffRole && !ctx.identity.memberId) {
    return err(forbidden('Only members or staff can use discussions'));
  }
  return actor;
};

const memberScope = (ctx: Ctx): MemberScope | null =>
  ctx.identity.tenantId && ctx.identity.memberId
    ? { tenantId: ctx.identity.tenantId, userId: ctx.identity.userId, memberId: ctx.identity.memberId }
    : null;

const sanitizeBody = (body: string): string =>
  body
    .replace(/<script\b[^<]*(?:(?!<\/script>)<[^<]*)*<\/script>/gi, '')
    .replace(/\son[a-z]+\s*=\s*(?:"[^"]*"|'[^']*'|[^\s>]+)/gi, '')
    .replace(/<[^>]*>/g, '')
    .replace(/\r\n/g, '\n')
    .trim();

const lessonAccess = async (
  ctx: Ctx,
  lessonId: string,
  deps: Pick<CommunityDeps, 'courses' | 'modules' | 'grants' | 'clock'>,
): Promise<Result<void, AppError>> => {
  const tenant = requireTenant(ctx);
  if (!tenant.ok) return tenant;
  if (ctx.identity.staffRole) return ok(undefined);
  const member = memberScope(ctx);
  if (!member) return err(forbidden('Only members can access lesson discussions'));
  const [courses, modules] = await Promise.all([
    deps.courses.list(tenant.value.tenantId),
    deps.modules.list(tenant.value.tenantId),
  ]);
  const location = locateLesson(lessonId, courses, modules);
  if (!location) return err(forbidden('This lesson is not accessible'));
  const lookup = await resolveMemberAccessLookup(member, deps);
  return isLessonAccessibleByLookup(lookup, {
    courseId: location.course.id,
    moduleId: location.moduleId,
    lessonId,
  })
    ? ok(undefined)
    : err(forbidden('This lesson is not accessible'));
};

const accessibleLessonIds = async (
  ctx: Ctx,
  deps: Pick<CommunityDeps, 'courses' | 'modules' | 'lessons' | 'grants' | 'clock'>,
): Promise<Result<Set<string>, AppError>> => {
  const tenant = requireTenant(ctx);
  if (!tenant.ok) return tenant;
  const [courses, modules, lessons] = await Promise.all([
    deps.courses.list(tenant.value.tenantId),
    deps.modules.list(tenant.value.tenantId),
    deps.lessons.list(tenant.value.tenantId),
  ]);
  if (ctx.identity.staffRole) return ok(new Set(lessons.map((lesson) => lesson.id)));
  const member = memberScope(ctx);
  if (!member) return err(forbidden('Only members can search discussions'));
  const lookup = await resolveMemberAccessLookup(member, deps);
  return ok(accessibleLessons(courses, modules, lessons, lookup));
};

const accessibleLessons = (
  courses: Course[],
  modules: CourseModule[],
  lessons: CourseLesson[],
  lookup: AccessLookup,
): Set<string> => {
  const ids = new Set<string>();
  for (const lesson of lessons) {
    const location = locateLesson(lesson.id, courses, modules);
    if (
      location &&
      isLessonAccessibleByLookup(lookup, {
        courseId: location.course.id,
        moduleId: location.moduleId,
        lessonId: lesson.id,
      })
    ) {
      ids.add(lesson.id);
    }
  }
  return ids;
};

const postDepth = async (
  tenantId: string,
  post: Post,
  deps: Pick<CommunityDeps, 'posts'>,
): Promise<number> => {
  let depth = 1;
  let parentId = post.parentPostId;
  while (parentId !== null) {
    const parent = await deps.posts.findById(tenantId, parentId);
    if (!parent) return depth;
    depth += 1;
    parentId = parent.parentPostId;
  }
  return depth;
};

const nestReplies = (rootId: string, replies: Post[]): DiscussionPost[] => {
  const byParent = new Map<string, Post[]>();
  for (const reply of replies) {
    const parentId = reply.parentPostId ?? rootId;
    byParent.set(parentId, [...(byParent.get(parentId) ?? []), reply]);
  }
  const build = (post: Post): DiscussionPost => {
    const children = byParent.get(post.id) ?? [];
    return {
      ...renderPost(post),
      replyCount: children.length,
      replies: children.map(build),
    };
  };
  return (byParent.get(rootId) ?? []).map(build);
};

const snippet = (body: string): string => body.replace(/\s+/g, ' ').slice(0, 180);

const renderPost = (post: Post): Post =>
  post.deletedAt === null ? post : { ...post, body: 'Wpis usunięty' };

const notifySubscribers = async (
  tenantId: string,
  post: Post,
  deps: CommunityDeps,
  tenantName: string,
): Promise<Result<void, AppError>> => {
  const subscribers = await deps.threadSubscriptions.listSubscribersForRoot(tenantId, post.rootPostId);
  for (const subscriber of subscribers) {
    if (subscriber.userId === post.authorUserId || subscriber.mutedAt !== null) continue;
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
        authorDisplay: post.authorDisplay,
        snippet: snippet(post.body),
      },
      readAt: null,
      createdAt: deps.clock.nowIso(),
    };
    const inserted = await deps.notifications.insert(tenantId, notification);
    const member = await deps.tenantAccess.findMember(subscriber.userId, tenantId);
    const recipientEmail = member?.email ?? null;
    for (const channel of deps.notificationChannels) {
      const delivered = await channel.deliver(inserted, { recipientEmail, tenantName });
      if (!delivered.ok) return delivered;
    }
  }
  return ok(undefined);
};

export const createPost = async (
  ctx: Ctx,
  input: unknown,
  deps: CommunityDeps,
): Promise<Result<Post, AppError>> => {
  const actor = requireMemberOrStaff(ctx);
  if (!actor.ok) return actor;
  const parsed = createPostInputSchema.safeParse(input);
  if (!parsed.success) return err(validation('Invalid post payload', parsed.error.flatten()));
  const access = await lessonAccess(ctx, parsed.data.contextId, deps);
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
    const depth = await postDepth(actor.value.tenantId, parentPost, deps);
    if (depth >= 3) return err(validation('Reply depth is capped at 3'));
    rootPostId = parentPost.rootPostId;
  }
  const post: Post = {
    id: parentPost === null ? rootPostId : deps.ids.nextId(),
    tenantId: actor.value.tenantId,
    contextKind: parsed.data.contextKind,
    contextId: parsed.data.contextId,
    parentPostId: parentPost?.id ?? null,
    rootPostId,
    authorUserId: actor.value.userId,
    authorDisplay: ctx.identity.name,
    body,
    createdAt: deps.clock.nowIso(),
    editedAt: null,
    deletedAt: null,
  };
  const created = await deps.posts.createPost(actor.value.tenantId, post);
  await deps.threadSubscriptions.upsert(actor.value.tenantId, {
    userId: actor.value.userId,
    rootPostId: created.rootPostId,
    createdAt: created.createdAt,
  });
  if (parentPost !== null) {
    const notified = await notifySubscribers(actor.value.tenantId, created, deps, ctx.identity.tenantName ?? 'Together');
    if (!notified.ok) return notified;
  }
  return ok(created);
};

export const listDiscussion = async (
  ctx: Ctx,
  input: unknown,
  deps: CommunityDeps,
): Promise<Result<Discussion, AppError>> => {
  const scope = requireMemberOrStaff(ctx);
  if (!scope.ok) return scope;
  const parsed = listDiscussionInputSchema.safeParse(input);
  if (!parsed.success) return err(validation('Invalid discussion query', parsed.error.flatten()));
  const access = await lessonAccess(ctx, parsed.data.contextId, deps);
  if (!access.ok) return access;
  const listed = await deps.posts.listThreadsForContext(scope.value.tenantId, {
    contextKind: parsed.data.contextKind,
    contextId: parsed.data.contextId,
    limit: parsed.data.limit,
    ...(parsed.data.cursor === undefined ? {} : { cursor: parsed.data.cursor }),
  });
  const threads = await Promise.all(
    listed.threads.map(async (thread) => ({
      ...renderPost(thread.post),
      replyCount: thread.replyCount,
      replies: nestReplies(thread.post.id, await deps.posts.listReplies(scope.value.tenantId, thread.post.rootPostId)),
    })),
  );
  return ok({ threads, nextCursor: listed.nextCursor });
};

export const editPost = async (
  ctx: Ctx,
  input: unknown,
  deps: CommunityDeps,
): Promise<Result<Post, AppError>> => {
  const actor = requireActor(ctx);
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
  return updated ? ok(updated) : err(validation('Post not found'));
};

export const deletePost = async (
  ctx: Ctx,
  input: unknown,
  deps: CommunityDeps,
): Promise<Result<Post, AppError>> => {
  const actor = requireActor(ctx);
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
  return deleted ? ok(deleted) : err(validation('Post not found'));
};

export const subscribeThread = async (
  ctx: Ctx,
  input: unknown,
  deps: CommunityDeps,
): Promise<Result<{ rootPostId: string }, AppError>> => {
  const actor = requireMemberOrStaff(ctx);
  if (!actor.ok) return actor;
  const parsed = subscribeThreadInputSchema.safeParse(input);
  if (!parsed.success) return err(validation('Invalid thread subscription payload', parsed.error.flatten()));
  const root = await deps.posts.findById(actor.value.tenantId, parsed.data.rootPostId);
  if (!root) return err(validation('Thread not found'));
  const access = await lessonAccess(ctx, root.contextId, deps);
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
  const actor = requireMemberOrStaff(ctx);
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
  const tenant = requireTenant(ctx);
  if (!tenant.ok) return tenant;
  const parsed = searchPostsInputSchema.safeParse(input);
  if (!parsed.success) return err(validation('Invalid post search payload', parsed.error.flatten()));
  const accessible = await accessibleLessonIds(ctx, deps);
  if (!accessible.ok) return accessible;
  const requested = parsed.data.lessonIds ?? [...accessible.value];
  const lessonIds = requested.filter((lessonId) => accessible.value.has(lessonId));
  if (lessonIds.length === 0) return ok([]);
  return ok(await deps.posts.search(tenant.value.tenantId, { query: parsed.data.query, lessonIds, limit: parsed.data.limit }));
};

export const listNotifications = async (
  ctx: Ctx,
  input: unknown,
  deps: CommunityDeps,
): Promise<Result<{ notifications: Notification[]; nextCursor: string | null }, AppError>> => {
  const actor = requireActor(ctx);
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
  const actor = requireActor(ctx);
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
  const actor = requireActor(ctx);
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
  const actor = requireActor(ctx);
  if (!actor.ok) return actor;
  return ok({ unread: await deps.notifications.unreadCount(actor.value.tenantId, actor.value.userId) });
};
