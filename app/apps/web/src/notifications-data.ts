import { useEffect, useRef } from 'react';
import { useMutation, useQuery, useQueryClient, type QueryClient } from '@tanstack/react-query';

import { notificationKindSchema } from '#core/domain/index.js';

import { actions } from './api.js';
import { connectNotificationsStream, streamlessPollInterval } from './notifications-stream.js';
import { useNotificationsTransport } from './notifications-transport.js';

export const refreshForNotificationKind = (queryClient: QueryClient, kind: string): Promise<void> =>
  kind === notificationKindSchema.enum['change-proposal']
    ? queryClient.invalidateQueries(actions.changeProposalsInvalidates())
    : Promise.resolve();

const SUMMARY_KEY = JSON.stringify(actions.changeProposalSummary.queryKey);

/** Without the stream nothing announces a new proposal, so the polled count is the signal to reload the lists. */
export const useChangeProposalSummary = (enabled: boolean) => {
  const queryClient = useQueryClient();
  const { streamless } = useNotificationsTransport();
  const pollInterval = streamlessPollInterval(streamless);
  const summary = useQuery({ ...actions.changeProposalSummary, enabled, refetchInterval: pollInterval });
  const counted = summary.data === undefined ? null : `${String(summary.data.pending)}/${String(summary.data.pendingGroups)}`;
  const lastCounted = useRef<string | null>(null);
  const polled = pollInterval !== false;

  useEffect(() => {
    if (counted === null) return;
    const previous = lastCounted.current;
    lastCounted.current = counted;
    if (!polled || previous === null || previous === counted) return;
    void queryClient.invalidateQueries({
      ...actions.changeProposalsInvalidates(),
      predicate: (query) => JSON.stringify(query.queryKey) !== SUMMARY_KEY,
    });
  }, [counted, polled, queryClient]);

  return summary;
};

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
      onNotificationKind: (kind) => void refreshForNotificationKind(queryClient, kind),
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
