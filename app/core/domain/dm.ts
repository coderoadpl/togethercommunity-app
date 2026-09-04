import { z } from 'zod';

export const DM_BODY_MAX_LENGTH = 5000;

export const DM_MESSAGE_RATE_LIMIT = { maxMessages: 20, windowSeconds: 60 } as const;

export const DM_CONVERSATION_RATE_LIMIT = { maxConversations: 10, windowSeconds: 3600 } as const;

export const dmConversationSchema = z.object({
  id: z.string().min(1),
  tenantId: z.string().min(1),
  participantLowUserId: z.string().min(1),
  participantHighUserId: z.string().min(1),
  createdByUserId: z.string().min(1),
  createdAt: z.string().datetime(),
  lastMessageId: z.string().min(1).nullable(),
  lastMessageAt: z.string().datetime(),
  lastMessageSnippet: z.string(),
  lastMessageSenderUserId: z.string().min(1),
});

export type DmConversation = z.output<typeof dmConversationSchema>;

export const dmMessageSchema = z.object({
  id: z.string().min(1),
  tenantId: z.string().min(1),
  conversationId: z.string().min(1),
  senderUserId: z.string().min(1),
  body: z.string().min(1).max(DM_BODY_MAX_LENGTH),
  createdAt: z.string().datetime(),
});

export type DmMessage = z.output<typeof dmMessageSchema>;

export const DM_REPORT_SNAPSHOT_SIZE = 20;

export const memberBlockSchema = z.object({
  tenantId: z.string().min(1),
  blockerUserId: z.string().min(1),
  blockedUserId: z.string().min(1),
  createdAt: z.string().datetime(),
});

export type MemberBlock = z.output<typeof memberBlockSchema>;

export interface DmBlockDirections {
  blockedByViewer: boolean;
  blocksViewer: boolean;
}

export const NO_DM_BLOCKS: DmBlockDirections = { blockedByViewer: false, blocksViewer: false };

export const dmConversationStateSchema = z.object({
  tenantId: z.string().min(1),
  conversationId: z.string().min(1),
  userId: z.string().min(1),
  lastReadAt: z.string().datetime(),
});

export type DmConversationState = z.output<typeof dmConversationStateSchema>;

/**
 * Client projection: raw participant user ids never leave the server, the other
 * participant is pre-resolved and unread is computed against the viewer cursor.
 * `canSend` collapses every reason the thread is closed (either block direction,
 * opt-out, ban) into one neutral flag, so it never says who blocked whom.
 */
export const publicDmConversationSchema = z.object({
  id: z.string().min(1),
  otherParticipant: z.object({
    display: z.string().min(1),
    avatarUrl: z.string().nullable(),
    isStaff: z.boolean(),
  }),
  lastMessageAt: z.string().datetime(),
  lastMessageSnippet: z.string(),
  lastMessageIsOwn: z.boolean(),
  hasMessages: z.boolean(),
  unread: z.boolean(),
  blockedByViewer: z.boolean().default(false),
  canSend: z.boolean().default(true),
});

export type PublicDmConversation = z.output<typeof publicDmConversationSchema>;

export const publicDmMessageSchema = z.object({
  id: z.string().min(1),
  conversationId: z.string().min(1),
  body: z.string().min(1).max(DM_BODY_MAX_LENGTH),
  createdAt: z.string().datetime(),
  isOwn: z.boolean(),
});

export type PublicDmMessage = z.output<typeof publicDmMessageSchema>;

export const startDmConversationInputSchema = z.object({
  recipient: z.discriminatedUnion('kind', [
    z.object({ kind: z.literal('member'), memberId: z.string().min(1) }),
    z.object({ kind: z.literal('post-author'), postId: z.string().min(1) }),
  ]),
});

export const sendDmMessageInputSchema = z.object({
  conversationId: z.string().min(1),
  body: z.string().min(1).max(DM_BODY_MAX_LENGTH),
});

const dmCursorSchema = z.string().min(1).superRefine((value, ctx) => {
  const separator = value.indexOf('|');
  if (
    separator === -1
    || !z.string().datetime().safeParse(value.slice(0, separator)).success
    || value.slice(separator + 1).length === 0
  ) {
    ctx.addIssue({ code: z.ZodIssueCode.custom, message: 'Invalid direct message cursor' });
  }
});

export const listDmConversationsInputSchema = z.object({
  cursor: dmCursorSchema.optional(),
  limit: z.number().int().min(1).max(100).default(20),
});

export const listDmMessagesInputSchema = z.object({
  conversationId: z.string().min(1),
  cursor: dmCursorSchema.optional(),
  limit: z.number().int().min(1).max(100).default(50),
});

export const dmConversationRefSchema = z.object({
  conversationId: z.string().min(1),
});

/** Canonical pair ordering keeps one conversation row per unordered user pair. */
export const canonicalDmParticipants = (
  left: string,
  right: string,
): { low: string; high: string } =>
  left < right ? { low: left, high: right } : { low: right, high: left };

export const dmParticipants = (conversation: DmConversation): [string, string] => [
  conversation.participantLowUserId,
  conversation.participantHighUserId,
];

export const otherDmParticipant = (conversation: DmConversation, viewerUserId: string): string =>
  conversation.participantLowUserId === viewerUserId
    ? conversation.participantHighUserId
    : conversation.participantLowUserId;

export const toPublicDmMessage = (message: DmMessage, viewerUserId: string): PublicDmMessage => ({
  id: message.id,
  conversationId: message.conversationId,
  body: message.body,
  createdAt: message.createdAt,
  isOwn: message.senderUserId === viewerUserId,
});

export const toPublicDmConversation = (
  conversation: DmConversation,
  viewer: { userId: string; lastReadAt: string | null },
  otherParticipant: PublicDmConversation['otherParticipant'],
  reachability: { blocks: DmBlockDirections; recipientReachable: boolean },
): PublicDmConversation => {
  const lastMessageIsOwn = conversation.lastMessageSenderUserId === viewer.userId;
  const blocked = reachability.blocks.blockedByViewer || reachability.blocks.blocksViewer;
  return {
    id: conversation.id,
    otherParticipant,
    lastMessageAt: conversation.lastMessageAt,
    lastMessageSnippet: conversation.lastMessageSnippet,
    lastMessageIsOwn,
    hasMessages: conversation.lastMessageId !== null,
    unread:
      conversation.lastMessageId !== null
      && !lastMessageIsOwn
      && (viewer.lastReadAt === null || conversation.lastMessageAt > viewer.lastReadAt),
    blockedByViewer: reachability.blocks.blockedByViewer,
    canSend: !blocked && reachability.recipientReachable,
  };
};
