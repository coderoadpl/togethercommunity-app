import {
  DEFAULT_LANGUAGE,
  appError,
  createSpaceInputSchema,
  deleteSpaceInputSchema,
  err,
  followSpaceInputSchema,
  listSpaceFeedInputSchema,
  markSpaceSeenInputSchema,
  MAX_PINNED_POSTS_PER_SPACE,
  notFound,
  ok,
  postSnippet,
  pinPostInputSchema,
  reactToPostInputSchema,
  renderPost,
  setSpaceArchivedInputSchema,
  spaceSchema,
  toPublicPost,
  updateSpaceInputSchema,
  validation,
  type AppError,
  type MemberSpace,
  type Notification,
  type Post,
  type ReactionEmoji,
  type ReactionSummary,
  type Result,
  type Space,
  type SpaceFeed,
  type StaffSpace,
} from '#core/domain/index.js';

import type { Ctx } from '../context.js';
import type {
  Clock,
  CourseModuleRepository,
  CourseRepository,
  DiscussionLinkPort,
  IdGenerator,
  NotificationChannelPort,
  NotificationRepository,
  PostReactionRepository,
  PostRepository,
  ProductGrantRepository,
  ProductRepository,
  SpaceRepository,
  SpaceSeenRepository,
  SpaceSubscriptionRepository,
  TenantAccessReader,
  TenantRepository,
} from '../ports.js';
import {
  lessonContextAccess,
  listAccessibleSpaces,
  requireActor,
  requireMemberOrStaff,
  spaceContextAccess,
  spaceVisibleToMemberScope,
  type ActorScope,
} from './community-access.js';

export interface SpacesDeps {
  spaces: SpaceRepository;
  posts: PostRepository;
  reactions: PostReactionRepository;
  spaceSubscriptions: SpaceSubscriptionRepository;
  spaceSeen: SpaceSeenRepository;
  notifications: NotificationRepository;
  notificationChannels: NotificationChannelPort[];
  courses: CourseRepository;
  modules: CourseModuleRepository;
  grants: ProductGrantRepository;
  products: ProductRepository;
  tenants: TenantRepository;
  tenantAccess: TenantAccessReader;
  links: DiscussionLinkPort;
  ids: IdGenerator;
  clock: Clock;
}

const requireStaff = (
  ctx: Ctx,
  capability: 'space:write' | 'community:pin',
): Result<ActorScope, AppError> => {
  return requireActor(ctx, capability);
};

const HOME_SPACE_STAYS_PUBLIC =
  'Point the tenant home space at another space before making this one non-public or archiving it';

const isDefaultHomeSpace = async (
  tenantId: string,
  spaceId: string,
  deps: Pick<SpacesDeps, 'tenants'>,
): Promise<boolean> => (await deps.tenants.findSettings(tenantId))?.defaultHomeSpaceId === spaceId;

export const createSpace = async (
  ctx: Ctx,
  input: unknown,
  deps: SpacesDeps,
): Promise<Result<Space, AppError>> => {
  const staff = requireStaff(ctx, 'space:write');
  if (!staff.ok) return staff;
  const parsed = createSpaceInputSchema.safeParse(input);
  if (!parsed.success) return err(validation('Invalid space payload', parsed.error.flatten()));
  const existing = await deps.spaces.findBySlug(staff.value.tenantId, parsed.data.slug);
  if (existing) return err(appError('conflict', `A space with slug "${parsed.data.slug}" already exists`));
  const record = spaceSchema.safeParse({
    id: deps.ids.nextId(),
    tenantId: staff.value.tenantId,
    slug: parsed.data.slug,
    name: parsed.data.name,
    description: parsed.data.description ?? null,
    visibility: parsed.data.visibility,
    productIds: parsed.data.productIds ?? [],
    publicReadOnly: parsed.data.publicReadOnly ?? false,
    position:
      parsed.data.position ??
      (await deps.spaces.list(staff.value.tenantId, { includeArchived: true })).length,
    createdAt: deps.clock.nowIso(),
  });
  if (!record.success) return err(validation('Invalid space payload', record.error.flatten()));
  if (record.data.visibility === 'product' && record.data.productIds.length === 0) {
    return err(validation('A product-gated space needs at least one product'));
  }
  await deps.spaces.create(staff.value.tenantId, record.data);
  if (record.data.publicReadOnly) await deps.products.bumpContentVersion(staff.value.tenantId);
  return ok(record.data);
};

