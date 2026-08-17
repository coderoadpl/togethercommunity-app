import { describe, expect, it } from 'vitest';

import {
  DM_CONVERSATION_RATE_LIMIT,
  DM_MESSAGE_RATE_LIMIT,
  canonicalDmParticipants,
  type DmConversation,
  type DmConversationState,
  type DmMessage,
  type Identity,
  type Member,
  type Notification,
  type Post,
  type PublicDmConversation,
  type Space,
} from '#core/domain/index.js';

import type { Ctx } from '../context.js';
import type {
  Clock,
  DmConversationRepository,
  DmConversationStateRepository,
  DmMessageRepository,
  IdGenerator,
  NotificationChannelPort,
  NotificationRepository,
  RealtimeEvent,
} from '../ports.js';
import {
  dmUnreadCount,
  getDmConversation,
  listDmConversations,
  listDmMessages,
  markDmConversationRead,
  sendDmMessage,
  startDmConversation,
  type DirectMessagesDeps,
} from './direct-messages.js';

const NOW = '2026-08-17T10:00:00.000Z';

const identity = (overrides: Partial<Identity> = {}): Identity => ({
  userId: 'u1',
  email: 'u1@example.com',
  name: 'User One',
  emailVerified: true,
  tenantId: 't1',
  tenantSlug: 'tenant',
  tenantName: 'Tenant',
  staffRole: null,
  memberId: 'm1',
  image: null,
  memberDisplayName: null,
  memberBannedAt: null,
  memberDmOptOutAt: null,
  ...overrides,
});

const ctx = (overrides: Partial<Identity> = {}): Ctx => ({ identity: identity(overrides) });

const member = (overrides: Partial<Member> & { id: string; userId: string }): Member => ({
  tenantId: 't1',
  email: `${overrides.userId}@example.com`,
  displayName: null,
  tags: [],
  marketingConsents: {},
  externalCustomerIds: {},
  createdAt: NOW,
  deletedAt: null,
  bannedAt: null,
  bannedReason: null,
  bannedByUserId: null,
  dmOptOutAt: null,
  ...overrides,
});

const space: Space = {
  id: 's1',
  tenantId: 't1',
  slug: 'open',
  name: 'Otwarta',
  description: null,
  visibility: 'members',
  productIds: [],
  publicReadOnly: false,
  position: 0,
  archivedAt: null,
  createdAt: NOW,
};

const post = (overrides: Partial<Post> & { id: string; authorUserId: string }): Post => ({
  tenantId: 't1',
  contextKind: 'space',
  contextId: 's1',
  parentPostId: null,
  rootPostId: overrides.id,
  authorDisplay: 'Autor',
  authorIsStaff: false,
  body: 'Wpis',
  createdAt: NOW,
  editedAt: null,
  deletedAt: null,
  pinnedAt: null,
  ...overrides,
});

class SequenceIds implements IdGenerator {
  private next = 1;

  nextId(): string {
    const id = `id-${String(this.next)}`;
    this.next += 1;
    return id;
  }
}

class MutableClock implements Clock {
  private tick = 0;

  nowIso(): string {
    const stamp = new Date(Date.parse(NOW) + this.tick * 1000).toISOString();
    this.tick += 1;
    return stamp;
  }
}

class FakeDmConversations implements DmConversationRepository {
  readonly rows: DmConversation[] = [];

  async findById(tenantId: string, id: string): Promise<DmConversation | null> {
    return this.rows.find((row) => row.tenantId === tenantId && row.id === id) ?? null;
  }

  async findByParticipants(
    tenantId: string,
    pair: { low: string; high: string },
  ): Promise<DmConversation | null> {
    return (
      this.rows.find(
        (row) =>
          row.tenantId === tenantId &&
          row.participantLowUserId === pair.low &&
          row.participantHighUserId === pair.high,
      ) ?? null
    );
  }

