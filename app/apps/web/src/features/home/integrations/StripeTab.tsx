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
import { CopyField } from '../../../components/ui/CopyField.js';
import { localizePanelError, useLanguage, useTranslations } from '../../../i18n/index.js';
import { formatDateTime } from '../../../lib/format.js';
import { usePanelContext } from '../panel-context.js';
import { ProviderTest } from './ProviderTest.js';
import { previewFor } from './secret-preview.js';

const StripeConfiguration = ({
  slot = 'live',
  maskedPreview,
  webhookConfigured,
  mode,
}: {
  slot?: StripeMode;
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
  const removalCallbacks = {
    onSuccess: () => setConfirmingRemove(false),
    onSettled: async () => {
      await queryClient.invalidateQueries(actions.tenantSecretsInvalidates());
    },
  };
  const removeLive = useMutation({ ...actions.deleteStripeSecrets, ...removalCallbacks });
  const removeTest = useMutation({ ...actions.removeStripeTestMode, ...removalCallbacks });
  const remove = slot === 'test' ? removeTest : removeLive;
  const submit = (event: FormEvent) => {
    event.preventDefault();
    configure.mutate({ restrictedKey, mode: slot });
  };

  return (
    <Box component="form" onSubmit={submit} sx={{ display: 'grid', gap: '0.6rem' }}>
      <Box sx={{ display: 'flex', alignItems: 'center', gap: '0.6rem', flexWrap: 'wrap' }}>
        <FormLabel htmlFor={`stripe-${slot}-restricted-key`}>{t.integrations.restrictedKeyLabel}</FormLabel>
        <Chip
          size="small"
          variant="outlined"
          data-testid={`stripe-${slot === 'test' ? 'test-' : ''}key-status`}
          label={maskedPreview === null
            ? t.integrations.notConfigured
            : `${t.integrations.configured} · ${maskedPreview}`}
        />
        {mode === null ? null : (
          <Chip
            size="small"
            color={mode === 'live' ? 'success' : 'info'}
            data-testid={`stripe-${slot === 'test' ? 'test-' : ''}mode-badge`}
            label={mode === 'live' ? t.integrations.stripeLiveMode : t.integrations.stripeTestMode}
          />
        )}
      </Box>
      <OutlinedInput
        id={`stripe-${slot}-restricted-key`}
        type="password"
        value={restrictedKey}
        placeholder={t.integrations.valuePlaceholder}
        onChange={(event) => setRestrictedKey(event.target.value)}
        inputProps={{ 'data-testid': `stripe-${slot === 'test' ? 'test-' : ''}restricted-key` }}
        autoComplete="off"
      />
      <Typography variant="caption" component="p">
        {t.integrations.stripeRestrictedPermissions}
      </Typography>
      <Box>
        <Button
          type="submit"
          variant="contained"
          data-testid={`stripe-${slot === 'test' ? 'test-' : ''}configure`}
          disabled={configure.isPending || restrictedKey.trim() === ''}
        >
          {configure.isPending ? t.integrations.stripeConfiguring : t.integrations.stripeConfigure}
        </Button>
        {maskedPreview === null && !webhookConfigured ? null : (
          <Button
            type="button"
            color="error"
            data-testid={`stripe-${slot === 'test' ? 'test-' : ''}remove`}
            disabled={remove.isPending}
            onClick={() => setConfirmingRemove(true)}
          >
            {remove.isPending ? t.integrations.removing : t.integrations.remove}
          </Button>
        )}
      </Box>
      {configure.isSuccess ? (
        <Typography variant="caption" component="p" data-testid={`stripe-${slot === 'test' ? 'test-' : ''}configured`}>
          {t.integrations.stripeConfigured}
        </Typography>
      ) : null}
      {configure.isError ? <Alert severity="error">{localizePanelError(configure.error, t)}</Alert> : null}
      {remove.isError ? <Alert severity="error">{localizePanelError(remove.error, t)}</Alert> : null}
      <ConfirmDialog
        open={confirmingRemove}
        title={t.integrations.stripeDisconnectConfirmTitle}
        body={(
          <>
            <Typography>{t.integrations.stripeDisconnectConfirmBody}</Typography>
            {remove.isError ? <Alert severity="error">{localizePanelError(remove.error, t)}</Alert> : null}
          </>
        )}
        confirmLabel={remove.isPending ? t.integrations.removing : t.integrations.remove}
        cancelLabel={t.common.cancel}
        pending={remove.isPending}
        onClose={() => setConfirmingRemove(false)}
        onConfirm={() => remove.mutate(undefined)}
        confirmTestId={`stripe-${slot === 'test' ? 'test-' : ''}remove-confirm`}
      />
    </Box>
  );
};

const BillingPortalField = ({ canEdit }: { canEdit: boolean }) => {
  const t = useTranslations();
  const queryClient = useQueryClient();
  const settings = useQuery(actions.tenantSettings);
  const [url, setUrl] = useState<string | null>(null);

  const value = url ?? settings.data?.settings.billingPortalUrl ?? '';

  const updateSettings = useMutation({
    ...actions.updateTenantSettings,
    onSuccess: async () => {
      await queryClient.invalidateQueries(actions.tenantSettingsInvalidates());
    },
  });

  const submit = (event: FormEvent) => {
    event.preventDefault();
    updateSettings.mutate({ billingPortalUrl: value.trim() === '' ? null : value.trim() });
  };

  return (
    <SectionCard
      title={t.billing.heading}
      description={t.billing.intro}
      onSubmit={submit}
      actions={canEdit ? (
        <Button
          type="submit"
          variant="contained"
          data-testid="billing-portal-save"
          disabled={updateSettings.isPending || !settings.isSuccess}
        >
          {updateSettings.isPending ? t.billing.saving : t.billing.save}
        </Button>
      ) : undefined}
    >
      <FormControl fullWidth>
        <FormLabel htmlFor="billing-portal-url">{t.billing.urlLabel}</FormLabel>
        {settings.isPending ? (
          <StatusView
            state={{ kind: 'loading', label: t.common.loading }}
            data-testid="billing-portal-url-loading"
          />
        ) : (
          <OutlinedInput
            id="billing-portal-url"
            type="url"
            value={value}
            disabled={!canEdit || !settings.isSuccess}
            onChange={(event) => setUrl(event.target.value)}
            placeholder={t.billing.placeholder}
            inputProps={{ 'data-testid': 'billing-portal-url' }}
          />
        )}
      </FormControl>
      {settings.isError ? (
        <StatusView state={{ kind: 'error', message: localizePanelError(settings.error, t), retry: { label: t.common.retry, onRetry: () => void settings.refetch() } }} />
      ) : null}
      {updateSettings.isSuccess ? (
        <Typography variant="caption" component="p" data-testid="billing-portal-saved">
          {t.billing.saved}
        </Typography>
      ) : null}
      {updateSettings.isError ? <Alert severity="error">{localizePanelError(updateSettings.error, t)}</Alert> : null}
    </SectionCard>
  );
};

export const StripeTab = () => {
  const t = useTranslations();
  const { language } = useLanguage();
  const { tenant } = usePanelContext();
  const secrets = useQuery(actions.tenantSecrets);

  const storedSecrets = secrets.data?.secrets;
  const stripeMode = secrets.data?.stripeMode ?? null;
  const stripeReady =
    storedSecrets !== undefined &&
    previewFor(storedSecrets, 'stripe.restrictedKey') !== null &&
    previewFor(storedSecrets, 'stripe.webhookSecret') !== null;

  return (
    <>
      <SectionCard title={t.integrations.stripeHeading} description={t.integrations.stripeDescription}>
        {secrets.isPending ? (
          <StatusView state={{ kind: 'loading', label: t.integrations.loading }} />
        ) : secrets.isError ? (
          <StatusView state={{ kind: 'error', message: localizePanelError(secrets.error, t), retry: { label: t.common.retry, onRetry: () => void secrets.refetch() } }} />
        ) : (
          <>
            <StripeConfiguration
              maskedPreview={previewFor(secrets.data.secrets, 'stripe.restrictedKey')}
              webhookConfigured={previewFor(secrets.data.secrets, 'stripe.webhookSecret') !== null}
              mode={stripeMode}
            />
            {stripeMode === 'test' ? (
              <Alert severity="warning" data-testid="stripe-live-slot-test-key">
                {t.integrations.stripeLiveSlotTestKey}
              </Alert>
            ) : null}
          </>
        )}

        <CopyField
          label={t.integrations.webhookUrlLabel}
          hint={stripeReady ? t.integrations.webhookActiveHint : t.integrations.webhookUrlHint}
          value={secrets.data?.stripeWebhookUrl ?? ''}
          testId="stripe-webhook-url"
        />

        <ProviderTest
          provider="payment"
          ready={stripeReady}
          hint={t.integrations.saveKeysFirst}
          showHint={!secrets.isPending && !secrets.isError}
        />
      </SectionCard>

      <SectionCard title={t.integrations.stripeTestMode} description={t.integrations.stripeTestDescription}>
        {secrets.isSuccess ? <>
          <StripeConfiguration slot="test"
            maskedPreview={previewFor(secrets.data.secrets, 'stripe.testRestrictedKey')}
            webhookConfigured={previewFor(secrets.data.secrets, 'stripe.testWebhookSecret') !== null}
            mode={previewFor(secrets.data.secrets, 'stripe.testRestrictedKey') === null ? null : 'test'}
          />
          <Typography>{previewFor(secrets.data.secrets, 'stripe.testWebhookSecret') !== null
            ? t.integrations.stripeTestEndpointRegistered : t.integrations.notConfigured}</Typography>
          <Typography>{t.integrations.stripeTestLastEvent({
            value: secrets.data.stripeTestLastEventAt === null
              ? t.integrations.stripeTestNoEvents
              : formatDateTime(secrets.data.stripeTestLastEventAt, language),
          })}</Typography>
          <CopyField label={t.integrations.webhookUrlLabel} value={`${secrets.data.stripeWebhookUrl}?mode=test`} testId="stripe-test-webhook-url" />
        </> : null}
      </SectionCard>

      <BillingPortalField canEdit={tenant.staffRole === 'owner'} />
    </>
  );
};
