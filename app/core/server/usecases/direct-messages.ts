import {
  DEFAULT_LANGUAGE,
  DM_CONVERSATION_RATE_LIMIT,
  DM_MESSAGE_RATE_LIMIT,
  canonicalDmParticipants,
  dmConversationRefSchema,
  dmConversationSchema,
  dmMessageSchema,
  dmParticipants,
  err,
  forbidden,
  internal,
  listDmConversationsInputSchema,
  listDmMessagesInputSchema,
  notFound,
  ok,
  otherDmParticipant,
  postSnippet,
  rateLimited,
  sendDmMessageInputSchema,
  startDmConversationInputSchema,
  toPublicDmConversation,
  toPublicDmMessage,
  validation,
  type AppError,
  type DmConversation,
  type Member,
  type Notification,
  type Post,
  type PublicDmConversation,
  type PublicDmMessage,
  type Result,
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
  DmConversationRepository,
  DmConversationStateRepository,
  DmMessageRepository,
  IdGenerator,
  MemberRepository,
  NotificationChannelPort,
  NotificationRepository,
  PostRepository,
  ProductGrantRepository,
  RealtimeBusPort,
  SpaceRepository,
  TenantAccessReader,
  UserDisplayReader,
} from '../ports.js';
import { avatarUrlsFor } from './avatar.js';
import {
  lessonContextAccess,
  requireMemberOrStaff,
  requireUnbannedMember,
  spaceContextAccess,
} from './community-access.js';
import { resolveAuthorDisplay } from './community.js';

export interface DirectMessagesDeps {
  dmConversations: DmConversationRepository;
  dmMessages: DmMessageRepository;
  dmConversationStates: DmConversationStateRepository;
  members: MemberRepository;
  posts: PostRepository;
  spaces: SpaceRepository;
  courses: CourseRepository;
  modules: CourseModuleRepository;
  lessons: CourseLessonRepository;
  grants: ProductGrantRepository;
  tenantAccess: TenantAccessReader;
  userDisplays: UserDisplayReader;
  notifications: NotificationRepository;
  notificationChannels: NotificationChannelPort[];
  realtimeBus: RealtimeBusPort;
  links: DiscussionLinkPort;
  ids: IdGenerator;
  clock: Clock;
  avatarSources: AvatarSourceReader;
  contentHash: ContentHash;
}

const secondsBefore = (iso: string, seconds: number): string =>
  new Date(Date.parse(iso) - seconds * 1000).toISOString();

interface Counterpart {
  userId: string;
  member: Member | null;
  isStaff: boolean;
}

const loadCounterpart = async (
  tenantId: string,
  userId: string,
  deps: DirectMessagesDeps,
): Promise<Counterpart> => {
  const [staffGrant, member] = await Promise.all([
    deps.tenantAccess.findStaffGrant(userId, { tenantId }),
    deps.tenantAccess.findMember(tenantId, userId),
  ]);
  return { userId, member, isStaff: staffGrant !== null };
};

/**
 * Recipients must be reachable people in this tenant; staff grants keep the
 * support channel open in both directions. Strangers and other tenants get the
 * same `not_found`, and a ban is indistinguishable from an opt-out, so the
 * endpoint is no existence or moderation-state oracle.
 */
const requireReachableRecipient = (
  recipient: Counterpart,
  senderIsStaff: boolean,
): Result<Counterpart, AppError> => {
  const member = recipient.member;
  if (member === null || member.deletedAt !== null) {
    return recipient.isStaff ? ok(recipient) : err(notFound('Recipient not found in this community'));
  }
  if (
    !recipient.isStaff &&
    (member.bannedAt !== null || (!senderIsStaff && member.dmOptOutAt !== null))
  ) {
    return err(forbidden('This member cannot be messaged right now'));
  }
  return ok(recipient);
};

const postAuthorAccessible = async (
  ctx: Ctx,
  post: Post,
  deps: DirectMessagesDeps,
): Promise<Result<void, AppError>> => {
  if (post.contextKind === 'lesson') return lessonContextAccess(ctx, post.contextId, deps);
  const space = await spaceContextAccess(ctx, post.contextId, deps);
  return space.ok ? ok(undefined) : space;
};

