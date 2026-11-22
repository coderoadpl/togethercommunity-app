import { useEffect, useId, useRef, useState } from 'react';
import { Box, Button, Dialog, DialogActions, DialogContent, DialogContentText, DialogTitle, Link, Stack, Typography } from '@mui/material';
import type { MetaCapiConfig } from '#core/domain/index.js';
import { ChevronDownIcon, ExternalLinkIcon } from '../../components/ui/account-icons.js';
import { useTranslations } from '../../i18n/index.js';
import { AccountSessionDisclosure, VisuallyHidden } from '../../theme.js';

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
  const revealFields = useRef(false);
  const fieldList = useRef<HTMLUListElement>(null);
  useEffect(() => {
    if (!expanded || !revealFields.current) return;
    revealFields.current = false;
    fieldList.current?.firstElementChild?.scrollIntoView({ block: 'nearest' });
  }, [expanded]);
  const toggleFields = () => {
    revealFields.current = !expanded;
    setExpanded(!expanded);
  };
  const fields = [t.metaCapi.fieldsPurchase, t.metaCapi.fieldsIdentity, t.metaCapi.fieldsBrowser, t.metaCapi.fieldsAttribution];
  return (
    <Dialog
      open={open}
      onClose={onDismiss}
      fullWidth
      maxWidth="sm"
      scroll="paper"
      aria-labelledby={`${id}-title`}
      aria-describedby={`${id}-body`}
      sx={{ '& .MuiDialog-container': { alignItems: 'flex-end' } }}
    >
      <DialogTitle id={`${id}-title`} tabIndex={-1} autoFocus>{config.heading}</DialogTitle>
      <DialogContent dividers>
        <Stack spacing={2}>
          <DialogContentText id={`${id}-body`} color="text.primary">{config.body}</DialogContentText>
          {config.privacyUrl ? (
            <Link
              href={config.privacyUrl}
              target="_blank"
              rel="noopener noreferrer"
              underline="always"
              sx={{ alignSelf: 'flex-start', display: 'inline-flex', alignItems: 'center', gap: 0.5, minHeight: 44 }}
            >
              {t.metaCapi.privacyPolicy}
              <ExternalLinkIcon />
              <VisuallyHidden>{` ${t.metaCapi.newTabHint}`}</VisuallyHidden>
            </Link>
          ) : null}
          <Box>
            <AccountSessionDisclosure aria-expanded={expanded} aria-controls={`${id}-fields`} onClick={toggleFields}>
              <Typography component="span" variant="body2">{t.metaCapi.fieldsToggle}</Typography>
              <ChevronDownIcon />
            </AccountSessionDisclosure>
            <Box component="ul" ref={fieldList} id={`${id}-fields`} hidden={!expanded} sx={{ pl: 3, mb: 0, mt: 1, '& > li + li': { mt: 1 } }}>
              {fields.map((field) => (
                <Typography key={field} component="li" variant="body2" color="text.secondary">{field}</Typography>
              ))}
            </Box>
          </Box>
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