export const updateSpace = async (
  ctx: Ctx,
  input: unknown,
  deps: SpacesDeps,
): Promise<Result<Space, AppError>> => {
  const staff = requireStaff(ctx, 'space:write');
  if (!staff.ok) return staff;
  const parsed = updateSpaceInputSchema.safeParse(input);
  if (!parsed.success) return err(validation('Invalid space update payload', parsed.error.flatten()));
  const space = await deps.spaces.findById(staff.value.tenantId, parsed.data.id);
  if (!space) return err(notFound('Space not found'));
  const next: Space = {
    ...space,
    name: parsed.data.name ?? space.name,
    description: parsed.data.description === undefined ? space.description : parsed.data.description,
    visibility: parsed.data.visibility ?? space.visibility,
    productIds: parsed.data.productIds ?? space.productIds,
    publicReadOnly: parsed.data.publicReadOnly ?? space.publicReadOnly,
    position: parsed.data.position ?? space.position,
  };
  if (next.visibility === 'product' && next.productIds.length === 0) {
    return err(validation('A product-gated space needs at least one product'));
  }
  if (!next.publicReadOnly && (await isDefaultHomeSpace(staff.value.tenantId, space.id, deps))) {
    return err(validation(HOME_SPACE_STAYS_PUBLIC));
  }
  const updated = await deps.spaces.update(staff.value.tenantId, next);
  if (!updated) return err(notFound('Space not found'));
  if (updated.publicReadOnly !== space.publicReadOnly) {
    await deps.products.bumpContentVersion(staff.value.tenantId);
  }
  return ok(updated);
};

export const deleteSpace = async (
  ctx: Ctx,
  input: unknown,
  deps: SpacesDeps,
): Promise<Result<{ spaceId: string }, AppError>> => {
  const staff = requireStaff(ctx, 'space:write');
  if (!staff.ok) return staff;
  const parsed = deleteSpaceInputSchema.safeParse(input);
  if (!parsed.success) return err(validation('Invalid space delete payload', parsed.error.flatten()));
  const deleted = await deps.spaces.delete(staff.value.tenantId, parsed.data.id);
  return deleted ? ok({ spaceId: parsed.data.id }) : err(notFound('Space not found'));
};

/** Soft archive/restore: an archived space is hidden from members but keeps its posts and followers. */
export const setSpaceArchived = async (
  ctx: Ctx,
  input: unknown,
  deps: SpacesDeps,
): Promise<Result<Space, AppError>> => {
  const staff = requireStaff(ctx, 'space:write');
  if (!staff.ok) return staff;
  const parsed = setSpaceArchivedInputSchema.safeParse(input);
  if (!parsed.success) return err(validation('Invalid space archive payload', parsed.error.flatten()));
  if (parsed.data.archived && (await isDefaultHomeSpace(staff.value.tenantId, parsed.data.id, deps))) {
    return err(validation(HOME_SPACE_STAYS_PUBLIC));
  }
  const updated = await deps.spaces.setArchived(staff.value.tenantId, {
    id: parsed.data.id,
    archivedAt: parsed.data.archived ? deps.clock.nowIso() : null,
  });
  if (!updated) return err(notFound('Space not found'));
  if (updated.publicReadOnly) await deps.products.bumpContentVersion(staff.value.tenantId);
  return ok(updated);
};

/** Panel listing: every space including archived, each with its post and follower counts. */
export const listSpacesForStaff = async (
  ctx: Ctx,
  deps: SpacesDeps,
): Promise<Result<StaffSpace[], AppError>> => {
  const staff = requireStaff(ctx, 'space:write');
  if (!staff.ok) return staff;
  const spaces = await deps.spaces.list(staff.value.tenantId, { includeArchived: true });
  const stats = await deps.spaces.stats(
    staff.value.tenantId,
    spaces.map((space) => space.id),
  );
  return ok(
    spaces.map((space): StaffSpace => ({ ...space, stats: stats.get(space.id) ?? { posts: 0, followers: 0 } })),
  );
};

