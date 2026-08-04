import { useEffect, useState, type MouseEvent } from 'react';
import { Alert, Badge, Box, Button, ButtonBase, Divider, IconButton, Menu, Snackbar, SvgIcon, Tooltip, Typography } from '@mui/material';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useNavigate } from '@tanstack/react-router';

import type { Notification } from '#core/domain/index.js';

import { actions } from './api.js';
import { localizeError, useLanguage, useTranslations } from './i18n/index.js';
import { formatDate } from './lib/format.js';
import { connectNotificationsStream } from './notifications-stream.js';
import {
  Eyebrow,
  FinePrint,
  NotificationBellIcon,
  NotificationMenuItem,
  NotificationSnippet,
  NotificationTitle,
  UnreadDot,
} from './theme.js';

const POLL_INTERVAL_MS = 30_000;

const BELL_PATH =
  'M12 22c1.1 0 2-.9 2-2h-4c0 1.1.9 2 2 2zm6-6v-5c0-3.07-1.63-5.64-4.5-6.32V4c0-.83-.67-1.5-1.5-1.5s-1.5.67-1.5 1.5v.68C7.64 5.36 6 7.92 6 11v5l-2 2v1h16v-1l-2-2z';

const BellIcon = () => (
  <NotificationBellIcon aria-hidden viewBox="0 0 24 24">
    <path d={BELL_PATH} />
  </NotificationBellIcon>
);

/** Tab-bar variant: default SvgIcon size so the label baseline matches the sibling tabs. */
const TabBellIcon = () => (
  <SvgIcon aria-hidden viewBox="0 0 24 24">
    <path d={BELL_PATH} />
  </SvgIcon>
);

