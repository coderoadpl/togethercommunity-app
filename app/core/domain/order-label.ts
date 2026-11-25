import type { OrderListItem } from './commerce.js';
import { trackingNumberSchema } from './fulfilment.js';
import { shipxShipmentBought } from './shipx.js';

export const orderLabel = (shipment: { shipxShipmentId: string | null; status: string; trackingNumber: string | null } | null | undefined): NonNullable<OrderListItem['label']> | null => {
  if (shipment?.shipxShipmentId == null || shipment.status === 'canceled' || !shipxShipmentBought(shipment)) return null;
  const tracking = trackingNumberSchema.safeParse(shipment.trackingNumber);
  return tracking.success ? { carrier: 'inpost', trackingNumber: tracking.data } : null;
};

export const orderFulfilmentDisplay = (order: Pick<OrderListItem, 'fulfilmentStatus' | 'label'>) =>
  order.fulfilmentStatus === 'to_pack' && order.label != null ? 'label_ready' : order.fulfilmentStatus;
