import { useState, type FormEvent } from 'react';
import {
  Alert,
  Box,
  Button,
  Chip,
  FormControl,
  FormLabel,
  OutlinedInput,
  Paper,
  Stack,
  Typography,
} from '@mui/material';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';

import { ApiError } from '@core/client/index.js';
import type { TenantSecretKey } from '@core/domain/index.js';

import { actions } from '../../../api.js';
import { Eyebrow } from '../../../theme.js';
import { useTranslations } from '../../../i18n/index.js';

const mutationErrorMessage = (error: Error): string =>
  error instanceof ApiError ? error.appError.message : error.message;

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
      {setSecret.isError ? <Alert>{mutationErrorMessage(setSecret.error)}</Alert> : null}
      {removeSecret.isError ? <Alert>{mutationErrorMessage(removeSecret.error)}</Alert> : null}
    </Box>
  );
};

const previewFor = (
  secrets: { key: TenantSecretKey; maskedPreview: string }[] | undefined,
  key: TenantSecretKey,
): string | null => secrets?.find((secret) => secret.key === key)?.maskedPreview ?? null;

export const IntegrationsPanel = ({ tenantId }: { tenantId: string }) => {
  const t = useTranslations();
  const secrets = useQuery(actions.tenantSecrets);
  const testConnection = useMutation(actions.testStripeConnection);

  const webhookUrl = `${window.location.origin}/api/webhooks/stripe/${tenantId}`;

  return (
    <Paper elevation={1} sx={{ p: '1.5rem' }}>
      <Stack useFlexGap spacing="1.5rem">
        <Box sx={{ display: 'grid', gap: '0.4rem' }}>
          <Typography variant="h2" component="h2">
            {t.integrations.heading}
          </Typography>
          <Typography variant="body2">{t.integrations.intro}</Typography>
        </Box>

        <Box sx={{ display: 'grid', gap: '1rem' }}>
          <Eyebrow variant="overline" component="h3">
            {t.integrations.stripeHeading}
          </Eyebrow>
          <Typography variant="body2">{t.integrations.stripeDescription}</Typography>

          {secrets.isPending ? (
            <Typography variant="body2" component="p">
              {t.integrations.loading}
            </Typography>
          ) : secrets.isError ? (
            <Alert>
              {secrets.error instanceof ApiError ? secrets.error.appError.message : secrets.error.message}
            </Alert>
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
              disabled={testConnection.isPending}
              onClick={() => testConnection.mutate(undefined)}
              sx={{ justifySelf: 'start' }}
            >
              {testConnection.isPending ? t.integrations.testing : t.integrations.testConnection}
            </Button>
            {testConnection.isSuccess ? (
              <Typography variant="caption" component="p" data-testid="stripe-test-result">
                {testConnection.data.diagnostic}
              </Typography>
            ) : null}
            {testConnection.isError ? (
              <Alert data-testid="stripe-test-error">
                {mutationErrorMessage(testConnection.error)}
              </Alert>
            ) : null}
          </Box>
        </Box>
      </Stack>
    </Paper>
  );
};
