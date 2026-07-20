import { z } from 'zod';

export const postContextKindSchema = z.enum(['lesson', 'space']);

export type PostContextKind = z.output<typeof postContextKindSchema>;

export const postSchema = z.object({
  id: z.string().min(1),
  tenantId: z.string().min(1),
  contextKind: postContextKindSchema,
  contextId: z.string().min(1),
  parentPostId: z.string().min(1).nullable(),
  rootPostId: z.string().min(1),
  authorUserId: z.string().min(1),
  authorDisplay: z.string().trim().min(1),
  // Default keeps rows persisted before this field existed parseable.
  authorIsStaff: z.boolean().default(false),
  body: z.string().min(1).max(5000),
  createdAt: z.string().datetime(),
  editedAt: z.string().datetime().nullable(),
  deletedAt: z.string().datetime().nullable(),
});

export type Post = z.output<typeof postSchema>;

/**
 * What a client is allowed to see: the raw authorUserId is dropped and ownership is
 * pre-computed server-side into isOwn (author checks and moderation stay on the server).
 */
export const publicPostSchema = postSchema.omit({ authorUserId: true }).extend({
  isOwn: z.boolean(),
});

export type PublicPost = z.output<typeof publicPostSchema>;

export const createPostInputSchema = z.object({
  contextKind: postContextKindSchema,
  contextId: z.string().min(1),
  parentPostId: z.string().min(1).optional(),
  body: z.string().min(1).max(5000),
});

export type CreatePostInput = z.input<typeof createPostInputSchema>;

export const updatePostInputSchema = z.object({
  id: z.string().min(1),
  body: z.string().min(1).max(5000),
});

export type UpdatePostInput = z.input<typeof updatePostInputSchema>;

export const deletePostInputSchema = z.object({
  id: z.string().min(1),
});

export type DeletePostInput = z.input<typeof deletePostInputSchema>;

export const listDiscussionInputSchema = z.object({
  contextKind: postContextKindSchema,
  contextId: z.string().min(1),
  cursor: z.string().optional(),
  limit: z.number().int().min(1).max(100).default(20),
});

export type ListDiscussionInput = z.input<typeof listDiscussionInputSchema>;

export const subscribeThreadInputSchema = z.object({
  rootPostId: z.string().min(1),
});

export type SubscribeThreadInput = z.input<typeof subscribeThreadInputSchema>;

export const muteThreadInputSchema = z.object({
  rootPostId: z.string().min(1),
});

export type MuteThreadInput = z.input<typeof muteThreadInputSchema>;

export const searchPostsInputSchema = z.object({
  query: z.string().trim().min(1),
  lessonIds: z.array(z.string().min(1)).optional(),
  spaceIds: z.array(z.string().min(1)).optional(),
  limit: z.number().int().min(1).max(50).default(20),
});

export type SearchPostsInput = z.input<typeof searchPostsInputSchema>;

export const notificationKindSchema = z.enum(['thread-reply', 'space-post', 'lesson-question']);

export type NotificationKind = z.output<typeof notificationKindSchema>;

/**
 * One payload shape for every notification kind so clients render without
 * narrowing: `lessonName` holds the lesson name for lesson contexts and the
 * space name for space contexts (courseId stays null there).
 */
export const notificationPayloadSchema = z.object({
  rootPostId: z.string().min(1),
  postId: z.string().min(1),
  contextKind: postContextKindSchema,
  contextId: z.string().min(1),
  // Defaults keep rows persisted before these fields existed parseable.
  courseId: z.string().min(1).nullable().default(null),
  lessonName: z.string().default(''),
  authorDisplay: z.string().trim().min(1),
  snippet: z.string(),
});

export type NotificationPayload = z.output<typeof notificationPayloadSchema>;

export const notificationSchema = z.object({
  id: z.string().min(1),
  tenantId: z.string().min(1),
  recipientUserId: z.string().min(1),
  kind: notificationKindSchema,
  payload: notificationPayloadSchema,
  readAt: z.string().datetime().nullable(),
  createdAt: z.string().datetime(),
});

export type Notification = z.output<typeof notificationSchema>;

export const notificationListInputSchema = z.object({
  cursor: z.string().optional(),
  limit: z.number().int().min(1).max(100).default(20),
});

export type NotificationListInput = z.input<typeof notificationListInputSchema>;

export const notificationMarkReadInputSchema = z.object({
  id: z.string().min(1),
});

export type NotificationMarkReadInput = z.input<typeof notificationMarkReadInputSchema>;

export type DiscussionPost = PublicPost & {
  replies: DiscussionPost[];
  replyCount: number;
};

type DiscussionPostInput = z.input<typeof publicPostSchema> & {
  replies: DiscussionPostInput[];
  replyCount: number;
};

export const discussionPostSchema: z.ZodType<DiscussionPost, z.ZodTypeDef, DiscussionPostInput> =
  publicPostSchema.extend({
    replies: z.lazy(() => z.array(discussionPostSchema)),
    replyCount: z.number().int().nonnegative(),
  });

export const threadSubscriptionStateSchema = z.enum(['subscribed', 'muted']);

export type ThreadSubscriptionState = z.output<typeof threadSubscriptionStateSchema>;

export const discussionSchema = z.object({
  threads: z.array(discussionPostSchema),
  nextCursor: z.string().nullable(),
  // Default keeps envelopes produced before this field existed parseable.
  viewerSubscriptions: z.record(threadSubscriptionStateSchema).default({}),
});

export type Discussion = z.output<typeof discussionSchema>;

export const postSearchHitSchema = z.object({
  post: publicPostSchema,
  /** The post's contextId: a lesson id for lesson posts, a space id for space posts. */
  lessonId: z.string().min(1),
  snippet: z.string(),
});

export type PostSearchHit = z.output<typeof postSearchHitSchema>;

export const DELETED_POST_PLACEHOLDER = 'Wpis usunięty';

/** Soft-deleted posts keep the thread shape but never leak their body. */
export const renderPost = (post: Post): Post =>
  post.deletedAt === null ? post : { ...post, body: DELETED_POST_PLACEHOLDER };

/** Client projection: the raw author id is dropped, ownership pre-computed into isOwn. */
export const toPublicPost = (post: Post, viewerUserId: string): PublicPost => ({
  id: post.id,
  tenantId: post.tenantId,
  contextKind: post.contextKind,
  contextId: post.contextId,
  parentPostId: post.parentPostId,
  rootPostId: post.rootPostId,
  authorDisplay: post.authorDisplay,
  authorIsStaff: post.authorIsStaff,
  body: post.body,
  createdAt: post.createdAt,
  editedAt: post.editedAt,
  deletedAt: post.deletedAt,
  isOwn: post.authorUserId === viewerUserId,
});

export const postSnippet = (body: string): string => body.replace(/\s+/g, ' ').slice(0, 180);
