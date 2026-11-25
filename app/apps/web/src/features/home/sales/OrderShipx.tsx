import { Alert, Button, Checkbox, FormControlLabel, MenuItem, Stack, TextField, Typography } from '@mui/material';
import { useState } from 'react';
import { PARCEL_TEMPLATES, parcelTemplateSchema, SHIPX_SETUP_GAPS, shipxAttemptUnconfirmed, shipxShipmentBought, type OrderListItem, type ParcelTemplate, type ShipxOrderView } from '#core/domain/index.js';

import { ConfirmDialog } from '../../../components/ui/ConfirmDialog.js';
import { localizeShipxError, useTranslations } from '../../../i18n/index.js';

interface OrderShipxProps {
  order: OrderListItem;
  view: ShipxOrderView | undefined;
  canCreate: boolean;
  pending: boolean;
  discarding: boolean;
  downloading: boolean;
  error: unknown;
  onCreate: (parcelTemplate: ParcelTemplate | undefined, markShipped: boolean) => void;
  onDiscard: (parcelTemplate: ParcelTemplate | undefined) => void;
  onDownloadLabel: () => void;
}

const AUTOMATIC = 'automatic';

const hintReason = (reason: ShipxOrderView['reason']): (typeof SHIPX_SETUP_GAPS)[number] | null =>
  SHIPX_SETUP_GAPS.find((candidate) => candidate === reason) ?? null;