  async insert(_tenantId: string, conversation: DmConversation): Promise<DmConversation> {
    this.rows.push(conversation);
    return conversation;
  }

  async listForParticipant(
    tenantId: string,
    query: { userId: string; cursor?: string; limit: number },
  ): Promise<{ conversations: DmConversation[]; nextCursor: string | null }> {
    const cursorOf = (row: DmConversation): string => `${row.lastMessageAt}|${row.id}`;
    const matching = this.rows
      .filter(
        (row) =>
          row.tenantId === tenantId &&
          (row.participantLowUserId === query.userId || row.participantHighUserId === query.userId) &&
          (query.cursor === undefined || cursorOf(row) < query.cursor),
      )
      .sort((left, right) => cursorOf(right).localeCompare(cursorOf(left)));
    const page = matching.slice(0, query.limit);
    const overflow = matching[query.limit];
    const last = page.at(-1);
    return { conversations: page, nextCursor: overflow && last ? cursorOf(last) : null };
  }

  async countCreatedBySince(
    tenantId: string,
    query: { createdByUserId: string; since: string },
  ): Promise<number> {
    return this.rows.filter(
      (row) =>
        row.tenantId === tenantId &&
        row.createdByUserId === query.createdByUserId &&
        row.createdAt >= query.since,
    ).length;
  }

  async countUnreadForParticipant(tenantId: string, userId: string): Promise<number> {
    return this.rows.filter(
      (row) =>
        row.tenantId === tenantId &&
        (row.participantLowUserId === userId || row.participantHighUserId === userId) &&
        row.lastMessageId !== null &&
        row.lastMessageSenderUserId !== userId &&
        row.lastMessageAt > (this.readCursors.get(`${row.id}|${userId}`) ?? ''),
    ).length;
  }

  async applyLastMessage(
    tenantId: string,
    input: {
      conversationId: string;
      lastMessageId: string;
      lastMessageAt: string;
      lastMessageSnippet: string;
      lastMessageSenderUserId: string;
    },
  ): Promise<DmConversation | null> {
    const index = this.rows.findIndex(
      (row) => row.tenantId === tenantId && row.id === input.conversationId,
    );
    const row = this.rows[index];
    if (!row) return null;
    const next: DmConversation = {
      ...row,
      lastMessageId: input.lastMessageId,
      lastMessageAt: input.lastMessageAt,
      lastMessageSnippet: input.lastMessageSnippet,
      lastMessageSenderUserId: input.lastMessageSenderUserId,
    };
    this.rows[index] = next;
    return next;
  }

  readonly readCursors = new Map<string, string>();
}

class FakeDmMessages implements DmMessageRepository {
  readonly rows: DmMessage[] = [];

  async insert(_tenantId: string, message: DmMessage): Promise<DmMessage> {
    this.rows.push(message);
    return message;
  }

  async listForConversation(
    tenantId: string,
    query: { conversationId: string; cursor?: string; limit: number },
  ): Promise<{ messages: DmMessage[]; nextCursor: string | null }> {
    const cursorOf = (row: DmMessage): string => `${row.createdAt}|${row.id}`;
    const matching = this.rows
      .filter(
        (row) =>
          row.tenantId === tenantId &&
          row.conversationId === query.conversationId &&
          (query.cursor === undefined || cursorOf(row) < query.cursor),
      )
      .sort((left, right) => cursorOf(right).localeCompare(cursorOf(left)));
    const page = matching.slice(0, query.limit);
    const overflow = matching[query.limit];
    const last = page.at(-1);
    return { messages: page, nextCursor: overflow && last ? cursorOf(last) : null };
  }

  async countRecentBySender(tenantId: string, senderUserId: string, sinceIso: string): Promise<number> {
    return this.rows.filter(
      (row) =>
        row.tenantId === tenantId && row.senderUserId === senderUserId && row.createdAt >= sinceIso,
    ).length;
  }
}

class FakeDmConversationStates implements DmConversationStateRepository {
  constructor(private readonly conversations: FakeDmConversations) {}

