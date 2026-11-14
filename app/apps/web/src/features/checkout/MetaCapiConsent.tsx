import { useState } from 'react';
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
  const decision = useMutation({
    ...actions.metaCapi.decide,
    onSuccess: setSavedState,
    onError: () => dismissal.clear(),
  });
  const state = savedState ?? config;
  const dismiss = () => {
    setDismissed(true);
    dismissal.save();
  };
  return (
    <>
      <MetaCapiConsentDialog
        config={config}
        open={config.enabled && state.consent === 'undecided' && state.withdrawnAt === null && !dismissed}
        onDismiss={dismiss}
        onDecision={(choice) => {
          dismiss();
          const fbp = browserIdentifier();
          decision.mutate({ sessionId, decision: choice, locale: config.locale, textVersion: config.textVersion, ...(fbp === undefined ? {} : { fbp }) });
        }}
      />
      {decision.isError ? <Alert severity="error">{t.metaCapi.decisionError}</Alert> : null}
      {state.consent === 'granted' || state.withdrawnAt !== null ? (
        <Stack direction="row" spacing={1} useFlexGap sx={{ flexWrap: 'wrap', alignItems: 'center' }}>
          <Typography variant="body2" role="status">{state.withdrawnAt !== null ? t.metaCapi.withdrawn : t.metaCapi.granted}</Typography>
          {state.withdrawnAt === null ? (
            <Button variant="text" disabled={decision.isPending} onClick={() => decision.mutate({ sessionId, decision: 'withdrawn' })}>{t.metaCapi.withdraw}</Button>
          ) : null}
        </Stack>
      ) : null}
    </>
  );
};
