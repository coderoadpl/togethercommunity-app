import { useState } from 'react';
import {
  Alert,
  Box,
  Button,
  FormControl,
  FormLabel,
  OutlinedInput,
  Snackbar,
  Typography,
} from '@mui/material';
import { useMutation, useQueryClient } from '@tanstack/react-query';

import { actions } from '../../api.js';
import { ConfirmDialog } from '../../components/layout/index.js';
import { localizePanelError, useTranslations } from '../../i18n/index.js';

export const PlatformDataReset = ({ environment }: { environment: string }) => {
  const t = useTranslations();
  const queryClient = useQueryClient();
  const [dialogOpen, setDialogOpen] = useState(false);
  const [confirmation, setConfirmation] = useState('');
  const [succeeded, setSucceeded] = useState(false);

  const reset = useMutation({
    ...actions.resetPlatformData,
    onSuccess: async () => {
      setDialogOpen(false);
      setConfirmation('');
      setSucceeded(true);
      await queryClient.invalidateQueries();
    },
  });

  const close = () => {
    setDialogOpen(false);
    setConfirmation('');
    reset.reset();
  };

  return (
    <Box sx={{ mt: '1.5rem', display: 'grid', gap: '0.75rem' }}>
      <Typography variant="h2" component="h2">{t.platformReset.title}</Typography>
      <Typography variant="body2">{t.platformReset.description({ environment })}</Typography>
      <Button
        variant="outlined"
        color="error"
        onClick={() => setDialogOpen(true)}
        data-testid="platform-reset-open"
      >
        {t.platformReset.action}
      </Button>
      <ConfirmDialog
        open={dialogOpen}
        title={t.platformReset.confirmTitle}
        body={
          <>
            <Typography variant="body2">
              {t.platformReset.confirmBody({ environment })}
            </Typography>
            <FormControl fullWidth>
              <FormLabel htmlFor="platform-reset-confirmation">
                {t.platformReset.confirmLabel}
              </FormLabel>
              <OutlinedInput
                id="platform-reset-confirmation"
                value={confirmation}
                placeholder={environment}
                onChange={(event) => setConfirmation(event.target.value)}
              />
            </FormControl>
            {reset.isError ? (
              <Alert severity="error">{localizePanelError(reset.error, t)}</Alert>
            ) : null}
          </>
        }
        confirmLabel={reset.isPending ? t.platformReset.running : t.platformReset.confirmButton}
        cancelLabel={t.common.cancel}
        pending={reset.isPending}
        confirmDisabled={confirmation.trim() !== environment}
        onConfirm={() => reset.mutate({ confirmation })}
        onClose={close}
        confirmTestId="platform-reset-confirm"
      />
      <Snackbar
        open={succeeded}
        autoHideDuration={6000}
        onClose={() => setSucceeded(false)}
        anchorOrigin={{ vertical: 'bottom', horizontal: 'left' }}
        message={t.platformReset.success({ environment })}
      />
    </Box>
  );
};
