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
  createdAt: z.string().datetime(),
});

export type Space = z.output<typeof spaceSchema>;

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

export type CreateSpaceInput = z.input<typeof createSpaceInputSchema>;

export const updateSpaceInputSchema = z.object({
  id: z.string().min(1),
  name: spaceSchema.shape.name.optional(),
  description: z.string().max(2000).nullable().optional(),
  visibility: spaceVisibilitySchema.optional(),
  productIds: z.array(z.string().min(1)).optional(),
  position: z.number().int().nonnegative().optional(),
});

export type UpdateSpaceInput = z.input<typeof updateSpaceInputSchema>;

export const deleteSpaceInputSchema = z.object({
  id: z.string().min(1),
});

export type DeleteSpaceInput = z.input<typeof deleteSpaceInputSchema>;

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

export type ReactToPostInput = z.input<typeof reactToPostInputSchema>;

export const spaceFeedItemSchema = publicPostSchema.extend({
  replyCount: z.number().int().nonnegative(),
  reactions: z.array(reactionSummarySchema),
});

export type SpaceFeedItem = z.output<typeof spaceFeedItemSchema>;

export const spaceFeedSchema = z.object({
  spaceId: z.string().min(1),
  items: z.array(spaceFeedItemSchema),
  nextCursor: z.string().nullable(),
  isFollowing: z.boolean(),
});

export type SpaceFeed = z.output<typeof spaceFeedSchema>;

export const listSpaceFeedInputSchema = z.object({
  spaceId: z.string().min(1),
  cursor: z.string().optional(),
  limit: z.number().int().min(1).max(100).default(20),
});

export type ListSpaceFeedInput = z.input<typeof listSpaceFeedInputSchema>;

export const followSpaceInputSchema = z.object({
  spaceId: z.string().min(1),
});

export type FollowSpaceInput = z.input<typeof followSpaceInputSchema>;
