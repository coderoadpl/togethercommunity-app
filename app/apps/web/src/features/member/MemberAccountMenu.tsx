import { useState } from 'react';
import { Alert, Box, Divider, IconButton, ListItemIcon, ListItemText, Menu, MenuItem, Snackbar, Tooltip, Typography } from '@mui/material';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Link, useNavigate } from '@tanstack/react-router';

import { actions } from '../../api.js';
import { StatusView } from '../../components/layout/index.js';
import { localizeError, useTranslations } from '../../i18n/index.js';
import { forgetLoginIdentifier } from '../../lib/login-identifier.js';
import { navigateFresh } from '../../lib/navigation.js';
import {
  streamlessPollInterval,
  UNREAD_BADGE_POLL_INTERVAL_MS,
} from '../../notifications-stream.js';
import { useNotificationsTransport } from '../../notifications-transport.js';
import { BreakAllText, CountBadge, Eyebrow, InkDotBadge, VisuallyHidden } from '../../theme.js';
import { SignOutIcon, StudioIcon } from './account-icons.js';
import { useCanOpenStudio } from './viewer.js';
import { ManageAccountIcon } from '../../components/ui/ManageAccountIcon.js';
import { UserAvatar } from '../../components/ui/UserAvatar.js';
import { memberMessagesPath } from './shell/member-nav.js';
import { MessagesIcon, ProductsIcon } from './shell/shell-icons.js';