  readonly rows: DmConversationState[] = [];

  async findForViewer(
    tenantId: string,
    input: { userId: string; conversationIds: string[] },
  ): Promise<DmConversationState[]> {
    return this.rows.filter(
      (row) =>
        row.tenantId === tenantId &&
        row.userId === input.userId &&
        input.conversationIds.includes(row.conversationId),
    );
  }

  async markRead(
    tenantId: string,
    input: { conversationId: string; userId: string; lastReadAt: string },
  ): Promise<DmConversationState> {
    const next: DmConversationState = { tenantId, ...input };
    const index = this.rows.findIndex(
      (row) =>
        row.tenantId === tenantId &&
        row.conversationId === input.conversationId &&
        row.userId === input.userId,
    );
    if (index < 0) this.rows.push(next);
    else this.rows[index] = next;
    this.conversations.readCursors.set(`${input.conversationId}|${input.userId}`, input.lastReadAt);
    return next;
  }
}

class FakeNotifications implements NotificationRepository {
  readonly rows: Notification[] = [];

  async insert(_tenantId: string, notification: Notification): Promise<Notification> {
    this.rows.push(notification);
    return notification;
  }

  async listForRecipient(): Promise<{ notifications: Notification[]; nextCursor: string | null }> {
    return { notifications: this.rows, nextCursor: null };
  }

  async markRead(): Promise<Notification | null> {
    return null;
  }

  async markAllRead(): Promise<number> {
    return 0;
  }

  async unreadCount(): Promise<number> {
    return 0;
  }

  async hasUnreadDmNotification(
    tenantId: string,
    recipientUserId: string,
    conversationId: string,
  ): Promise<boolean> {
    return this.rows.some(
      (row) =>
        row.tenantId === tenantId &&
        row.recipientUserId === recipientUserId &&
        row.kind === 'dm-message' &&
        row.readAt === null &&
        row.payload.contextId === conversationId,
    );
  }

  async markDmConversationRead(
    tenantId: string,
    input: { recipientUserId: string; conversationId: string; readAt: string },
  ): Promise<number> {
    let marked = 0;
    this.rows.forEach((row, index) => {
      if (
        row.tenantId === tenantId &&
        row.recipientUserId === input.recipientUserId &&
        row.kind === 'dm-message' &&
        row.readAt === null &&
        row.payload.contextId === input.conversationId
      ) {
        this.rows[index] = { ...row, readAt: input.readAt };
        marked += 1;
      }
    });
    return marked;
  }
}

interface Fixture {
  deps: DirectMessagesDeps;
  conversations: FakeDmConversations;
  messages: FakeDmMessages;
  states: FakeDmConversationStates;
  notifications: FakeNotifications;
  delivered: Array<{ recipientUserId: string; email: string | null; url: string }>;
  published: RealtimeEvent[];
}

