import { describe, expect, it } from 'vitest';

import { ok, type EmailOutboxPayload, type Notification } from '@core/domain/index.js';
import type { EmailOutboxRepository, NotificationDeliveryContext } from '@core/server/index.js';

import { createEmailNotificationChannel } from './email.js';

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
    lessonName: 'Lekcja o hamakach',
    authorDisplay: 'Ola',
    snippet: 'Świetne pytanie!',
  },
  readAt: null,
  createdAt: '2026-07-15T10:00:00.000Z',
};

const context: NotificationDeliveryContext = {
  recipientEmail: 'u2@example.com',
  tenantName: 'Kamperowo',
  contextName: 'Lekcja o hamakach',
  contextUrl: 'http://acme.localhost:48730/my/courses/c1/lessons/l1',
  language: 'pl',
};

const captureEmail = () => {
  const sent: Array<{ to: string; payload: EmailOutboxPayload }> = [];
  const port: EmailOutboxRepository = {
    enqueue: async (message) => {
      sent.push({ to: message.to, payload: message.payload });
      return ok({ id: message.id });
    },
    claimBatch: async () => ok([]),
    markSent: async () => ok(undefined),
    markFailed: async () => ok(undefined),
  };
  return { sent, port };
};

const channel = (port: EmailOutboxRepository) => createEmailNotificationChannel(
  port,
  { nextId: () => 'email-1' },
  { nowIso: () => '2026-07-15T10:00:00.000Z' },
  () => undefined,
);

describe('email notification channel', () => {
  it('renders the threadReply template onto the recipient address', async () => {
    const { sent, port } = captureEmail();

    const delivered = await channel(port).deliver(notification, context);

    expect(delivered.ok).toBe(true);
    expect(sent).toHaveLength(1);
    expect(sent[0]?.to).toBe('u2@example.com');
    expect(sent[0]?.payload).toMatchObject({ kind: 'thread-reply', lessonName: 'Lekcja o hamakach', authorDisplay: 'Ola', snippet: 'Świetne pytanie!', tenantName: 'Kamperowo' });
  });

  it('renders the spacePost template for space-post notifications', async () => {
    const { sent, port } = captureEmail();

    const delivered = await channel(port).deliver(
      {
        ...notification,
        kind: 'space-post',
        payload: {
          ...notification.payload,
          contextKind: 'space',
          contextId: 's1',
          courseId: null,
          lessonName: 'Społeczność',
        },
      },
      {
        ...context,
        contextName: 'Społeczność',
        contextUrl: 'http://acme.localhost:48730/community/s1/posts/p1',
      },
    );

    expect(delivered.ok).toBe(true);
    expect(sent[0]?.payload).toMatchObject({ kind: 'space-post', spaceName: 'Społeczność', url: 'http://acme.localhost:48730/community/s1/posts/p1' });
  });

  it('renders the lesson question template for lesson-question notifications', async () => {
    const { sent, port } = captureEmail();

    const delivered = await channel(port).deliver(
      { ...notification, kind: 'lesson-question' },
      { ...context, language: 'en' },
    );

    expect(delivered.ok).toBe(true);
    expect(sent[0]?.payload).toMatchObject({ kind: 'lesson-question', language: 'en', lessonName: 'Lekcja o hamakach' });
  });

  it('skips recipients without an email address', async () => {
    const { sent, port } = captureEmail();

    const delivered = await channel(port).deliver(notification, {
      ...context,
      recipientEmail: null,
    });

    expect(delivered.ok).toBe(true);
    expect(sent).toEqual([]);
  });
});
