import { useId, type ReactNode } from 'react';
import { Button, Dialog, DialogActions, DialogContent, DialogTitle, Stack } from '@mui/material';

interface ConfirmDialogProps {
  open: boolean;
  title: ReactNode;
  body: ReactNode;
  confirmLabel: ReactNode;
  cancelLabel: ReactNode;
  pending?: boolean;
  onConfirm: () => void;
  onClose: () => void;
  'data-testid'?: string;
}

export const ConfirmDialog = ({
  open,
  title,
  body,
  confirmLabel,
  cancelLabel,
  pending = false,
  onConfirm,
  onClose,
  'data-testid': testId,
}: ConfirmDialogProps) => {
  const titleId = useId();

  return (
    <Dialog open={open} onClose={onClose} aria-labelledby={titleId} data-testid={testId}>
      <DialogTitle id={titleId}>{title}</DialogTitle>
      <DialogContent>
        <Stack useFlexGap spacing="0.75rem" sx={{ pt: '0.25rem' }}>
          {body}
        </Stack>
      </DialogContent>
      <DialogActions>
        <Button variant="text" onClick={onClose} disabled={pending} data-testid="confirm-dialog-cancel">
          {cancelLabel}
        </Button>
        <Button
          variant="contained"
          color="error"
          onClick={onConfirm}
          disabled={pending}
          data-testid="confirm-dialog-confirm"
        >
          {confirmLabel}
        </Button>
      </DialogActions>
    </Dialog>
  );
};
