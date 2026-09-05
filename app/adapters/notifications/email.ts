import { ok, type EmailOutboxPayload, type Notification } from '#core/domain/index.js';
import type {
  Clock,
  EmailOutboxRepository,
  IdGenerator,
  NotificationChannelPort,
  NotificationDeliveryContext,
} from '#core/server/index.js';

/** `null` marks a notification kind that has no e-mail template and stays in-app. */
const emailPayloadFor = (
  notification: Notification,
  context: NotificationDeliveryContext,
): EmailOutboxPayload | null => {
  const shared = {
    language: context.language,
    tenantName: context.tenantName,
    snippet: notification.payload.snippet,
    url: context.contextUrl,
  };
  const authored = { ...shared, authorDisplay: notification.payload.authorDisplay ?? '' };
  switch (notification.kind) {
    case 'space-post':
      return { kind: 'space-post', ...authored, spaceName: context.contextName };
    case 'space-event':
      return { kind: 'space-event', ...authored, spaceName: context.contextName };
    case 'lesson-question':
      return { kind: 'lesson-question', ...authored, lessonName: context.contextName };
    case 'dm-message':
      return { kind: 'direct-message', ...shared, senderDisplay: context.contextName };
    case 'thread-reply':
    case 'dm-report':
      return { kind: 'thread-reply', ...authored, lessonName: context.contextName };
    case 'tenant-domain-verified':
    case 'tenant-domain-error':
      return null;
  }
};

export const createEmailNotificationChannel = (
  emailOutbox: EmailOutboxRepository,
  ids: IdGenerator,
  clock: Clock,
  dispatchEmail: () => void,
): NotificationChannelPort => ({
  deliver: async (notification, context) => {
    if (context.recipientEmail === null) return ok(undefined);
    const payload = emailPayloadFor(notification, context);
    if (payload === null) return ok(undefined);
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