const resolveRecipientUserId = async (
  ctx: Ctx,
  tenantId: string,
  recipient: { kind: 'member'; memberId: string } | { kind: 'post-author'; postId: string },
  deps: DirectMessagesDeps,
): Promise<Result<string, AppError>> => {
  if (recipient.kind === 'member') {
    const member = await deps.members.findById(tenantId, recipient.memberId);
    if (member === null || member.deletedAt !== null) {
      return err(notFound('Recipient not found in this community'));
    }
    return ok(member.userId);
  }
  const post = await deps.posts.findById(tenantId, recipient.postId);
  if (post === null || post.deletedAt !== null) return err(notFound('Post not found'));
  const access = await postAuthorAccessible(ctx, post, deps);
  return access.ok ? ok(post.authorUserId) : access;
};

const participantProjection = async (
  tenantId: string,
  counterparts: readonly Counterpart[],
  deps: DirectMessagesDeps,
): Promise<Map<string, PublicDmConversation['otherParticipant']>> => {
  const userIds = counterparts.map((counterpart) => counterpart.userId);
  const [displayNames, avatarUrls] = await Promise.all([
    deps.userDisplays.findDisplayNames(tenantId, userIds),
    avatarUrlsFor(tenantId, userIds, deps),
  ]);
  return new Map(
    counterparts.map((counterpart) => {
      const override = counterpart.member?.displayName?.trim() ?? '';
      const display =
        override.length > 0
          ? override
          : resolveAuthorDisplay({
              name: displayNames.get(counterpart.userId) ?? null,
              email: counterpart.member?.email ?? null,
            });
      return [
        counterpart.userId,
        { display, avatarUrl: avatarUrls.get(counterpart.userId) ?? null, isStaff: counterpart.isStaff },
      ];
    }),
  );
};

const UNKNOWN_PARTICIPANT: PublicDmConversation['otherParticipant'] = {
  display: resolveAuthorDisplay({}),
  avatarUrl: null,
  isStaff: false,
};

const resolveParticipant = async (
  tenantId: string,
  userId: string,
  deps: DirectMessagesDeps,
): Promise<PublicDmConversation['otherParticipant']> => {
  const counterpart = await loadCounterpart(tenantId, userId, deps);
  const projection = await participantProjection(tenantId, [counterpart], deps);
  return projection.get(userId) ?? UNKNOWN_PARTICIPANT;
};

const projectConversations = async (
  tenantId: string,
  viewerUserId: string,
  conversations: readonly DmConversation[],
  deps: DirectMessagesDeps,
): Promise<PublicDmConversation[]> => {
  if (conversations.length === 0) return [];
  const counterparts = await Promise.all(
    [...new Set(conversations.map((conversation) => otherDmParticipant(conversation, viewerUserId)))].map(
      (userId) => loadCounterpart(tenantId, userId, deps),
    ),
  );
  const participants = await participantProjection(tenantId, counterparts, deps);
  const states = await deps.dmConversationStates.findForViewer(tenantId, {
    userId: viewerUserId,
    conversationIds: conversations.map((conversation) => conversation.id),
  });
  const lastReadByConversation = new Map(states.map((state) => [state.conversationId, state.lastReadAt]));
  return conversations.map((conversation) =>
    toPublicDmConversation(
      conversation,
      { userId: viewerUserId, lastReadAt: lastReadByConversation.get(conversation.id) ?? null },
      participants.get(otherDmParticipant(conversation, viewerUserId)) ?? UNKNOWN_PARTICIPANT,
    ),
  );
};

const participantConversation = async (
  tenantId: string,
  viewerUserId: string,
  conversationId: string,
  deps: DirectMessagesDeps,
): Promise<Result<DmConversation, AppError>> => {
  const conversation = await deps.dmConversations.findById(tenantId, conversationId);
  if (conversation === null || !dmParticipants(conversation).includes(viewerUserId)) {
    return err(notFound('Conversation not found'));
  }
  return ok(conversation);
};