const fixture = (input: { members?: Member[]; staffUserIds?: string[]; posts?: Post[] } = {}): Fixture => {
  const conversations = new FakeDmConversations();
  const messages = new FakeDmMessages();
  const states = new FakeDmConversationStates(conversations);
  const notifications = new FakeNotifications();
  const delivered: Fixture['delivered'] = [];
  const published: RealtimeEvent[] = [];
  const members = input.members ?? [
    member({ id: 'm1', userId: 'u1' }),
    member({ id: 'm2', userId: 'u2' }),
  ];
  const posts = input.posts ?? [];
  const channel: NotificationChannelPort = {
    deliver: async (notification, context) => {
      delivered.push({
        recipientUserId: notification.recipientUserId,
        email: context.recipientEmail,
        url: context.contextUrl,
      });
      return { ok: true, value: undefined };
    },
  };
  const deps: DirectMessagesDeps = {
    dmConversations: conversations,
    dmMessages: messages,
    dmConversationStates: states,
    members: {
      findById: async (tenantId, memberId) =>
        members.find((row) => row.tenantId === tenantId && row.id === memberId) ?? null,
      findByEmail: async () => null,
      listWithProductIds: async () => [],
      create: async () => undefined,
      updateEmail: async () => null,
      updateDisplayName: async () => null,
      updateDmOptOut: async () => null,
      setBanned: async () => null,
    },
    posts: {
      createPost: async (_tenantId, created) => created,
      findById: async (tenantId, id) =>
        posts.find((row) => row.tenantId === tenantId && row.id === id) ?? null,
      findByIds: async () => [],
      countByAuthorSince: async () => 0,
      listRecentBodiesByAuthor: async () => [],
      listByAuthor: async () => [],
      listThreadsForContext: async () => ({ threads: [], nextCursor: null }),
      listThreadsForSpaces: async () => ({ threads: [], nextCursor: null }),
      listReplies: async () => [],
      updateBody: async () => null,
      softDelete: async () => null,
      setPinned: async () => null,
      listPinnedForContext: async () => [],
      countPinnedForContext: async () => 0,
      latestRootPostAt: async () => new Map(),
      search: async () => [],
    },
    spaces: {
      list: async () => [space],
      findById: async (tenantId, id) => (tenantId === 't1' && id === space.id ? space : null),
      findBySlug: async () => null,
      create: async () => undefined,
      update: async () => null,
      setArchived: async () => null,
      delete: async () => false,
      stats: async () => new Map(),
    },
    courses: {
      list: async () => [],
      findById: async () => null,
      findByIds: async () => [],
      create: async () => undefined,
      update: async () => null,
      delete: async () => false,
    },
    modules: {
      list: async () => [],
      findById: async () => null,
      findByIds: async () => [],
      create: async () => undefined,
      update: async () => null,
      delete: async () => false,
    },
    lessons: {
      list: async () => [],
      listPreviews: async () => [],
      findById: async () => null,
      findByIds: async () => [],
      create: async () => undefined,
      update: async () => null,
      delete: async () => false,
    },
    grants: {
      findById: async () => null,
      findGrant: async () => null,
      createGrant: async () => true,
      setGrantWindow: async () => null,
      revokeGrant: async () => null,
      listForMemberWithProductNames: async () => [],
      listActiveForMember: async () => [],
      listGrantedProducts: async () => [],
    },
    tenantAccess: {
      listTenantsForStaff: async () => [],
      listStaffForTenant: async () => [],
      findStaffGrant: async (userId, lookup) =>
        'tenantId' in lookup && lookup.tenantId === 't1' && (input.staffUserIds ?? []).includes(userId)
          ? {
              tenant: {
                id: 't1',
                slug: 'tenant',
                name: 'Tenant',
                status: 'active',
                plan: 'hosted',
                contentVersion: 1,
              },
              staffRole: 'admin',
            }
          : null,
      findMember: async (tenantId, userId) =>
        members.find((row) => row.tenantId === tenantId && row.userId === userId) ?? null,
    },
    userDisplays: {
      findDisplayNames: async (_tenantId, userIds) =>
        new Map(userIds.map((userId) => [userId, `Osoba ${userId}`])),
    },
    notifications,
    notificationChannels: [channel],
    realtimeBus: {
      publish: (event) => {
        published.push(event);
      },
      subscribe: () => () => undefined,
    },
    links: {
      lessonDiscussionUrl: () => 'http://tenant.localhost/my',
      spaceUrl: () => 'http://tenant.localhost/community/s1',
      conversationUrl: ({ conversationId }) => `http://tenant.localhost/messages/${conversationId}`,
    },
    ids: new SequenceIds(),
    clock: new MutableClock(),
    avatarSources: {
      listAvatarSources: async (tenantId, userIds) =>
        members
          .filter((row) => row.tenantId === tenantId && userIds.includes(row.userId))
          .map((row) => ({ userId: row.userId, email: row.email, image: null })),
    },
    contentHash: { sha256: (content) => `digest(${String(content)})` },
  };
  return { deps, conversations, messages, states, notifications, delivered, published };
};

