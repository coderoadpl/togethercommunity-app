import { orderLabel, type OrderListItem, type ShipxShipment } from '#core/domain/index.js';

export const shipxCreateLine = ({ order, shipment }: { order: OrderListItem; shipment: ShipxShipment }): string => {
  const labelTracking = shipment.trackingNumber?.trim() ?? null;
  if (order.fulfilmentStatus === 'shipped') {
    const dispatch = order.shipment;
    const dispatchTracking = dispatch?.trackingNumber.trim() ?? '';
    const tracking = dispatch == null ? 'no dispatch tracking recorded' : `${dispatch.carrier} ${dispatchTracking}`;
    const reconcile = labelTracking !== null && (dispatch?.carrier !== 'inpost' || labelTracking !== dispatchTracking)
      ? `; InPost label ${labelTracking} was bought as well, reconcile it in Manager Paczek`
      : '';
    return `shipped: ${order.id} (${tracking})${reconcile}`;
  }
  if (order.fulfilmentStatus === 'to_pack' && order.label === null) {
    return `label bought, but its tracking number cannot be used for dispatch; check Manager Paczek: ${order.id} (inpost ${labelTracking ?? ''})`;
  }
  const label = order.label === undefined ? orderLabel(shipment) : order.label;
  const labelStatus = label === null ? 'label bought' : 'label ready';
  return `${labelStatus}; order still to pack: ${order.id} (inpost ${label?.trackingNumber ?? labelTracking ?? ''})`;
};