export const startDmConversation = async (
  ctx: Ctx,
  input: unknown,
  deps: DirectMessagesDeps,
): Promise<Result<PublicDmConversation, AppError>> => {
  const actor = requireUnbannedMember(ctx, 'dm:write');
  if (!actor.ok) return actor;
  const parsed = startDmConversationInputSchema.safeParse(input);
  if (!parsed.success) return err(validation('Invalid conversation payload', parsed.error.flatten()));
  const recipientUserId = await resolveRecipientUserId(
    ctx,
    actor.value.tenantId,
    parsed.data.recipient,
    deps,
  );
  if (!recipientUserId.ok) return recipientUserId;
  if (recipientUserId.value === actor.value.userId) {
    return err(validation('You cannot message yourself'));
  }
  const recipient = await requireReachableRecipient(
    await loadCounterpart(actor.value.tenantId, recipientUserId.value, deps),
    ctx.identity.staffRole !== null,
  );
  if (!recipient.ok) return recipient;
  const pair = canonicalDmParticipants(actor.value.userId, recipient.value.userId);
  const existing = await deps.dmConversations.findByParticipants(actor.value.tenantId, pair);
  if (existing !== null) {
    const [projected] = await projectConversations(
      actor.value.tenantId,
      actor.value.userId,
      [existing],
      deps,
    );
    return projected === undefined ? err(internal('Could not project the conversation')) : ok(projected);
  }
  const now = deps.clock.nowIso();
  const recentConversations = await deps.dmConversations.countCreatedBySince(actor.value.tenantId, {
    createdByUserId: actor.value.userId,
    since: secondsBefore(now, DM_CONVERSATION_RATE_LIMIT.windowSeconds),
  });
  if (recentConversations >= DM_CONVERSATION_RATE_LIMIT.maxConversations) {
    return err(rateLimited('You are starting conversations too quickly — take a short break'));
  }
  const record = dmConversationSchema.safeParse({
    id: deps.ids.nextId(),
    tenantId: actor.value.tenantId,
    participantLowUserId: pair.low,
    participantHighUserId: pair.high,
    createdByUserId: actor.value.userId,
    createdAt: now,
    lastMessageId: null,
    lastMessageAt: now,
    lastMessageSnippet: '',
    lastMessageSenderUserId: actor.value.userId,
  });
  if (!record.success) return err(internal('Could not create a valid conversation'));
  const created = await deps.dmConversations.insert(actor.value.tenantId, record.data);
  const [projected] = await projectConversations(
    actor.value.tenantId,
    actor.value.userId,
    [created],
    deps,
  );
  return projected === undefined ? err(internal('Could not project the conversation')) : ok(projected);
};

const notifyDmRecipient = async (
  tenantId: string,
  input: {
    conversationId: string;
    message: { id: string; body: string; createdAt: string };
    senderDisplay: string;
    senderAvatarUrl: string | null;
    recipient: Counterpart;
  },
  deps: DirectMessagesDeps,
  tenant: { tenantName: string; tenantSlug: string | null },
): Promise<Result<void, AppError>> => {
  deps.realtimeBus.publish({
    kind: 'dm',
    tenantId,
    recipientUserId: input.recipient.userId,
    conversationId: input.conversationId,
    createdAt: input.message.createdAt,
  });
  const alreadyPending = await deps.notifications.hasUnreadDmNotification(
    tenantId,
    input.recipient.userId,
    input.conversationId,
  );
  if (alreadyPending) return ok(undefined);
  const notification: Notification = {
    id: deps.ids.nextId(),
    tenantId,
    recipientUserId: input.recipient.userId,
    kind: 'dm-message',
    payload: {
      rootPostId: input.message.id,
      postId: input.message.id,
      contextKind: 'dm',
      contextId: input.conversationId,
      courseId: null,
      eventId: null,
      lessonName: input.senderDisplay,
      authorDisplay: input.senderDisplay,
      authorAvatarUrl: input.senderAvatarUrl,
      snippet: postSnippet(input.message.body),
    },
    readAt: null,
    createdAt: deps.clock.nowIso(),
  };
  const inserted = await deps.notifications.insert(tenantId, notification);
  const conversationUrl = deps.links.conversationUrl({
    tenantSlug: tenant.tenantSlug,
    conversationId: input.conversationId,
  });
  for (const channel of deps.notificationChannels) {
    const delivered = await channel.deliver(inserted, {
      recipientEmail: input.recipient.member?.email ?? null,
      tenantName: tenant.tenantName,
      contextName: input.senderDisplay,
      contextUrl: conversationUrl,
      language: DEFAULT_LANGUAGE,
    });
    if (!delivered.ok) return delivered;
  }
  return ok(undefined);
};