export const MemberAccountMenu = ({ panelUrl = '/panel/members' }: { panelUrl?: string } = {}) => {
  const t = useTranslations();
  const me = useQuery(actions.me);
  const navigation = useQuery(actions.memberNavigation);
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const [anchorEl, setAnchorEl] = useState<HTMLElement | null>(null);
  const open = Boolean(anchorEl);
  const canOpenStudio = useCanOpenStudio();

  const signOut = useMutation({
    ...actions.signOut,
    onSuccess: async () => {
      forgetLoginIdentifier();
      queryClient.clear();
      await navigate({ to: '/login' });
    },
  });

  // The session under view-as-member is still the operator's, so signing out here
  // would end their panel session; the control leaves the view instead.
  const impersonating = (me.data?.impersonation ?? null) !== null;
  const stopImpersonation = useMutation({
    ...actions.stopImpersonation,
    onSuccess: () => navigateFresh(panelUrl),
  });

  const email = me.data?.email ?? null;
  const displayName = me.data?.tenant?.displayName ?? me.data?.name ?? '';
  const messagesEnabled =
    !impersonating
    && navigation.isSuccess
    && navigation.data.navigation.directMessagesEnabled;
  const { streamless } = useNotificationsTransport();
  const unreadMessages = useQuery({
    ...actions.unreadMessages,
    enabled: messagesEnabled,
    refetchInterval: streamlessPollInterval(streamless, UNREAD_BADGE_POLL_INTERVAL_MS),
  });
  const unreadMessageCount = unreadMessages.data?.unread ?? 0;
  const leaving = signOut.isPending || stopImpersonation.isPending;
  const failure = signOut.error ?? stopImpersonation.error;
  const dismissFailure = () => {
    signOut.reset();
    stopImpersonation.reset();
  };
  const close = () => setAnchorEl(null);

  return (
    <>
      <Tooltip title={t.panel.accountMenu}>
        <IconButton
          data-testid="member-account-menu"
          aria-label={
            unreadMessageCount > 0
              ? t.panel.accountMenuUnread({ count: unreadMessageCount })
              : t.panel.accountMenu
          }
          aria-haspopup="true"
          aria-expanded={open ? true : undefined}
          onClick={(event) => setAnchorEl(event.currentTarget)}
          sx={{ minHeight: '48px', minWidth: '48px' }}
        >
          <InkDotBadge
            variant="dot"
            invisible={unreadMessageCount === 0}
            data-testid="member-account-unread"
          >
            <UserAvatar
              name={displayName}
              email={email}
              imageUrl={me.data?.avatarUrl ?? null}
            />
          </InkDotBadge>
        </IconButton>
      </Tooltip>
      <Menu
        anchorEl={anchorEl}
        open={open}
        onClose={close}
        anchorOrigin={{ vertical: 'bottom', horizontal: 'right' }}
        transformOrigin={{ vertical: 'top', horizontal: 'right' }}
      >
        {me.isError ? <Box sx={{ p: '0.75rem' }}><StatusView surface={false} state={{ kind: 'error', message: localizeError(me.error, t), retry: { label: t.common.retry, onRetry: () => void me.refetch() } }} /></Box> : null}
        {email !== null ? (
          <Box sx={{ display: 'flex', alignItems: 'center', gap: '0.75rem', px: '1rem', py: '0.5rem', maxWidth: '18rem' }}>
            <UserAvatar
              name={displayName}
              email={email}
              imageUrl={me.data?.avatarUrl ?? null}
              size="lg"
            />
            <Box sx={{ minWidth: 0 }}>
              <Eyebrow variant="overline" component="p">
                {t.panel.signedInAs}
              </Eyebrow>
              {displayName === '' ? null : (
                <Typography variant="body2" component="p" noWrap data-testid="member-account-name">
                  {displayName}
                </Typography>
              )}
              <BreakAllText
                variant="caption"
                component="p"
                color="text.secondary"
                data-testid="member-account-email"
              >
                {email}
              </BreakAllText>
            </Box>
          </Box>
        ) : null}
        {email !== null ? <Divider /> : null}
        {canOpenStudio ? (
          <MenuItem
            component={Link}
            to="/panel"
            data-testid="member-account-studio-link"
            sx={{ minHeight: '44px' }}
            onClick={() => setAnchorEl(null)}
          >
            <ListItemIcon>
              <StudioIcon />
            </ListItemIcon>
            <ListItemText primary={t.account.menuStudio} />
          </MenuItem>
        ) : null}
        <MenuItem
          component={Link}
          to="/my/products"
          data-testid="member-account-products"
          onClick={close}
        >
          <ListItemIcon>
            <ProductsIcon />
          </ListItemIcon>
          <ListItemText primary={t.student.myProducts} />
        </MenuItem>
        {messagesEnabled ? (
          <MenuItem
            component={Link}
            to={memberMessagesPath()}
            data-testid="member-account-messages"
            onClick={close}
          >
            <ListItemIcon>
              <MessagesIcon />
            </ListItemIcon>
            <ListItemText primary={t.messages.navLabel} />
            {unreadMessageCount > 0 ? (
              <>
                <CountBadge aria-hidden data-testid="member-account-messages-unread">
                  {unreadMessageCount}
                </CountBadge>
                <VisuallyHidden>
                  {t.messages.unreadAria({ count: unreadMessageCount })}
                </VisuallyHidden>
              </>
            ) : null}
          </MenuItem>
        ) : null}
        <MenuItem
          component={Link}
          to="/account"
          data-testid="member-account-link"
          onClick={close}
        >
          <ListItemIcon>
            <ManageAccountIcon />
          </ListItemIcon>
          <ListItemText primary={t.account.menuAccount} />
        </MenuItem>
        <MenuItem
          data-testid="member-sign-out"
          disabled={leaving}
          onClick={() => {
            close();
            if (impersonating) stopImpersonation.mutate(undefined);
            else signOut.mutate();
          }}
        >
          <ListItemIcon>
            <SignOutIcon />
          </ListItemIcon>
          <ListItemText primary={impersonating ? t.shell.impersonationExit : t.tenant.signOut} />
        </MenuItem>
      </Menu>
      <Snackbar open={failure !== null} autoHideDuration={6000} onClose={dismissFailure}>
        <Alert severity="error" onClose={dismissFailure}>
          {failure === null ? '' : localizeError(failure, t)}
        </Alert>
      </Snackbar>
    </>
  );
};
