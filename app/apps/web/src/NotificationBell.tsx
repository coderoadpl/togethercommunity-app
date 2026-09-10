import { BellIcon as MemberBellIcon } from './components/ui/account-icons.js';
import { useId, useState, type MouseEvent } from 'react';
import {
  Alert,
  Box,
  Button,
  IconButton,
  Skeleton,
  Snackbar,
  Stack,
  SvgIcon,
  Tooltip,
  useMediaQuery,
} from '@mui/material';
import { useTheme } from '@mui/material/styles';
import { useQuery } from '@tanstack/react-query';
import { Link } from '@tanstack/react-router';

import type { Notification } from '#core/domain/index.js';

import { actions } from './api.js';
import { localizeError, useTranslations } from './i18n/index.js';
import { NotificationList } from './NotificationList.js';
import { notificationTarget, useNotificationNavigation } from './notification-links.js';
import { useNotifications } from './notifications-data.js';
import {
  EmptyStateContent,
  EmptyStateIcon,
  Eyebrow,
  NotificationBellIcon,
  NotificationCountBadge,
  NotificationPanel,
  NotificationPanelAction,
  NotificationPanelBody,
  NotificationPanelFooter,
  NotificationPanelHeader,
  NotificationPopover,
  NotificationSnippet,
  SHELL_SNACKBAR_ANCHOR,
  SheetDrawer,
} from './theme.js';

const BELL_PATH =
  'M12 22c1.1 0 2-.9 2-2h-4c0 1.1.9 2 2 2zm6-6v-5c0-3.07-1.63-5.64-4.5-6.32V4c0-.83-.67-1.5-1.5-1.5s-1.5.67-1.5 1.5v.68C7.64 5.36 6 7.92 6 11v5l-2 2v1h16v-1l-2-2z';

const BellIcon = () => (
  <NotificationBellIcon aria-hidden viewBox="0 0 24 24">
    <path d={BELL_PATH} />
  </NotificationBellIcon>
);

const CloseIcon = () => (
  <SvgIcon aria-hidden viewBox="0 0 24 24">
    <path d="M18.3 5.71 12 12l6.3 6.29-1.41 1.42L10.59 13.4l-6.3 6.31-1.42-1.42L9.17 12l-6.3-6.29 1.42-1.42 6.3 6.31 6.3-6.31z" />
  </SvgIcon>
);

const SKELETON_ROWS = [0, 1, 2];

