import { describe, expect, it } from 'vitest';

import type { DmConversation, Notification } from '#core/domain/index.js';
import { createScopedSubscribers } from '#core/server/index.js';
import type {
  DmConversationRepository,
  NotificationRepository,
  RealtimeBusPort,
  RealtimeEvent,
} from '#core/server/index.js';

import {
  createNotificationEventStream,
  parseLastEventId,
  replayRealtimeEvents,
} from './notifications-sse.js';

const notification = (overrides: Partial<Notification>): Notification => ({
  id: 'n1',
  tenantId: 't1',
  recipientUserId: 'u1',
  kind: 'thread-reply',
  payload: {
    rootPostId: 'p1',
    postId: 'p2',
    contextKind: 'lesson',
    contextId: 'l1',
    courseId: 'c1',
    eventId: null,
    lessonName: 'Lesson 1',
    authorDisplay: 'Author',
    authorAvatarUrl: null,
    snippet: 'hello',
  },
  sourceKey: null,
  readAt: null,
  createdAt: '2026-07-15T10:00:00.000Z',
  ...overrides,
});

const conversation = (overrides: Partial<DmConversation>): DmConversation => ({
  id: 'c1',
  tenantId: 't1',
  participantLowUserId: 'u1',
  participantHighUserId: 'u2',
  createdByUserId: 'u2',
  createdAt: '2026-07-15T10:00:00.000Z',
  lastMessageId: 'm1',
  lastMessageAt: '2026-07-15T10:00:00.000Z',
  lastMessageSnippet: 'hi',
  lastMessageSenderUserId: 'u2',
  ...overrides,
});

const recordingBus = () => {
  const subscribers = createScopedSubscribers();
  let unsubscribed = 0;
  const bus: RealtimeBusPort = {
    publish: (event) => {
      subscribers.deliver(event);
    },
    subscribe: (scope, listener) => {
      const remove = subscribers.add(scope, listener);
      return () => {
        remove();
        unsubscribed += 1;
      };
    },
  };
  return {
    bus,
    listenerCount: () => subscribers.size(),
    unsubscribedCount: () => unsubscribed,
  };
};

const notificationsStub = (rows: Notification[]): NotificationRepository => ({
  insert: async (_tenantId, row) => row,
  insertMany: async (_tenantId, inserted) => inserted,
  listForRecipient: async () => ({ notifications: rows, nextCursor: null }),
  markRead: async () => null,
  markAllRead: async () => 0,
  unreadCount: async () => 0,
  hasUnreadDmNotification: async () => false,
  markDmConversationRead: async () => 0,
});

const conversationsStub = (rows: DmConversation[]): DmConversationRepository => ({
  findById: async () => null,
  findByParticipants: async () => null,
  insert: async (_tenantId, row) => row,
  listForParticipant: async () => ({ conversations: rows, nextCursor: null }),
  countCreatedBySince: async () => 0,
  countUnreadForParticipant: async () => 0,
  applyLastMessage: async () => null,
});

const decoder = new TextDecoder();

const readChunk = async (reader: ReadableStreamDefaultReader<Uint8Array>): Promise<string> => {
  const { value, done } = await reader.read();
  if (done || value === undefined) throw new Error('stream ended unexpectedly');
  return decoder.decode(value);
};

