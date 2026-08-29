import { useState } from 'react';
import { Alert, IconButton, ListItemText, Menu, MenuItem, Snackbar, Tooltip } from '@mui/material';

import { useTranslations } from '../../i18n/index.js';
import { SHELL_SNACKBAR_ANCHOR } from '../../theme.js';
import { PostMenuIcon } from './community-icons.js';
import { ReportPostDialog, useReportUnavailable } from './ReportPostButton.js';
import { StartMessageErrorSnackbar, useStartPostConversation } from './messages/StartMessageButton.js';

type CopyOutcome = 'done' | 'failed';

const copyToClipboard = async (text: string): Promise<CopyOutcome> => {
  const { clipboard } = navigator;
  if (clipboard === undefined) return 'failed';
  try {
    await clipboard.writeText(text);
    return 'done';
  } catch {
    return 'failed';
  }
};

export const FeedPostMenu = ({
  postId,
  postPath,
  canContactAuthor,
}: {
  postId: string;
  postPath: string;
  canContactAuthor: boolean;
}) => {
  const t = useTranslations();
  const [anchorEl, setAnchorEl] = useState<HTMLElement | null>(null);
  const [reportOpen, setReportOpen] = useState(false);
  const [copyOutcome, setCopyOutcome] = useState<CopyOutcome | null>(null);
  const conversation = useStartPostConversation(postId);
  const reportUnavailable = useReportUnavailable();
  const open = anchorEl !== null;

  const copyLink = async () => {
    setAnchorEl(null);
    setCopyOutcome(await copyToClipboard(new URL(postPath, window.location.origin).toString()));
  };

  return (
    <>
      <Tooltip title={t.community.postMenu}>
        <IconButton
          size="small"
          data-testid={`post-menu-${postId}`}
          aria-label={t.community.postMenu}
          aria-haspopup="true"
          aria-expanded={open ? true : undefined}
          onClick={(event) => setAnchorEl(event.currentTarget)}
        >
          <PostMenuIcon />
        </IconButton>
      </Tooltip>
      <Menu
        anchorEl={anchorEl}
        open={open}
        onClose={() => setAnchorEl(null)}
        anchorOrigin={{ vertical: 'bottom', horizontal: 'right' }}
        transformOrigin={{ vertical: 'top', horizontal: 'right' }}
      >
        <MenuItem data-testid={`copy-link-${postId}`} onClick={() => void copyLink()}>
          <ListItemText primary={t.community.copyLink} />
        </MenuItem>
        {canContactAuthor && conversation.available ? (
          <MenuItem
            data-testid={`start-message-${postId}`}
            disabled={conversation.pending}
            onClick={() => {
              setAnchorEl(null);
              conversation.start();
            }}
          >
            <ListItemText primary={t.messages.startFromAuthor} />
          </MenuItem>
        ) : null}
        {canContactAuthor ? (
          <MenuItem
            data-testid={`report-post-${postId}`}
            disabled={reportUnavailable}
            onClick={() => {
              setAnchorEl(null);
              setReportOpen(true);
            }}
          >
            <ListItemText primary={t.community.report} />
          </MenuItem>
        ) : null}
      </Menu>
      <ReportPostDialog postId={postId} open={reportOpen} onClose={() => setReportOpen(false)} />
      <StartMessageErrorSnackbar conversation={conversation} />
      <Snackbar
        open={copyOutcome !== null}
        autoHideDuration={4000}
        anchorOrigin={SHELL_SNACKBAR_ANCHOR}
        onClose={() => setCopyOutcome(null)}
      >
        <Alert severity={copyOutcome === 'failed' ? 'error' : 'success'} onClose={() => setCopyOutcome(null)}>
          {copyOutcome === 'failed' ? t.community.copyLinkFailed : t.community.copyLinkDone}
        </Alert>
      </Snackbar>
    </>
  );
};
