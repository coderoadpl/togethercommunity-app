import { describe, expect, it } from 'vitest';

import { ok, type Notification } from '@core/domain/index.js';
import type { EmailPort, NotificationDeliveryContext } from '@core/server/index.js';

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
  const sent: Array<{ to: string; subject: string; html: string; text: string }> = [];
  const port: EmailPort = {
    send: async (message) => {
      sent.push(message);
      return ok({ messageId: 'msg-1' });
    },
  };
  return { sent, port };
};

describe('email notification channel', () => {
  it('renders the threadReply template onto the recipient address', async () => {
    const { sent, port } = captureEmail();

    const delivered = await createEmailNotificationChannel(port).deliver(notification, context);

    expect(delivered.ok).toBe(true);
    expect(sent).toHaveLength(1);
    expect(sent[0]?.to).toBe('u2@example.com');
    expect(sent[0]?.subject).toContain('Lekcja o hamakach');
    expect(sent[0]?.text).toContain('Ola');
    expect(sent[0]?.text).toContain('Świetne pytanie!');
    expect(sent[0]?.text).toContain('http://acme.localhost:48730/my/courses/c1/lessons/l1');
    expect(sent[0]?.html).toContain('Kamperowo');
  });

  it('renders the spacePost template for space-post notifications', async () => {
    const { sent, port } = captureEmail();

    const delivered = await createEmailNotificationChannel(port).deliver(
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
        contextUrl: 'http://acme.localhost:48730/my/spaces/s1',
      },
    );

    expect(delivered.ok).toBe(true);
    expect(sent[0]?.subject).toContain('Społeczność');
    expect(sent[0]?.subject).toContain('strefie');
    expect(sent[0]?.text).toContain('http://acme.localhost:48730/my/spaces/s1');
  });

  it('skips recipients without an email address', async () => {
    const { sent, port } = captureEmail();

    const delivered = await createEmailNotificationChannel(port).deliver(notification, {
      ...context,
      recipientEmail: null,
    });

    expect(delivered.ok).toBe(true);
    expect(sent).toEqual([]);
  });
});
