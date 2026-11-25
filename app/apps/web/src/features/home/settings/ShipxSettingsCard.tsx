import { useState } from 'react';
import { Alert, Button, MenuItem, Stack, TextField, Typography } from '@mui/material';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';

import { DEFAULT_SHIPX_SENDING_METHOD, SHIPX_SENDING_METHODS, shipxSenderSchema, shipxSendingMethodSchema, type ConfigureShipxSlotInput, type ShipxEnvironment, type ShipxSendingMethod, type ShipxSettingsView, type ShipxSlotView } from '#core/domain/index.js';

import { actions } from '../../../api.js';
import { SectionCard, StatusView } from '../../../components/layout/index.js';
import { useToastOutcome } from '../../../components/ui/Toast.js';
import { localizePanelError, useTranslations } from '../../../i18n/index.js';

const SENDER_FIELDS = ['name', 'company', 'email', 'phone', 'street', 'buildingNumber', 'city', 'postCode'] as const;

const SLOT_ORDER = ['production', 'sandbox'] as const satisfies readonly ShipxEnvironment[];

type SenderField = (typeof SENDER_FIELDS)[number];

type SenderDraft = Record<SenderField, string>;

interface SlotDraft {
  organizationId: string;
  token: string;
}

interface ShipxDraft {
  slots: Record<ShipxEnvironment, SlotDraft>;
  sender: SenderDraft;
  sendingMethod: ShipxSendingMethod;
}

const emptySender: SenderDraft = { name: '', company: '', email: '', phone: '', street: '', buildingNumber: '', city: '', postCode: '' };

const emptySlot: SlotDraft = { organizationId: '', token: '' };

const draftFrom = (view: ShipxSettingsView | undefined): ShipxDraft => ({
  slots: { sandbox: emptySlot, production: emptySlot },
  sendingMethod: view?.sendingMethod ?? DEFAULT_SHIPX_SENDING_METHOD,
  sender: view?.sender == null ? emptySender : { ...view.sender, company: view.sender.company ?? '' },
});

const senderBlank = (sender: SenderDraft): boolean => SENDER_FIELDS.every((field) => sender[field].trim() === '');

const slotInput = (slot: SlotDraft): ConfigureShipxSlotInput | undefined => {
  const organizationId = slot.organizationId.trim();
  const token = slot.token.trim();
  if (organizationId === '' && token === '') return undefined;
  return { ...(organizationId === '' ? {} : { organizationId }), ...(token === '' ? {} : { token }) };
};

const slotStored = (view: ShipxSlotView | undefined): boolean => view?.organizationId != null || view?.token != null;

export const ShipxSettingsCard = ({ canEdit }: { canEdit: boolean }) => {
  const t = useTranslations();
  const queryClient = useQueryClient();
  const settings = useQuery(actions.shipxSettings);
  const [draft, setDraft] = useState<ShipxDraft | null>(null);
  const [invalid, setInvalid] = useState(false);
  const value = draft ?? draftFrom(settings.data);
  const save = useMutation({
    ...actions.shipxConfigure,
    onSuccess: () => Promise.all([
      queryClient.invalidateQueries(actions.shipxSettingsInvalidates()),
      queryClient.invalidateQueries(actions.shipxShipmentInvalidates()),
    ]),
  });
  const clearSlot = (slot: ShipxEnvironment) => save.mutate({ [slot]: { clearCredentials: true } }, {
    onSuccess: () => setDraft((current) => (current === null ? null : { ...current, slots: { ...current.slots, [slot]: emptySlot } })),
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
  const changeSlot = (slot: ShipxEnvironment, patch: Partial<SlotDraft>) =>
    change({ slots: { ...value.slots, [slot]: { ...value.slots[slot], ...patch } } });
  const credentialHelper = (stored: ShipxSlotView['token']) =>
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
        const sandbox = slotInput(value.slots.sandbox);
        const production = slotInput(value.slots.production);
        save.mutate({
          sender: sender === null ? null : sender.data,
          ...(value.sendingMethod === settings.data?.sendingMethod ? {} : { sendingMethod: value.sendingMethod }),
          ...(sandbox === undefined ? {} : { sandbox }),
          ...(production === undefined ? {} : { production }),
        }, { onSuccess: () => setDraft(null) });
      }}
    >
      {SLOT_ORDER.map((slot) => {
        const stored = settings.data?.[slot];
        return (
          <Stack key={slot} useFlexGap spacing="0.75rem" data-testid={`shipx-slot-${slot}`}>
            <Typography variant="subtitle2" component="h3">{t.shipx.slotHeadings[slot]}</Typography>
            {stored === undefined ? null : (
              <Typography color={stored.configured ? 'success.main' : 'text.secondary'} data-testid={`shipx-${slot}-status`}>
                {stored.configured ? t.shipx.slotConnected : t.shipx.slotNotConnected}
              </Typography>
            )}
            <Stack direction={{ xs: 'column', sm: 'row' }} useFlexGap spacing="0.75rem">
              <TextField
                label={t.shipx.organizationId}
                value={value.slots[slot].organizationId}
                disabled={disabled}
                autoComplete="off"
                helperText={credentialHelper(stored?.organizationId ?? null)}
                onChange={(event) => changeSlot(slot, { organizationId: event.target.value })}
                slotProps={{ htmlInput: { inputMode: 'numeric', 'data-testid': `shipx-${slot}-organization-id` } }}
                sx={{ flex: 1 }}
              />
              <TextField
                type="password"
                label={t.shipx.token}
                value={value.slots[slot].token}
                disabled={disabled}
                autoComplete="new-password"
                helperText={credentialHelper(stored?.token ?? null)}
                onChange={(event) => changeSlot(slot, { token: event.target.value })}
                slotProps={{ htmlInput: { 'data-testid': `shipx-${slot}-token` } }}
                sx={{ flex: 2 }}
              />
            </Stack>
            {canEdit && slotStored(stored) ? (
              <Stack direction="row">
                <Button color="error" variant="outlined" disabled={disabled} onClick={() => clearSlot(slot)} data-testid={`shipx-${slot}-clear-credentials`}>
                  {t.shipx.clearCredentials}
                </Button>
              </Stack>
            ) : null}
          </Stack>
        );
      })}
      <TextField
        select
        id="shipx-sending-method"
        label={t.shipx.sendingMethodLabel}
        helperText={t.shipx.sendingMethodHint}
        value={value.sendingMethod}
        disabled={disabled}
        onChange={(event) => change({ sendingMethod: shipxSendingMethodSchema.parse(event.target.value) })}
      >
        {SHIPX_SENDING_METHODS.map((method) => <MenuItem key={method} value={method}>{t.shipx.sendingMethods[method]}</MenuItem>)}
      </TextField>
      <Typography variant="subtitle2" component="h3">{t.shipx.senderHeading}</Typography>
      <Typography variant="body2" color="text.secondary" data-testid="shipx-sender-hint">{t.shipx.senderHint}</Typography>
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
      {settings.isError ? (
        <StatusView state={{ kind: 'error', message: localizePanelError(settings.error, t), retry: { label: t.common.retry, onRetry: () => void settings.refetch() } }} />
      ) : null}
    </SectionCard>
  );
};
