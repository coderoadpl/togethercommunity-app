import { ok } from '#core/domain/index.js';
import type { Clock, EmailOutboxRepository, IdGenerator, NotificationChannelPort } from '#core/server/index.js';

export const createEmailNotificationChannel = (
  emailOutbox: EmailOutboxRepository,
  ids: IdGenerator,
  clock: Clock,
  dispatchEmail: () => void,
): NotificationChannelPort => ({
  deliver: async (notification, context) => {
    if (context.recipientEmail === null) return ok(undefined);
    const shared = {
      language: context.language,
      tenantName: context.tenantName,
      snippet: notification.payload.snippet,
      url: context.contextUrl,
    };
    const authored = {
      ...shared,
      authorDisplay: notification.payload.authorDisplay,
    };
    const payload =
      notification.kind === 'space-post'
        ? { kind: 'space-post' as const, ...authored, spaceName: context.contextName }
        : notification.kind === 'space-event'
          ? { kind: 'space-event' as const, ...authored, spaceName: context.contextName }
          : notification.kind === 'lesson-question'
            ? { kind: 'lesson-question' as const, ...authored, lessonName: context.contextName }
            : notification.kind === 'dm-message'
              ? { kind: 'direct-message' as const, ...shared, senderDisplay: context.contextName }
              : { kind: 'thread-reply' as const, ...authored, lessonName: context.contextName };
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
