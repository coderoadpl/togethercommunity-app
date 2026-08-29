import { useState } from 'react';
import {
  Alert,
  Button,
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
  FormControl,
  InputLabel,
  MenuItem,
  Select,
  TextField,
} from '@mui/material';
import { useMutation, useQuery } from '@tanstack/react-query';

import { ApiError } from '#core/client/index.js';
import type { PostReportReason } from '#core/domain/index.js';

import { actions } from '../../api.js';
import { StatusView } from '../../components/layout/index.js';
import { localizeError, useTranslations } from '../../i18n/index.js';

export const useReportUnavailable = (disabled = false): boolean => {
  const me = useQuery(actions.me);
  return disabled || me.isError || me.data?.tenant?.banned === true;
};

export const ReportPostDialog = ({
  postId,
  open,
  onClose,
}: {
  postId: string;
  open: boolean;
  onClose: () => void;
}) => {
  const t = useTranslations();
  const [reason, setReason] = useState<PostReportReason>('spam');
  const [note, setNote] = useState('');
  const [sent, setSent] = useState(false);
  const me = useQuery(actions.me);
  const report = useMutation({
    ...actions.reportPost,
    onSuccess: () => setSent(true),
  });
  const error = report.error instanceof ApiError && report.error.appError.code === 'conflict'
    ? t.community.reportAlready
    : report.isError
      ? localizeError(report.error, t)
      : null;

  return (
    <Dialog open={open} onClose={onClose} fullWidth maxWidth="sm">
      <DialogTitle>{t.community.reportTitle}</DialogTitle>
      <DialogContent>
        <FormControl fullWidth margin="normal">
          <InputLabel id={`report-reason-${postId}`}>{t.community.reportReasonLabel}</InputLabel>
          <Select
            labelId={`report-reason-${postId}`}
            label={t.community.reportReasonLabel}
            value={reason}
            onChange={(event) => setReason(event.target.value)}
          >
            <MenuItem value="spam">{t.community.reportReasonSpam}</MenuItem>
            <MenuItem value="harassment">{t.community.reportReasonHarassment}</MenuItem>
            <MenuItem value="off-topic">{t.community.reportReasonOffTopic}</MenuItem>
            <MenuItem value="illegal">{t.community.reportReasonIllegal}</MenuItem>
            <MenuItem value="other">{t.community.reportReasonOther}</MenuItem>
          </Select>
        </FormControl>
        <TextField
          fullWidth
          multiline
          minRows={3}
          label={t.community.reportNoteLabel}
          value={note}
          onChange={(event) => setNote(event.target.value)}
          slotProps={{ htmlInput: { maxLength: 1000 } }}
        />
        {sent ? <Alert severity="success" sx={{ mt: '1rem' }}>{t.community.reportSent}</Alert> : null}
        {me.isError ? <StatusView surface={false} state={{ kind: 'error', message: localizeError(me.error, t), retry: { label: t.common.retry, onRetry: () => void me.refetch() } }} /> : null}
        {error === null ? null : <Alert severity="error" sx={{ mt: '1rem' }}>{error}</Alert>}
      </DialogContent>
      <DialogActions>
        <Button onClick={onClose}>{t.common.cancel}</Button>
        <Button
          variant="contained"
          disabled={report.isPending || sent}
          onClick={() => report.mutate({ postId, reason, ...(note.trim() === '' ? {} : { note }) })}
        >
          {t.community.reportSubmit}
        </Button>
      </DialogActions>
    </Dialog>
  );
};

export const ReportPostButton = ({ postId, disabled = false }: { postId: string; disabled?: boolean }) => {
  const t = useTranslations();
  const [open, setOpen] = useState(false);
  const unavailable = useReportUnavailable(disabled);

  return (
    <>
      <Button size="small" variant="text" disabled={unavailable} onClick={() => setOpen(true)}>
        {t.community.report}
      </Button>
      <ReportPostDialog postId={postId} open={open} onClose={() => setOpen(false)} />
    </>
  );
};