const startWith = async (
  fx: Fixture,
  actor: Ctx = ctx(),
  memberId = 'm2',
): Promise<PublicDmConversation> => {
  const started = await startDmConversation(actor, { recipient: { kind: 'member', memberId } }, fx.deps);
  if (!started.ok) throw new Error(`start failed: ${started.error.code}`);
  return started.value;
};

describe('startDmConversation', () => {
  it('creates one canonical conversation and reuses it on repeat starts', async () => {
    const fx = fixture();

    const first = await startWith(fx);
    const second = await startWith(fx);

    expect(second.id).toBe(first.id);
    expect(fx.conversations.rows).toHaveLength(1);
    const [row] = fx.conversations.rows;
    expect(row === undefined ? null : canonicalDmParticipants(row.participantLowUserId, row.participantHighUserId)).toEqual({
      low: 'u1',
      high: 'u2',
    });
    expect(first.hasMessages).toBe(false);
    expect(first.otherParticipant.display).toBe('Osoba u2');
  });

  it('reaches the same conversation from either side of the pair', async () => {
    const fx = fixture();

    const fromU1 = await startWith(fx);
    const fromU2 = await startWith(fx, ctx({ userId: 'u2', memberId: 'm2' }), 'm1');

    expect(fromU2.id).toBe(fromU1.id);
    expect(fromU2.otherParticipant.display).toBe('Osoba u1');
  });

  it('rejects messaging yourself', async () => {
    const fx = fixture();

    const result = await startDmConversation(ctx(), { recipient: { kind: 'member', memberId: 'm1' } }, fx.deps);

    expect(result.ok ? null : result.error.code).toBe('validation');
  });

  it('refuses a banned sender and an unreachable recipient alike', async () => {
    const banned = await startDmConversation(
      ctx({ memberBannedAt: NOW }),
      { recipient: { kind: 'member', memberId: 'm2' } },
      fixture().deps,
    );
    expect(banned.ok ? null : banned.error.code).toBe('banned');

    const bannedRecipient = fixture({
      members: [member({ id: 'm1', userId: 'u1' }), member({ id: 'm2', userId: 'u2', bannedAt: NOW })],
    });
    const blocked = await startDmConversation(
      ctx(),
      { recipient: { kind: 'member', memberId: 'm2' } },
      bannedRecipient.deps,
    );
    expect(blocked.ok ? null : blocked.error.code).toBe('forbidden');
  });

  it('reports not found for a member of another tenant', async () => {
    const fx = fixture({
      members: [member({ id: 'm1', userId: 'u1' }), member({ id: 'm9', userId: 'u9', tenantId: 't2' })],
    });

    const result = await startDmConversation(ctx(), { recipient: { kind: 'member', memberId: 'm9' } }, fx.deps);

    expect(result.ok ? null : result.error.code).toBe('not_found');
  });

  it('honours the opt-out for members and lets staff through', async () => {
    const members = [
      member({ id: 'm1', userId: 'u1' }),
      member({ id: 'm2', userId: 'u2', dmOptOutAt: NOW }),
    ];

    const asMember = await startDmConversation(
      ctx(),
      { recipient: { kind: 'member', memberId: 'm2' } },
      fixture({ members }).deps,
    );
    expect(asMember.ok ? null : asMember.error.code).toBe('forbidden');

    const asStaff = await startDmConversation(
      ctx({ userId: 'u3', memberId: null, staffRole: 'admin' }),
      { recipient: { kind: 'member', memberId: 'm2' } },
      fixture({ members, staffUserIds: ['u3'] }).deps,
    );
    expect(asStaff.ok).toBe(true);
  });

  it('resolves a post author without exposing the author id', async () => {
    const fx = fixture({ posts: [post({ id: 'p1', authorUserId: 'u2' })] });

    const result = await startDmConversation(ctx(), { recipient: { kind: 'post-author', postId: 'p1' } }, fx.deps);

    expect(result.ok && result.value.otherParticipant.display).toBe('Osoba u2');
  });

  it('rate limits new conversations per sender', async () => {
    const others = Array.from({ length: DM_CONVERSATION_RATE_LIMIT.maxConversations + 1 }, (_, index) =>
      member({ id: `m-${String(index)}`, userId: `u-${String(index)}` }),
    );
    const fx = fixture({ members: [member({ id: 'm1', userId: 'u1' }), ...others] });

    const outcomes = [];
    for (const recipient of others) {
      outcomes.push(
        await startDmConversation(ctx(), { recipient: { kind: 'member', memberId: recipient.id } }, fx.deps),
      );
    }

    expect(outcomes.filter((outcome) => outcome.ok)).toHaveLength(
      DM_CONVERSATION_RATE_LIMIT.maxConversations,
    );
    const last = outcomes.at(-1);
    expect(last !== undefined && !last.ok ? last.error.code : null).toBe('rate_limited');
  });
});

