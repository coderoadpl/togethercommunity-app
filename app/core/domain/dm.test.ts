import { describe, expect, it } from 'vitest';

import {
  DM_BODY_MAX_LENGTH,
  NO_DM_BLOCKS,
  canonicalDmParticipants,
  dmConversationSchema,
  dmMessageSchema,
  dmParticipants,
  listDmConversationsInputSchema,
  listDmMessagesInputSchema,
  otherDmParticipant,
  publicDmConversationSchema,
  sendDmMessageInputSchema,
  startDmConversationInputSchema,
  toPublicDmConversation,
  toPublicDmMessage,
  type DmConversation,
  type DmMessage,
} from './dm.js';

const NOW = '2026-08-17T10:00:00.000Z';
const LATER = '2026-08-17T11:00:00.000Z';

const conversation = (overrides: Partial<DmConversation> = {}): DmConversation =>
  dmConversationSchema.parse({
    id: 'c1',
    tenantId: 't1',
    participantLowUserId: 'u1',
    participantHighUserId: 'u2',
    createdByUserId: 'u1',
    createdAt: NOW,
    lastMessageId: 'msg-1',
    lastMessageAt: LATER,
    lastMessageSnippet: 'Cześć',
    lastMessageSenderUserId: 'u2',
    ...overrides,
  });

const message = (overrides: Partial<DmMessage> = {}): DmMessage =>
  dmMessageSchema.parse({
    id: 'msg-1',
    tenantId: 't1',
    conversationId: 'c1',
    senderUserId: 'u2',
    body: 'Cześć',
    createdAt: LATER,
    ...overrides,
  });

const otherParticipant = { display: 'Ada', avatarUrl: null, isStaff: false };
const reachable = { blocks: NO_DM_BLOCKS, recipientReachable: true };

describe('direct message records', () => {
  it('orders a participant pair canonically in both directions', () => {
    expect(canonicalDmParticipants('u2', 'u1')).toEqual({ low: 'u1', high: 'u2' });
    expect(canonicalDmParticipants('u1', 'u2')).toEqual({ low: 'u1', high: 'u2' });
  });

  it('resolves the counterpart of either participant', () => {
    expect(otherDmParticipant(conversation(), 'u1')).toBe('u2');
    expect(otherDmParticipant(conversation(), 'u2')).toBe('u1');
    expect(dmParticipants(conversation())).toEqual(['u1', 'u2']);
  });

  it('rejects a body over the shared post bound and an empty body', () => {
    expect(sendDmMessageInputSchema.safeParse({ conversationId: 'c1', body: '' }).success).toBe(false);
    expect(
      sendDmMessageInputSchema.safeParse({
        conversationId: 'c1',
        body: 'x'.repeat(DM_BODY_MAX_LENGTH + 1),
      }).success,
    ).toBe(false);
    expect(
      sendDmMessageInputSchema.safeParse({
        conversationId: 'c1',
        body: 'x'.repeat(DM_BODY_MAX_LENGTH),
      }).success,
    ).toBe(true);
  });

  it('accepts both recipient resolution shapes and rejects unknown ones', () => {
    expect(
      startDmConversationInputSchema.safeParse({ recipient: { kind: 'member', memberId: 'm1' } }).success,
    ).toBe(true);
    expect(
      startDmConversationInputSchema.safeParse({ recipient: { kind: 'post-author', postId: 'p1' } }).success,
    ).toBe(true);
    expect(
      startDmConversationInputSchema.safeParse({ recipient: { kind: 'user', userId: 'u2' } }).success,
    ).toBe(false);
  });

  it('validates list cursors as an ISO timestamp with an id tiebreaker', () => {
    expect(listDmConversationsInputSchema.safeParse({ cursor: `${NOW}|c1` }).success).toBe(true);
    expect(listDmConversationsInputSchema.safeParse({ cursor: 'c1' }).success).toBe(false);
    expect(listDmConversationsInputSchema.safeParse({ cursor: `${NOW}|` }).success).toBe(false);
    expect(listDmMessagesInputSchema.parse({ conversationId: 'c1' }).limit).toBe(50);
  });
});

describe('direct message projections', () => {
  it('drops the sender id and pre-computes ownership', () => {
    expect(toPublicDmMessage(message(), 'u1')).toEqual({
      id: 'msg-1',
      conversationId: 'c1',
      body: 'Cześć',
      createdAt: LATER,
      isOwn: false,
    });
    expect(toPublicDmMessage(message(), 'u2').isOwn).toBe(true);
  });

  it('marks a conversation unread only for the recipient of the last message', () => {
    const viewerIsRecipient = toPublicDmConversation(
      conversation(),
      { userId: 'u1', lastReadAt: null },
      otherParticipant,
      reachable,
    );
    expect(publicDmConversationSchema.parse(viewerIsRecipient).unread).toBe(true);
    expect(viewerIsRecipient.lastMessageIsOwn).toBe(false);
    expect(
      toPublicDmConversation(conversation(), { userId: 'u2', lastReadAt: null }, otherParticipant, reachable).unread,
    ).toBe(false);
  });

  it('clears unread once the read cursor passes the last message', () => {
    expect(
      toPublicDmConversation(conversation(), { userId: 'u1', lastReadAt: LATER }, otherParticipant, reachable).unread,
    ).toBe(false);
    expect(
      toPublicDmConversation(conversation(), { userId: 'u1', lastReadAt: NOW }, otherParticipant, reachable).unread,
    ).toBe(true);
  });

  it('closes sending for either block direction without naming the blocker', () => {
    const blockedByViewer = toPublicDmConversation(
      conversation(),
      { userId: 'u1', lastReadAt: null },
      otherParticipant,
      { blocks: { blockedByViewer: true, blocksViewer: false }, recipientReachable: true },
    );
    expect(blockedByViewer).toMatchObject({ blockedByViewer: true, canSend: false });

    const blocksViewer = toPublicDmConversation(
      conversation(),
      { userId: 'u1', lastReadAt: null },
      otherParticipant,
      { blocks: { blockedByViewer: false, blocksViewer: true }, recipientReachable: true },
    );
    expect(blocksViewer).toMatchObject({ blockedByViewer: false, canSend: false });
  });

  it('closes sending for an unreachable recipient the same way a block does', () => {
    expect(
      toPublicDmConversation(
        conversation(),
        { userId: 'u1', lastReadAt: null },
        otherParticipant,
        { blocks: NO_DM_BLOCKS, recipientReachable: false },
      ),
    ).toMatchObject({ blockedByViewer: false, canSend: false });
  });

  it('never marks a conversation without messages unread', () => {
    const empty = conversation({ lastMessageId: null, lastMessageSnippet: '', lastMessageAt: NOW });
    const projected = toPublicDmConversation(empty, { userId: 'u1', lastReadAt: null }, otherParticipant, reachable);
    expect(projected.hasMessages).toBe(false);
    expect(projected.unread).toBe(false);
  });
});