describe('notification event stream', () => {
  it('opens with a reconnect delay and the unread count, then streams bus events', async () => {
    const { bus } = recordingBus();
    const stream = createNotificationEventStream({
      tenantId: 't1',
      recipientUserId: 'u1',
      bus,
      unreadCount: async () => 3,
      heartbeatMs: 60_000,
      lifetimeMs: 60_000,
    });
    const reader = stream.getReader();

    expect(await readChunk(reader)).toBe('retry: 1000\n\n');
    expect(await readChunk(reader)).toBe('event: unread\ndata: {"unread":3}\n\n');

    bus.publish({
      kind: 'notification',
      tenantId: 't1',
      recipientUserId: 'u2',
      notificationId: 'n-other-user',
      createdAt: '2026-07-15T10:00:01.000Z',
    });
    bus.publish({
      kind: 'notification',
      tenantId: 't1',
      recipientUserId: 'u1',
      notificationId: 'n-mine',
      createdAt: '2026-07-15T10:00:02.000Z',
    });

    expect(await readChunk(reader)).toBe(
      'id: 2026-07-15T10:00:02.000Z|n-mine\nevent: notification\ndata: {"id":"n-mine"}\n\n',
    );

    await reader.cancel();
  });

  it('sends a lightweight dm event so an open conversation refetches', async () => {
    const { bus } = recordingBus();
    const stream = createNotificationEventStream({
      tenantId: 't1',
      recipientUserId: 'u1',
      bus,
      unreadCount: async () => 0,
      heartbeatMs: 60_000,
      lifetimeMs: 60_000,
    });
    const reader = stream.getReader();
    await readChunk(reader);
    await readChunk(reader);

    bus.publish({
      kind: 'dm',
      tenantId: 't1',
      recipientUserId: 'u1',
      conversationId: 'c-mine',
      createdAt: '2026-07-15T10:00:03.000Z',
    });

    expect(await readChunk(reader)).toBe(
      'id: 2026-07-15T10:00:03.000Z|c-mine\nevent: dm\ndata: {"conversationId":"c-mine"}\n\n',
    );

    await reader.cancel();
  });

  it('replays events the client missed before subscribing to live ones', async () => {
    const { bus } = recordingBus();
    const stream = createNotificationEventStream({
      tenantId: 't1',
      recipientUserId: 'u1',
      bus,
      unreadCount: async () => 1,
      heartbeatMs: 60_000,
      lifetimeMs: 60_000,
      replay: async () => [
        {
          kind: 'notification',
          tenantId: 't1',
          recipientUserId: 'u1',
          notificationId: 'n-missed',
          createdAt: '2026-07-15T10:00:04.000Z',
        },
      ],
    });
    const reader = stream.getReader();
    await readChunk(reader);
    await readChunk(reader);

    expect(await readChunk(reader)).toBe(
      'id: 2026-07-15T10:00:04.000Z|n-missed\nevent: notification\ndata: {"id":"n-missed"}\n\n',
    );

    await reader.cancel();
  });

  it('delivers live events published while the opening queries run', async () => {
    const { bus } = recordingBus();
    const stream = createNotificationEventStream({
      tenantId: 't1',
      recipientUserId: 'u1',
      bus,
      unreadCount: async () => {
        bus.publish({
          kind: 'dm',
          tenantId: 't1',
          recipientUserId: 'u1',
          conversationId: 'c-live',
          createdAt: '2026-07-15T10:00:06.000Z',
        });
        return 0;
      },
      heartbeatMs: 60_000,
      lifetimeMs: 60_000,
      replay: async () => [
        {
          kind: 'notification',
          tenantId: 't1',
          recipientUserId: 'u1',
          notificationId: 'n-missed',
          createdAt: '2026-07-15T10:00:05.000Z',
        },
      ],
    });
    const reader = stream.getReader();
    await readChunk(reader);
    await readChunk(reader);

    expect(await readChunk(reader)).toBe(
      'id: 2026-07-15T10:00:05.000Z|n-missed\nevent: notification\ndata: {"id":"n-missed"}\n\n',
    );
    expect(await readChunk(reader)).toBe(
      'id: 2026-07-15T10:00:06.000Z|c-live\nevent: dm\ndata: {"conversationId":"c-live"}\n\n',
    );

    await reader.cancel();
  });

  it('sends an event once when it arrives live and in the replay', async () => {
    const { bus } = recordingBus();
    const duplicate: RealtimeEvent = {
      kind: 'notification',
      tenantId: 't1',
      recipientUserId: 'u1',
      notificationId: 'n-dup',
      createdAt: '2026-07-15T10:00:07.000Z',
    };
    const stream = createNotificationEventStream({
      tenantId: 't1',
      recipientUserId: 'u1',
      bus,
      unreadCount: async () => {
        bus.publish(duplicate);
        return 0;
      },
      heartbeatMs: 60_000,
      lifetimeMs: 60_000,
      replay: async () => [duplicate],
    });
    const reader = stream.getReader();
    await readChunk(reader);
    await readChunk(reader);

    expect(await readChunk(reader)).toBe(
      'id: 2026-07-15T10:00:07.000Z|n-dup\nevent: notification\ndata: {"id":"n-dup"}\n\n',
    );

    bus.publish({
      kind: 'notification',
      tenantId: 't1',
      recipientUserId: 'u1',
      notificationId: 'n-after',
      createdAt: '2026-07-15T10:00:08.000Z',
    });

    expect(await readChunk(reader)).toBe(
      'id: 2026-07-15T10:00:08.000Z|n-after\nevent: notification\ndata: {"id":"n-after"}\n\n',
    );

    await reader.cancel();
  });

  it('closes the stream before the serverless cap so the client reconnects', async () => {
    const { bus, listenerCount } = recordingBus();
    const stream = createNotificationEventStream({
      tenantId: 't1',
      recipientUserId: 'u1',
      bus,
      unreadCount: async () => 0,
      heartbeatMs: 60_000,
      lifetimeMs: 5,
    });
    const reader = stream.getReader();
    await readChunk(reader);
    await readChunk(reader);

    let done = false;
    while (!done) done = (await reader.read()).done;

    expect(listenerCount()).toBe(0);
  });

  it('counts the lifetime from stream start, not from the end of the opening queries', async () => {
    const { bus, listenerCount } = recordingBus();
    const stream = createNotificationEventStream({
      tenantId: 't1',
      recipientUserId: 'u1',
      bus,
      unreadCount: async () => {
        await new Promise((resolve) => setTimeout(resolve, 40));
        return 0;
      },
      heartbeatMs: 60_000,
      lifetimeMs: 5,
    });
    const reader = stream.getReader();

    let done = false;
    while (!done) done = (await reader.read()).done;

    expect(listenerCount()).toBe(0);
  });

  it('drops the lifetime timer when the opening queries fail', async () => {
    const { bus, listenerCount } = recordingBus();
    const stream = createNotificationEventStream({
      tenantId: 't1',
      recipientUserId: 'u1',
      bus,
      unreadCount: async () => {
        throw new Error('database unavailable');
      },
      heartbeatMs: 60_000,
      lifetimeMs: 5,
    });
    const reader = stream.getReader();

    expect(await readChunk(reader)).toBe('retry: 1000\n\n');
    await expect(reader.read()).rejects.toThrow('database unavailable');
    await new Promise((resolve) => setTimeout(resolve, 20));

    expect(listenerCount()).toBe(0);
  });

  it('unsubscribes from the bus and stops the heartbeat on disconnect', async () => {
    const { bus, listenerCount, unsubscribedCount } = recordingBus();
    const stream = createNotificationEventStream({
      tenantId: 't1',
      recipientUserId: 'u1',
      bus,
      unreadCount: async () => 0,
      heartbeatMs: 60_000,
      lifetimeMs: 60_000,
    });
    const reader = stream.getReader();
    await readChunk(reader);
    await readChunk(reader);
    expect(listenerCount()).toBe(1);

    await reader.cancel();

    expect(listenerCount()).toBe(0);
    expect(unsubscribedCount()).toBe(1);
  });
});