export const OrderShipx = ({ order, view, canCreate, pending, discarding, downloading, error, onCreate, onDiscard, onDownloadLabel }: OrderShipxProps) => {
  const t = useTranslations();
  const [markShipped, setMarkShipped] = useState(false);
  const [confirming, setConfirming] = useState<'create' | 'discard' | null>(null);
  const [parcelTemplate, setParcelTemplate] = useState<ParcelTemplate | undefined>(undefined);
  const shipment = view?.shipment ?? null;
  const labelReady = order.label != null || (shipment?.shipxShipmentId != null && shipxShipmentBought(shipment));
  const showCreate = canCreate && view?.available === true && view.service !== null && !labelReady;
  if (!showCreate && confirming !== null) setConfirming(null);
  if (view === undefined || view.service === null) return null;
  const unconfirmed = shipment !== null && shipxAttemptUnconfirmed(shipment);
  const discardable = shipment !== null && shipment.shipxShipmentId === null;
  const awaitingPayment = shipment?.shipxShipmentId != null && !labelReady && view.reason === null;
  const failure = error === null ? null : localizeShipxError(error, t);
  const service = t.shipx.services[view.service];
  const createsShipment = shipment?.shipxShipmentId == null && !unconfirmed;
  const chosenTemplate = createsShipment ? parcelTemplate : undefined;
  const size = t.shipx.parcelTemplates[chosenTemplate ?? view.parcelTemplate];
  const createConfirmBody = order.mode === 'test'
    ? t.shipx.createConfirmBodyTest({ service, size })
    : markShipped
      ? t.shipx.createConfirmBodyShipped({ service, size, email: order.memberEmail })
      : t.shipx.createConfirmBody({ service, size });
  const reason = canCreate ? hintReason(view.reason) : null;
  const hint = reason === null ? null : t.shipx.unavailableReasons[reason][view.environment];
  const busy = pending || discarding;
  if (!labelReady && !showCreate && hint === null && shipment === null) return null;
  const parcelTemplateField = (
    <TextField
      select
      fullWidth
      id="order-shipx-parcel-template"
      label={t.shipx.parcelTemplateOverrideLabel}
      value={parcelTemplate ?? AUTOMATIC}
      onChange={(event) => setParcelTemplate(event.target.value === AUTOMATIC ? undefined : parcelTemplateSchema.parse(event.target.value))}
      slotProps={{ htmlInput: { 'data-testid': 'order-shipx-parcel-template' } }}
    >
      <MenuItem value={AUTOMATIC}>{t.shipx.parcelTemplateAutomatic({ size: t.shipx.parcelTemplates[view.parcelTemplate] })}</MenuItem>
      {PARCEL_TEMPLATES.map((template) => <MenuItem key={template} value={template}>{t.shipx.parcelTemplates[template]}</MenuItem>)}
    </TextField>
  );

  return (
    <Stack useFlexGap spacing="0.75rem" data-testid="order-shipx">
      {shipment === null || unconfirmed ? null : (
        <Typography color="text.secondary" data-testid="order-shipx-status">{t.shipx.shipmentStatus({ status: shipment.status })}</Typography>
      )}
      {unconfirmed ? <Alert severity="warning" data-testid="order-shipx-unconfirmed">{t.shipx.attemptUnconfirmed}</Alert> : null}
      {awaitingPayment ? <Typography color="text.secondary" data-testid="order-shipx-pending">{t.shipx.paymentPending}</Typography> : null}
      <Stack direction={{ xs: 'column', sm: 'row' }} useFlexGap spacing="0.75rem">
        {showCreate ? (
          <Button variant="contained" disabled={busy} onClick={() => { setMarkShipped(false); setConfirming('create'); }} data-testid="order-shipx-create">
            {pending ? t.shipx.creating : t.shipx.create}
          </Button>
        ) : null}
        {showCreate && discardable ? (
          <Button variant="outlined" color="warning" disabled={busy} onClick={() => setConfirming('discard')} data-testid="order-shipx-discard">
            {t.shipx.discardAttempt}
          </Button>
        ) : null}
        {labelReady ? (
          <Button variant="outlined" disabled={downloading} onClick={onDownloadLabel} data-testid="order-shipx-label">
            {downloading ? t.shipx.downloadingLabel : t.shipx.printLabel}
          </Button>
        ) : null}
      </Stack>
      {hint === null ? null : <Typography color="text.secondary" data-testid="order-shipx-hint">{hint}</Typography>}
      {failure === null ? null : (
        <Alert severity="error" data-testid="order-shipx-error">
          {failure.message}
          {failure.detail === null ? null : <Typography component="div" variant="body2">{t.shipx.errorDetail({ detail: failure.detail })}</Typography>}
        </Alert>
      )}
      <ConfirmDialog
        open={showCreate && confirming === 'create'}
        title={t.shipx.createConfirmTitle}
        body={(
          <>
            {createsShipment ? parcelTemplateField : null}
            <Typography>{createConfirmBody}</Typography>
            <FormControlLabel
              control={<Checkbox checked={markShipped} onChange={(_event, checked) => setMarkShipped(checked)} />}
              label={order.mode === 'test' ? t.shipx.markShippedTest : t.shipx.markShipped}
            />
          </>
        )}
        confirmLabel={t.shipx.createConfirm}
        cancelLabel={t.common.cancel}
        confirmColor="primary"
        pending={pending}
        onConfirm={() => {
          setConfirming(null);
          onCreate(chosenTemplate, markShipped);
        }}
        onClose={() => setConfirming(null)}
        confirmTestId="order-shipx-confirm"
      />
      <ConfirmDialog
        open={showCreate && confirming === 'discard'}
        title={unconfirmed ? t.shipx.discardConfirmTitle : t.shipx.discardClaimConfirmTitle}
        body={(
          <>
            <Typography>{unconfirmed ? t.shipx.discardConfirmBody : t.shipx.discardClaimConfirmBody}</Typography>
            {parcelTemplateField}
          </>
        )}
        confirmLabel={t.shipx.discardConfirm}
        cancelLabel={t.common.cancel}
        confirmColor="warning"
        pending={discarding}
        onConfirm={() => {
          setConfirming(null);
          onDiscard(parcelTemplate);
        }}
        onClose={() => setConfirming(null)}
        confirmTestId="order-shipx-discard-confirm"
      />
    </Stack>
  );
};
