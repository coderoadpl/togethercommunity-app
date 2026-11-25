import { Alert, Button, Stack, TextField } from '@mui/material';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useState, type ReactNode } from 'react';
import { z } from 'zod';
import { deliveryCorrectionInputSchema, deliveryCorrectionReasonSchema, normalizeLockerPhone, rateNeedsPolishMobile, orderShipmentAllowed, shipxShipmentBought, type DeliveryCorrectionInput, type OrderListItem, type OrderShipping, type ShipxOrderView } from '#core/domain/index.js';
import { actions } from '../../../api.js';
import { ConfirmDialog } from '../../../components/ui/ConfirmDialog.js';
import { errorCodeOf, errorDetailsOf, localizePanelError, useTranslations, type Messages } from '../../../i18n/index.js';
import { OrderDeliveryCorrectionHistory } from './OrderDeliveryCorrectionHistory.js';

const reasonSchema = z.object({ deliveryCorrection: deliveryCorrectionReasonSchema });
const failureMessage = (error: unknown, t: Messages): string => {
  if (errorCodeOf(error) === 'locker_phone_invalid') return t.shipping.inpostPhoneInvalid;
  const parsed = reasonSchema.safeParse(errorDetailsOf(error));
  return parsed.success ? t.deliveryCorrection.reasons[parsed.data.deliveryCorrection] : localizePanelError(error, t);
};
const draftOf = (shipping: OrderShipping) => ({
  phone: shipping.phone ?? '', recipientName: shipping.address.name,
  line1: shipping.address.line1, line2: shipping.address.line2 ?? '', postalCode: shipping.address.postalCode, city: shipping.address.city,
  locker: shipping.pickupPoint?.code ?? '',
});
type Draft = ReturnType<typeof draftOf>;

const correctionOf = (orderId: string, shipping: OrderShipping, draft: Draft): DeliveryCorrectionInput => {
  const original = draftOf(shipping);
  const address: NonNullable<DeliveryCorrectionInput['address']> = {};
  const expected: DeliveryCorrectionInput['expected'] = {};
  const expectedAddress: NonNullable<DeliveryCorrectionInput['address']> = {};
  for (const field of ['line1', 'line2', 'postalCode', 'city'] as const) {
    if (draft[field].trim() !== original[field].trim()) {
      if (field === 'line2') { address.line2 = draft.line2.trim() || null; expectedAddress.line2 = shipping.address.line2; }
      else { address[field] = draft[field]; expectedAddress[field] = shipping.address[field]; }
    }
  }
  const input: DeliveryCorrectionInput = { orderId, expected };
  if (draft.phone.trim() !== original.phone.trim()) { input.phone = draft.phone; expected.phone = shipping.phone; }
  if (draft.recipientName.trim() !== original.recipientName.trim()) { input.recipientName = draft.recipientName; expected.recipientName = shipping.address.name; }
  if (Object.keys(address).length > 0) { input.address = address; expected.address = expectedAddress; }
  if (shipping.pickupPoint !== null && draft.locker.trim().toUpperCase() !== original.locker) {
    input.pickupPoint = { code: draft.locker }; expected.pickupPoint = shipping.pickupPoint.code;
  }
  return input;
};

