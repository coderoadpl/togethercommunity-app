import { useState, type FormEvent } from 'react';
import {
  Alert,
  Box,
  Button,
  Chip,
  FormControl,
  FormLabel,
  OutlinedInput,
  Stack,
  Typography,
} from '@mui/material';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';

import type { IntegrationTestInput } from '#core/contract/index.js';
import type { ProviderDiagnosticCode, StripeMode, TenantSecretKey } from '#core/domain/index.js';

import { actions } from '../../../api.js';
import { ConfirmDialog, PanelPage, SectionCard, StatusView } from '../../../components/layout/index.js';
import { localizeError, useTranslations } from '../../../i18n/index.js';
import { SecretField } from './SecretField.js';
import { StorageWizard } from './StorageWizard.js';

const previewFor = (
  secrets: { key: TenantSecretKey; maskedPreview: string }[] | undefined,
  key: TenantSecretKey,
): string | null => secrets?.find((secret) => secret.key === key)?.maskedPreview ?? null;

const StripeConfiguration = ({
  maskedPreview,
  webhookConfigured,
  mode,
}: {
  maskedPreview: string | null;
  webhookConfigured: boolean;
  mode: StripeMode | null;
}) => {
  const t = useTranslations();
  const queryClient = useQueryClient();
  const [restrictedKey, setRestrictedKey] = useState('');
  const [confirmingRemove, setConfirmingRemove] = useState(false);
  const configure = useMutation({
    ...actions.configureStripe,
    onSuccess: async () => {
      setRestrictedKey('');
      await queryClient.invalidateQueries(actions.tenantSecretsInvalidates());
    },
  });
  const remove = useMutation({
    ...actions.deleteStripeSecrets,
    onSuccess: () => setConfirmingRemove(false),
    onSettled: async () => {
      await queryClient.invalidateQueries(actions.tenantSecretsInvalidates());
    },
  });
  const submit = (event: FormEvent) => {
    event.preventDefault();
    configure.mutate({ restrictedKey });
  };

  return (
    <Box component="form" onSubmit={submit} sx={{ display: 'grid', gap: '0.6rem' }}>
      <Box sx={{ display: 'flex', alignItems: 'center', gap: '0.6rem', flexWrap: 'wrap' }}>
        <FormLabel htmlFor="stripe-restricted-key">{t.integrations.restrictedKeyLabel}</FormLabel>
        <Chip
          size="small"
          variant="outlined"
          data-testid="stripe-key-status"
          label={maskedPreview === null
            ? t.integrations.notConfigured
            : `${t.integrations.configured} · ${maskedPreview}`}
        />
        {mode === null ? null : (
          <Chip
            size="small"
            color={mode === 'live' ? 'success' : 'info'}
            data-testid="stripe-mode-badge"
            label={mode === 'live' ? t.integrations.stripeLiveMode : t.integrations.stripeTestMode}
          />
        )}
      </Box>
      <OutlinedInput
        id="stripe-restricted-key"
        type="password"
        value={restrictedKey}
        placeholder={t.integrations.valuePlaceholder}
        onChange={(event) => setRestrictedKey(event.target.value)}
        inputProps={{ 'data-testid': 'stripe-restricted-key' }}
        autoComplete="off"
      />
      <Typography variant="caption" component="p">
        {t.integrations.stripeRestrictedPermissions}
      </Typography>
      <Box>
        <Button
          type="submit"
          variant="outlined"
          data-testid="stripe-configure"
          disabled={configure.isPending || restrictedKey.trim() === ''}
        >
          {configure.isPending ? t.integrations.stripeConfiguring : t.integrations.stripeConfigure}
        </Button>
        {maskedPreview === null && !webhookConfigured ? null : (
          <Button
            type="button"
            color="error"
            data-testid="stripe-remove"
            disabled={remove.isPending}
            onClick={() => setConfirmingRemove(true)}
          >
            {remove.isPending ? t.integrations.removing : t.integrations.remove}
          </Button>
        )}
      </Box>
      {configure.isSuccess ? (
        <Typography variant="caption" component="p" data-testid="stripe-configured">
          {t.integrations.stripeConfigured}
        </Typography>
      ) : null}
      {configure.isError ? <Alert severity="error">{localizeError(configure.error, t)}</Alert> : null}
      {remove.isError ? <Alert severity="error">{localizeError(remove.error, t)}</Alert> : null}
      <ConfirmDialog
        open={confirmingRemove}
        title={t.integrations.stripeDisconnectConfirmTitle}
        body={(
          <>
            <Typography>{t.integrations.stripeDisconnectConfirmBody}</Typography>
            {remove.isError ? <Alert severity="error">{localizeError(remove.error, t)}</Alert> : null}
          </>
        )}
        confirmLabel={remove.isPending ? t.integrations.removing : t.integrations.remove}
        cancelLabel={t.common.cancel}
        pending={remove.isPending}
        onClose={() => setConfirmingRemove(false)}
        onConfirm={() => remove.mutate(undefined)}
        confirmTestId="stripe-remove-confirm"
      />
    </Box>
  );
};

