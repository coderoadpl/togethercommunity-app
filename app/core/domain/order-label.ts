import type { OrderListItem } from './commerce.js';
import { shipxShipmentBought } from './shipx.js';

export const orderLabel = (shipment: { shipxShipmentId: string | null; status: string; trackingNumber: string | null } | null | undefined): NonNullable<OrderListItem['label']> | null =>
  shipment?.shipxShipmentId != null && shipment.trackingNumber !== null && shipxShipmentBought(shipment)
    ? { carrier: 'inpost', trackingNumber: shipment.trackingNumber }
    : null;

export const orderFulfilmentDisplay = (order: Pick<OrderListItem, 'fulfilmentStatus' | 'label'>) =>
  order.fulfilmentStatus === 'to_pack' && order.label != null ? 'label_ready' : order.fulfilmentStatus;
