import { Alert, Box, Button, Stack, Typography } from '@mui/material';
import { useMutation, useQuery } from '@tanstack/react-query';

import { actions } from '../../../api.js';
import { SectionCard, StatusView } from '../../../components/layout/index.js';
import { localizePanelError, useTranslations } from '../../../i18n/index.js';
import { SecretField } from './SecretField.js';
import { previewFor } from './secret-preview.js';

const IfirmaTestConnection = ({ ready }: { ready: boolean }) => {
  const t = useTranslations();
  const testConnection = useMutation(actions.testIfirmaConnection);
  return (
    <Box sx={{ display: 'grid', gap: '0.5rem' }}>
      <Button
        type="button"
        variant="contained"
        data-testid="ifirma-test-connection"
        disabled={testConnection.isPending || !ready}
        onClick={() => testConnection.mutate(undefined)}
        sx={{ justifySelf: 'start' }}
      >
        {testConnection.isPending ? t.integrations.testing : t.integrations.testConnection}
      </Button>
      {!ready ? (
        <Typography variant="caption" component="p" data-testid="ifirma-test-hint">
          {t.integrations.ifirmaSaveFirst}
        </Typography>
      ) : null}
      {testConnection.isSuccess ? (
        <Typography variant="caption" component="p" data-testid="ifirma-test-result">
          {testConnection.data.diagnostic}
        </Typography>
      ) : null}
      {testConnection.isError ? (
        <Alert severity="error" data-testid="ifirma-test-error">{localizePanelError(testConnection.error, t)}</Alert>
      ) : null}
    </Box>
  );
};

const KsefTestConnection = ({ ready }: { ready: boolean }) => {
  const t = useTranslations();
  const testConnection = useMutation(actions.testKsefConnection);
  return (
    <Box sx={{ display: 'grid', gap: '0.5rem' }}>
      <Button
        type="button"
        variant="contained"
        data-testid="ksef-test-connection"
        disabled={testConnection.isPending || !ready}
        onClick={() => testConnection.mutate(undefined)}
        sx={{ justifySelf: 'start' }}
      >
        {testConnection.isPending ? t.integrations.testing : t.integrations.testConnection}
      </Button>
      {!ready ? (
        <Typography variant="caption" component="p" data-testid="ksef-test-hint">
          {t.integrations.ksefSaveFirst}
        </Typography>
      ) : null}
      {testConnection.isSuccess ? (
        <Typography variant="caption" component="p" data-testid="ksef-test-result">
          {testConnection.data.diagnostic}
        </Typography>
      ) : null}
      {testConnection.isError ? (
        <Alert severity="error" data-testid="ksef-test-error">{localizePanelError(testConnection.error, t)}</Alert>
      ) : null}
    </Box>
  );
};

export const InvoicingTab = () => {
  const t = useTranslations();
  const secrets = useQuery(actions.tenantSecrets);

  const storedSecrets = secrets.data?.secrets;
  const ifirmaReady =
    storedSecrets !== undefined &&
    previewFor(storedSecrets, 'ifirma.invoiceApiKey') !== null &&
    previewFor(storedSecrets, 'ifirma.username') !== null;
  const ksefReady =
    previewFor(storedSecrets, 'ksef.token') !== null
    && previewFor(storedSecrets, 'ksef.contextNip') !== null;

  return (
    <>
      <SectionCard
        title={t.integrations.ifirmaHeading}
        description={t.integrations.ifirmaDescription}
      >
        {secrets.isPending ? (
          <StatusView state={{ kind: 'loading', label: t.integrations.loading }} />
        ) : secrets.isError ? (
          <StatusView state={{ kind: 'error', message: localizePanelError(secrets.error, t), retry: { label: t.common.retry, onRetry: () => void secrets.refetch() } }} />
        ) : (
          <Stack useFlexGap spacing="1.25rem">
            <SecretField
              secretKey="ifirma.invoiceApiKey"
              label={t.integrations.ifirmaInvoiceApiKeyLabel}
              maskedPreview={previewFor(secrets.data.secrets, 'ifirma.invoiceApiKey')}
            />
            <SecretField
              secretKey="ifirma.username"
              label={t.integrations.ifirmaUsernameLabel}
              maskedPreview={previewFor(secrets.data.secrets, 'ifirma.username')}
            />
          </Stack>
        )}
        <IfirmaTestConnection ready={ifirmaReady} />
      </SectionCard>

      <SectionCard
        title={t.integrations.ksefHeading}
        description={t.integrations.ksefDescription}
      >
        {secrets.isPending ? (
          <StatusView state={{ kind: 'loading', label: t.integrations.loading }} />
        ) : secrets.isError ? (
          <StatusView state={{ kind: 'error', message: localizePanelError(secrets.error, t), retry: { label: t.common.retry, onRetry: () => void secrets.refetch() } }} />
        ) : (
          <Stack useFlexGap spacing="1.25rem">
            <Typography variant="body2">{t.integrations.ksefTokenHelp}</Typography>
            <SecretField
              secretKey="ksef.token"
              label={t.integrations.ksefTokenLabel}
              maskedPreview={previewFor(secrets.data.secrets, 'ksef.token')}
            />
            <SecretField
              secretKey="ksef.contextNip"
              label={t.integrations.ksefContextNipLabel}
              maskedPreview={previewFor(secrets.data.secrets, 'ksef.contextNip')}
            />
            <Typography variant="caption" component="p">
              {ksefReady ? t.integrations.configured : t.integrations.notConfigured}
            </Typography>
          </Stack>
        )}
        <KsefTestConnection ready={ksefReady} />
      </SectionCard>
    </>
  );
};
