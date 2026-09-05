import { useState } from 'react';
import { Alert, Box, Divider, IconButton, ListItemIcon, ListItemText, Menu, MenuItem, Snackbar, Tooltip } from '@mui/material';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useNavigate } from '@tanstack/react-router';

import { actions } from '../../api.js';
import { StatusView } from '../../components/layout/index.js';
import { localizeError, useTranslations } from '../../i18n/index.js';
import { forgetLoginIdentifier } from '../../lib/login-identifier.js';
import { navigateFresh } from '../../lib/navigation.js';
import { BreakAllText, Eyebrow } from '../../theme.js';
import { AccountIcon, ManageAccountIcon, SignOutIcon } from './account-icons.js';
import { MemberAvatar } from '../../components/ui/MemberAvatar.js';

export const MemberAccountMenu = ({ panelUrl = '/panel/members' }: { panelUrl?: string } = {}) => {
  const t = useTranslations();
  const me = useQuery(actions.me);
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const [anchorEl, setAnchorEl] = useState<HTMLElement | null>(null);
  const open = Boolean(anchorEl);

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
  const leaving = signOut.isPending || stopImpersonation.isPending;
  const failure = signOut.error ?? stopImpersonation.error;
  const dismissFailure = () => {
    signOut.reset();
    stopImpersonation.reset();
  };

  return (
    <>
      <Tooltip title={t.panel.accountMenu}>
        <IconButton
          size="small"
          data-testid="member-account-menu"
          aria-label={t.panel.accountMenu}
          aria-haspopup="true"
          aria-expanded={open ? true : undefined}
          onClick={(event) => setAnchorEl(event.currentTarget)}
        >
          <AccountIcon />
        </IconButton>
      </Tooltip>
      <Menu
        anchorEl={anchorEl}
        open={open}
        onClose={() => setAnchorEl(null)}
        anchorOrigin={{ vertical: 'bottom', horizontal: 'right' }}
        transformOrigin={{ vertical: 'top', horizontal: 'right' }}
      >
        {me.isError ? <Box sx={{ p: '0.75rem' }}><StatusView surface={false} state={{ kind: 'error', message: localizeError(me.error, t), retry: { label: t.common.retry, onRetry: () => void me.refetch() } }} /></Box> : null}
        {email !== null ? (
          <Box sx={{ display: 'flex', alignItems: 'center', gap: '0.75rem', px: '1rem', py: '0.5rem', maxWidth: '18rem' }}>
            <MemberAvatar name={displayName} avatarUrl={me.data?.avatarUrl ?? null} />
            <Box sx={{ minWidth: 0 }}>
              <Eyebrow variant="overline" component="p">
                {t.panel.signedInAs}
              </Eyebrow>
              <BreakAllText variant="body2" data-testid="member-account-email">
                {email}
              </BreakAllText>
            </Box>
          </Box>
        ) : null}
        {email !== null ? <Divider /> : null}
        <MenuItem
          data-testid="member-account-link"
          onClick={() => {
            setAnchorEl(null);
            void navigate({ to: '/account' });
          }}
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
            setAnchorEl(null);
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
