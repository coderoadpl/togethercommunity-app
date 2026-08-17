import { describe, expect, it } from 'vitest';

import type { Notification } from '#core/domain/index.js';

import { pl } from './i18n/pl.js';
import { notificationTarget, notificationTitle } from './notification-links.js';

const notification = (input: {
  kind: Notification['kind'];
  contextKind: 'lesson' | 'space' | 'dm';
  contextId: string;
  courseId: string | null;
  lessonName?: string;
}): Notification => ({
  id: 'n1',
  tenantId: 't1',
  recipientUserId: 'u1',
  kind: input.kind,
  payload: {
    rootPostId: 'root-1',
    postId: 'reply-1',
    contextKind: input.contextKind,
    contextId: input.contextId,
    courseId: input.courseId,
    eventId: null,
    lessonName: input.lessonName ?? 'Hamaki w kamperze',
    authorDisplay: 'Ola',
    authorAvatarUrl: null,
    snippet: 'Już odpowiadam',
  },
  readAt: null,
  createdAt: '2026-08-15T08:00:00.000Z',
});

describe('notificationTarget', () => {
  it('routes a space post to the thread page of its root post', () => {
    expect(
      notificationTarget(
        notification({ kind: 'space-post', contextKind: 'space', contextId: 's1', courseId: null }),
      ),
    ).toEqual({ kind: 'space-thread', spaceId: 's1', postId: 'root-1' });
  });

  it('routes a lesson question to its lesson with the thread root', () => {
    expect(
      notificationTarget(
        notification({
          kind: 'lesson-question',
          contextKind: 'lesson',
          contextId: 'l1',
          courseId: 'c1',
        }),
      ),
    ).toEqual({ kind: 'lesson-thread', courseId: 'c1', lessonId: 'l1', rootPostId: 'root-1' });
  });

  it('routes a lesson thread reply to its lesson with the thread root', () => {
    expect(
      notificationTarget(
        notification({
          kind: 'thread-reply',
          contextKind: 'lesson',
          contextId: 'l1',
          courseId: 'c1',
        }),
      ),
    ).toEqual({ kind: 'lesson-thread', courseId: 'c1', lessonId: 'l1', rootPostId: 'root-1' });
  });

  it('routes a direct message to its conversation', () => {
    expect(
      notificationTarget(
        notification({ kind: 'dm-message', contextKind: 'dm', contextId: 'c1', courseId: null }),
      ),
    ).toEqual({ kind: 'dm-conversation', conversationId: 'c1' });
  });

  it('leaves a legacy lesson notification without a course unroutable', () => {
    expect(
      notificationTarget(
        notification({
          kind: 'thread-reply',
          contextKind: 'lesson',
          contextId: 'l1',
          courseId: null,
        }),
      ),
    ).toEqual({ kind: 'none' });
  });
});

describe('notificationTitle', () => {
  it('names the space for a space post', () => {
    expect(
      notificationTitle(
        pl,
        notification({
          kind: 'space-post',
          contextKind: 'space',
          contextId: 's1',
          courseId: null,
          lessonName: 'Ogólna',
        }),
      ),
    ).toBe(pl.notifications.spacePost({ author: 'Ola', space: 'Ogólna' }));
  });

  it('names the sender for a direct message', () => {
    expect(
      notificationTitle(
        pl,
        notification({
          kind: 'dm-message',
          contextKind: 'dm',
          contextId: 'c1',
          courseId: null,
          lessonName: 'Ola',
        }),
      ),
    ).toBe(pl.notifications.dmMessage({ author: 'Ola' }));
  });

  it('names the lesson for a question and for a reply', () => {
    expect(
      notificationTitle(
        pl,
        notification({
          kind: 'lesson-question',
          contextKind: 'lesson',
          contextId: 'l1',
          courseId: 'c1',
        }),
      ),
    ).toBe(pl.notifications.lessonQuestion({ author: 'Ola', lesson: 'Hamaki w kamperze' }));
    expect(
      notificationTitle(
        pl,
        notification({
          kind: 'thread-reply',
          contextKind: 'lesson',
          contextId: 'l1',
          courseId: 'c1',
        }),
      ),
    ).toBe(pl.notifications.threadReply({ author: 'Ola', lesson: 'Hamaki w kamperze' }));
  });
});
