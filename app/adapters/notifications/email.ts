import { ok } from '@core/domain/index.js';
import type { Clock, EmailOutboxRepository, IdGenerator, NotificationChannelPort } from '@core/server/index.js';

export const createEmailNotificationChannel = (
  emailOutbox: EmailOutboxRepository,
  ids: IdGenerator,
  clock: Clock,
  dispatchEmail: () => void,
): NotificationChannelPort => ({
  deliver: async (notification, context) => {
    if (context.recipientEmail === null) return ok(undefined);
    const payload =
      notification.kind === 'space-post'
        ? {
            kind: 'space-post' as const,
            language: context.language,
            tenantName: context.tenantName,
            spaceName: context.contextName,
            authorDisplay: notification.payload.authorDisplay,
            snippet: notification.payload.snippet,
            url: context.contextUrl,
          }
        : notification.kind === 'lesson-question'
          ? {
              kind: 'lesson-question' as const,
              language: context.language,
              tenantName: context.tenantName,
              lessonName: context.contextName,
              authorDisplay: notification.payload.authorDisplay,
              snippet: notification.payload.snippet,
              url: context.contextUrl,
            }
          : {
              kind: 'thread-reply' as const,
              language: context.language,
              tenantName: context.tenantName,
              lessonName: context.contextName,
              authorDisplay: notification.payload.authorDisplay,
              snippet: notification.payload.snippet,
              url: context.contextUrl,
            };
    const queued = await emailOutbox.enqueue({
      id: ids.nextId(),
      tenantId: notification.tenantId,
      to: context.recipientEmail,
      payload,
      now: clock.nowIso(),
    });
    if (!queued.ok) return queued;
    dispatchEmail();
    return ok(undefined);
  },
});
