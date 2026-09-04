import { ok } from '#core/domain/index.js';
import { createScopedSubscribers } from '#core/server/index.js';
import type { NotificationChannelPort, RealtimeBusPort } from '#core/server/index.js';

export const createRealtimeBus = (): RealtimeBusPort => {
  const subscribers = createScopedSubscribers();
  return {
    publish: (event) => {
      subscribers.deliver(event);
    },
    subscribe: (scope, listener) => subscribers.add(scope, listener),
  };
};

/** Persistence happens in the use-case; this channel only pushes to live SSE listeners. */
export const createInAppNotificationChannel = (bus: RealtimeBusPort): NotificationChannelPort => ({
  deliver: async (notification) => {
    bus.publish({
      kind: 'notification',
      tenantId: notification.tenantId,
      recipientUserId: notification.recipientUserId,
      notificationId: notification.id,
      notificationKind: notification.kind,
      createdAt: notification.createdAt,
    });
    return ok(undefined);
  },
});
