import { useEffect, useState } from 'react';
import { Alert, Box, Button, ButtonBase, Snackbar, Stack, Typography } from '@mui/material';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useNavigate } from '@tanstack/react-router';

import { ApiError } from '#core/client/index.js';
import type { Notification } from '#core/domain/index.js';

import { actions } from '../../api.js';
import { ListSection } from '../../components/layout/index.js';
import { localizeError, useLanguage, useTranslations } from '../../i18n/index.js';
import { formatDate } from '../../lib/format.js';
import {
  notificationTarget,
  notificationTitle,
  useNotificationNavigation,
} from '../../notification-links.js';
import {
  DiscussionThread,
  FinePrint,
  NotificationSnippet,
  NotificationTitle,
  SHELL_SNACKBAR_ANCHOR,
  UnreadDot,
  VisuallyHidden,
} from '../../theme.js';
import { MemberAvatar } from '../../components/ui/MemberAvatar.js';
import { MemberSurface } from './MemberSurface.js';

const PAGE_SIZE = 20;
const MAX_LIMIT = 100;

const isUnauthorized = (error: Error | null) =>
  error instanceof ApiError && error.appError.code === 'unauthorized';

const NotificationBody = ({ notification }: { notification: Notification }) => {
  const t = useTranslations();
  const { language } = useLanguage();
  const unread = notification.readAt === null;
  return (
    <Stack direction="row" useFlexGap sx={{ columnGap: '0.6rem', alignItems: 'flex-start' }}>
      {unread ? (
        <>
          <UnreadDot aria-hidden />
          <VisuallyHidden>{t.notifications.unreadLabel}</VisuallyHidden>
        </>
      ) : null}
      <MemberAvatar
        name={notification.payload.authorDisplay}
        avatarUrl={notification.payload.authorAvatarUrl}
        size="sm"
      />
      <Box sx={{ minWidth: 0 }}>
        <NotificationTitle component="p" unread={unread}>
          {notificationTitle(t, notification)}
        </NotificationTitle>
        <NotificationSnippet variant="body2" component="p">
          {notification.payload.snippet}
        </NotificationSnippet>
        <FinePrint component="p">{formatDate(notification.createdAt, language)}</FinePrint>
      </Box>
    </Stack>
  );
};

const NotificationRow = ({
  notification,
  onOpen,
}: {
  notification: Notification;
  onOpen: () => void;
}) => (
  <DiscussionThread sx={{ p: '0.9rem 1.1rem' }} data-testid={`notification-row-${notification.id}`}>
    {notificationTarget(notification).kind === 'none' ? (
      <NotificationBody notification={notification} />
    ) : (
      <ButtonBase
        data-testid={`notification-open-${notification.id}`}
        onClick={onOpen}
        sx={{ display: 'block', width: '100%', justifyContent: 'flex-start' }}
      >
        <NotificationBody notification={notification} />
      </ButtonBase>
    )}
  </DiscussionThread>
);

export const NotificationsPage = () => {
  const t = useTranslations();
  const navigate = useNavigate();
  const navigateToTarget = useNotificationNavigation();
  const queryClient = useQueryClient();
  const [limit, setLimit] = useState(PAGE_SIZE);

  const list = useQuery({
    ...actions.notificationsPage(limit),
    placeholderData: (previous) => previous,
  });
  const unread = useQuery(actions.unreadNotifications);

  const invalidate = () => queryClient.invalidateQueries(actions.notificationsInvalidates());
  const markRead = useMutation({ ...actions.markNotificationRead, onSuccess: invalidate });
  const markAllRead = useMutation({ ...actions.markAllNotificationsRead, onSuccess: invalidate });

  const unauthorized = isUnauthorized(list.error) || isUnauthorized(unread.error);
  useEffect(() => {
    if (unauthorized) void navigate({ to: '/login' });
  }, [navigate, unauthorized]);

  const openNotification = (notification: Notification) => {
    if (notification.readAt === null) markRead.mutate({ id: notification.id });
    navigateToTarget(notificationTarget(notification));
  };

  if (list.isPending) {
    return (
      <MemberSurface
        title={t.notifications.heading}
        eyebrow={t.notifications.pageEyebrow}
        state={{ kind: 'loading', label: t.notifications.loading }}
      />
    );
  }

  if (unauthorized) return null;

  if (list.isError) {
    return (
      <MemberSurface
        title={t.notifications.heading}
        eyebrow={t.notifications.pageEyebrow}
        state={{
          kind: 'error',
          message: localizeError(list.error, t),
          retry: { label: t.common.retry, onRetry: () => void list.refetch() },
        }}
      />
    );
  }

  const unreadCount = unread.data?.unread ?? 0;
  const pagination =
    list.data.nextCursor === null ? null : limit >= MAX_LIMIT ? (
      <FinePrint component="p" data-testid="notifications-truncated">
        {t.notifications.olderTruncated}
      </FinePrint>
    ) : (
      <Button
        variant="outlined"
        data-testid="notifications-load-more"
        disabled={list.isFetching}
        onClick={() => setLimit((previous) => Math.min(previous + PAGE_SIZE, MAX_LIMIT))}
      >
        {t.notifications.loadMore}
      </Button>
    );

  return (
    <MemberSurface title={t.notifications.heading} eyebrow={t.notifications.pageEyebrow}>
      <ListSection
        data-testid="notifications-list"
        isEmpty={list.data.notifications.length === 0}
        empty={
          <Typography variant="body2" data-testid="notifications-page-empty">
            {t.notifications.empty}
          </Typography>
        }
        toolbar={{
          actions: (
            <Button
              variant="outlined"
              data-testid="notifications-mark-all-read"
              disabled={markAllRead.isPending || unreadCount === 0}
              onClick={() => markAllRead.mutate()}
            >
              {t.notifications.markAllRead}
            </Button>
          ),
        }}
        {...(pagination === null ? {} : { pagination })}
      >
        <Stack useFlexGap sx={{ rowGap: '0.75rem' }}>
          {list.data.notifications.map((notification) => (
            <NotificationRow
              key={notification.id}
              notification={notification}
              onOpen={() => openNotification(notification)}
            />
          ))}
        </Stack>
      </ListSection>
      {markRead.isError ? <Alert severity="error">{localizeError(markRead.error, t)}</Alert> : null}
      {markAllRead.isError ? (
        <Alert severity="error">{localizeError(markAllRead.error, t)}</Alert>
      ) : null}
      <Snackbar
        open={markAllRead.isSuccess}
        autoHideDuration={4000}
        anchorOrigin={SHELL_SNACKBAR_ANCHOR}
        onClose={() => markAllRead.reset()}
      >
        <Alert severity="success" onClose={() => markAllRead.reset()}>
          {t.notifications.markedAllRead}
        </Alert>
      </Snackbar>
    </MemberSurface>
  );
};