describe('sendDmMessage', () => {
  it('appends the message, advances the projection and notifies the recipient once per burst', async () => {
    const fx = fixture();
    const conversation = await startWith(fx);

    const first = await sendDmMessage(ctx(), { conversationId: conversation.id, body: 'Cześć' }, fx.deps);
    const second = await sendDmMessage(ctx(), { conversationId: conversation.id, body: 'Jesteś tam?' }, fx.deps);

    expect(first.ok && first.value.isOwn).toBe(true);
    expect(second.ok).toBe(true);
    expect(fx.messages.rows).toHaveLength(2);
    expect(fx.conversations.rows[0]?.lastMessageSnippet).toBe('Jesteś tam?');
    expect(fx.notifications.rows).toHaveLength(1);
    expect(fx.notifications.rows[0]?.kind).toBe('dm-message');
    expect(fx.notifications.rows[0]?.payload.contextKind).toBe('dm');
    expect(fx.notifications.rows[0]?.payload.contextId).toBe(conversation.id);
    expect(fx.delivered).toEqual([
      {
        recipientUserId: 'u2',
        email: 'u2@example.com',
        url: `http://tenant.localhost/messages/${conversation.id}`,
      },
    ]);
  });

  it('publishes a live dm event for the recipient on every message', async () => {
    const fx = fixture();
    const conversation = await startWith(fx);

    await sendDmMessage(ctx(), { conversationId: conversation.id, body: 'Raz' }, fx.deps);
    await sendDmMessage(ctx(), { conversationId: conversation.id, body: 'Dwa' }, fx.deps);

    expect(fx.published).toEqual([
      { kind: 'dm', tenantId: 't1', recipientUserId: 'u2', conversationId: conversation.id },
      { kind: 'dm', tenantId: 't1', recipientUserId: 'u2', conversationId: conversation.id },
    ]);
  });

  it('notifies again once the recipient has read the conversation', async () => {
    const fx = fixture();
    const conversation = await startWith(fx);
    await sendDmMessage(ctx(), { conversationId: conversation.id, body: 'Cześć' }, fx.deps);

    await markDmConversationRead(
      ctx({ userId: 'u2', memberId: 'm2' }),
      { conversationId: conversation.id },
      fx.deps,
    );
    await sendDmMessage(ctx(), { conversationId: conversation.id, body: 'Wracam' }, fx.deps);

    expect(fx.notifications.rows).toHaveLength(2);
    expect(fx.notifications.rows[0]?.readAt).not.toBeNull();
  });

  it('refuses a non-participant with not_found', async () => {
    const fx = fixture({
      members: [
        member({ id: 'm1', userId: 'u1' }),
        member({ id: 'm2', userId: 'u2' }),
        member({ id: 'm3', userId: 'u3' }),
      ],
    });
    const conversation = await startWith(fx);

    const result = await sendDmMessage(
      ctx({ userId: 'u3', memberId: 'm3' }),
      { conversationId: conversation.id, body: 'Podsłuch' },
      fx.deps,
    );

    expect(result.ok ? null : result.error.code).toBe('not_found');
  });

  it('stops a member who opts out after the conversation started', async () => {
    const members = [member({ id: 'm1', userId: 'u1' }), member({ id: 'm2', userId: 'u2' })];
    const fx = fixture({ members });
    const conversation = await startWith(fx);
    members[1] = member({ id: 'm2', userId: 'u2', dmOptOutAt: NOW });

    const result = await sendDmMessage(ctx(), { conversationId: conversation.id, body: 'Halo' }, fx.deps);

    expect(result.ok ? null : result.error.code).toBe('forbidden');
  });

  it('rate limits messages per sender window', async () => {
    const fx = fixture();
    const conversation = await startWith(fx);

    const outcomes = [];
    for (let index = 0; index <= DM_MESSAGE_RATE_LIMIT.maxMessages; index += 1) {
      outcomes.push(
        await sendDmMessage(ctx(), { conversationId: conversation.id, body: `wiadomość ${String(index)}` }, fx.deps),
      );
    }

    expect(outcomes.filter((outcome) => outcome.ok)).toHaveLength(DM_MESSAGE_RATE_LIMIT.maxMessages);
    const last = outcomes.at(-1);
    expect(last !== undefined && !last.ok ? last.error.code : null).toBe('rate_limited');
  });
});