export const NotificationBell = ({ tabLabel, live = true }: { tabLabel?: string; live?: boolean }) => {
  const t = useTranslations();
  const { language } = useLanguage();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const [anchorEl, setAnchorEl] = useState<HTMLElement | null>(null);
  const [polling, setPolling] = useState(false);
  const open = Boolean(anchorEl);

  useEffect(() => {
    if (!live) return;
    const stream = connectNotificationsStream({
      onEvent: () => void queryClient.invalidateQueries(actions.notificationsInvalidates()),
      onFallback: () => setPolling(true),
    });
    return () => stream.close();
  }, [live, queryClient]);

  const unread = useQuery({
    ...actions.unreadNotifications,
    enabled: live,
    refetchInterval: polling ? POLL_INTERVAL_MS : false,
  });
  const list = useQuery({ ...actions.notifications, enabled: live && open });

  const markRead = useMutation({
    ...actions.markNotificationRead,
    onSuccess: () => queryClient.invalidateQueries(actions.notificationsInvalidates()),
  });
  const markAllRead = useMutation({
    ...actions.markAllNotificationsRead,
    onSuccess: () => queryClient.invalidateQueries(actions.notificationsInvalidates()),
  });

  const openNotification = (notification: Notification) => {
    setAnchorEl(null);
    if (notification.readAt === null) markRead.mutate({ id: notification.id });
    if (notification.payload.contextKind === 'space') {
      void navigate({ to: '/community/$spaceId', params: { spaceId: notification.payload.contextId } });
    } else if (notification.payload.courseId !== null) {
      void navigate({
        to: '/my/courses/$courseId/lessons/$lessonId',
        params: {
          courseId: notification.payload.courseId,
          lessonId: notification.payload.contextId,
        },
      });
    }
  };

  const notificationTitle = (notification: Notification) =>
    notification.kind === 'space-post'
      ? t.notifications.spacePost({
          author: notification.payload.authorDisplay,
          space: notification.payload.lessonName,
        })
      : notification.kind === 'lesson-question'
        ? t.notifications.lessonQuestion({
            author: notification.payload.authorDisplay,
            lesson: notification.payload.lessonName,
          })
        : t.notifications.threadReply({
            author: notification.payload.authorDisplay,
            lesson: notification.payload.lessonName,
          });

  const unreadCount = unread.data?.unread ?? 0;
  const notifications = list.data?.notifications ?? [];

  const trigger = tabLabel === undefined ? (
    <Tooltip title={t.notifications.bell}>
        <IconButton
          color="inherit"
          size="small"
          data-testid="notification-bell"
          aria-label={t.notifications.bell}
          aria-haspopup="true"
          aria-expanded={open ? true : undefined}
          onClick={(event: MouseEvent<HTMLElement>) => setAnchorEl(event.currentTarget)}
          sx={{ minHeight: '44px', minWidth: '44px' }}
        >
          <Badge badgeContent={unreadCount} color="error" data-testid="notification-badge">
            <BellIcon />
          </Badge>
        </IconButton>
    </Tooltip>
  ) : (
    <ButtonBase
      data-testid="notification-tab"
      aria-label={t.notifications.bell}
      aria-haspopup="true"
      aria-expanded={open ? true : undefined}
      onClick={(event: MouseEvent<HTMLElement>) => setAnchorEl(event.currentTarget)}
      sx={{ minHeight: '44px', minWidth: '44px', py: '0.55rem', display: 'flex', flexDirection: 'column', gap: '0.15rem' }}
    >
      <Badge badgeContent={unreadCount} color="error" data-testid="notification-tab-badge">
        <TabBellIcon />
      </Badge>
      <Typography variant="caption" component="span" noWrap>{tabLabel}</Typography>
    </ButtonBase>
  );

  return (
    <>
      {trigger}
      <Menu
        anchorEl={anchorEl}
        open={open}
        onClose={() => setAnchorEl(null)}
        anchorOrigin={{ vertical: 'bottom', horizontal: 'right' }}
        transformOrigin={{ vertical: 'top', horizontal: 'right' }}
      >
        <Box sx={{ px: '1rem', py: '0.5rem', width: 'min(22rem, 82vw)' }}>
          <Eyebrow variant="overline" component="p">
            {t.notifications.heading}
          </Eyebrow>
        </Box>
        <Divider />
        {list.isPending ? (
          <Box sx={{ px: '1rem', py: '0.75rem' }}>
            <NotificationSnippet variant="body2" component="p">
              {t.notifications.loading}
            </NotificationSnippet>
          </Box>
        ) : list.isError ? (
          <Box sx={{ px: '1rem', py: '0.75rem' }}>
            <Alert severity="error">{localizeError(list.error, t)}</Alert>
            <Button size="small" sx={{ mt: '0.5rem' }} onClick={() => void list.refetch()}>
              {t.common.retry}
            </Button>
          </Box>
        ) : notifications.length === 0 ? (
          <Box sx={{ px: '1rem', py: '0.75rem' }} data-testid="notifications-empty">
            <NotificationSnippet variant="body2" component="p">
              {t.notifications.empty}
            </NotificationSnippet>
          </Box>
        ) : (
          notifications.map((notification) => (
            <NotificationMenuItem
              key={notification.id}
              data-testid={`notification-${notification.id}`}
              onClick={() => openNotification(notification)}
              sx={{ gap: '0.6rem', maxWidth: '22rem' }}
            >
              {notification.readAt === null ? <UnreadDot aria-hidden /> : null}
              <Box sx={{ minWidth: 0 }}>
                <NotificationTitle component="p" unread={notification.readAt === null}>
                  {notificationTitle(notification)}
                </NotificationTitle>
                <NotificationSnippet variant="body2" component="p">
                  {notification.payload.snippet}
                </NotificationSnippet>
                <FinePrint component="p">{formatDate(notification.createdAt, language)}</FinePrint>
              </Box>
            </NotificationMenuItem>
          ))
        )}
        <Divider />
        <Box sx={{ px: '1rem', py: '0.5rem' }}>
          <Button
            size="small"
            data-testid="notifications-mark-all-read"
            disabled={markAllRead.isPending || unreadCount === 0}
            onClick={() => markAllRead.mutate()}
          >
            {t.notifications.markAllRead}
          </Button>
          {unread.isError ? (
            <Box>
              <Alert severity="error">{localizeError(unread.error, t)}</Alert>
              <Button size="small" sx={{ mt: '0.5rem' }} onClick={() => void unread.refetch()}>
                {t.common.retry}
              </Button>
            </Box>
          ) : null}
          {markAllRead.isError ? <Alert severity="error">{localizeError(markAllRead.error, t)}</Alert> : null}
        </Box>
      </Menu>
      <Snackbar open={markRead.isError} autoHideDuration={6000} onClose={() => markRead.reset()}>
        <Alert severity="error" onClose={() => markRead.reset()}>{markRead.isError ? localizeError(markRead.error, t) : ''}</Alert>
      </Snackbar>
      <Snackbar open={markAllRead.isSuccess} autoHideDuration={4000} onClose={() => markAllRead.reset()}>
        <Alert severity="success" onClose={() => markAllRead.reset()}>{t.notifications.markedAllRead}</Alert>
      </Snackbar>
    </>
  );
};
