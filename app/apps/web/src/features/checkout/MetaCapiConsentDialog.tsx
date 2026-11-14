import { useId, useState } from 'react';
import { Button, Dialog, DialogActions, DialogContent, DialogContentText, DialogTitle, Link, Stack, Typography } from '@mui/material';
import type { MetaCapiConfig } from '#core/domain/index.js';
import { useTranslations } from '../../i18n/index.js';

export const MetaCapiConsentDialog = ({ config, open, onDecision, onDismiss, initiallyExpanded = false }: {
  config: MetaCapiConfig;
  open: boolean;
  onDecision: (decision: 'granted' | 'denied') => void;
  onDismiss: () => void;
  initiallyExpanded?: boolean;
}) => {
  const t = useTranslations();
  const id = useId();
  const [expanded, setExpanded] = useState(initiallyExpanded);
  return (
    <Dialog open={open} onClose={onDismiss} fullWidth maxWidth="sm" aria-labelledby={`${id}-title`} aria-describedby={`${id}-body`}>
      <DialogTitle id={`${id}-title`} tabIndex={-1} autoFocus>{config.heading}</DialogTitle>
      <DialogContent>
        <Stack spacing={2}>
          <DialogContentText id={`${id}-body`}>{config.body}</DialogContentText>
          {config.privacyUrl ? (
            <Link href={config.privacyUrl} target="_blank" rel="noopener noreferrer">{t.metaCapi.privacyPolicy}</Link>
          ) : null}
          <Button variant="text" aria-expanded={expanded} aria-controls={`${id}-fields`} onClick={() => setExpanded(!expanded)}>{t.metaCapi.fieldsToggle}</Button>
          {expanded ? (
            <Stack component="ul" id={`${id}-fields`} spacing={1} sx={{ pl: 3, m: 0 }}>
              <Typography component="li" variant="body2">{t.metaCapi.fieldsPurchase}</Typography>
              <Typography component="li" variant="body2">{t.metaCapi.fieldsIdentity}</Typography>
              <Typography component="li" variant="body2">{t.metaCapi.fieldsBrowser}</Typography>
              <Typography component="li" variant="body2">{t.metaCapi.fieldsAttribution}</Typography>
            </Stack>
          ) : null}
        </Stack>
      </DialogContent>
      <DialogActions sx={{ p: 3 }}>
        <Stack direction={{ xs: 'column', sm: 'row' }} spacing={2} sx={{ width: '100%' }}>
          <Button variant="outlined" fullWidth onClick={() => onDecision('granted')}>{config.acceptLabel}</Button>
          <Button variant="outlined" fullWidth onClick={() => onDecision('denied')}>{config.declineLabel}</Button>
        </Stack>
      </DialogActions>
    </Dialog>
  );
};