export const listSpacesForMember = async (
  ctx: Ctx,
  deps: SpacesDeps,
): Promise<Result<MemberSpace[], AppError>> => {
  const actor = requireMemberOrStaff(ctx, 'space:read');
  if (!actor.ok) return actor;
  const visible = await listAccessibleSpaces(ctx, deps);
  if (!visible.ok) return visible;
  const followed = await deps.spaceSubscriptions.listForUser(actor.value.tenantId, {
    userId: actor.value.userId,
    spaceIds: visible.value.map((space) => space.id),
  });
  const followedIds = new Set(followed.map((subscription) => subscription.spaceId));
  return ok(
    visible.value.map((space): MemberSpace => ({ ...space, isFollowing: followedIds.has(space.id) })),
  );
};

export const getSpaceFeed = async (
  ctx: Ctx,
  input: unknown,
  deps: SpacesDeps,
): Promise<Result<SpaceFeed, AppError>> => {
  const actor = requireMemberOrStaff(ctx, 'space:read');
  if (!actor.ok) return actor;
  const parsed = listSpaceFeedInputSchema.safeParse(input);
  if (!parsed.success) return err(validation('Invalid space feed query', parsed.error.flatten()));
  const space = await spaceContextAccess(ctx, parsed.data.spaceId, deps);
  if (!space.ok) return space;
  const [listed, pinnedPosts] = await Promise.all([
    deps.posts.listThreadsForContext(actor.value.tenantId, {
      contextKind: 'space',
      contextId: space.value.id,
      limit: parsed.data.limit,
      order: 'desc',
      ...(parsed.data.cursor === undefined ? {} : { cursor: parsed.data.cursor }),
    }),
    deps.posts.listPinnedForContext(actor.value.tenantId, {
      contextKind: 'space',
      contextId: space.value.id,
      limit: MAX_PINNED_POSTS_PER_SPACE,
    }),
  ]);
  const pinnedIds = new Set(pinnedPosts.map((post) => post.id));
  const reactions = await deps.reactions.summarize(actor.value.tenantId, {
    postIds: [...listed.threads.map((thread) => thread.post.id), ...pinnedIds],
    viewerUserId: actor.value.userId,
  });
  const pinnedReplies = await Promise.all(
    pinnedPosts.map((post) => deps.posts.listReplies(actor.value.tenantId, post.rootPostId)),
  );
  const followed = await deps.spaceSubscriptions.listForUser(actor.value.tenantId, {
    userId: actor.value.userId,
    spaceIds: [space.value.id],
  });
  return ok({
    spaceId: space.value.id,
    pinned: pinnedPosts.map((post, index) => ({
      ...toPublicPost(renderPost(post), actor.value.userId),
      replyCount: pinnedReplies[index]?.length ?? 0,
      reactions: reactions.get(post.id) ?? [],
    })),
    items: listed.threads
      .filter((thread) => !pinnedIds.has(thread.post.id))
      .map((thread) => ({
        ...toPublicPost(renderPost(thread.post), actor.value.userId),
        replyCount: thread.replyCount,
        reactions: reactions.get(thread.post.id) ?? [],
      })),
    nextCursor: listed.nextCursor,
    isFollowing: followed.length > 0,
  });
};

export const setPostPinned = async (
  ctx: Ctx,
  input: unknown,
  deps: SpacesDeps,
): Promise<Result<Post, AppError>> => {
  const staff = requireStaff(ctx, 'community:pin');
  if (!staff.ok) return staff;
  const parsed = pinPostInputSchema.safeParse(input);
  if (!parsed.success) return err(validation('Invalid post pin payload', parsed.error.flatten()));
  const post = await deps.posts.findById(staff.value.tenantId, parsed.data.postId);
  if (post === null || post.deletedAt !== null) return err(notFound('Post not found'));
  if (post.contextKind !== 'space') return err(validation('Only space posts can be pinned'));
  if (post.parentPostId !== null) return err(validation('Only root posts can be pinned'));
  if (parsed.data.pinned && post.pinnedAt === null) {
    const count = await deps.posts.countPinnedForContext(staff.value.tenantId, {
      contextKind: 'space',
      contextId: post.contextId,
    });
    if (count >= MAX_PINNED_POSTS_PER_SPACE) {
      return err(appError('conflict', 'A space can have at most five pinned posts'));
    }
  }
  const updated = await deps.posts.setPinned(staff.value.tenantId, {
    id: post.id,
    pinnedAt: parsed.data.pinned ? deps.clock.nowIso() : null,
  });
  return updated === null ? err(notFound('Post not found')) : ok(updated);
};

