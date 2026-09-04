import { describe, expect, it } from 'vitest';

import type { Notification } from '#core/domain/index.js';
import type { NotificationDeliveryContext, RealtimeEvent } from '#core/server/index.js';

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
    eventId: null,
    domain: null,
    lessonName: 'Lesson 1',
    authorDisplay: 'Author',
    authorAvatarUrl: null,
    snippet: 'Hi there',
  },
  sourceKey: null,
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

const scope = { tenantId: 't1', recipientUserId: 'u2' };

describe('in-app notification channel', () => {
  it('publishes identifiers only onto the realtime bus', async () => {
    const bus = createRealtimeBus();
    const received: RealtimeEvent[] = [];
    bus.subscribe(scope, (event) => received.push(event));

    const delivered = await createInAppNotificationChannel(bus).deliver(notification, context);

    expect(delivered.ok).toBe(true);
    expect(received).toEqual([
      {
        kind: 'notification',
        tenantId: 't1',
        recipientUserId: 'u2',
        notificationId: 'n1',
        notificationKind: 'thread-reply',
        createdAt: '2026-07-15T10:00:00.000Z',
      },
    ]);
  });

  it('delivers only to listeners scoped to the tenant and recipient', async () => {
    const bus = createRealtimeBus();
    const received: RealtimeEvent[] = [];
    bus.subscribe({ tenantId: 't1', recipientUserId: 'u3' }, (event) => received.push(event));
    bus.subscribe({ tenantId: 't2', recipientUserId: 'u2' }, (event) => received.push(event));

    await createInAppNotificationChannel(bus).deliver(notification, context);

    expect(received).toEqual([]);
  });

  it('stops delivering to unsubscribed listeners', async () => {
    const bus = createRealtimeBus();
    const received: RealtimeEvent[] = [];
    const unsubscribe = bus.subscribe(scope, (event) => received.push(event));
    unsubscribe();

    await createInAppNotificationChannel(bus).deliver(notification, context);

    expect(received).toEqual([]);
  });
});