const BunnyLibraryIdField = () => {
  const t = useTranslations();
  const queryClient = useQueryClient();
  const settings = useQuery(actions.tenantSettings);
  const [draft, setDraft] = useState<string | null>(null);

  const value = draft ?? settings.data?.settings.bunnyStreamLibraryId ?? '';

  const updateSettings = useMutation({
    ...actions.updateTenantSettings,
    onSuccess: async () => {
      setDraft(null);
      await queryClient.invalidateQueries(actions.tenantSettingsInvalidates());
    },
  });

  const submit = (event: FormEvent) => {
    event.preventDefault();
    updateSettings.mutate({ bunnyStreamLibraryId: value.trim() === '' ? null : value.trim() });
  };

  return (
    <Box component="form" onSubmit={submit} sx={{ display: 'grid', gap: '0.6rem' }}>
      <FormControl fullWidth>
        <FormLabel htmlFor="bunny-library-id">{t.integrations.bunnyLibraryIdLabel}</FormLabel>
        <OutlinedInput
          id="bunny-library-id"
          value={value}
          disabled={settings.isPending}
          onChange={(event) => setDraft(event.target.value)}
          inputProps={{ 'data-testid': 'bunny-library-id' }}
        />
        <Typography variant="caption" component="p" sx={{ mt: '0.35rem' }}>
          {t.integrations.bunnyLibraryIdHelper}
        </Typography>
      </FormControl>
      <Box>
        <Button
          type="submit"
          variant="outlined"
          data-testid="bunny-library-id-save"
          disabled={updateSettings.isPending || settings.isPending}
        >
          {updateSettings.isPending ? t.integrations.saving : t.integrations.save}
        </Button>
      </Box>
      {updateSettings.isSuccess ? (
        <Typography variant="caption" component="p" data-testid="bunny-library-id-saved">
          {t.integrations.saved}
        </Typography>
      ) : null}
      {updateSettings.isError ? <Alert severity="error">{localizeError(updateSettings.error, t)}</Alert> : null}
      {settings.isError ? <StatusView surface={false} state={{ kind: 'error', message: localizeError(settings.error, t), retry: { label: t.common.retry, onRetry: () => void settings.refetch() } }} /> : null}
    </Box>
  );
};

const BunnyCdnHostnameField = () => {
  const t = useTranslations();
  const queryClient = useQueryClient();
  const settings = useQuery(actions.tenantSettings);
  const [draft, setDraft] = useState<string | null>(null);

  const value = draft ?? settings.data?.settings.bunnyStreamCdnHostname ?? '';

  const updateSettings = useMutation({
    ...actions.updateTenantSettings,
    onSuccess: async () => {
      setDraft(null);
      await queryClient.invalidateQueries(actions.tenantSettingsInvalidates());
    },
  });

  const submit = (event: FormEvent) => {
    event.preventDefault();
    updateSettings.mutate({ bunnyStreamCdnHostname: value.trim() === '' ? null : value.trim() });
  };

  return (
    <Box component="form" onSubmit={submit} sx={{ display: 'grid', gap: '0.6rem' }}>
      <FormControl fullWidth>
        <FormLabel htmlFor="bunny-cdn-hostname">{t.integrations.bunnyCdnHostnameLabel}</FormLabel>
        <OutlinedInput
          id="bunny-cdn-hostname"
          value={value}
          placeholder="vz-xxxxxxx-xxx.b-cdn.net"
          disabled={settings.isPending}
          onChange={(event) => setDraft(event.target.value)}
          inputProps={{ 'data-testid': 'bunny-cdn-hostname' }}
        />
        <Typography variant="caption" component="p" sx={{ mt: '0.35rem' }}>
          {t.integrations.bunnyCdnHostnameHelper}
        </Typography>
      </FormControl>
      <Box>
        <Button
          type="submit"
          variant="outlined"
          data-testid="bunny-cdn-hostname-save"
          disabled={updateSettings.isPending || settings.isPending}
        >
          {updateSettings.isPending ? t.integrations.saving : t.integrations.save}
        </Button>
      </Box>
      {updateSettings.isSuccess ? (
        <Typography variant="caption" component="p" data-testid="bunny-cdn-hostname-saved">
          {t.integrations.saved}
        </Typography>
      ) : null}
      {updateSettings.isError ? <Alert severity="error">{localizeError(updateSettings.error, t)}</Alert> : null}
      {settings.isError ? <StatusView surface={false} state={{ kind: 'error', message: localizeError(settings.error, t), retry: { label: t.common.retry, onRetry: () => void settings.refetch() } }} /> : null}
    </Box>
  );
};

