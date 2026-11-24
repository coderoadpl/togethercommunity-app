import { useState } from 'react';
import { IconButton, ListItemText, Menu, MenuItem, Tooltip } from '@mui/material';

import { useTranslations } from '../../i18n/index.js';
import { PostMenuIcon } from './community-icons.js';
import { ReportPostDialog, useReportUnavailable } from './ReportPostButton.js';
import { StartMessageErrorSnackbar, useStartPostConversation } from './messages/StartMessageButton.js';

export const PostContactMenu = ({ postId }: { postId: string }) => {
  const t = useTranslations();
  const [anchorEl, setAnchorEl] = useState<HTMLElement | null>(null);
  const [reportOpen, setReportOpen] = useState(false);
  const conversation = useStartPostConversation(postId);
  const reportUnavailable = useReportUnavailable();
  const open = anchorEl !== null;

  return (
    <>
      <Tooltip title={t.community.postMenu}>
        <IconButton
          data-testid={`post-contact-menu-${postId}`}
          aria-label={t.community.postMenu}
          aria-haspopup="true"
          aria-expanded={open ? true : undefined}
          onClick={(event) => setAnchorEl(event.currentTarget)}
          sx={{ width: 44, height: 44 }}
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
        {conversation.available ? (
          <MenuItem
            data-testid={`menu-start-message-${postId}`}
            disabled={conversation.pending}
            onClick={() => {
              setAnchorEl(null);
              conversation.start();
            }}
          >
            <ListItemText primary={t.messages.messageAuthor} />
          </MenuItem>
        ) : null}
        <MenuItem
          data-testid={`menu-report-post-${postId}`}
          disabled={reportUnavailable}
          onClick={() => {
            setAnchorEl(null);
            setReportOpen(true);
          }}
        >
          <ListItemText primary={t.community.report} />
        </MenuItem>
      </Menu>
      <ReportPostDialog postId={postId} open={reportOpen} onClose={() => setReportOpen(false)} />
      <StartMessageErrorSnackbar conversation={conversation} />
    </>
  );
};
