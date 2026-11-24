import { useCallback, useEffect, useId, useRef, useState } from 'react';
import { Box, Button, DialogActions, DialogContent, DialogContentText, Link, Stack, Typography } from '@mui/material';
import type { MetaCapiConfig } from '#core/domain/index.js';
import { ChevronDownIcon, ExternalLinkIcon } from '../../components/ui/account-icons.js';
import { useTranslations } from '../../i18n/index.js';
import { AccountSessionDisclosure, ConsentDialog, ConsentDialogHeading, VisuallyHidden } from '../../theme.js';

const hasMoreBelow = (area: HTMLElement): boolean => area.scrollHeight - area.scrollTop - area.clientHeight > 1;
const hasMoreAbove = (area: HTMLElement): boolean => area.scrollTop > 0;

export const MetaCapiConsentDialog = ({ config, open, onDecision, onDismiss, onExited, disableRestoreFocus = false, initiallyExpanded = false }: {
  config: MetaCapiConfig;
  open: boolean;
  onDecision: (decision: 'granted' | 'denied') => void;
  onDismiss: () => void;
  onExited?: () => void;
  disableRestoreFocus?: boolean;
  initiallyExpanded?: boolean;
}) => {
  const t = useTranslations();
  const id = useId();
  const [expanded, setExpanded] = useState(initiallyExpanded);
  const [moreBelow, setMoreBelow] = useState(false);
  const [moreAbove, setMoreAbove] = useState(false);
  const revealFields = useRef(false);
  const disclosure = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    if (!expanded || !revealFields.current) return;
    revealFields.current = false;
    disclosure.current?.scrollIntoView({ block: 'start' });
  }, [expanded]);
  const trackEdges = useCallback((area: HTMLElement) => {
    setMoreBelow(hasMoreBelow(area));
    setMoreAbove(hasMoreAbove(area));
  }, []);
  const scrollArea = useCallback((area: HTMLDivElement | null) => {
    if (!area) return;
    const update = () => trackEdges(area);
    update();
    if (typeof ResizeObserver === 'undefined') return;
    const observer = new ResizeObserver(update);
    observer.observe(area);
    if (area.firstElementChild) observer.observe(area.firstElementChild);
    return () => observer.disconnect();
  }, [trackEdges]);
  const toggleFields = () => {
    revealFields.current = !expanded;
    setExpanded(!expanded);
  };
  const fields = [t.metaCapi.fieldsPurchase, t.metaCapi.fieldsIdentity, t.metaCapi.fieldsBrowser, t.metaCapi.fieldsAttribution];
  return (
    <ConsentDialog
      open={open}
      onClose={onDismiss}
      disableRestoreFocus={disableRestoreFocus}
      slotProps={{ transition: { onExited } }}
      fullWidth
      maxWidth="sm"
      scroll="paper"
      aria-labelledby={`${id}-title`}
      aria-describedby={`${id}-body`}
      sx={{ '& .MuiDialog-container': { alignItems: 'flex-end' } }}
    >
      <DialogContent ref={scrollArea} data-more-below={moreBelow} data-more-above={moreAbove} onScroll={(event) => trackEdges(event.currentTarget)}>
        <Stack spacing={2}>
          <ConsentDialogHeading id={`${id}-title`} component="h2" variant="h6">{config.heading}</ConsentDialogHeading>
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
            <AccountSessionDisclosure ref={disclosure} aria-expanded={expanded} aria-controls={`${id}-fields`} onClick={toggleFields}>
              <Typography component="span" variant="body2">{t.metaCapi.fieldsToggle}</Typography>
              <ChevronDownIcon />
            </AccountSessionDisclosure>
            <Box component="ul" id={`${id}-fields`} hidden={!expanded} sx={{ pl: 3, mb: 0, mt: 1, '& > li + li': { mt: 1 } }}>
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
    </ConsentDialog>
  );
};
