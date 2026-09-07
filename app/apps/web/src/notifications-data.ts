import { useEffect } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';

import { actions } from './api.js';
import { connectNotificationsStream, streamlessPollInterval } from './notifications-stream.js';
import { useNotificationsTransport } from './notifications-transport.js';

/**
 * The bell owns the stream (`stream: true`); every other surface reads the same
 * cache, so a mounted page never opens a second event source.
 */
export const useNotifications = ({
  live = true,
  stream = false,
}: { live?: boolean; stream?: boolean } = {}) => {
  const queryClient = useQueryClient();
  const me = useQuery(actions.me);
  const { streamless, reportStreamless, reportStreaming } = useNotificationsTransport();

  useEffect(() => {
    if (!stream) return;
    const source = connectNotificationsStream({
      onEvent: () => {
        void queryClient.invalidateQueries(actions.notificationsInvalidates());
        void queryClient.invalidateQueries(actions.messagesInvalidates());
      },
      onFallback: reportStreamless,
      onStreaming: reportStreaming,
    });
    return () => source.close();
  }, [queryClient, reportStreamless, reportStreaming, stream]);

  const unread = useQuery({
    ...actions.unreadNotifications,
    enabled: live,
    refetchInterval: streamlessPollInterval(streamless),
  });

  const invalidate = () => queryClient.invalidateQueries(actions.notificationsInvalidates());
  const markRead = useMutation({ ...actions.markNotificationRead, onSuccess: invalidate });
  const markAllRead = useMutation({ ...actions.markAllNotificationsRead, onSuccess: invalidate });

  return {
    impersonating: (me.data?.impersonation ?? null) !== null,
    unread,
    unreadCount: unread.data?.unread ?? 0,
    markRead,
    markAllRead,
  };
};
