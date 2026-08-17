import { describe, expect, it } from 'vitest';

import type { Notification } from '#core/domain/index.js';
import type { NotificationDeliveryContext, RealtimeNotificationEvent } from '#core/server/index.js';

import { createInAppNotificationChannel, createRealtimeBus } from './in-app.js';

const notification: Notification = {
  id: 'n1',
  tenantId: 't1',
  recipientUserId: 'u2',
  kind: 'thread-reply',
  payload: {
    rootPostId: 'p1',
    postId: 'p2',
    contextKind: 'lesson',
    contextId: 'l1',
    courseId: 'c1',
    lessonName: 'Lesson 1',
    authorDisplay: 'Author',
    authorAvatarUrl: null,
    snippet: 'Hi there',
  },
  readAt: null,
  createdAt: '2026-07-15T10:00:00.000Z',
};

const context: NotificationDeliveryContext = {
  recipientEmail: 'u2@example.com',
  tenantName: 'Tenant',
  contextName: 'Lesson 1',
  contextUrl: 'http://acme.localhost/my/courses/c1/lessons/l1',
  language: 'pl',
};

describe('in-app notification channel', () => {
  it('publishes the notification onto the realtime bus', async () => {
    const bus = createRealtimeBus();
    const received: RealtimeNotificationEvent[] = [];
    bus.subscribe((event) => received.push(event));

    const delivered = await createInAppNotificationChannel(bus).deliver(notification, context);

    expect(delivered.ok).toBe(true);
    expect(received).toEqual([{ tenantId: 't1', recipientUserId: 'u2', notification }]);
  });

  it('stops delivering to unsubscribed listeners', async () => {
    const bus = createRealtimeBus();
    const received: RealtimeNotificationEvent[] = [];
    const unsubscribe = bus.subscribe((event) => received.push(event));
    unsubscribe();

    await createInAppNotificationChannel(bus).deliver(notification, context);

    expect(received).toEqual([]);
  });
});
