import { useState, type FormEvent } from 'react';
import {
  Alert,
  Box,
  Button,
  FormControl,
  FormLabel,
  OutlinedInput,
  Stack,
  Typography,
} from '@mui/material';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';

import { actions } from '../../../api.js';
import { SectionCard, StatusView } from '../../../components/layout/index.js';
import { localizeError, useTranslations } from '../../../i18n/index.js';
import { SecretField } from './SecretField.js';
import { previewFor } from './secret-preview.js';

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

export const VideoTab = () => {
  const t = useTranslations();
  const secrets = useQuery(actions.tenantSecrets);
  const settings = useQuery(actions.tenantSettings);

  const bunnyReady =
    secrets.data?.secrets !== undefined &&
    previewFor(secrets.data.secrets, 'bunny.apiKey') !== null &&
    (settings.data?.settings.bunnyStreamLibraryId ?? null) !== null;

  return (
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
  );
};
