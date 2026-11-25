import { describe, expect, it } from 'vitest';
import { correctedOrderShipping, deliveryCorrectionAllowed, deliveryCorrectionInputSchema, type DeliveryCorrectionInput } from './delivery-correction.js';
import { orderShippingSchema, type OrderShipping } from './shipping.js';

const shipping: OrderShipping = {
  rateId: 'locker', label: 'Locker', amountCents: 1200, vatRatePercent: 23, carrier: 'inpost',
  pickupPoint: { provider: 'inpost', code: 'ABC01M', name: null, address: null },
  phone: null, address: { name: 'Example Buyer', line1: 'Example Street 1', line2: null, postalCode: '00-001', city: 'Example City', country: 'PL' },
};
const correct = (input: Omit<DeliveryCorrectionInput, 'expected'> & { expected?: DeliveryCorrectionInput['expected'] }, current = shipping) => correctedOrderShipping(current, {
  input: deliveryCorrectionInputSchema.parse({ ...input, expected: input.expected ?? {
    ...(input.phone === undefined ? {} : { phone: current.phone }),
    ...(input.recipientName === undefined ? {} : { recipientName: current.address.name }),
    ...(input.pickupPoint === undefined ? {} : { pickupPoint: current.pickupPoint?.code ?? null }),
    ...(input.address === undefined ? {} : { address: Object.fromEntries(Object.keys(input.address).map((key) => [key, Object.entries(current.address).find(([field]) => field === key)?.[1]])) }),
  } }), pickupPoint: input.pickupPoint === undefined ? null : { provider: 'inpost', code: input.pickupPoint.code, name: 'Directory name', address: 'Directory address' },
  at: '2026-11-25T10:00:00.000Z', byUserId: 'staff', byEmail: 'staff@example.org',
});