export const followSpace = async (
  ctx: Ctx,
  input: unknown,
  deps: SpacesDeps,
): Promise<Result<{ spaceId: string; isFollowing: boolean }, AppError>> => {
  const actor = requireMemberOrStaff(ctx, 'space:interact');
  if (!actor.ok) return actor;
  const parsed = followSpaceInputSchema.safeParse(input);
  if (!parsed.success) return err(validation('Invalid space follow payload', parsed.error.flatten()));
  const space = await spaceContextAccess(ctx, parsed.data.spaceId, deps);
  if (!space.ok) return space;
  await deps.spaceSubscriptions.follow(actor.value.tenantId, {
    userId: actor.value.userId,
    spaceId: space.value.id,
    createdAt: deps.clock.nowIso(),
  });
  return ok({ spaceId: space.value.id, isFollowing: true });
};

export const unfollowSpace = async (
  ctx: Ctx,
  input: unknown,
  deps: SpacesDeps,
): Promise<Result<{ spaceId: string; isFollowing: boolean }, AppError>> => {
  const actor = requireMemberOrStaff(ctx, 'space:interact');
  if (!actor.ok) return actor;
  const parsed = followSpaceInputSchema.safeParse(input);
  if (!parsed.success) return err(validation('Invalid space follow payload', parsed.error.flatten()));
  await deps.spaceSubscriptions.unfollow(actor.value.tenantId, {
    userId: actor.value.userId,
    spaceId: parsed.data.spaceId,
  });
  return ok({ spaceId: parsed.data.spaceId, isFollowing: false });
};

/** The write behind the sidebar dot: `getMemberNavigation` compares this mark with the newest root post. */
export const markSpaceSeen = async (
  ctx: Ctx,
  input: unknown,
  deps: SpacesDeps,
): Promise<Result<{ spaceId: string; seenAt: string }, AppError>> => {
  const actor = requireMemberOrStaff(ctx, 'space:interact');
  if (!actor.ok) return actor;
  const parsed = markSpaceSeenInputSchema.safeParse(input);
  if (!parsed.success) return err(validation('Invalid space seen payload', parsed.error.flatten()));
  const space = await spaceContextAccess(ctx, parsed.data.spaceId, deps);
  if (!space.ok) return space;
  const seenAt = deps.clock.nowIso();
  await deps.spaceSeen.markSeen(actor.value.tenantId, {
    userId: actor.value.userId,
    spaceId: space.value.id,
    seenAt,
  });
  return ok({ spaceId: space.value.id, seenAt });
};

const postContextAccess = async (ctx: Ctx, post: Post, deps: SpacesDeps): Promise<Result<void, AppError>> => {
  if (post.contextKind === 'lesson') return lessonContextAccess(ctx, post.contextId, deps);
  const space = await spaceContextAccess(ctx, post.contextId, deps);
  return space.ok ? ok(undefined) : space;
};