export const sendDmMessage = async (
  ctx: Ctx,
  input: unknown,
  deps: DirectMessagesDeps,
): Promise<Result<PublicDmMessage, AppError>> => {
  const actor = requireUnbannedMember(ctx, 'dm:write');
  if (!actor.ok) return actor;
  const parsed = sendDmMessageInputSchema.safeParse(input);
  if (!parsed.success) return err(validation('Invalid message payload', parsed.error.flatten()));
  const conversation = await participantConversation(
    actor.value.tenantId,
    actor.value.userId,
    parsed.data.conversationId,
    deps,
  );
  if (!conversation.ok) return conversation;
  const recipient = await requireReachableRecipient(
    await loadCounterpart(
      actor.value.tenantId,
      otherDmParticipant(conversation.value, actor.value.userId),
      deps,
    ),
    ctx.identity.staffRole !== null,
  );
  if (!recipient.ok) return recipient;
  const now = deps.clock.nowIso();
  const recentMessages = await deps.dmMessages.countRecentBySender(
    actor.value.tenantId,
    actor.value.userId,
    secondsBefore(now, DM_MESSAGE_RATE_LIMIT.windowSeconds),
  );
  if (recentMessages >= DM_MESSAGE_RATE_LIMIT.maxMessages) {
    return err(rateLimited('You are sending messages too quickly — take a short break'));
  }
  const record = dmMessageSchema.safeParse({
    id: deps.ids.nextId(),
    tenantId: actor.value.tenantId,
    conversationId: conversation.value.id,
    senderUserId: actor.value.userId,
    body: parsed.data.body.trim(),
    createdAt: now,
  });
  if (!record.success) return err(validation('Invalid message payload', record.error.flatten()));
  const created = await deps.dmMessages.insert(actor.value.tenantId, record.data);
  await deps.dmConversations.applyLastMessage(actor.value.tenantId, {
    conversationId: created.conversationId,
    lastMessageId: created.id,
    lastMessageAt: created.createdAt,
    lastMessageSnippet: postSnippet(created.body),
    lastMessageSenderUserId: created.senderUserId,
  });
  await deps.dmConversationStates.markRead(actor.value.tenantId, {
    conversationId: created.conversationId,
    userId: actor.value.userId,
    lastReadAt: created.createdAt,
  });
  const sender = await resolveParticipant(actor.value.tenantId, actor.value.userId, deps);
  const notified = await notifyDmRecipient(
    actor.value.tenantId,
    {
      conversationId: created.conversationId,
      message: created,
      senderDisplay: sender.display,
      senderAvatarUrl: sender.avatarUrl,
      recipient: recipient.value,
    },
    deps,
    { tenantName: ctx.identity.tenantName ?? 'Together', tenantSlug: ctx.identity.tenantSlug },
  );
  if (!notified.ok) return notified;
  return ok(toPublicDmMessage(created, actor.value.userId));
};