describe('delivery correction', () => {
  it('requires a field and rejects unknown fields, non-storable text and excessive length', () => {
    for (const value of [
      { orderId: 'order' }, { orderId: 'order', phone: '' }, { orderId: 'order', recipientName: '\u0000' },
      { orderId: 'order', phone: 'x'.repeat(41) }, { orderId: 'order', recipientName: 'x'.repeat(201) },
      { orderId: 'order', recipientName: '\ud800' }, { orderId: 'order', phone: '123', corrections: [] },
      { orderId: 'order', address: { ...shipping.address, country: 'GB' } },
    ]) expect(deliveryCorrectionInputSchema.safeParse(value).success).toBe(false);
  });
  it('normalizes a locker phone and appends one audit entry per changed field', () => {
    const result = correct({ orderId: 'order', phone: ' 500 000 000 ', recipientName: ' Corrected Buyer ', pickupPoint: { code: 'ABC02M' },
      address: { line1: 'Example Street 2', line2: '3', postalCode: '00-002', city: 'Other City' } });
    expect(result).toMatchObject({ ok: true, value: { phone: '+48500000000', address: { country: 'PL', name: 'Corrected Buyer' }, pickupPoint: { code: 'ABC02M', name: 'Directory name' }, corrections: [
      { field: 'phone', from: null, to: '+48500000000', byEmail: 'staff@example.org' },
      { field: 'recipient_name', from: 'Example Buyer', to: 'Corrected Buyer' },
      { field: 'address', from: 'Example Street 1, 00-001 Example City', to: 'Example Street 2, 3, 00-002 Other City' },
      { field: 'pickup_point', from: 'ABC01M', to: 'ABC02M' },
    ] } });
    if (!result.ok) throw new Error('Correction failed');
    const again = correct({ orderId: 'order', recipientName: 'Another Buyer' }, result.value);
    expect(again.ok && again.value.corrections).toHaveLength(5);
  });
  it('rejects a foreign locker phone but accepts it for another carrier', () => {
    expect(correct({ orderId: 'order', phone: '+44 7700 900000' })).toMatchObject({ ok: false, error: { code: 'locker_phone_invalid' } });
    expect(correct({ orderId: 'order', phone: '+44 7700 900000' }, { ...shipping, carrier: 'other', pickupPoint: null })).toMatchObject({ ok: true, value: { phone: '+44 7700 900000' } });
  });
  it('rejects foreign and zero-prefixed InPost courier phones and stores canonical numbers', () => {
    const courier = { ...shipping, pickupPoint: null };
    for (const phone of ['+44 7700 900000', '050000000']) expect(correct({ orderId: 'order', phone }, courier)).toMatchObject({ ok: false, error: { code: 'locker_phone_invalid' } });
    expect(correct({ orderId: 'order', phone: '500 000 000' }, courier)).toMatchObject({ ok: true, value: { phone: '+48500000000' } });
  });
  it('rejects a stale field but preserves unrelated concurrent address changes', () => {
    expect(correct({ orderId: 'order', phone: '500000000', expected: { phone: '+48600000000' } })).toMatchObject({ ok: false, error: { code: 'delivery_correction_conflict' } });
    expect(correct({ orderId: 'order', address: { line1: 'Street 2' }, expected: { address: { line1: shipping.address.line1 } } }, { ...shipping, address: { ...shipping.address, city: 'Concurrent City' } })).toMatchObject({ ok: true, value: { address: { line1: 'Street 2', city: 'Concurrent City' } } });
    expect(correct({ orderId: 'order', address: { line1: 'Street 2' }, expected: { address: { line1: 'Stale Street' } } })).toMatchObject({ ok: false, error: { code: 'delivery_correction_conflict' } });
  });
  it('compares the exact stored address, including whitespace and empty second lines', () => {
    const current = { ...shipping, address: { ...shipping.address, line1: ' Street 1 ', line2: '' } };
    expect(correct({ orderId: 'order', address: { line1: 'Street 2', line2: null }, expected: { address: { line1: ' Street 1 ', line2: '' } } }, current)).toMatchObject({ ok: true, value: { address: { line1: 'Street 2', line2: null } } });
  });
  it('requires an expected value for every changed field', () => {
    expect(deliveryCorrectionInputSchema.safeParse({ orderId: 'order', phone: '500000000', expected: {} }).success).toBe(false);
    expect(deliveryCorrectionInputSchema.safeParse({ orderId: 'order', address: { city: 'City' }, expected: { address: { line1: 'Street' } } }).success).toBe(false);
  });
  it('rejects invalid postal codes, unsupported countries and lockers on courier orders', () => {
    expect(correct({ orderId: 'order', address: { line1: 'Street 2', line2: null, postalCode: '12345', city: 'City' } })).toMatchObject({ ok: false, error: { details: { deliveryCorrection: 'postal_code' } } });
    expect(correct({ orderId: 'order', phone: '500000000' }, { ...shipping, address: { ...shipping.address, country: 'GB' } })).toMatchObject({ ok: false, error: { details: { deliveryCorrection: 'country' } } });
    expect(correct({ orderId: 'order', pickupPoint: { code: 'ABC02M' } }, { ...shipping, pickupPoint: null })).toMatchObject({ ok: false, error: { details: { deliveryCorrection: 'locker_not_allowed' } } });
  });
  it('rejects no-op corrections and preserves the complete audit at its limit', () => {
    expect(correct({ orderId: 'order', recipientName: 'Example Buyer' })).toMatchObject({ ok: false, error: { details: { deliveryCorrection: 'unchanged' } } });
    const full = { ...shipping, corrections: Array.from({ length: 50 }, () => ({ field: 'phone' as const, from: null, to: '+48500000000', at: '2026-11-25T09:00:00.000Z', byUserId: 'staff', byEmail: null })) };
    expect(correct({ orderId: 'order', phone: '500000000' }, full)).toMatchObject({ ok: false, error: { details: { deliveryCorrection: 'history_full' } } });
    expect(full.corrections).toHaveLength(50);
  });
  it('keeps the old shipping shape readable and strips added keys in the previous schema', () => {
    expect(orderShippingSchema.parse(shipping)).toEqual(shipping);
    const result = correct({ orderId: 'order', phone: '500000000' });
    if (!result.ok) throw new Error('Correction failed');
    expect(orderShippingSchema.omit({ corrections: true }).parse(result.value)).toEqual({ ...shipping, phone: '+48500000000' });
    expect(orderShippingSchema.parse({ ...result.value, futureKey: true })).toEqual(result.value);
  });
  it('checks paid to-pack status, bought shipments and active operations', () => {
    const ready = { status: 'paid', fulfilmentStatus: 'to_pack' as const };
    expect(deliveryCorrectionAllowed(ready, [])).toEqual({ ok: true, value: undefined });
    expect(deliveryCorrectionAllowed({ ...ready, fulfilmentStatus: 'shipped' }, [])).toMatchObject({ ok: false, error: { code: 'delivery_correction_shipped' } });
    expect(deliveryCorrectionAllowed({ ...ready, status: 'pending' }, [])).toMatchObject({ ok: false });
    expect(deliveryCorrectionAllowed({ ...ready, fulfilmentStatus: null }, [])).toMatchObject({ ok: false });
    expect(deliveryCorrectionAllowed(ready, [{ status: 'confirmed', trackingNumber: 'TRACK001', boughtAt: null, operationToken: null, providerShipmentId: 'draft', createAttemptedAt: null }])).toMatchObject({ ok: false, error: { code: 'delivery_correction_shipment_bought' } });
    expect(deliveryCorrectionAllowed(ready, [{ status: 'created', trackingNumber: null, boughtAt: null, operationToken: 'lease', providerShipmentId: null, createAttemptedAt: null }])).toMatchObject({ ok: false, error: { code: 'delivery_correction_shipment_exists' } });
    expect(deliveryCorrectionAllowed(ready, [{ status: 'offers_prepared', trackingNumber: null, boughtAt: null, operationToken: null, providerShipmentId: null, createAttemptedAt: null }])).toMatchObject({ ok: true });
  });
});
