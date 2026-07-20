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

import type { TenantSecretKey } from '@core/domain/index.js';

import { actions } from '../../../api.js';
import { PanelPage, SectionCard, StatusView } from '../../../components/layout/index.js';
import { localizeError, useTranslations } from '../../../i18n/index.js';

const SecretField = ({
  secretKey,
  label,
  maskedPreview,
}: {
  secretKey: TenantSecretKey;
  label: string;
  maskedPreview: string | null;
}) => {
  const t = useTranslations();
  const queryClient = useQueryClient();
  const [value, setValue] = useState('');

  const invalidate = async () => {
    await queryClient.invalidateQueries(actions.tenantSecretsInvalidates());
  };

  const setSecret = useMutation({
    ...actions.setTenantSecret,
    onSuccess: async () => {
      setValue('');
      await invalidate();
    },
  });
  const removeSecret = useMutation({ ...actions.deleteTenantSecret, onSuccess: invalidate });

  const submit = (event: FormEvent) => {
    event.preventDefault();
    setSecret.mutate({ key: secretKey, value });
  };

  const inputId = `secret-${secretKey}`;

  return (
    <Box component="form" onSubmit={submit} sx={{ display: 'grid', gap: '0.6rem' }}>
      <Box sx={{ display: 'flex', alignItems: 'center', gap: '0.6rem', flexWrap: 'wrap' }}>
        <FormLabel htmlFor={inputId} sx={{ m: 0 }}>
          {label}
        </FormLabel>
        <Chip
          size="small"
          variant="outlined"
          data-testid={`secret-status-${secretKey}`}
          label={maskedPreview ? `${t.integrations.configured} · ${maskedPreview}` : t.integrations.notConfigured}
        />
      </Box>
      <FormControl fullWidth>
        <OutlinedInput
          id={inputId}
          type="password"
          value={value}
          placeholder={t.integrations.valuePlaceholder}
          onChange={(event) => setValue(event.target.value)}
          inputProps={{ 'data-testid': `secret-input-${secretKey}` }}
          autoComplete="off"
        />
      </FormControl>
      <Box sx={{ display: 'flex', gap: '0.6rem', flexWrap: 'wrap' }}>
        <Button
          type="submit"
          variant="outlined"
          data-testid={`secret-save-${secretKey}`}
          disabled={setSecret.isPending || value.trim().length === 0}
        >
          {setSecret.isPending ? t.integrations.saving : t.integrations.save}
        </Button>
        {maskedPreview ? (
          <Button
            type="button"
            variant="text"
            color="error"
            data-testid={`secret-remove-${secretKey}`}
            disabled={removeSecret.isPending}
            onClick={() => removeSecret.mutate({ key: secretKey })}
          >
            {removeSecret.isPending ? t.integrations.removing : t.integrations.remove}
          </Button>
        ) : null}
      </Box>
      {setSecret.isSuccess ? (
        <Typography variant="caption" component="p" data-testid={`secret-saved-${secretKey}`}>
          {t.integrations.saved}
        </Typography>
      ) : null}
      {setSecret.isError ? <Alert>{localizeError(setSecret.error, t)}</Alert> : null}
      {removeSecret.isError ? <Alert>{localizeError(removeSecret.error, t)}</Alert> : null}
    </Box>
  );
};

const previewFor = (
  secrets: { key: TenantSecretKey; maskedPreview: string }[] | undefined,
  key: TenantSecretKey,
): string | null => secrets?.find((secret) => secret.key === key)?.maskedPreview ?? null;

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
      {updateSettings.isError ? <Alert>{localizeError(updateSettings.error, t)}</Alert> : null}
      {settings.isError ? <Alert>{localizeError(settings.error, t)}</Alert> : null}
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
        <Alert data-testid="bunny-test-error">{localizeError(testConnection.error, t)}</Alert>
      ) : null}
    </Box>
  );
};

