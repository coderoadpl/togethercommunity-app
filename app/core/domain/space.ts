import { z } from 'zod';

import { publicPostSchema } from './community.js';

export const spaceVisibilitySchema = z.enum(['members', 'product']);

export type SpaceVisibility = z.output<typeof spaceVisibilitySchema>;

export const spaceSchema = z.object({
  id: z.string().min(1),
  tenantId: z.string().min(1),
  slug: z
    .string()
    .min(1)
    .max(80)
    .regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/),
  name: z.string().trim().min(1).max(120),
  description: z.string().max(2000).nullable(),
  visibility: spaceVisibilitySchema,
  productIds: z.array(z.string().min(1)).default([]),
  position: z.number().int().nonnegative(),
  archivedAt: z.string().datetime().nullable().default(null),
  createdAt: z.string().datetime(),
});

export type Space = z.output<typeof spaceSchema>;

const spaceStatsSchema = z.object({
  posts: z.number().int().nonnegative(),
  followers: z.number().int().nonnegative(),
});

export type SpaceStats = z.output<typeof spaceStatsSchema>;

/** A space as its creator sees it in the panel: with engagement stats resolved server-side. */
export const staffSpaceSchema = spaceSchema.extend({
  stats: spaceStatsSchema,
});

export type StaffSpace = z.output<typeof staffSpaceSchema>;

/** A space as a member sees it: with the viewer's follow state resolved server-side. */
export const memberSpaceSchema = spaceSchema.extend({
  isFollowing: z.boolean(),
});

export type MemberSpace = z.output<typeof memberSpaceSchema>;

export const createSpaceInputSchema = z.object({
  slug: spaceSchema.shape.slug,
  name: spaceSchema.shape.name,
  description: z.string().max(2000).optional(),
  visibility: spaceVisibilitySchema,
  productIds: z.array(z.string().min(1)).optional(),
  position: z.number().int().nonnegative().optional(),
});


export const updateSpaceInputSchema = z.object({
  id: z.string().min(1),
  name: spaceSchema.shape.name.optional(),
  description: z.string().max(2000).nullable().optional(),
  visibility: spaceVisibilitySchema.optional(),
  productIds: z.array(z.string().min(1)).optional(),
  position: z.number().int().nonnegative().optional(),
});


export const deleteSpaceInputSchema = z.object({
  id: z.string().min(1),
});


export const setSpaceArchivedInputSchema = z.object({
  id: z.string().min(1),
  archived: z.boolean(),
});


export const REACTION_EMOJIS = ['👍', '❤️', '🎉', '💡', '😂'] as const;

export const reactionEmojiSchema = z.enum(REACTION_EMOJIS);

export type ReactionEmoji = z.output<typeof reactionEmojiSchema>;

export const reactionSummarySchema = z.object({
  emoji: reactionEmojiSchema,
  count: z.number().int().positive(),
  viewerReacted: z.boolean(),
});

export type ReactionSummary = z.output<typeof reactionSummarySchema>;

export const reactToPostInputSchema = z.object({
  postId: z.string().min(1),
  emoji: reactionEmojiSchema,
});


const spaceFeedItemSchema = publicPostSchema.extend({
  replyCount: z.number().int().nonnegative(),
  reactions: z.array(reactionSummarySchema),
});

export type SpaceFeedItem = z.output<typeof spaceFeedItemSchema>;

export const spaceFeedSchema = z.object({
  spaceId: z.string().min(1),
  items: z.array(spaceFeedItemSchema),
  pinned: z.array(spaceFeedItemSchema).default([]),
  nextCursor: z.string().nullable(),
  isFollowing: z.boolean(),
});

export type SpaceFeed = z.output<typeof spaceFeedSchema>;

export const listSpaceFeedInputSchema = z.object({
  spaceId: z.string().min(1),
  cursor: z.string().optional(),
  limit: z.number().int().min(1).max(100).default(20),
});


const memberHomeFeedItemSchema = spaceFeedItemSchema.extend({
  spaceId: z.string().min(1),
  spaceName: z.string(),
});

export type MemberHomeFeedItem = z.output<typeof memberHomeFeedItemSchema>;

export const memberHomeFeedSchema = z.object({
  items: z.array(memberHomeFeedItemSchema),
  nextCursor: z.string().nullable(),
});

export type MemberHomeFeed = z.output<typeof memberHomeFeedSchema>;

export const memberHomeFeedInputSchema = z.object({
  cursor: z.string().optional(),
  limit: z.number().int().min(1).max(50).default(10),
});

export const followSpaceInputSchema = z.object({
  spaceId: z.string().min(1),
});

export const markSpaceSeenInputSchema = z.object({
  spaceId: z.string().min(1),
});
