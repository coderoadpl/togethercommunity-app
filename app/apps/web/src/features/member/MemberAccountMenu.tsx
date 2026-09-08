import { useState } from 'react';
import { Box, Divider, IconButton, Menu, Tooltip } from '@mui/material';
import { useQuery } from '@tanstack/react-query';

import { actions } from '../../api.js';
import { StatusView } from '../../components/layout/index.js';
import { localizeError, useTranslations } from '../../i18n/index.js';
import { InkDotBadge } from '../../theme.js';
import { UserAvatar } from '../../components/ui/UserAvatar.js';
import {
  MemberAccountActionFailure,
  MemberAccountActionList,
  MemberAccountIdentityBlock,
  useMemberAccountActions,
} from './MemberAccountActions.js';

export const MemberAccountMenu = ({ panelUrl = '/panel/members' }: { panelUrl?: string } = {}) => {
  const t = useTranslations();
  const me = useQuery(actions.me);
  const [anchorEl, setAnchorEl] = useState<HTMLElement | null>(null);
  const open = Boolean(anchorEl);
  const close = () => setAnchorEl(null);
  const account = useMemberAccountActions({ panelUrl });

  return (
    <>
      <Tooltip title={t.panel.accountMenu}>
        <IconButton
          data-testid="member-account-menu"
          aria-label={
            account.unreadMessageCount > 0
              ? t.panel.accountMenuUnread({ count: account.unreadMessageCount })
              : t.panel.accountMenu
          }
          aria-haspopup="true"
          aria-expanded={open ? true : undefined}
          onClick={(event) => setAnchorEl(event.currentTarget)}
          sx={{ minHeight: '48px', minWidth: '48px' }}
        >
          <InkDotBadge
            variant="dot"
            invisible={account.unreadMessageCount === 0}
            data-testid="member-account-unread"
          >
            <UserAvatar
              name={account.displayName}
              email={account.email}
              imageUrl={account.avatarUrl}
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
        <MemberAccountIdentityBlock
          avatarUrl={account.avatarUrl}
          displayName={account.displayName}
          email={account.email}
        />
        {account.email !== null ? <Divider /> : null}
        <MemberAccountActionList actions={account.actions} onSelect={close} surface="menu" />
      </Menu>
      <MemberAccountActionFailure failure={account.failure} onDismiss={account.dismissFailure} />
    </>
  );
};