export const IntegrationsPanel = ({ tenantId }: { tenantId: string }) => {
  const t = useTranslations();
  const secrets = useQuery(actions.tenantSecrets);
  const settings = useQuery(actions.tenantSettings);
  const testConnection = useMutation(actions.testStripeConnection);

  const webhookUrl = `${window.location.origin}/api/webhooks/stripe/${tenantId}`;
  const storedSecrets = secrets.data?.secrets;
  const stripeReady =
    storedSecrets !== undefined &&
    previewFor(storedSecrets, 'stripe.restrictedKey') !== null &&
    previewFor(storedSecrets, 'stripe.webhookSecret') !== null;
  const bunnyReady =
    storedSecrets !== undefined &&
    previewFor(storedSecrets, 'bunny.apiKey') !== null &&
    (settings.data?.settings.bunnyStreamLibraryId ?? null) !== null;

  return (
    <PanelPage title={t.integrations.heading} description={t.integrations.intro}>
        <SectionCard title={t.integrations.stripeHeading} description={t.integrations.stripeDescription}>

          {secrets.isPending ? (
            <StatusView state={{ kind: 'loading', label: t.integrations.loading }} />
          ) : secrets.isError ? (
            <StatusView state={{ kind: 'error', message: localizeError(secrets.error, t) }} />
          ) : (
            <Stack useFlexGap spacing="1.25rem">
              <SecretField
                secretKey="stripe.restrictedKey"
                label={t.integrations.restrictedKeyLabel}
                maskedPreview={previewFor(secrets.data.secrets, 'stripe.restrictedKey')}
              />
              <SecretField
                secretKey="stripe.webhookSecret"
                label={t.integrations.webhookSecretLabel}
                maskedPreview={previewFor(secrets.data.secrets, 'stripe.webhookSecret')}
              />
            </Stack>
          )}

          <FormControl fullWidth>
            <FormLabel htmlFor="stripe-webhook-url">{t.integrations.webhookUrlLabel}</FormLabel>
            <OutlinedInput
              id="stripe-webhook-url"
              readOnly
              value={webhookUrl}
              inputProps={{ 'data-testid': 'stripe-webhook-url' }}
            />
            <Typography variant="caption" component="p" sx={{ mt: '0.35rem' }}>
              {t.integrations.webhookUrlHint}
            </Typography>
          </FormControl>

          <Box sx={{ display: 'grid', gap: '0.5rem' }}>
            <Button
              type="button"
              variant="contained"
              data-testid="stripe-test-connection"
              disabled={testConnection.isPending || !stripeReady}
              onClick={() => testConnection.mutate(undefined)}
              sx={{ justifySelf: 'start' }}
            >
              {testConnection.isPending ? t.integrations.testing : t.integrations.testConnection}
            </Button>
            {!stripeReady && !secrets.isPending && !secrets.isError ? (
              <Typography variant="caption" component="p" data-testid="stripe-test-hint">
                {t.integrations.saveKeysFirst}
              </Typography>
            ) : null}
            {testConnection.isSuccess ? (
              <Typography variant="caption" component="p" data-testid="stripe-test-result">
                {testConnection.data.diagnostic}
              </Typography>
            ) : null}
            {testConnection.isError ? (
              <Alert data-testid="stripe-test-error">
                {localizeError(testConnection.error, t)}
              </Alert>
            ) : null}
          </Box>
        </SectionCard>

        <SectionCard title={t.integrations.bunnyHeading} description={t.integrations.bunnyDescription}>

          {secrets.isPending ? (
            <StatusView state={{ kind: 'loading', label: t.integrations.loading }} />
          ) : secrets.isError ? (
            <StatusView state={{ kind: 'error', message: localizeError(secrets.error, t) }} />
          ) : (
            <Stack useFlexGap spacing="1.25rem">
              <SecretField
                secretKey="bunny.apiKey"
                label={t.integrations.bunnyApiKeyLabel}
                maskedPreview={previewFor(secrets.data.secrets, 'bunny.apiKey')}
              />
              <BunnyLibraryIdField />
            </Stack>
          )}

          <BunnyTestConnection ready={bunnyReady} />
        </SectionCard>

        <SectionCard title={t.integrations.s3Heading} description={t.integrations.s3Description}>
          {secrets.isPending ? (
            <StatusView state={{ kind: 'loading', label: t.integrations.loading }} />
          ) : secrets.isError ? (
            <StatusView state={{ kind: 'error', message: localizeError(secrets.error, t) }} />
          ) : (
            <Stack useFlexGap spacing="1.25rem">
              <SecretField
                secretKey="s3.accessKeyId"
                label={t.integrations.s3AccessKeyIdLabel}
                maskedPreview={previewFor(secrets.data.secrets, 's3.accessKeyId')}
              />
              <SecretField
                secretKey="s3.secretAccessKey"
                label={t.integrations.s3SecretAccessKeyLabel}
                maskedPreview={previewFor(secrets.data.secrets, 's3.secretAccessKey')}
              />
            </Stack>
          )}
        </SectionCard>
    </PanelPage>
  );
};
