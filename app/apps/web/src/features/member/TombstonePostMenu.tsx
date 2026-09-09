import { useState } from 'react';
import { Alert, IconButton, ListItemText, Menu, MenuItem, Tooltip } from '@mui/material';

import { ConfirmDialog } from '../../components/layout/index.js';
import { localizeError, useTranslations } from '../../i18n/index.js';
import { PostMenuIcon } from './community-icons.js';
import { usePostMutations } from './usePostMutations.js';

export const TombstonePostMenu = ({ postId, writeDisabled }: { postId: string; writeDisabled: boolean }) => {
  const t = useTranslations();
  const [anchorEl, setAnchorEl] = useState<HTMLElement | null>(null);
  const [confirming, setConfirming] = useState(false);
  const { purge } = usePostMutations();
  return (
    <>
      <Tooltip title={t.community.postMenu}>
        <IconButton
          size="small"
          data-testid={`post-menu-${postId}`}
          aria-label={t.community.postMenu}
          aria-haspopup="true"
          aria-expanded={anchorEl !== null ? true : undefined}
          onClick={(event) => setAnchorEl(event.currentTarget)}
        >
          <PostMenuIcon />
        </IconButton>
      </Tooltip>
      <Menu anchorEl={anchorEl} open={anchorEl !== null} onClose={() => setAnchorEl(null)}>
        <MenuItem
          data-testid={`purge-button-${postId}`}
          disabled={writeDisabled || purge.isPending}
          onClick={() => {
            setAnchorEl(null);
            setConfirming(true);
          }}
        >
          <ListItemText primary={t.discussion.purge} />
        </MenuItem>
      </Menu>
      <ConfirmDialog
        open={confirming}
        title={t.discussion.purgeConfirmTitle}
        body={t.discussion.purgeConfirmBody}
        confirmLabel={purge.isPending ? t.discussion.deleting : t.discussion.purge}
        cancelLabel={t.common.cancel}
        pending={purge.isPending}
        onClose={() => setConfirming(false)}
        onConfirm={() => purge.mutate({ id: postId }, { onSuccess: () => setConfirming(false) })}
        confirmTestId="confirm-purge-post"
      />
      {purge.error !== null ? <Alert severity="error">{localizeError(purge.error, t)}</Alert> : null}
    </>
  );
};
