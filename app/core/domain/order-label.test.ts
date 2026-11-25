import { describe, expect, it } from 'vitest';
import { orderFulfilmentDisplay, orderLabel } from './order-label.js';

const bought = { shipxShipmentId: '1001', status: 'confirmed', trackingNumber: 'LABEL1234' };

describe('derived order labels', () => {
  it('requires a stored id, tracking number and a bought status', () => {
    expect(orderLabel(bought)).toEqual({ carrier: 'inpost', trackingNumber: 'LABEL1234' });
    expect(orderLabel(null)).toBeNull();
    expect(orderLabel(undefined)).toBeNull();
    expect(orderLabel({ ...bought, shipxShipmentId: null })).toBeNull();
    expect(orderLabel({ ...bought, trackingNumber: null })).toBeNull();
    for (const status of ['created', 'offers_prepared', 'offer_selected']) expect(orderLabel({ ...bought, status })).toBeNull();
  });

  it('changes only the display of to-pack orders, never stored fulfilment', () => {
    const label = orderLabel(bought);
    expect(orderFulfilmentDisplay({ fulfilmentStatus: 'to_pack', label })).toBe('label_ready');
    expect(orderFulfilmentDisplay({ fulfilmentStatus: 'to_pack' })).toBe('to_pack');
    expect(orderFulfilmentDisplay({ fulfilmentStatus: 'shipped', label })).toBe('shipped');
    expect(orderFulfilmentDisplay({ fulfilmentStatus: null, label })).toBeNull();
  });
});
