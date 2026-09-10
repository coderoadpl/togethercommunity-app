import { useEffect, type ReactNode } from 'react';
import { Alert, Button, Snackbar, ToggleButton, ToggleButtonGroup, Typography } from '@mui/material';
import { useInfiniteQuery } from '@tanstack/react-query';
import { useNavigate } from '@tanstack/react-router';

import { ApiError } from '#core/client/index.js';
import type { Notification } from '#core/domain/index.js';

import { actions } from '../../api.js';
import { ListSection, PanelPage, type PageState } from '../../components/layout/index.js';
import { localizeError, useTranslations } from '../../i18n/index.js';
import { useRedirectToLogin } from './use-login-redirect.js';
import { NotificationList } from '../../NotificationList.js';
import { notificationTarget, useNotificationNavigation } from '../../notification-links.js';
import { useNotifications } from '../../notifications-data.js';
import { SHELL_SNACKBAR_ANCHOR } from '../../theme.js';
import { MemberSurface } from './MemberSurface.js';

export type NotificationsFilter = 'all' | 'unread';

export type NotificationsBasePath = '/notifications' | '/panel/notifications';

const isUnauthorized = (error: Error | null) =>
  error instanceof ApiError && error.appError.code === 'unauthorized';

export const NotificationsPage = ({
  filter = 'all',
  basePath = '/notifications',
}: { filter?: NotificationsFilter; basePath?: NotificationsBasePath } = {}) => {
  const t = useTranslations();
  const navigate = useNavigate();
  const redirectToLogin = useRedirectToLogin();
  const navigateToTarget = useNotificationNavigation();
  const { impersonating, unread, unreadCount, markRead, markAllRead } = useNotifications();

  const list = useInfiniteQuery({
    ...actions.notificationsPage(filter === 'unread' ? { unread: true } : {}),
  });

  const unauthorized = isUnauthorized(list.error) || isUnauthorized(unread.error);
  useEffect(() => {
    if (unauthorized) void redirectToLogin();
  }, [redirectToLogin, unauthorized]);

  const openNotification = (notification: Notification) => {
    if (notification.readAt === null && !impersonating) markRead.mutate({ id: notification.id });
    navigateToTarget(notificationTarget(notification));
  };

  const surface = (props: { state?: PageState; children?: ReactNode }) =>
    basePath === '/panel/notifications' ? (
      <PanelPage title={t.notifications.heading} {...props} />
    ) : (
      <MemberSurface
        title={t.notifications.heading}
        {...props}
      />
    );

  if (list.isPending) {
    return surface({ state: { kind: 'loading', label: t.notifications.loading } });
  }

  if (unauthorized) return null;

  if (list.isError) {
    return surface({
      state: {
        kind: 'error',
        message: localizeError(list.error, t),
        retry: { label: t.common.retry, onRetry: () => void list.refetch() },
      },
    });
  }

  const notifications = list.data.pages.flatMap((page) => page.notifications);

  return surface({
    children: (
      <>
        <ListSection
          data-testid="notifications-list"
          isEmpty={filter === 'all' && notifications.length === 0}
          empty={
            <Typography variant="body2" data-testid="notifications-page-empty">
              {t.notifications.empty}
            </Typography>
          }
          {...(filter === 'unread' && notifications.length === 0
            ? {
              noMatches: (
                <Typography variant="body2" data-testid="notifications-page-all-read">
                  {t.notifications.allRead}
                </Typography>
              ),
            }
            : {})}
          toolbar={{
            filters: (
              <ToggleButtonGroup
                exclusive
                size="small"
                value={filter}
                data-testid="notifications-filter"
                sx={{ '& .MuiToggleButton-root': { minHeight: '48px' } }}
                onChange={(_event, next: NotificationsFilter | null) => {
                  if (next === null) return;
                  void navigate({
                    to: basePath,
                    search: next === 'unread' ? { filter: 'unread' } : {},
                  });
                }}
              >
                <ToggleButton value="all" data-testid="notifications-filter-all">
                  {t.notifications.filterAll}
                </ToggleButton>
                <ToggleButton value="unread" data-testid="notifications-filter-unread">
                  {t.notifications.filterUnread}
                </ToggleButton>
              </ToggleButtonGroup>
            ),
            actions: (
              <Button
                variant="outlined"
                data-testid="notifications-mark-all-read"
                disabled={markAllRead.isPending || impersonating || unreadCount === 0}
                onClick={() => markAllRead.mutate()}
              >
                {t.notifications.markAllRead}
              </Button>
            ),
          }}
          {...(list.hasNextPage
            ? {
              pagination: (
                <Button
                  variant="outlined"
                  data-testid="notifications-load-more"
                  disabled={list.isFetchingNextPage}
                  onClick={() => void list.fetchNextPage()}
                >
                  {t.notifications.loadMore}
                </Button>
              ),
            }
            : {})}
        >
          <NotificationList notifications={notifications} onOpen={openNotification} />
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
      </>
    ),
  });
};
