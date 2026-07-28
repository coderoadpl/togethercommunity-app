import { ok } from '#core/domain/index.js';
import type {
  NotificationChannelPort,
  RealtimeBusPort,
  RealtimeNotificationEvent,
} from '#core/server/index.js';

export const createRealtimeBus = (): RealtimeBusPort => {
  const listeners = new Set<(event: RealtimeNotificationEvent) => void>();
  return {
    publish: (event) => {
      for (const listener of listeners) listener(event);
    },
    subscribe: (listener) => {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
  };
};

/** Persistence happens in the use-case; this channel only pushes to live SSE listeners. */
export const createInAppNotificationChannel = (bus: RealtimeBusPort): NotificationChannelPort => ({
  deliver: async (notification) => {
    bus.publish({
      tenantId: notification.tenantId,
      recipientUserId: notification.recipientUserId,
      notification,
    });
    return ok(undefined);
  },
});