const reactionOutcome = async (
  ctx: Ctx,
  input: unknown,
  deps: SpacesDeps,
  apply: (
    tenantId: string,
    reaction: { postId: string; userId: string; emoji: ReactionEmoji },
  ) => Promise<unknown>,
): Promise<Result<{ postId: string; reactions: ReactionSummary[] }, AppError>> => {
  const actor = requireMemberOrStaff(ctx, 'space:interact');
  if (!actor.ok) return actor;
  const parsed = reactToPostInputSchema.safeParse(input);
  if (!parsed.success) return err(validation('Invalid reaction payload', parsed.error.flatten()));
  const post = await deps.posts.findById(actor.value.tenantId, parsed.data.postId);
  if (!post || post.deletedAt !== null) return err(notFound('Post not found'));
  const access = await postContextAccess(ctx, post, deps);
  if (!access.ok) return access;
  await apply(actor.value.tenantId, {
    postId: post.id,
    userId: actor.value.userId,
    emoji: parsed.data.emoji,
  });
  const summaries = await deps.reactions.summarize(actor.value.tenantId, {
    postIds: [post.id],
    viewerUserId: actor.value.userId,
  });
  return ok({ postId: post.id, reactions: summaries.get(post.id) ?? [] });
};

export const reactToPost = async (
  ctx: Ctx,
  input: unknown,
  deps: SpacesDeps,
): Promise<Result<{ postId: string; reactions: ReactionSummary[] }, AppError>> => {
  const actor = requireMemberOrStaff(ctx, 'space:interact');
  if (!actor.ok) return actor;
  return reactionOutcome(ctx, input, deps, (tenantId, reaction) =>
    deps.reactions.add(tenantId, { ...reaction, createdAt: deps.clock.nowIso() }),
  );
};

export const unreactToPost = async (
  ctx: Ctx,
  input: unknown,
  deps: SpacesDeps,
): Promise<Result<{ postId: string; reactions: ReactionSummary[] }, AppError>> => {
  const actor = requireMemberOrStaff(ctx, 'space:interact');
  if (!actor.ok) return actor;
  return reactionOutcome(ctx, input, deps, (tenantId, reaction) => deps.reactions.remove(tenantId, reaction));
};

export interface SpaceNotifyDeps {
  spaceSubscriptions: SpaceSubscriptionRepository;
  notifications: NotificationRepository;
  notificationChannels: NotificationChannelPort[];
  grants: ProductGrantRepository;
  tenantAccess: TenantAccessReader;
  links: DiscussionLinkPort;
  ids: IdGenerator;
  clock: Clock;
}

/** Fan-out for a new root post in a space: every follower except the author, entitlement-gated. */
export const notifySpaceFollowers = async (
  tenantId: string,
  post: Post,
  space: Space,
  deps: SpaceNotifyDeps,
  tenant: { tenantName: string; tenantSlug: string | null },
): Promise<Result<void, AppError>> => {
  const followers = await deps.spaceSubscriptions.listFollowersForSpace(tenantId, space.id);
  if (followers.length === 0) return ok(undefined);
  const spaceUrl = deps.links.spaceUrl({
    tenantSlug: tenant.tenantSlug,
    spaceId: space.id,
    rootPostId: post.rootPostId,
  });
  for (const follower of followers) {
    if (follower.userId === post.authorUserId) continue;
    const [staffGrant, member] = await Promise.all([
      deps.tenantAccess.findStaffGrant(follower.userId, { tenantId }),
      deps.tenantAccess.findMember(tenantId, follower.userId),
    ]);
    const memberCanAccess =
      member !== null &&
      (await spaceVisibleToMemberScope({ tenantId, memberId: member.id }, space, deps));
    if (staffGrant === null && !memberCanAccess) continue;
    const notification: Notification = {
      id: deps.ids.nextId(),
      tenantId,
      recipientUserId: follower.userId,
      kind: 'space-post',
      payload: {
        rootPostId: post.rootPostId,
        postId: post.id,
        contextKind: 'space',
        contextId: space.id,
        courseId: null,
        lessonName: space.name,
        authorDisplay: post.authorDisplay,
        snippet: postSnippet(post.body),
      },
      readAt: null,
      createdAt: deps.clock.nowIso(),
    };
    const inserted = await deps.notifications.insert(tenantId, notification);
    for (const channel of deps.notificationChannels) {
      const delivered = await channel.deliver(inserted, {
        recipientEmail: member?.email ?? null,
        tenantName: tenant.tenantName,
        contextName: space.name,
        contextUrl: spaceUrl,
        language: DEFAULT_LANGUAGE,
      });
      if (!delivered.ok) return delivered;
    }
  }
  return ok(undefined);
};
