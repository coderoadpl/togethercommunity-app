import { useState } from 'react';
import {
  Alert,
  Button,
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
  FormControl,
  IconButton,
  InputLabel,
  ListItemText,
  Menu,
  MenuItem,
  Select,
  Snackbar,
  Tooltip,
} from '@mui/material';
import { useMutation, useQueryClient } from '@tanstack/react-query';

import { ApiError } from '#core/client/index.js';
import type { DmReportReason } from '#core/domain/index.js';

import { actions } from '../../../api.js';
import { localizeError, useTranslations } from '../../../i18n/index.js';
import { SHELL_SNACKBAR_ANCHOR } from '../../../theme.js';
import { PostMenuIcon } from '../community-icons.js';

const ReportConversationDialog = ({
  conversationId,
  onClose,
}: {
  conversationId: string;
  onClose: () => void;
}) => {
  const t = useTranslations();
  const [reason, setReason] = useState<DmReportReason>('harassment');
  const [sent, setSent] = useState(false);
  const report = useMutation({ ...actions.reportConversation, onSuccess: () => setSent(true) });
  const error = report.error instanceof ApiError && report.error.appError.code === 'conflict'
    ? t.messages.reportAlready
    : report.isError
      ? localizeError(report.error, t)
      : null;

  return (
    <Dialog open onClose={onClose} fullWidth maxWidth="sm">
      <DialogTitle>{t.messages.reportTitle}</DialogTitle>
      <DialogContent>
        <FormControl fullWidth margin="normal">
          <InputLabel id={`dm-report-reason-${conversationId}`}>{t.community.reportReasonLabel}</InputLabel>
          <Select
            labelId={`dm-report-reason-${conversationId}`}
            label={t.community.reportReasonLabel}
            value={reason}
            data-testid="dm-report-reason"
            onChange={(event) => setReason(event.target.value)}
          >
            <MenuItem value="spam">{t.community.reportReasonSpam}</MenuItem>
            <MenuItem value="harassment">{t.community.reportReasonHarassment}</MenuItem>
            <MenuItem value="illegal">{t.community.reportReasonIllegal}</MenuItem>
            <MenuItem value="other">{t.community.reportReasonOther}</MenuItem>
          </Select>
        </FormControl>
        <Alert severity="info">{t.messages.reportHint}</Alert>
        {sent ? <Alert severity="success" sx={{ mt: '1rem' }}>{t.messages.reportSent}</Alert> : null}
        {error === null ? null : <Alert severity="error" sx={{ mt: '1rem' }}>{error}</Alert>}
      </DialogContent>
      <DialogActions>
        <Button onClick={onClose}>{sent ? t.common.close : t.common.cancel}</Button>
        <Button
          variant="contained"
          data-testid="dm-report-submit"
          disabled={report.isPending || sent}
          onClick={() => report.mutate({ conversationId, reason })}
        >
          {t.community.reportSubmit}
        </Button>
      </DialogActions>
    </Dialog>
  );
};

export const ConversationMenu = ({
  conversationId,
  blockedByViewer,
}: {
  conversationId: string;
  blockedByViewer: boolean;
}) => {
  const t = useTranslations();
  const queryClient = useQueryClient();
  const [anchorEl, setAnchorEl] = useState<HTMLElement | null>(null);
  const [reportOpen, setReportOpen] = useState(false);
  const open = anchorEl !== null;

  const onSuccess = async () => {
    await queryClient.invalidateQueries(actions.messagesInvalidates());
  };
  const block = useMutation({ ...actions.blockConversationParticipant, onSuccess });
  const unblock = useMutation({ ...actions.unblockConversationParticipant, onSuccess });
  const pending = block.isPending || unblock.isPending;
  const failed = block.isError ? block.error : unblock.isError ? unblock.error : null;

  return (
    <>
      <Tooltip title={t.messages.conversationMenu}>
        <IconButton
          size="small"
          data-testid="conversation-menu"
          aria-label={t.messages.conversationMenu}
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
        <MenuItem
          data-testid={blockedByViewer ? 'conversation-unblock' : 'conversation-block'}
          disabled={pending}
          onClick={() => {
            setAnchorEl(null);
            if (blockedByViewer) unblock.mutate({ conversationId });
            else block.mutate({ conversationId });
          }}
        >
          <ListItemText primary={blockedByViewer ? t.messages.unblock : t.messages.block} />
        </MenuItem>
        <MenuItem
          data-testid="conversation-report"
          onClick={() => {
            setAnchorEl(null);
            setReportOpen(true);
          }}
        >
          <ListItemText primary={t.messages.report} />
        </MenuItem>
      </Menu>
      <Snackbar
        open={failed !== null}
        autoHideDuration={6000}
        anchorOrigin={SHELL_SNACKBAR_ANCHOR}
        onClose={() => {
          block.reset();
          unblock.reset();
        }}
      >
        <Alert severity="error">{failed === null ? '' : localizeError(failed, t)}</Alert>
      </Snackbar>
      {reportOpen ? (
        <ReportConversationDialog
          conversationId={conversationId}
          onClose={() => setReportOpen(false)}
        />
      ) : null}
    </>
  );
};
