import type { ReactNode } from 'react';
import { Alert, Box, ListItemIcon, ListItemText, MenuItem, Snackbar, Typography } from '@mui/material';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Link, useNavigate } from '@tanstack/react-router';

import { actions } from '../../api.js';
import { ManageAccountIcon } from '../../components/ui/ManageAccountIcon.js';
import { UserAvatar } from '../../components/ui/UserAvatar.js';
import { localizeError, useTranslations } from '../../i18n/index.js';
import { forgetLoginIdentifier } from '../../lib/login-identifier.js';
import { navigateFresh } from '../../lib/navigation.js';
import {
  streamlessPollInterval,
  UNREAD_BADGE_POLL_INTERVAL_MS,
} from '../../notifications-stream.js';
import { useNotificationsTransport } from '../../notifications-transport.js';
import { BreakAllText, CountBadge, Eyebrow, VisuallyHidden } from '../../theme.js';
import { SignOutIcon, StudioIcon } from './account-icons.js';
import { memberMessagesPath } from './shell/member-nav.js';
import { NavRow } from './shell/shell-chrome.js';
import { MessagesIcon, ProductsIcon } from './shell/shell-icons.js';
import { useCanOpenStudio } from './viewer.js';

type AccountActionKey = 'studio' | 'products' | 'messages' | 'account' | 'sign-out';
type AccountActionLinkTo = '/panel' | '/my/products' | '/messages' | '/account';

type LinkAccountAction = {
  kind: 'link';
  key: AccountActionKey;
  to: AccountActionLinkTo;
  label: string;
  testId: string;
  icon: ReactNode;
  unread?: { count: number; label: string };
};

type ButtonAccountAction = {
  kind: 'button';
  key: AccountActionKey;
  label: string;
  testId: string;
  icon: ReactNode;
  disabled: boolean;
  onClick: () => void;
};

export type AccountAction = LinkAccountAction | ButtonAccountAction;

export type MemberAccountActionsState = {
  actions: AccountAction[];
  avatarUrl: string | null;
  displayName: string;
  dismissFailure: () => void;
  email: string | null;
  failure: Error | null;
  unreadMessageCount: number;
};

export const useMemberAccountActions = ({
  panelUrl = '/panel/members',
}: {
  panelUrl?: string;
} = {}): MemberAccountActionsState => {
  const t = useTranslations();
  const me = useQuery(actions.me);
  const navigation = useQuery(actions.memberNavigation);
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const canOpenStudio = useCanOpenStudio();

  const signOut = useMutation({
    ...actions.signOut,
    onSuccess: async () => {
      forgetLoginIdentifier();
      queryClient.clear();
      await navigate({ to: '/login' });
    },
  });

  const impersonating = (me.data?.impersonation ?? null) !== null;
  const stopImpersonation = useMutation({
    ...actions.stopImpersonation,
    onSuccess: () => navigateFresh(panelUrl),
  });

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
  const actionsList: AccountAction[] = [];

  if (canOpenStudio) {
    actionsList.push({
      kind: 'link',
      key: 'studio',
      to: '/panel',
      label: t.account.menuStudio,
      testId: 'member-account-studio-link',
      icon: <StudioIcon />,
    });
  }

  actionsList.push({
    kind: 'link',
    key: 'products',
    to: '/my/products',
    label: t.student.myProducts,
    testId: 'member-account-products',
    icon: <ProductsIcon />,
  });

  if (messagesEnabled) {
    actionsList.push({
      kind: 'link',
      key: 'messages',
      to: memberMessagesPath(),
      label: t.messages.navLabel,
      testId: 'member-account-messages',
      icon: <MessagesIcon />,
      ...(unreadMessageCount > 0
        ? {
            unread: {
              count: unreadMessageCount,
              label: t.messages.unreadAria({ count: unreadMessageCount }),
            },
          }
        : {}),
    });
  }

  actionsList.push(
    {
      kind: 'link',
      key: 'account',
      to: '/account',
      label: t.account.menuAccount,
      testId: 'member-account-link',
      icon: <ManageAccountIcon />,
    },
    {
      kind: 'button',
      key: 'sign-out',
      label: impersonating ? t.shell.impersonationExit : t.tenant.signOut,
      testId: 'member-sign-out',
      icon: <SignOutIcon />,
      disabled: leaving,
      onClick: () => {
        // The session under view-as-member is still the operator's, so signing out here would end their panel session; the control leaves the view instead.
        if (impersonating) stopImpersonation.mutate(undefined);
        else signOut.mutate();
      },
    },
  );

  return {
    actions: actionsList,
    avatarUrl: me.data?.avatarUrl ?? null,
    displayName: me.data?.tenant?.displayName ?? me.data?.name ?? '',
    dismissFailure,
    email: me.data?.email ?? null,
    failure,
    unreadMessageCount,
  };
};

