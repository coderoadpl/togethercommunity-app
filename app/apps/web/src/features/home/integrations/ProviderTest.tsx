import { Alert, Box, Button, Typography } from '@mui/material';
import { useMutation } from '@tanstack/react-query';

import type { IntegrationTestInput } from '#core/contract/index.js';
import type { ProviderDiagnostic, ProviderDiagnosticCode } from '#core/domain/index.js';

import { actions } from '../../../api.js';
import { localizePanelError, useLanguage, useTranslations } from '../../../i18n/index.js';

export const ProviderTest = ({
  provider,
  ready,
  hint,
  showHint = true,
}: {
  provider: IntegrationTestInput['provider'];
  ready: boolean;
  hint?: string;
  showHint?: boolean;
}) => {
  const t = useTranslations();
  const { language } = useLanguage();
  const test = useMutation(actions.testIntegration);
  const messageByCode: Record<ProviderDiagnosticCode, string> = {
    'storage.available': t.integrations.storageAvailable,
    'email.available': t.integrations.emailAvailable,
    'payment.available': t.integrations.paymentAvailable,
  };
  const successMessage = (diagnostic: ProviderDiagnostic): string =>
    diagnostic.details === undefined
      ? messageByCode[diagnostic.code]
      : `${messageByCode[diagnostic.code]} ${t.integrations.emailTestedVia({ transport: diagnostic.details.transport })}`;
  return (
    <Box sx={{ display: 'grid', gap: '0.5rem' }}>
      <Button
        type="button"
        variant="outlined"
        data-testid={`${provider}-test-connection`}
        disabled={test.isPending || !ready}
        onClick={() => test.mutate({ provider, language })}
        sx={{ justifySelf: 'start' }}
      >
        {test.isPending ? t.integrations.testing : t.integrations.testConnection}
      </Button>
      {showHint && !ready && hint !== undefined ? (
        <Typography variant="caption" component="p" data-testid={`${provider}-test-hint`}>
          {hint}
        </Typography>
      ) : null}
      {test.isSuccess ? (
        <Typography variant="caption" component="p" data-testid={`${provider}-test-result`}>
          {successMessage(test.data.diagnostic)}
        </Typography>
      ) : null}
      {test.isError ? (
        <Alert severity="error" data-testid={`${provider}-test-error`}>{localizePanelError(test.error, t)}</Alert>
      ) : null}
    </Box>
  );
};