export const listDmConversations = async (
  ctx: Ctx,
  input: unknown,
  deps: DirectMessagesDeps,
): Promise<Result<{ conversations: PublicDmConversation[]; nextCursor: string | null }, AppError>> => {
  const actor = requireMemberOrStaff(ctx, 'dm:read');
  if (!actor.ok) return actor;
  const parsed = listDmConversationsInputSchema.safeParse(input);
  if (!parsed.success) return err(validation('Invalid conversations query', parsed.error.flatten()));
  const listed = await deps.dmConversations.listForParticipant(actor.value.tenantId, {
    userId: actor.value.userId,
    limit: parsed.data.limit,
    ...(parsed.data.cursor === undefined ? {} : { cursor: parsed.data.cursor }),
  });
  return ok({
    conversations: await projectConversations(
      actor.value.tenantId,
      actor.value.userId,
      listed.conversations,
      deps,
    ),
    nextCursor: listed.nextCursor,
  });
};

export const getDmConversation = async (
  ctx: Ctx,
  input: unknown,
  deps: DirectMessagesDeps,
): Promise<Result<PublicDmConversation, AppError>> => {
  const actor = requireMemberOrStaff(ctx, 'dm:read');
  if (!actor.ok) return actor;
  const parsed = dmConversationRefSchema.safeParse(input);
  if (!parsed.success) return err(validation('Invalid conversation query', parsed.error.flatten()));
  const conversation = await participantConversation(
    actor.value.tenantId,
    actor.value.userId,
    parsed.data.conversationId,
    deps,
  );
  if (!conversation.ok) return conversation;
  const [projected] = await projectConversations(
    actor.value.tenantId,
    actor.value.userId,
    [conversation.value],
    deps,
  );
  return projected === undefined ? err(internal('Could not project the conversation')) : ok(projected);
};

export const listDmMessages = async (
  ctx: Ctx,
  input: unknown,
  deps: DirectMessagesDeps,
): Promise<Result<{ messages: PublicDmMessage[]; nextCursor: string | null }, AppError>> => {
  const actor = requireMemberOrStaff(ctx, 'dm:read');
  if (!actor.ok) return actor;
  const parsed = listDmMessagesInputSchema.safeParse(input);
  if (!parsed.success) return err(validation('Invalid messages query', parsed.error.flatten()));
  const conversation = await participantConversation(
    actor.value.tenantId,
    actor.value.userId,
    parsed.data.conversationId,
    deps,
  );
  if (!conversation.ok) return conversation;
  const listed = await deps.dmMessages.listForConversation(actor.value.tenantId, {
    conversationId: conversation.value.id,
    limit: parsed.data.limit,
    ...(parsed.data.cursor === undefined ? {} : { cursor: parsed.data.cursor }),
  });
  return ok({
    messages: listed.messages.map((message) => toPublicDmMessage(message, actor.value.userId)),
    nextCursor: listed.nextCursor,
  });
};

export const markDmConversationRead = async (
  ctx: Ctx,
  input: unknown,
  deps: DirectMessagesDeps,
): Promise<Result<{ conversationId: string; lastReadAt: string }, AppError>> => {
  const actor = requireMemberOrStaff(ctx, 'dm:write');
  if (!actor.ok) return actor;
  const parsed = dmConversationRefSchema.safeParse(input);
  if (!parsed.success) return err(validation('Invalid conversation payload', parsed.error.flatten()));
  const conversation = await participantConversation(
    actor.value.tenantId,
    actor.value.userId,
    parsed.data.conversationId,
    deps,
  );
  if (!conversation.ok) return conversation;
  const readAt = deps.clock.nowIso();
  const state = await deps.dmConversationStates.markRead(actor.value.tenantId, {
    conversationId: conversation.value.id,
    userId: actor.value.userId,
    lastReadAt: readAt,
  });
  await deps.notifications.markDmConversationRead(actor.value.tenantId, {
    recipientUserId: actor.value.userId,
    conversationId: conversation.value.id,
    readAt,
  });
  return ok({ conversationId: state.conversationId, lastReadAt: state.lastReadAt });
};

export const dmUnreadCount = async (
  ctx: Ctx,
  deps: DirectMessagesDeps,
): Promise<Result<{ unread: number }, AppError>> => {
  const actor = requireMemberOrStaff(ctx, 'dm:read');
  if (!actor.ok) return actor;
  return ok({
    unread: await deps.dmConversations.countUnreadForParticipant(
      actor.value.tenantId,
      actor.value.userId,
    ),
  });
};