const ActionContent = ({ action }: { action: AccountAction }) => (
  <>
    <ListItemIcon>{action.icon}</ListItemIcon>
    <ListItemText primary={action.label} />
    {'unread' in action && action.unread !== undefined ? (
      <>
        <CountBadge aria-hidden data-testid="member-account-messages-unread">
          {action.unread.count}
        </CountBadge>
        <VisuallyHidden>{action.unread.label}</VisuallyHidden>
      </>
    ) : null}
  </>
);

export const MemberAccountActionList = ({
  actions,
  onSelect,
  surface,
}: {
  actions: AccountAction[];
  onSelect: () => void;
  surface: 'menu' | 'sheet';
}) => (
  <>
    {actions.map((action) => {
      if (action.kind === 'link') {
        return surface === 'menu' ? (
          <MenuItem
            key={action.key}
            component={Link}
            to={action.to}
            data-testid={action.testId}
            sx={{ minHeight: '44px' }}
            onClick={onSelect}
          >
            <ActionContent action={action} />
          </MenuItem>
        ) : (
          <NavRow
            key={action.key}
            component={Link}
            to={action.to}
            data-testid={action.testId}
            onClick={onSelect}
          >
            <ActionContent action={action} />
          </NavRow>
        );
      }

      const handleClick = () => {
        onSelect();
        action.onClick();
      };

      return surface === 'menu' ? (
        <MenuItem
          key={action.key}
          data-testid={action.testId}
          disabled={action.disabled}
          sx={{ minHeight: '44px' }}
          onClick={handleClick}
        >
          <ActionContent action={action} />
        </MenuItem>
      ) : (
        <NavRow
          key={action.key}
          component="button"
          type="button"
          data-testid={action.testId}
          disabled={action.disabled}
          onClick={handleClick}
          sx={{ width: '100%' }}
        >
          <ActionContent action={action} />
        </NavRow>
      );
    })}
  </>
);

export const MemberAccountIdentityBlock = ({
  avatarUrl,
  displayName,
  email,
  surface = 'menu',
  testId,
}: {
  avatarUrl: string | null;
  displayName: string;
  email: string | null;
  surface?: 'menu' | 'sheet';
  testId?: string;
}) => {
  const t = useTranslations();
  if (email === null) return null;

  return (
    <Box
      data-testid={testId}
      sx={{
        display: 'flex',
        alignItems: 'center',
        gap: surface === 'menu' ? '0.75rem' : '0.6rem',
        px: surface === 'menu' ? '1rem' : '0.6rem',
        py: surface === 'menu' ? '0.5rem' : '0.6rem',
        minWidth: 0,
        maxWidth: surface === 'menu' ? '18rem' : undefined,
      }}
    >
      <UserAvatar
        name={displayName}
        email={email}
        imageUrl={avatarUrl}
        size={surface === 'menu' ? 'lg' : 'md'}
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
  );
};

export const MemberAccountActionFailure = ({
  failure,
  onDismiss,
}: {
  failure: Error | null;
  onDismiss: () => void;
}) => {
  const t = useTranslations();
  return (
    <Snackbar open={failure !== null} autoHideDuration={6000} onClose={onDismiss}>
      <Alert severity="error" onClose={onDismiss}>
        {failure === null ? '' : localizeError(failure, t)}
      </Alert>
    </Snackbar>
  );
};
