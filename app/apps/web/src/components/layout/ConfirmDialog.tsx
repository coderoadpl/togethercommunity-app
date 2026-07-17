import { useId, type ReactNode } from 'react';
import { Button, Dialog, DialogActions, DialogContent, DialogTitle, Stack } from '@mui/material';

interface ConfirmDialogProps {
  open: boolean;
  title: ReactNode;
  body: ReactNode;
  confirmLabel: ReactNode;
  cancelLabel: ReactNode;
  pending?: boolean;
  confirmDisabled?: boolean;
  onConfirm: () => void;
  onClose: () => void;
  confirmTestId?: string;
  'data-testid'?: string;
}

export const ConfirmDialog = ({
  open,
  title,
  body,
  confirmLabel,
  cancelLabel,
  pending = false,
  confirmDisabled = false,
  onConfirm,
  onClose,
  confirmTestId = 'confirm-dialog-confirm',
  'data-testid': testId,
}: ConfirmDialogProps) => {
  const titleId = useId();
  // Escape/backdrop must not dismiss a confirm whose mutation is in flight —
  // the cancel button is already disabled while pending.
  const close = () => {
    if (!pending) onClose();
  };

  return (
    <Dialog open={open} onClose={close} aria-labelledby={titleId} data-testid={testId}>
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
          disabled={pending || confirmDisabled}
          data-testid={confirmTestId}
        >
          {confirmLabel}
        </Button>
      </DialogActions>
    </Dialog>
  );
};
