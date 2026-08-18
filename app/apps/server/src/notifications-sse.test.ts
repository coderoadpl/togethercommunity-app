import { describe, expect, it } from 'vitest';

import type { Notification } from '#core/domain/index.js';
import type { RealtimeBusPort, RealtimeEvent } from '#core/server/index.js';

import { createNotificationEventStream } from './notifications-sse.js';

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
  readAt: null,
  createdAt: '2026-07-15T10:00:00.000Z',
  ...overrides,
});

const recordingBus = () => {
  const listeners = new Set<(event: RealtimeEvent) => void>();
  let unsubscribed = 0;
  const bus: RealtimeBusPort = {
    publish: (event) => {
      for (const listener of listeners) listener(event);
    },
    subscribe: (listener) => {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
        unsubscribed += 1;
      };
    },
  };
  return { bus, listenerCount: () => listeners.size, unsubscribedCount: () => unsubscribed };
};

const decoder = new TextDecoder();

const readChunk = async (reader: ReadableStreamDefaultReader<Uint8Array>): Promise<string> => {
  const { value, done } = await reader.read();
  if (done || value === undefined) throw new Error('stream ended unexpectedly');
  return decoder.decode(value);
};

describe('notification event stream', () => {
  it('sends the unread count on connect, then bus events for the recipient only', async () => {
    const { bus } = recordingBus();
    const stream = createNotificationEventStream({
      tenantId: 't1',
      recipientUserId: 'u1',
      bus,
      unreadCount: async () => 3,
      heartbeatMs: 60_000,
    });
    const reader = stream.getReader();

    expect(await readChunk(reader)).toBe('event: unread\ndata: {"unread":3}\n\n');

    const mine = notification({ id: 'n-mine' });
    bus.publish({ kind: 'notification', tenantId: 't1', recipientUserId: 'u2', notification: notification({ id: 'n-other-user' }) });
    bus.publish({ kind: 'notification', tenantId: 't2', recipientUserId: 'u1', notification: notification({ id: 'n-other-tenant' }) });
    bus.publish({ kind: 'notification', tenantId: 't1', recipientUserId: 'u1', notification: mine });

    const chunk = await readChunk(reader);
    expect(chunk).toBe(`event: notification\ndata: ${JSON.stringify(mine)}\n\n`);

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
    });
    const reader = stream.getReader();
    await readChunk(reader);

    bus.publish({ kind: 'dm', tenantId: 't1', recipientUserId: 'u2', conversationId: 'c-other' });
    bus.publish({ kind: 'dm', tenantId: 't1', recipientUserId: 'u1', conversationId: 'c-mine' });

    expect(await readChunk(reader)).toBe('event: dm\ndata: {"conversationId":"c-mine"}\n\n');

    await reader.cancel();
  });

  it('unsubscribes from the bus and stops the heartbeat on disconnect', async () => {
    const { bus, listenerCount, unsubscribedCount } = recordingBus();
    const stream = createNotificationEventStream({
      tenantId: 't1',
      recipientUserId: 'u1',
      bus,
      unreadCount: async () => 0,
      heartbeatMs: 60_000,
    });
    const reader = stream.getReader();
    await readChunk(reader);
    expect(listenerCount()).toBe(1);

    await reader.cancel();

    expect(listenerCount()).toBe(0);
    expect(unsubscribedCount()).toBe(1);
  });
});
