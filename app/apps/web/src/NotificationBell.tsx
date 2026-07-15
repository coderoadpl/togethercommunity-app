import { useEffect, useState, type MouseEvent } from 'react';
import { Badge, Box, Button, Divider, IconButton, Menu, Tooltip } from '@mui/material';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useNavigate } from '@tanstack/react-router';

import type { Notification } from '@core/domain/index.js';

import { actions } from './api.js';
import { useLanguage, useTranslations } from './i18n/index.js';
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

const BellIcon = () => (
  <NotificationBellIcon aria-hidden viewBox="0 0 24 24">
    <path d="M12 22c1.1 0 2-.9 2-2h-4c0 1.1.9 2 2 2zm6-6v-5c0-3.07-1.63-5.64-4.5-6.32V4c0-.83-.67-1.5-1.5-1.5s-1.5.67-1.5 1.5v.68C7.64 5.36 6 7.92 6 11v5l-2 2v1h16v-1l-2-2z" />
  </NotificationBellIcon>
);

export const NotificationBell = () => {
  const t = useTranslations();
  const { language } = useLanguage();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const [anchorEl, setAnchorEl] = useState<HTMLElement | null>(null);
  const [polling, setPolling] = useState(false);
  const open = Boolean(anchorEl);

  useEffect(() => {
    const stream = connectNotificationsStream({
      onEvent: () => void queryClient.invalidateQueries(actions.notificationsInvalidates()),
      onFallback: () => setPolling(true),
    });
    return () => stream.close();
  }, [queryClient]);

  const unread = useQuery({
    ...actions.unreadNotifications,
    refetchInterval: polling ? POLL_INTERVAL_MS : false,
  });
  const list = useQuery({ ...actions.notifications, enabled: open });

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
    if (notification.payload.courseId !== null) {
      void navigate({
        to: '/my/courses/$courseId/lessons/$lessonId',
        params: {
          courseId: notification.payload.courseId,
          lessonId: notification.payload.contextId,
        },
      });
    }
  };

  const unreadCount = unread.data?.unread ?? 0;
  const notifications = list.data?.notifications ?? [];

  return (
    <>
      <Tooltip title={t.notifications.bell}>
        <IconButton
          color="inherit"
          size="small"
          data-testid="notification-bell"
          aria-label={t.notifications.bell}
          aria-haspopup="true"
          aria-expanded={open ? true : undefined}
          onClick={(event: MouseEvent<HTMLElement>) => setAnchorEl(event.currentTarget)}
        >
          <Badge badgeContent={unreadCount} color="error" data-testid="notification-badge">
            <BellIcon />
          </Badge>
        </IconButton>
      </Tooltip>
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
                  {t.notifications.threadReply({
                    author: notification.payload.authorDisplay,
                    lesson: notification.payload.lessonName,
                  })}
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
            disabled={markAllRead.isPending}
            onClick={() => markAllRead.mutate()}
          >
            {t.notifications.markAllRead}
          </Button>
        </Box>
      </Menu>
    </>
  );
};
