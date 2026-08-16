import { useState, type FormEvent } from 'react';
import {
  Alert,
  Box,
  Button,
  Chip,
  FormControl,
  FormLabel,
  OutlinedInput,
  Typography,
} from '@mui/material';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';

import type { StripeMode } from '#core/domain/index.js';

import { actions } from '../../../api.js';
import { ConfirmDialog, SectionCard, StatusView } from '../../../components/layout/index.js';
import { localizeError, useTranslations } from '../../../i18n/index.js';
import { ProviderTest } from './ProviderTest.js';
import { previewFor } from './secret-preview.js';

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

export const StripeTab = () => {
  const t = useTranslations();
  const secrets = useQuery(actions.tenantSecrets);

  const storedSecrets = secrets.data?.secrets;
  const stripeMode = secrets.data?.stripeMode ?? null;
  const stripeReady =
    storedSecrets !== undefined &&
    previewFor(storedSecrets, 'stripe.restrictedKey') !== null &&
    previewFor(storedSecrets, 'stripe.webhookSecret') !== null;

  return (
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
  );
};