const BunnyTestConnection = ({ ready }: { ready: boolean }) => {
  const t = useTranslations();
  const testConnection = useMutation(actions.testBunnyConnection);
  return (
    <Box sx={{ display: 'grid', gap: '0.5rem' }}>
      <Button
        type="button"
        variant="contained"
        data-testid="bunny-test-connection"
        disabled={testConnection.isPending || !ready}
        onClick={() => testConnection.mutate(undefined)}
        sx={{ justifySelf: 'start' }}
      >
        {testConnection.isPending ? t.integrations.testing : t.integrations.testConnection}
      </Button>
      {!ready ? (
        <Typography variant="caption" component="p" data-testid="bunny-test-hint">
          {t.integrations.bunnySaveFirst}
        </Typography>
      ) : null}
      {testConnection.isSuccess ? (
        <Typography variant="caption" component="p" data-testid="bunny-test-result">
          {testConnection.data.diagnostic}
        </Typography>
      ) : null}
      {testConnection.isError ? (
        <Alert severity="error" data-testid="bunny-test-error">{localizeError(testConnection.error, t)}</Alert>
      ) : null}
    </Box>
  );
};

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
        <Alert severity="error" data-testid="ifirma-test-error">{localizeError(testConnection.error, t)}</Alert>
      ) : null}
    </Box>
  );
};

const ProviderTest = ({
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
  const test = useMutation(actions.testIntegration);
  const messageByCode: Record<ProviderDiagnosticCode, string> = {
    'storage.available': t.integrations.storageAvailable,
    'email.available': t.integrations.emailAvailable,
    'payment.available': t.integrations.paymentAvailable,
  };
  return (
    <Box sx={{ display: 'grid', gap: '0.5rem' }}>
      <Button
        type="button"
        variant="contained"
        data-testid={`${provider}-test-connection`}
        disabled={test.isPending || !ready}
        onClick={() => test.mutate({ provider })}
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
          {messageByCode[test.data.diagnostic.code]}
        </Typography>
      ) : null}
      {test.isError ? (
        <Alert severity="error" data-testid={`${provider}-test-error`}>{localizeError(test.error, t)}</Alert>
      ) : null}
    </Box>
  );
};

