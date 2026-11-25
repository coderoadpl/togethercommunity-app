import type { OrderListItem, ShipxShipment } from '#core/domain/index.js';

export const shipxCreateLine = ({ order, shipment }: { order: OrderListItem; shipment: ShipxShipment }): string => {
  const labelTracking = shipment.trackingNumber;
  if (order.fulfilmentStatus === 'shipped') {
    const dispatch = order.shipment;
    const tracking = dispatch == null ? 'no dispatch tracking recorded' : `${dispatch.carrier} ${dispatch.trackingNumber}`;
    const reconcile = labelTracking !== null && labelTracking !== dispatch?.trackingNumber
      ? `; InPost label ${labelTracking} was bought as well, reconcile it in Manager Paczek`
      : '';
    return `shipped: ${order.id} (${tracking})${reconcile}`;
  }
  const status = order.fulfilmentStatus === 'to_pack' ? 'label ready; order still to pack' : 'label bought; order is off the packing list';
  return `${status}: ${order.id} (inpost ${labelTracking ?? ''})`;
};
