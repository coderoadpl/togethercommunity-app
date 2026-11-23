import { useEffect, useRef, useState } from 'react';
import { Alert, Button, Stack, Typography } from '@mui/material';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { ApiError } from '#core/client/index.js';
import type { MetaCapiConfig, MetaCapiState } from '#core/domain/index.js';
import { actions } from '../../api.js';
import { localizeError, useTranslations } from '../../i18n/index.js';
import { fieldErrorEntries } from '../../lib/validation-details.js';
import { sessionFlag } from '../../theme-mode.js';
import { MetaCapiConsentDialog } from './MetaCapiConsentDialog.js';
const browserIdentifier = (): string | undefined => {
  const value = document.cookie.split(';').map((part) => part.trim()).find((part) => part.startsWith('_fbp='))?.slice(5);
  if (!value) return undefined;
  try { return decodeURIComponent(value); } catch { return undefined; }
};
const emptyStatus = { position: 'absolute', width: 1, height: 1, overflow: 'hidden', clip: 'rect(0 0 0 0)' } as const;
const staleText = (error: unknown): boolean => error instanceof ApiError && error.appError.code === 'validation'
  && fieldErrorEntries(error.appError.details).some(([field]) => field === 'textVersion');

export const MetaCapiConsent = ({ config: initialConfig, sessionId }: { config: MetaCapiConfig; sessionId: string }) => {
  const t = useTranslations();
  const queryClient = useQueryClient();
  const [refreshedConfig, setRefreshedConfig] = useState<MetaCapiConfig | null>(null);
  const config = refreshedConfig ?? initialConfig;
  const dismissal = sessionFlag(`meta-capi-dismissed:${sessionId}`);
  const [dismissed, setDismissed] = useState(() => dismissal.load());
  const [savedState, setSavedState] = useState<MetaCapiState | null>(null);
  const statusText = useRef<HTMLParagraphElement>(null);
  const errorAlert = useRef<HTMLDivElement>(null);
  const [focusRequest, setFocusRequest] = useState<{ target: 'status' | 'error'; seq: number } | null>(null);
  const requestFocus = (target: 'status' | 'error') => setFocusRequest((previous) => ({ target, seq: (previous?.seq ?? 0) + 1 }));
  useEffect(() => {
    if (focusRequest === null) return;
    (focusRequest.target === 'error' ? errorAlert : statusText).current?.focus();
  }, [focusRequest]);
  const [reopened, setReopened] = useState(false);
  const choice = useMutation({
    ...actions.metaCapi.decide,
    onSuccess: setSavedState,
    onError: () => {
      dismissal.clear();
      if (document.activeElement === statusText.current) requestFocus('error');
    },
  });
  const withdrawal = useMutation({
    ...actions.metaCapi.decide,
    onSuccess: (saved) => {
      requestFocus('status');
      setSavedState(saved);
    },
  });
  const state = savedState ?? config;
  const withdrawn = state.withdrawnAt !== null;
  const dismiss = () => {
    setDismissed(true);
    dismissal.save();
  };
  const reopen = (next: MetaCapiConfig) => {
    choice.reset();
    setRefreshError(null);
    dismissal.clear();
    setDismissed(false);
    if (next.enabled && next.consent === 'undecided' && next.withdrawnAt === null) setReopened(true);
    else requestFocus('status');
  };
  const closed = () => {
    if (!reopened) return;
    setReopened(false);
    requestFocus(choice.isError ? 'error' : 'status');
  };
  const [refreshing, setRefreshing] = useState(false);
  const [refreshError, setRefreshError] = useState<unknown>(null);
  const retry = async () => {
    setRefreshing(true);
    setRefreshError(null);
    const current = await queryClient.fetchQuery({ ...actions.publicCheckoutSessionStatus(sessionId, config.locale), staleTime: 0 })
      .then((status) => status.metaCapi, (error: unknown) => {
        setRefreshError(error);
        return undefined;
      });
    if (current) setRefreshedConfig(current);
    setRefreshing(false);
    if (current) reopen(current);
    else if (!staleText(choice.error)) reopen(config);
  };
  const undecided = state.consent === 'undecided' && !withdrawn;
  const status = choice.isPending ? { text: t.metaCapi.saving }
    : withdrawn ? { text: t.metaCapi.withdrawn }
      : state.consent === 'granted' ? { text: t.metaCapi.granted, action: { label: withdrawal.isPending ? t.metaCapi.withdrawing : t.metaCapi.withdraw, pending: withdrawal.isPending, run: () => withdrawal.mutate({ sessionId, decision: 'withdrawn' }) } }
        : state.consent === 'denied' ? { text: t.metaCapi.denied }
          : config.enabled && dismissed && !choice.isError ? { text: t.metaCapi.undecided, action: { label: t.metaCapi.decide, pending: false, run: () => reopen(config) } }
            : null;
  return (
    <>
      <MetaCapiConsentDialog
        config={config}
        open={config.enabled && undecided && !dismissed}
        onDismiss={dismiss}
        onExited={closed}
        disableRestoreFocus={reopened}
        onDecision={(decision) => {
          dismiss();
          const fbp = browserIdentifier();
          choice.mutate({ sessionId, decision, locale: config.locale, textVersion: config.textVersion, ...(fbp === undefined ? {} : { fbp }) });
        }}
      />
      {choice.isError ? (
        <Alert ref={errorAlert} tabIndex={-1} severity="error" action={<Button color="inherit" size="small" disabled={refreshing} onClick={() => void retry()}>{t.common.retry}</Button>}>
          {staleText(choice.error) ? [t.metaCapi.decisionError, t.metaCapi.textChanged, refreshError === null ? null : localizeError(refreshError, t)].filter(Boolean).join(' ') : t.metaCapi.decisionError}
        </Alert>
      ) : null}
      <Stack spacing={0.5} sx={status === null ? emptyStatus : { alignItems: 'flex-start' }} data-testid="meta-capi-status">
        <Typography ref={statusText} variant="body1" role="status" tabIndex={-1}>{status?.text ?? ''}</Typography>
        {status?.action ? (
          <Button variant="outlined" size="small" disabled={status.action.pending} onClick={status.action.run} sx={{ minHeight: 44 }}>{status.action.label}</Button>
        ) : null}
      </Stack>
      {withdrawal.isError && !withdrawn ? <Alert severity="error">{t.metaCapi.withdrawError}</Alert> : null}
    </>
  );
};