export const IntegrationsPanel = () => {
  const t = useTranslations();
  const secrets = useQuery(actions.tenantSecrets);
  const settings = useQuery(actions.tenantSettings);

  const storedSecrets = secrets.data?.secrets;
  const stripeMode = secrets.data?.stripeMode ?? null;
  const stripeReady =
    storedSecrets !== undefined &&
    previewFor(storedSecrets, 'stripe.restrictedKey') !== null &&
    previewFor(storedSecrets, 'stripe.webhookSecret') !== null;
  const ifirmaReady =
    storedSecrets !== undefined &&
    previewFor(storedSecrets, 'ifirma.invoiceApiKey') !== null &&
    previewFor(storedSecrets, 'ifirma.username') !== null;
  const ksefReady =
    previewFor(storedSecrets, 'ksef.token') !== null
    && previewFor(storedSecrets, 'ksef.contextNip') !== null;
  const bunnyReady =
    storedSecrets !== undefined &&
    previewFor(storedSecrets, 'bunny.apiKey') !== null &&
    (settings.data?.settings.bunnyStreamLibraryId ?? null) !== null;
  const storageReady =
    storedSecrets !== undefined &&
    previewFor(storedSecrets, 's3.configuration') !== null;

  return (
    <PanelPage title={t.integrations.heading} description={t.integrations.intro}>
        {settings.isError ? <StatusView surface={false} state={{ kind: 'error', message: localizeError(settings.error, t), retry: { label: t.common.retry, onRetry: () => void settings.refetch() } }} /> : null}
        <SectionCard title={t.integrations.stripeHeading} description={t.integrations.stripeDescription}>

          {secrets.isPending ? (
            <StatusView state={{ kind: 'loading', label: t.integrations.loading }} />
          ) : secrets.isError ? (
            <StatusView state={{ kind: 'error', message: localizeError(secrets.error, t), retry: { label: t.common.retry, onRetry: () => void secrets.refetch() } }} />
          ) : (
            <StripeConfiguration
              maskedPreview={previewFor(secrets.data.secrets, 'stripe.restrictedKey')}
              webhookConfigured={previewFor(secrets.data.secrets, 'stripe.webhookSecret') !== null}
              mode={stripeMode}
            />
          )}

          <FormControl fullWidth>
            <FormLabel htmlFor="stripe-webhook-url">{t.integrations.webhookUrlLabel}</FormLabel>
            <OutlinedInput
              id="stripe-webhook-url"
              readOnly
              value={secrets.data?.stripeWebhookUrl ?? ''}
              inputProps={{ 'data-testid': 'stripe-webhook-url' }}
            />
            <Typography variant="caption" component="p" sx={{ mt: '0.35rem' }}>
              {stripeReady ? t.integrations.webhookActiveHint : t.integrations.webhookUrlHint}
            </Typography>
          </FormControl>

          <ProviderTest
            provider="payment"
            ready={stripeReady}
            hint={t.integrations.saveKeysFirst}
            showHint={!secrets.isPending && !secrets.isError}
          />
        </SectionCard>

        <SectionCard title={t.integrations.emailHeading} description={t.integrations.emailDescription}>
          <ProviderTest provider="email" ready />
        </SectionCard>

        <SectionCard
          title={t.integrations.ifirmaHeading}
          description={t.integrations.ifirmaDescription}
        >
          {secrets.isPending ? (
            <StatusView state={{ kind: 'loading', label: t.integrations.loading }} />
          ) : secrets.isError ? (
            <StatusView state={{ kind: 'error', message: localizeError(secrets.error, t), retry: { label: t.common.retry, onRetry: () => void secrets.refetch() } }} />
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
            <StatusView state={{ kind: 'error', message: localizeError(secrets.error, t), retry: { label: t.common.retry, onRetry: () => void secrets.refetch() } }} />
          ) : (
            <Stack useFlexGap spacing="1.25rem">
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
        </SectionCard>

        <SectionCard title={t.integrations.bunnyHeading} description={t.integrations.bunnyDescription}>

          {secrets.isPending ? (
            <StatusView state={{ kind: 'loading', label: t.integrations.loading }} />
          ) : secrets.isError ? (
            <StatusView state={{ kind: 'error', message: localizeError(secrets.error, t), retry: { label: t.common.retry, onRetry: () => void secrets.refetch() } }} />
          ) : (
            <Stack useFlexGap spacing="1.25rem">
              <SecretField
                secretKey="bunny.apiKey"
                label={t.integrations.bunnyApiKeyLabel}
                maskedPreview={previewFor(secrets.data.secrets, 'bunny.apiKey')}
              />
              <SecretField
                secretKey="bunny.securityKey"
                label={t.integrations.bunnySecurityKeyLabel}
                maskedPreview={previewFor(secrets.data.secrets, 'bunny.securityKey')}
              />
              <Typography variant="caption" component="p">
                {t.integrations.bunnySecurityHint}
              </Typography>
              <BunnyLibraryIdField />
              <BunnyCdnHostnameField />
            </Stack>
          )}

          <BunnyTestConnection ready={bunnyReady} />
        </SectionCard>

        <SectionCard title={t.integrations.s3Heading} description={t.integrations.s3Description}>
          {secrets.isPending ? (
            <StatusView state={{ kind: 'loading', label: t.integrations.loading }} />
          ) : secrets.isError ? (
            <StatusView state={{ kind: 'error', message: localizeError(secrets.error, t), retry: { label: t.common.retry, onRetry: () => void secrets.refetch() } }} />
          ) : (
            <StorageWizard configured={storageReady} />
          )}
          <ProviderTest
            provider="storage"
            ready={storageReady}
            hint={t.integrations.s3SaveFirst}
            showHint={!secrets.isPending && !secrets.isError}
          />
        </SectionCard>
    </PanelPage>
  );
};