describe('reading conversations', () => {
  it('lists conversations newest first with the viewer unread state', async () => {
    const fx = fixture();
    const conversation = await startWith(fx);
    await sendDmMessage(ctx(), { conversationId: conversation.id, body: 'Cześć' }, fx.deps);

    const asRecipient = await listDmConversations(ctx({ userId: 'u2', memberId: 'm2' }), {}, fx.deps);
    const asSender = await listDmConversations(ctx(), {}, fx.deps);

    expect(asRecipient.ok && asRecipient.value.conversations[0]?.unread).toBe(true);
    expect(asSender.ok && asSender.value.conversations[0]?.unread).toBe(false);
    expect(asSender.ok && asSender.value.conversations[0]?.lastMessageIsOwn).toBe(true);
  });

  it('returns the thread to participants and not_found to everyone else', async () => {
    const fx = fixture({
      members: [
        member({ id: 'm1', userId: 'u1' }),
        member({ id: 'm2', userId: 'u2' }),
        member({ id: 'm3', userId: 'u3' }),
      ],
    });
    const conversation = await startWith(fx);
    await sendDmMessage(ctx(), { conversationId: conversation.id, body: 'Cześć' }, fx.deps);

    const participant = await listDmMessages(
      ctx({ userId: 'u2', memberId: 'm2' }),
      { conversationId: conversation.id },
      fx.deps,
    );
    const stranger = await getDmConversation(
      ctx({ userId: 'u3', memberId: 'm3' }),
      { conversationId: conversation.id },
      fx.deps,
    );

    expect(participant.ok && participant.value.messages.map((message) => message.isOwn)).toEqual([false]);
    expect(stranger.ok ? null : stranger.error.code).toBe('not_found');
  });

  it('counts unread conversations for the badge and clears them on read', async () => {
    const fx = fixture();
    const conversation = await startWith(fx);
    await sendDmMessage(ctx(), { conversationId: conversation.id, body: 'Cześć' }, fx.deps);
    const recipient = ctx({ userId: 'u2', memberId: 'm2' });

    const before = await dmUnreadCount(recipient, fx.deps);
    await markDmConversationRead(recipient, { conversationId: conversation.id }, fx.deps);
    const after = await dmUnreadCount(recipient, fx.deps);

    expect(before.ok && before.value.unread).toBe(1);
    expect(after.ok && after.value.unread).toBe(0);
  });
});