describe('last-event-id replay', () => {
  it('parses only well-formed cursors', () => {
    expect(parseLastEventId('2026-07-15T10:00:00.000Z|n1')).toEqual({
      at: '2026-07-15T10:00:00.000Z',
      id: 'n1',
    });
    expect(parseLastEventId(undefined)).toBeNull();
    expect(parseLastEventId('no-separator')).toBeNull();
    expect(parseLastEventId('|n1')).toBeNull();
    expect(parseLastEventId('2026-07-15T10:00:00.000Z|')).toBeNull();
  });

  it('returns persisted notifications and inbound conversations after the cursor, oldest first', async () => {
    const events = await replayRealtimeEvents({
      tenantId: 't1',
      recipientUserId: 'u1',
      since: { at: '2026-07-15T10:00:00.000Z', id: 'n1' },
      notifications: notificationsStub([
        notification({ id: 'n2', createdAt: '2026-07-15T10:00:05.000Z' }),
        notification({ id: 'n1', createdAt: '2026-07-15T10:00:00.000Z' }),
      ]),
      dmConversations: conversationsStub([
        conversation({ id: 'c2', lastMessageAt: '2026-07-15T10:00:02.000Z' }),
        conversation({ id: 'c1', lastMessageAt: '2026-07-15T09:00:00.000Z' }),
      ]),
    });

    expect(events).toEqual([
      {
        kind: 'dm',
        tenantId: 't1',
        recipientUserId: 'u1',
        conversationId: 'c2',
        createdAt: '2026-07-15T10:00:02.000Z',
      },
      {
        kind: 'notification',
        tenantId: 't1',
        recipientUserId: 'u1',
        notificationId: 'n2',
        createdAt: '2026-07-15T10:00:05.000Z',
      },
    ]);
  });

  it('replays inside the clock-skew tolerance without repeating the cursor event', async () => {
    const events = await replayRealtimeEvents({
      tenantId: 't1',
      recipientUserId: 'u1',
      since: { at: '2026-07-15T10:00:00.000Z', id: 'n1' },
      notifications: notificationsStub([
        notification({ id: 'n1', createdAt: '2026-07-15T10:00:00.000Z' }),
        notification({ id: 'n-skewed', createdAt: '2026-07-15T09:59:58.000Z' }),
        notification({ id: 'n-old', createdAt: '2026-07-15T09:59:50.000Z' }),
      ]),
      dmConversations: conversationsStub([]),
    });

    expect(events.map((event) => event.createdAt)).toEqual(['2026-07-15T09:59:58.000Z']);
  });

  it('replays a newer message in the conversation the cursor points at', async () => {
    const since = { at: '2026-07-15T10:00:00.000Z', id: 'c-active' };

    const unchanged = await replayRealtimeEvents({
      tenantId: 't1',
      recipientUserId: 'u1',
      since,
      notifications: notificationsStub([]),
      dmConversations: conversationsStub([
        conversation({ id: 'c-active', lastMessageAt: '2026-07-15T10:00:00.000Z' }),
      ]),
    });
    const answered = await replayRealtimeEvents({
      tenantId: 't1',
      recipientUserId: 'u1',
      since,
      notifications: notificationsStub([]),
      dmConversations: conversationsStub([
        conversation({
          id: 'c-active',
          lastMessageId: 'm2',
          lastMessageAt: '2026-07-15T10:00:30.000Z',
        }),
      ]),
    });

    expect(unchanged).toEqual([]);
    expect(answered).toEqual([
      {
        kind: 'dm',
        tenantId: 't1',
        recipientUserId: 'u1',
        conversationId: 'c-active',
        createdAt: '2026-07-15T10:00:30.000Z',
      },
    ]);
  });

  it('skips conversations whose last message the recipient sent', async () => {
    const events = await replayRealtimeEvents({
      tenantId: 't1',
      recipientUserId: 'u1',
      since: { at: '2026-07-15T09:00:00.000Z', id: 'n0' },
      notifications: notificationsStub([]),
      dmConversations: conversationsStub([
        conversation({ id: 'c-own', lastMessageSenderUserId: 'u1' }),
        conversation({ id: 'c-empty', lastMessageId: null }),
      ]),
    });

    expect(events).toEqual([]);
  });
});
