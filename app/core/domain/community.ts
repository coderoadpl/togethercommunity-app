import { z } from 'zod';

export const postContextKindSchema = z.literal('lesson');

export type PostContextKind = z.output<typeof postContextKindSchema>;

export const postSchema = z.object({
  id: z.string().min(1),
  tenantId: z.string().min(1),
  contextKind: postContextKindSchema,
  contextId: z.string().min(1),
  parentPostId: z.string().min(1).nullable(),
  rootPostId: z.string().min(1),
  authorUserId: z.string().min(1),
  authorDisplay: z.string().min(1),
  body: z.string().min(1).max(5000),
  createdAt: z.string().datetime(),
  editedAt: z.string().datetime().nullable(),
  deletedAt: z.string().datetime().nullable(),
});

export type Post = z.output<typeof postSchema>;

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
  limit: z.number().int().min(1).max(50).default(20),
});

export type SearchPostsInput = z.input<typeof searchPostsInputSchema>;

export const notificationKindSchema = z.literal('thread-reply');

export type NotificationKind = z.output<typeof notificationKindSchema>;

export const threadReplyNotificationPayloadSchema = z.object({
  rootPostId: z.string().min(1),
  postId: z.string().min(1),
  contextKind: postContextKindSchema,
  contextId: z.string().min(1),
  authorDisplay: z.string().min(1),
  snippet: z.string(),
});

export type ThreadReplyNotificationPayload = z.output<typeof threadReplyNotificationPayloadSchema>;

export const notificationSchema = z.object({
  id: z.string().min(1),
  tenantId: z.string().min(1),
  recipientUserId: z.string().min(1),
  kind: notificationKindSchema,
  payload: threadReplyNotificationPayloadSchema,
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

export type DiscussionPost = Post & {
  replies: DiscussionPost[];
  replyCount: number;
};

export const discussionPostSchema: z.ZodType<DiscussionPost> = postSchema.extend({
  replies: z.lazy(() => z.array(discussionPostSchema)),
  replyCount: z.number().int().nonnegative(),
});

export const discussionSchema = z.object({
  threads: z.array(discussionPostSchema),
  nextCursor: z.string().nullable(),
});

export type Discussion = z.output<typeof discussionSchema>;

export const postSearchHitSchema = z.object({
  post: postSchema,
  lessonId: z.string().min(1),
  snippet: z.string(),
});

export type PostSearchHit = z.output<typeof postSearchHitSchema>;
