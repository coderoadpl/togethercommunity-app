import type { RealtimeEvent, RealtimeScope } from './ports.js';

const realtimeEventMatchesScope = (event: RealtimeEvent, scope: RealtimeScope): boolean =>
  event.tenantId === scope.tenantId && event.recipientUserId === scope.recipientUserId;

export const realtimeEventKey = (event: RealtimeEvent): string =>
  event.kind === 'notification' ? event.notificationId : event.conversationId;

export interface ScopedSubscribers {
  add: (scope: RealtimeScope, listener: (event: RealtimeEvent) => void) => () => void;
  deliver: (event: RealtimeEvent) => void;
  size: () => number;
}

export const createScopedSubscribers = (): ScopedSubscribers => {
  const subscriptions = new Set<{
    scope: RealtimeScope;
    listener: (event: RealtimeEvent) => void;
  }>();
  return {
    add: (scope, listener) => {
      const subscription = { scope, listener };
      subscriptions.add(subscription);
      return () => {
        subscriptions.delete(subscription);
      };
    },
    deliver: (event) => {
      for (const subscription of [...subscriptions]) {
        if (realtimeEventMatchesScope(event, subscription.scope)) subscription.listener(event);
      }
    },
    size: () => subscriptions.size,
  };
};
