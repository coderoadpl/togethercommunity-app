import { useState } from 'react';
import { Box, Divider, IconButton, ListItemIcon, ListItemText, Menu, MenuItem } from '@mui/material';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useNavigate } from '@tanstack/react-router';

import { actions } from '../../api.js';
import { useTranslations } from '../../i18n/index.js';
import { BreakAllText, Eyebrow } from '../../theme.js';
import { AccountIcon, SignOutIcon } from './account-icons.js';

export const MemberAccountMenu = () => {
  const t = useTranslations();
  const me = useQuery(actions.me);
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const [anchorEl, setAnchorEl] = useState<HTMLElement | null>(null);
  const open = Boolean(anchorEl);

  const signOut = useMutation({
    ...actions.signOut,
    onSuccess: async () => {
      await queryClient.invalidateQueries();
      await navigate({ to: '/login' });
    },
  });

  const email = me.data?.email ?? null;

  return (
    <>
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
      <Menu
        anchorEl={anchorEl}
        open={open}
        onClose={() => setAnchorEl(null)}
        anchorOrigin={{ vertical: 'bottom', horizontal: 'right' }}
        transformOrigin={{ vertical: 'top', horizontal: 'right' }}
      >
        {email !== null ? (
          <Box sx={{ px: '1rem', py: '0.5rem', maxWidth: '18rem' }}>
            <Eyebrow variant="overline" component="p">
              {t.panel.signedInAs}
            </Eyebrow>
            <BreakAllText variant="body2" data-testid="member-account-email">
              {email}
            </BreakAllText>
          </Box>
        ) : null}
        {email !== null ? <Divider /> : null}
        <MenuItem
          data-testid="member-sign-out"
          disabled={signOut.isPending}
          onClick={() => {
            setAnchorEl(null);
            signOut.mutate();
          }}
        >
          <ListItemIcon>
            <SignOutIcon />
          </ListItemIcon>
          <ListItemText primary={t.tenant.signOut} />
        </MenuItem>
      </Menu>
    </>
  );
};
