import { Alert, Button, Link, MenuItem, Stack, TextField, Typography } from '@mui/material';
import { useState, type ReactNode } from 'react';
import {
  SALES_LINK_TIME_ZONE,
  shipmentTrackingUrl,
  shippingCarrierSchema,
  trackingNumberSchema,
  type OrderListItem,
  type ShippingCarrier,
} from '#core/domain/index.js';

import { ConfirmDialog } from '../../../components/layout/index.js';
import { useLanguage, useTranslations } from '../../../i18n/index.js';
import { formatDateTime } from '../../../lib/format.js';

interface OrderShipmentProps {
  order: OrderListItem;
  canShip: boolean;
  pending: boolean;
  error: string | null;
  onShip: (input: { carrier: ShippingCarrier; trackingNumber: string }) => void;
}

const Row = ({ label, children }: { label: string; children: ReactNode }) => (
  <Stack direction={{ xs: 'column', sm: 'row' }} useFlexGap spacing="0.5rem" sx={{ justifyContent: 'space-between' }}>
    <Typography color="text.secondary">{label}</Typography>
    <Typography component="div" sx={{ overflowWrap: 'anywhere' }}>{children}</Typography>
  </Stack>
);

export const OrderShipment = ({ order, canShip, pending, error, onShip }: OrderShipmentProps) => {
  const t = useTranslations();
  const { language } = useLanguage();
  const [carrier, setCarrier] = useState<ShippingCarrier>(order.shipping?.carrier ?? 'inpost');
  const [trackingNumber, setTrackingNumber] = useState('');
  const [confirming, setConfirming] = useState(false);
  const tracking = trackingNumberSchema.safeParse(trackingNumber);

  if (order.fulfilmentStatus === 'shipped' && order.shipment != null) {
    const shipment = order.shipment;
    const url = shipmentTrackingUrl(shipment);
    return (
      <Stack useFlexGap spacing="0.75rem" data-testid="order-shipment">
        <Row label={t.shipping.shippedAt}>{formatDateTime(shipment.shippedAt, language, SALES_LINK_TIME_ZONE)}</Row>
        <Row label={t.shipping.shippedBy}>{shipment.shippedByDisplayName ?? '—'}</Row>
        <Row label={t.shipping.shipCarrier}>{t.shipping.carriers[shipment.carrier]}</Row>
        <Row label={t.shipping.trackingNumber}>
          {url === null ? shipment.trackingNumber : (
            <Link href={url} target="_blank" rel="noreferrer" data-testid="order-tracking-link">{shipment.trackingNumber}</Link>
          )}
        </Row>
      </Stack>
    );
  }
  if (order.fulfilmentStatus !== 'to_pack' || !canShip) return null;
  return (
    <Stack useFlexGap spacing="0.75rem" data-testid="order-ship-form">
      <Stack direction={{ xs: 'column', sm: 'row' }} useFlexGap spacing="0.75rem">
        <TextField
          select
          size="small"
          label={t.shipping.shipCarrier}
          value={carrier}
          onChange={(event) => setCarrier(shippingCarrierSchema.parse(event.target.value))}
          sx={{ minWidth: '10rem' }}
        >
          <MenuItem value="inpost">{t.shipping.carriers.inpost}</MenuItem>
          <MenuItem value="other">{t.shipping.carriers.other}</MenuItem>
        </TextField>
        <TextField
          size="small"
          label={t.shipping.shipTracking}
          value={trackingNumber}
          onChange={(event) => setTrackingNumber(event.target.value)}
          helperText={t.shipping.shipTrackingHint}
          error={trackingNumber.length > 0 && !tracking.success}
          sx={{ flex: 1 }}
          slotProps={{ htmlInput: { maxLength: 80, 'data-testid': 'order-ship-tracking' } }}
        />
      </Stack>
      <Stack direction="row">
        <Button variant="contained" disabled={pending || !tracking.success} onClick={() => setConfirming(true)} data-testid="order-ship">
          {pending ? t.shipping.markingShipped : t.shipping.markShipped}
        </Button>
      </Stack>
      {error === null ? null : <Alert severity="error">{error}</Alert>}
      <ConfirmDialog
        open={confirming}
        title={t.shipping.shipConfirmTitle}
        body={<Typography>{t.shipping.shipConfirmBody({ email: order.memberEmail, trackingNumber: tracking.success ? tracking.data : trackingNumber })}</Typography>}
        confirmLabel={t.shipping.shipConfirm}
        cancelLabel={t.common.cancel}
        confirmColor="primary"
        pending={pending}
        confirmDisabled={!tracking.success}
        onConfirm={() => {
          if (!tracking.success) return;
          setConfirming(false);
          onShip({ carrier, trackingNumber: tracking.data });
        }}
        onClose={() => setConfirming(false)}
        confirmTestId="order-ship-confirm"
      />
    </Stack>
  );
};