export const NotificationBell = ({
  live = true,
  viewAllTo = '/notifications',
}: { live?: boolean; viewAllTo?: '/notifications' | '/panel/notifications' } = {}) => {
  const t = useTranslations();
  const theme = useTheme();
  const compact = !useMediaQuery(theme.breakpoints.up('md'));
  const navigateToTarget = useNotificationNavigation();
  const headingId = useId();
  const [anchorEl, setAnchorEl] = useState<HTMLElement | null>(null);
  const open = anchorEl !== null;
  const { impersonating, unread, unreadCount, markRead, markAllRead } = useNotifications({
    live,
    stream: live,
  });
  const list = useQuery({ ...actions.notifications, enabled: live && open });

  const close = () => setAnchorEl(null);

  const openNotification = (notification: Notification) => {
    close();
    if (notification.readAt === null && !impersonating) markRead.mutate({ id: notification.id });
    navigateToTarget(notificationTarget(notification));
  };

  const notifications = list.data?.notifications ?? [];

  const panel = (
    <NotificationPanel role="dialog" aria-labelledby={headingId} data-testid="notifications-panel">
      <NotificationPanelHeader>
        <Eyebrow variant="overline" component="p" id={headingId}>
          {t.notifications.heading}
        </Eyebrow>
        <Box sx={{ flex: 1 }} />
        <NotificationPanelAction
          size="small"
          data-testid="notifications-popover-mark-all-read"
          aria-label={t.notifications.markAllRead}
          disabled={markAllRead.isPending || impersonating || unreadCount === 0}
          onClick={() => markAllRead.mutate()}
        >
          {t.notifications.markAllReadShort}
        </NotificationPanelAction>
        {compact ? (
          <IconButton
            aria-label={t.shell.closeSheet}
            data-testid="notifications-panel-close"
            sx={{ minHeight: 44, minWidth: 44 }}
            onClick={close}
          >
            <CloseIcon />
          </IconButton>
        ) : null}
      </NotificationPanelHeader>
      <NotificationPanelBody>
        {list.isPending ? (
          <Stack useFlexGap sx={{ rowGap: '0.5rem', p: '0.75rem' }} data-testid="notifications-loading">
            {SKELETON_ROWS.map((row) => (
              <Skeleton key={row} variant="rectangular" height={40} />
            ))}
          </Stack>
        ) : list.isError ? (
          <Box sx={{ p: '0.75rem' }}>
            <Alert severity="error">{localizeError(list.error, t)}</Alert>
            <Button size="small" sx={{ mt: '0.5rem' }} onClick={() => void list.refetch()}>
              {t.common.retry}
            </Button>
          </Box>
        ) : notifications.length === 0 ? (
          <EmptyStateContent sx={{ p: '1.25rem' }} data-testid="notifications-empty">
            <EmptyStateIcon aria-hidden viewBox="0 0 24 24">
              <path d={BELL_PATH} />
            </EmptyStateIcon>
            <NotificationSnippet variant="body2" component="p">
              {t.notifications.empty}
            </NotificationSnippet>
            <NotificationSnippet variant="body2" component="p">
              {t.notifications.emptyHint}
            </NotificationSnippet>
          </EmptyStateContent>
        ) : (
          <NotificationList autoFocusFirst notifications={notifications} onOpen={openNotification} />
        )}
        {unread.isError ? (
          <Box sx={{ p: '0.75rem' }}>
            <Alert severity="error">{localizeError(unread.error, t)}</Alert>
          </Box>
        ) : null}
        {markAllRead.isError ? (
          <Box sx={{ p: '0.75rem' }}>
            <Alert severity="error">{localizeError(markAllRead.error, t)}</Alert>
          </Box>
        ) : null}
      </NotificationPanelBody>
      <NotificationPanelFooter>
        <Button
          component={Link}
          to={viewAllTo}
          data-testid="notifications-view-all"
          sx={{ flex: 1, justifyContent: 'center', p: '0.75rem' }}
          onClick={close}
        >
          {t.notifications.viewAll}
        </Button>
      </NotificationPanelFooter>
    </NotificationPanel>
  );

  return (
    <>
      <Tooltip title={t.notifications.bell}>
        <IconButton
          color="inherit"
          data-testid="notification-bell"
          aria-label={
            unreadCount > 0 ? t.notifications.unreadAria({ count: unreadCount }) : t.notifications.bell
          }
          aria-haspopup="dialog"
          aria-expanded={open ? true : undefined}
          onClick={(event: MouseEvent<HTMLElement>) => setAnchorEl(event.currentTarget)}
          sx={{ minHeight: '48px', minWidth: '48px' }}
        >
          <NotificationCountBadge badgeContent={unreadCount} max={99} data-testid="notification-badge">
            {viewAllTo === '/notifications' ? <MemberBellIcon /> : <BellIcon />}
          </NotificationCountBadge>
        </IconButton>
      </Tooltip>
      {compact ? (
        <SheetDrawer anchor="bottom" open={open} onClose={close}>
          {panel}
        </SheetDrawer>
      ) : (
        <NotificationPopover
          anchorEl={anchorEl}
          open={open}
          onClose={close}
          anchorOrigin={{ vertical: 'bottom', horizontal: 'right' }}
          transformOrigin={{ vertical: 'top', horizontal: 'right' }}
        >
          {panel}
        </NotificationPopover>
      )}
      <Snackbar
        open={markRead.isError}
        autoHideDuration={6000}
        anchorOrigin={SHELL_SNACKBAR_ANCHOR}
        onClose={() => markRead.reset()}
      >
        <Alert severity="error" onClose={() => markRead.reset()}>
          {markRead.isError ? localizeError(markRead.error, t) : ''}
        </Alert>
      </Snackbar>
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
    </>
  );
};
