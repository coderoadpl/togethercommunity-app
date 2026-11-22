import { useEffect, useRef, useState } from 'react';
import { Alert, Button, Stack, Typography } from '@mui/material';
import { useMutation } from '@tanstack/react-query';
import type { MetaCapiConfig, MetaCapiState } from '#core/domain/index.js';
import { actions } from '../../api.js';
import { useTranslations } from '../../i18n/index.js';
import { sessionFlag } from '../../theme-mode.js';
import { MetaCapiConsentDialog } from './MetaCapiConsentDialog.js';
const browserIdentifier = (): string | undefined => {
  const value = document.cookie.split(';').map((part) => part.trim()).find((part) => part.startsWith('_fbp='))?.slice(5);
  if (!value) return undefined;
  try { return decodeURIComponent(value); } catch { return undefined; }
};

export const MetaCapiConsent = ({ config, sessionId }: { config: MetaCapiConfig; sessionId: string }) => {
  const t = useTranslations();
  const dismissal = sessionFlag(`meta-capi-dismissed:${sessionId}`);
  const [dismissed, setDismissed] = useState(() => dismissal.load());
  const [savedState, setSavedState] = useState<MetaCapiState | null>(null);
  const statusText = useRef<HTMLParagraphElement>(null);
  const focusStatus = useRef(false);
  const choice = useMutation({
    ...actions.metaCapi.decide,
    onSuccess: setSavedState,
    onError: () => dismissal.clear(),
  });
  const withdrawal = useMutation({
    ...actions.metaCapi.decide,
    onSuccess: (saved) => {
      focusStatus.current = true;
      setSavedState(saved);
    },
  });
  const state = savedState ?? config;
  const withdrawn = state.withdrawnAt !== null;
  useEffect(() => {
    if (!withdrawn || !focusStatus.current) return;
    focusStatus.current = false;
    statusText.current?.focus();
  }, [withdrawn]);
  const dismiss = () => {
    setDismissed(true);
    dismissal.save();
  };
  const reopen = () => {
    choice.reset();
    dismissal.clear();
    setDismissed(false);
  };
  const undecided = state.consent === 'undecided' && !withdrawn;
  const status = choice.isPending ? { text: t.metaCapi.saving }
    : withdrawn ? { text: t.metaCapi.withdrawn }
      : state.consent === 'granted' ? { text: t.metaCapi.granted, action: { label: t.metaCapi.withdraw, pending: withdrawal.isPending, run: () => withdrawal.mutate({ sessionId, decision: 'withdrawn' }) } }
        : state.consent === 'denied' ? { text: t.metaCapi.denied }
          : config.enabled && dismissed && !choice.isError ? { text: t.metaCapi.undecided, action: { label: t.metaCapi.decide, pending: false, run: reopen } }
            : null;
  return (
    <>
      <MetaCapiConsentDialog
        config={config}
        open={config.enabled && undecided && !dismissed}
        onDismiss={dismiss}
        onDecision={(decision) => {
          dismiss();
          const fbp = browserIdentifier();
          choice.mutate({ sessionId, decision, locale: config.locale, textVersion: config.textVersion, ...(fbp === undefined ? {} : { fbp }) });
        }}
      />
      {choice.isError ? (
        <Alert severity="error" action={<Button color="inherit" size="small" onClick={reopen}>{t.common.retry}</Button>}>{t.metaCapi.decisionError}</Alert>
      ) : null}
      {status === null ? null : (
        <Stack spacing={0.5} sx={{ alignItems: 'flex-start' }} data-testid="meta-capi-status">
          <Typography ref={statusText} variant="body1" role="status" tabIndex={-1}>{status.text}</Typography>
          {status.action ? (
            <Button variant="text" disabled={status.action.pending} onClick={status.action.run} sx={{ px: 0, minWidth: 0, minHeight: 44 }}>{status.action.label}</Button>
          ) : null}
        </Stack>
      )}
      {withdrawal.isError && !withdrawn ? <Alert severity="error">{t.metaCapi.withdrawError}</Alert> : null}
    </>
  );
};
