import { describe, expect, it } from 'vitest';

import {
  memberFulfilmentView,
  orderShipmentAllowed,
  orderShipmentSchema,
  packingListQuerySchema,
  shipOrderInputSchema,
  shipmentTrackingUrl,
} from './fulfilment.js';

describe('shipment tracking URL', () => {
  it('links InPost parcels to the InPost tracking page', () => {
    expect(shipmentTrackingUrl({ carrier: 'inpost', trackingNumber: '520000011395200025754311' }))
      .toBe('https://inpost.pl/sledzenie-przesylek?number=520000011395200025754311');
  });

  it('encodes the tracking number into the query string', () => {
    expect(shipmentTrackingUrl({ carrier: 'inpost', trackingNumber: 'AB 12&x' }))
      .toBe('https://inpost.pl/sledzenie-przesylek?number=AB%2012%26x');
  });

  it('returns no link for other carriers', () => {
    expect(shipmentTrackingUrl({ carrier: 'other', trackingNumber: 'RR123456789PL' })).toBeNull();
  });
});

describe('ship order input', () => {
  it('trims the tracking number and accepts 4 to 64 characters', () => {
    expect(shipOrderInputSchema.parse({ orderId: 'order', carrier: 'inpost', trackingNumber: '  ABCD  ' }).trackingNumber).toBe('ABCD');
    expect(shipOrderInputSchema.safeParse({ orderId: 'order', carrier: 'inpost', trackingNumber: ' ABC ' }).success).toBe(false);
    expect(shipOrderInputSchema.safeParse({ orderId: 'order', carrier: 'other', trackingNumber: 'x'.repeat(64) }).success).toBe(true);
    expect(shipOrderInputSchema.safeParse({ orderId: 'order', carrier: 'other', trackingNumber: 'x'.repeat(65) }).success).toBe(false);
  });

  it('holds a stored shipment to the same 4 to 64 character tracking number', () => {
    const stored = { carrier: 'inpost', shippedAt: '2026-11-05T10:00:00.000Z', shippedBy: 'staff' };
    expect(orderShipmentSchema.safeParse({ ...stored, trackingNumber: 'ABCD' }).success).toBe(true);
    expect(orderShipmentSchema.safeParse({ ...stored, trackingNumber: 'x'.repeat(64) }).success).toBe(true);
    expect(orderShipmentSchema.safeParse({ ...stored, trackingNumber: 'ABC' }).success).toBe(false);
    expect(orderShipmentSchema.safeParse({ ...stored, trackingNumber: 'x'.repeat(65) }).success).toBe(false);
  });

  it('rejects unknown carriers and extra fields', () => {
    expect(shipOrderInputSchema.safeParse({ orderId: 'order', carrier: 'dhl', trackingNumber: 'ABCD' }).success).toBe(false);
    expect(shipOrderInputSchema.safeParse({ orderId: 'order', carrier: 'inpost', trackingNumber: 'ABCD', note: 'x' }).success).toBe(false);
  });
});

describe('shipment transition', () => {
  it.each([
    ['paid', 'to_pack'],
    ['refunded', 'to_pack'],
    ['partially_refunded', 'to_pack'],
  ] as const)('allows a %s order that is %s', (status, fulfilmentStatus) => {
    expect(orderShipmentAllowed({ status, fulfilmentStatus })).toEqual({ ok: true, value: undefined });
  });

  it.each(['pending', 'failed'])('refuses an unpaid %s order', (status) => {
    expect(orderShipmentAllowed({ status, fulfilmentStatus: 'to_pack' })).toMatchObject({ ok: false, error: { code: 'validation' } });
  });

  it('reports a second shipment as a fulfilment conflict', () => {
    expect(orderShipmentAllowed({ status: 'paid', fulfilmentStatus: 'shipped' })).toMatchObject({ ok: false, error: { code: 'fulfilment_conflict' } });
  });

  it('refuses orders with nothing to ship', () => {
    expect(orderShipmentAllowed({ status: 'paid', fulfilmentStatus: null })).toMatchObject({ ok: false, error: { code: 'validation' } });
    expect(orderShipmentAllowed({ status: 'paid' })).toMatchObject({ ok: false, error: { code: 'validation' } });
  });
});

describe('member fulfilment view', () => {
  const shipment = { carrier: 'inpost' as const, trackingNumber: 'ABCD1234', shippedAt: '2026-11-05T10:00:00.000Z', shippedBy: 'staff' };

  it('is empty for orders without shipping', () => {
    expect(memberFulfilmentView({ fulfilmentStatus: null })).toBeNull();
  });

  it('shows an order being prepared without shipment details', () => {
    expect(memberFulfilmentView({ fulfilmentStatus: 'to_pack', shipment })).toEqual({
      status: 'to_pack', shippedAt: null, carrier: null, trackingNumber: null, trackingUrl: null,
    });
  });

  it('shows the shipment with the tracking link', () => {
    expect(memberFulfilmentView({ fulfilmentStatus: 'shipped', shipment })).toEqual({
      status: 'shipped',
      shippedAt: '2026-11-05T10:00:00.000Z',
      carrier: 'inpost',
      trackingNumber: 'ABCD1234',
      trackingUrl: 'https://inpost.pl/sledzenie-przesylek?number=ABCD1234',
    });
  });
});

describe('packing list query', () => {
  it('defaults to orders to pack and only offers CSV', () => {
    expect(packingListQuerySchema.parse({ format: 'csv' })).toEqual({ format: 'csv', fulfilmentStatus: 'to_pack', mode: 'live' });
    expect(packingListQuerySchema.parse({ format: 'csv', mode: 'test' })).toMatchObject({ mode: 'test' });
    expect(packingListQuerySchema.safeParse({ format: 'csv', mode: 'sandbox' }).success).toBe(false);
    expect(packingListQuerySchema.safeParse({ format: 'json' }).success).toBe(false);
  });
});
