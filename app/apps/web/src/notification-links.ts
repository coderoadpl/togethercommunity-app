import { useNavigate } from '@tanstack/react-router';

import type { Notification } from '#core/domain/index.js';

import type { Messages } from './i18n/index.js';

export type NotificationTarget =
  | { kind: 'space-thread'; spaceId: string; postId: string }
  | { kind: 'lesson-thread'; courseId: string; lessonId: string; rootPostId: string }
  | { kind: 'none' };

export const notificationTarget = (notification: Notification): NotificationTarget =>
  notification.payload.contextKind === 'space'
    ? {
        kind: 'space-thread',
        spaceId: notification.payload.contextId,
        postId: notification.payload.rootPostId,
      }
    : notification.payload.courseId === null
      ? { kind: 'none' }
      : {
          kind: 'lesson-thread',
          courseId: notification.payload.courseId,
          lessonId: notification.payload.contextId,
          rootPostId: notification.payload.rootPostId,
        };

export const notificationTitle = (t: Messages, notification: Notification): string =>
  notification.kind === 'space-post'
    ? t.notifications.spacePost({
        author: notification.payload.authorDisplay,
        space: notification.payload.lessonName,
      })
    : notification.kind === 'lesson-question'
      ? t.notifications.lessonQuestion({
          author: notification.payload.authorDisplay,
          lesson: notification.payload.lessonName,
        })
      : t.notifications.threadReply({
          author: notification.payload.authorDisplay,
          lesson: notification.payload.lessonName,
        });

export const useNotificationNavigation = () => {
  const navigate = useNavigate();
  return (target: NotificationTarget) => {
    if (target.kind === 'space-thread') {
      void navigate({
        to: '/community/$spaceId/posts/$postId',
        params: { spaceId: target.spaceId, postId: target.postId },
      });
    } else if (target.kind === 'lesson-thread') {
      void navigate({
        to: '/my/courses/$courseId/lessons/$lessonId',
        params: { courseId: target.courseId, lessonId: target.lessonId },
        search: { thread: target.rootPostId },
      });
    }
  };
};