export const OrderDeliveryCorrectionDialog = ({ orderId, shipping, pending, error, onSave, onClose }: {
  orderId: string; shipping: OrderShipping; pending: boolean; error: unknown; onSave: (input: DeliveryCorrectionInput) => void; onClose: () => void;
}) => {
  const t = useTranslations();
  const copy = t.deliveryCorrection;
  const [original] = useState(shipping);
  const [draft, setDraft] = useState(() => draftOf(shipping));
  const input = correctionOf(orderId, original, draft);
  const parsed = deliveryCorrectionInputSchema.safeParse(input);
  const errors: Partial<Record<keyof Draft, string>> = {};
  if (!parsed.success) {
    for (const issue of parsed.error.issues) {
      const field = issue.path[0] === 'address' ? issue.path[1] : issue.path[0] === 'pickupPoint' ? 'locker' : issue.path[0];
      if (field === 'phone' || field === 'recipientName' || field === 'line1' || field === 'line2' || field === 'postalCode' || field === 'city' || field === 'locker') errors[field] = copy.invalid;
    }
  }
  if (input.phone !== undefined && rateNeedsPolishMobile(original) && normalizeLockerPhone(draft.phone) === null) errors.phone = t.shipping.inpostPhoneInvalid;
  if (input.address?.postalCode !== undefined && shipping.address.country === 'PL' && !/^\d{2}-\d{3}$/.test(draft.postalCode.trim())) errors.postalCode = copy.postalInvalid;
  const valid = parsed.success && Object.keys(errors).length === 0;
  const field = (name: keyof Draft, label: string, hint?: string) => (
    <TextField key={name} fullWidth label={label} value={draft[name]} disabled={pending} error={errors[name] !== undefined}
      helperText={[errors[name], hint].filter(Boolean).join(' ')} onChange={(event) => setDraft({ ...draft, [name]: event.target.value })}
      slotProps={{ htmlInput: { 'data-testid': `delivery-correction-${name}` } }} />
  );
  return (
    <ConfirmDialog open title={copy.action} confirmLabel={copy.save} cancelLabel={t.common.cancel} confirmColor="primary"
      pending={pending} confirmDisabled={!valid} onClose={onClose} onConfirm={() => { if (parsed.success && valid) onSave(parsed.data); }}
      confirmTestId="delivery-correction-save" data-testid="delivery-correction-dialog"
      body={<>
        {field('phone', copy.phone, rateNeedsPolishMobile(original) ? t.shipping.courierPhoneHint : undefined)}
        {field('recipientName', copy.recipientName)}
        {field('line1', copy.line1)}{field('line2', copy.line2)}{field('postalCode', copy.postalCode)}{field('city', copy.city)}
        <TextField fullWidth label={copy.country} value={shipping.address.country} slotProps={{ input: { readOnly: true } }} />
        {shipping.pickupPoint === null ? null : field('locker', copy.locker)}
        {error == null ? null : <Alert severity="error">{failureMessage(error, t)}</Alert>}
      </>} />
  );
};

export const OrderDeliveryCorrection = ({ order, view, canCorrect, children }: {
  order: OrderListItem; view: ShipxOrderView | undefined; canCorrect: boolean; children: (open: (() => void) | undefined) => ReactNode;
}) => {
  const t = useTranslations();
  const queryClient = useQueryClient();
  const [open, setOpen] = useState(false);
  const correction = useMutation({
    ...actions.correctOrderDelivery,
    onSuccess: async () => {
      setOpen(false);
      await queryClient.invalidateQueries(actions.ordersInvalidates());
      await queryClient.invalidateQueries(actions.shipxShipmentInvalidates(order.id));
    },
    onError: async () => {
      await queryClient.invalidateQueries(actions.ordersInvalidates());
      await queryClient.invalidateQueries(actions.shipxShipmentInvalidates(order.id));
    },
  });
  if (order.shipping == null) return children(undefined);
  const shipment = view?.shipment;
  const refused = errorCodeOf(correction.error);
  const bought = (shipment != null && (shipxShipmentBought(shipment) || shipment.boughtAt !== null)) || refused === 'delivery_correction_shipment_bought';
  const shipped = order.fulfilmentStatus === 'shipped' || refused === 'delivery_correction_shipped';
  const exists = (shipment != null && (shipment.shipxShipmentId !== null || shipment.createAttemptedAt !== null)) || refused === 'delivery_correction_shipment_exists';
  const allowed = canCorrect && !bought && !shipped && !exists && orderShipmentAllowed(order).ok && (order.shipping.carrier !== 'inpost' || view !== undefined);
  const show = () => { correction.reset(); setOpen(true); };
  return (
    <>
      <Stack useFlexGap spacing="0.5rem">
        {allowed ? <Button variant="outlined" onClick={show} data-testid="order-delivery-correct">{t.deliveryCorrection.action}</Button> : null}
        {!canCorrect || (!bought && !shipped) ? null : <Alert severity="info">{bought ? t.deliveryCorrection.bought : t.deliveryCorrection.shipped}</Alert>}
        {correction.isSuccess ? <Alert severity="success">{t.deliveryCorrection.saved}</Alert> : null}
        {canCorrect && exists && !bought && !shipped ? <Alert severity="info">{t.deliveryCorrection.shipmentExists}</Alert> : null}
      </Stack>
      {children(allowed ? show : undefined)}
      <OrderDeliveryCorrectionHistory shipping={order.shipping} />
      {open && allowed ? <OrderDeliveryCorrectionDialog orderId={order.id} shipping={order.shipping} pending={correction.isPending} error={correction.error}
        onSave={(input) => correction.mutate(input)} onClose={() => setOpen(false)} /> : null}
    </>
  );
};
