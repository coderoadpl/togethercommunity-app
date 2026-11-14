import { useState } from 'react';
import { Alert, Button, MenuItem, Stack, TextField, Typography } from '@mui/material';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';

import { SHIPX_ENVIRONMENTS, shipxEnvironmentSchema, shipxSenderSchema, type ShipxEnvironment, type ShipxSettingsView } from '#core/domain/index.js';

import { actions } from '../../../api.js';
import { SectionCard, StatusView } from '../../../components/layout/index.js';
import { useToastOutcome } from '../../../components/ui/Toast.js';
import { localizePanelError, useTranslations } from '../../../i18n/index.js';

const SENDER_FIELDS = ['name', 'company', 'email', 'phone', 'street', 'buildingNumber', 'city', 'postCode'] as const;

type SenderField = (typeof SENDER_FIELDS)[number];

type SenderDraft = Record<SenderField, string>;

interface ShipxDraft {
  environment: ShipxEnvironment;
  organizationId: string;
  token: string;
  sender: SenderDraft;
}

const emptySender: SenderDraft = { name: '', company: '', email: '', phone: '', street: '', buildingNumber: '', city: '', postCode: '' };

const draftFrom = (view: ShipxSettingsView | undefined): ShipxDraft => ({
  environment: view?.environment ?? 'sandbox',
  organizationId: '',
  token: '',
  sender: view?.sender == null ? emptySender : { ...view.sender, company: view.sender.company ?? '' },
});

const senderBlank = (sender: SenderDraft): boolean => SENDER_FIELDS.every((field) => sender[field].trim() === '');

export const ShipxSettingsCard = ({ canEdit }: { canEdit: boolean }) => {
  const t = useTranslations();
  const queryClient = useQueryClient();
  const settings = useQuery(actions.shipxSettings);
  const [draft, setDraft] = useState<ShipxDraft | null>(null);
  const [invalid, setInvalid] = useState(false);
  const value = draft ?? draftFrom(settings.data);
  const save = useMutation({
    ...actions.shipxConfigure,
    onSuccess: async () => {
      await queryClient.invalidateQueries(actions.shipxSettingsInvalidates());
      setDraft(null);
    },
  });
  useToastOutcome(save.isSuccess, t.common.saved, save.error === null ? null : localizePanelError(save.error, t));
  const disabled = !canEdit || !settings.isSuccess || save.isPending;
  const senderLabels: Record<SenderField, string> = {
    name: t.shipx.senderName,
    company: t.shipx.senderCompany,
    email: t.shipx.senderEmail,
    phone: t.shipx.senderPhone,
    street: t.shipx.senderStreet,
    buildingNumber: t.shipx.senderBuildingNumber,
    city: t.shipx.senderCity,
    postCode: t.shipx.senderPostCode,
  };
  const change = (patch: Partial<ShipxDraft>) => {
    setInvalid(false);
    setDraft({ ...value, ...patch });
  };
  const credentialHelper = (stored: ShipxSettingsView['token']) =>
    stored === null ? t.shipx.credentialMissing : t.shipx.credentialSaved({ preview: stored.maskedPreview });

  return (
    <SectionCard
      title={t.shipx.settingsHeading}
      description={t.shipx.settingsIntro}
      data-testid="shipx-settings"
      actions={canEdit ? <Button type="submit" variant="contained" disabled={disabled}>{t.shipx.save}</Button> : undefined}
      onSubmit={(event) => {
        event.preventDefault();
        const sender = senderBlank(value.sender)
          ? null
          : shipxSenderSchema.safeParse({ ...value.sender, company: value.sender.company.trim() === '' ? null : value.sender.company });
        if (sender !== null && !sender.success) {
          setInvalid(true);
          return;
        }
        save.mutate({
          environment: value.environment,
          sender: sender === null ? null : sender.data,
          ...(value.organizationId.trim() === '' ? {} : { organizationId: value.organizationId.trim() }),
          ...(value.token.trim() === '' ? {} : { token: value.token.trim() }),
        });
      }}
    >
      {settings.data === undefined ? null : (
        <Typography color={settings.data.configured ? 'success.main' : 'text.secondary'} data-testid="shipx-configured">
          {settings.data.configured ? t.shipx.configured : t.shipx.notConfigured}
        </Typography>
      )}
      <TextField
        select
        label={t.shipx.environment}
        value={value.environment}
        disabled={disabled}
        onChange={(event) => change({ environment: shipxEnvironmentSchema.parse(event.target.value) })}
        slotProps={{ htmlInput: { 'data-testid': 'shipx-environment' } }}
      >
        {SHIPX_ENVIRONMENTS.map((environment) => <MenuItem key={environment} value={environment}>{t.shipx.environments[environment]}</MenuItem>)}
      </TextField>
      <Stack direction={{ xs: 'column', sm: 'row' }} useFlexGap spacing="0.75rem">
        <TextField
          label={t.shipx.organizationId}
          value={value.organizationId}
          disabled={disabled}
          autoComplete="off"
          helperText={credentialHelper(settings.data?.organizationId ?? null)}
          onChange={(event) => change({ organizationId: event.target.value })}
          slotProps={{ htmlInput: { inputMode: 'numeric', 'data-testid': 'shipx-organization-id' } }}
          sx={{ flex: 1 }}
        />
        <TextField
          type="password"
          label={t.shipx.token}
          value={value.token}
          disabled={disabled}
          autoComplete="new-password"
          helperText={credentialHelper(settings.data?.token ?? null)}
          onChange={(event) => change({ token: event.target.value })}
          slotProps={{ htmlInput: { 'data-testid': 'shipx-token' } }}
          sx={{ flex: 2 }}
        />
      </Stack>
      <Typography variant="subtitle2">{t.shipx.senderHeading}</Typography>
      <Stack direction={{ xs: 'column', sm: 'row' }} useFlexGap spacing="0.75rem" sx={{ flexWrap: 'wrap' }}>
        {SENDER_FIELDS.map((field) => (
          <TextField
            key={field}
            size="small"
            label={senderLabels[field]}
            value={value.sender[field]}
            disabled={disabled}
            onChange={(event) => change({ sender: { ...value.sender, [field]: event.target.value } })}
            slotProps={{ htmlInput: { 'data-testid': `shipx-sender-${field}` } }}
            sx={{ minWidth: '12rem', flex: 1 }}
          />
        ))}
      </Stack>
      {invalid ? <Alert severity="error" role="alert">{t.errors.messageValidation}</Alert> : null}
      {canEdit && (settings.data?.organizationId != null || settings.data?.token != null) ? (
        <Stack direction="row">
          <Button color="error" variant="outlined" disabled={disabled} onClick={() => save.mutate({ clearCredentials: true })} data-testid="shipx-clear-credentials">
            {t.shipx.clearCredentials}
          </Button>
        </Stack>
      ) : null}
      {settings.isError ? (
        <StatusView state={{ kind: 'error', message: localizePanelError(settings.error, t), retry: { label: t.common.retry, onRetry: () => void settings.refetch() } }} />
      ) : null}
    </SectionCard>
  );
};
