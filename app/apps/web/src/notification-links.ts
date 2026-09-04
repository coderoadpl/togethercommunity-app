import { useNavigate } from '@tanstack/react-router';

import type { Notification } from '#core/domain/index.js';

import type { Messages } from './i18n/index.js';

export type NotificationTarget =
  | { kind: 'space-thread'; spaceId: string; postId: string }
  | { kind: 'lesson-thread'; courseId: string; lessonId: string; rootPostId: string }
  | { kind: 'dm-conversation'; conversationId: string }
  | { kind: 'dm-reports' }
  | { kind: 'space-event'; spaceId: string; eventId: string }
  | { kind: 'tenant-domains' }
  | { kind: 'none' };

const TENANT_DOMAIN_KINDS: readonly Notification['kind'][] = [
  'tenant-domain-verified',
  'tenant-domain-error',
];

export const notificationTarget = (notification: Notification): NotificationTarget => {
  const { contextKind, contextId, rootPostId, courseId, eventId } = notification.payload;
  if (TENANT_DOMAIN_KINDS.includes(notification.kind)) return { kind: 'tenant-domains' };
  if (notification.kind === 'dm-report') return { kind: 'dm-reports' };
  if (contextId === null) return { kind: 'none' };
  if (notification.kind === 'space-event') {
    return eventId === null
      ? { kind: 'none' }
      : { kind: 'space-event', spaceId: contextId, eventId };
  }
  if (contextKind === 'dm') return { kind: 'dm-conversation', conversationId: contextId };
  if (rootPostId === null) return { kind: 'none' };
  if (contextKind === 'space') {
    return { kind: 'space-thread', spaceId: contextId, postId: rootPostId };
  }
  return courseId === null
    ? { kind: 'none' }
    : { kind: 'lesson-thread', courseId, lessonId: contextId, rootPostId };
};

export const notificationTitle = (t: Messages, notification: Notification): string => {
  const { lessonName, domain = '' } = notification.payload;
  const author = notification.payload.authorDisplay ?? '';
  return notification.kind === 'tenant-domain-verified'
  ? t.notifications.tenantDomainVerified({ domain })
  : notification.kind === 'tenant-domain-error'
  ? t.notifications.tenantDomainError({ domain })
  : notification.kind === 'dm-report'
  ? t.notifications.dmReport({ reporter: author })
  : notification.kind === 'space-event'
    ? t.notifications.spaceEvent({ space: lessonName })
    : notification.kind === 'dm-message'
    ? t.notifications.dmMessage({ author })
    : notification.kind === 'space-post'
      ? t.notifications.spacePost({ author, space: lessonName })
      : notification.kind === 'lesson-question'
        ? t.notifications.lessonQuestion({ author, lesson: lessonName })
        : t.notifications.threadReply({ author, lesson: lessonName });
};

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
    } else if (target.kind === 'dm-conversation') {
      void navigate({
        to: '/messages/$conversationId',
        params: { conversationId: target.conversationId },
      });
    } else if (target.kind === 'dm-reports') {
      void navigate({ to: '/panel/reports' });
    } else if (target.kind === 'tenant-domains') {
      void navigate({ to: '/panel/settings', hash: 'company' });
    } else if (target.kind === 'space-event') {
      void navigate({
        to: '/community/$spaceId/events/$eventId',
        params: { spaceId: target.spaceId, eventId: target.eventId },
      });
    }
  };
};
