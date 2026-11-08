import { describe, expect, it } from 'vitest';

import {
  buildShipxShipmentRequest,
  configureShipxInputSchema,
  largestParcelTemplate,
  normalizeShipxPhone,
  sanitizeShipxError,
  shipxAttemptUnconfirmed,
  shipxClientKind,
  shipxOfferToBuy,
  shipxPurchaseFailure,
  shipxReference,
  shipxRejected,
  shipxSenderSchema,
  shipxServiceFor,
  shipxShipmentBought,
  splitPersonName,
  splitStreetAddress,
  type OrderShipping,
  type ShipxRemoteShipment,
} from './index.js';

const sender = shipxSenderSchema.parse({
  name: 'Anna Sender', email: 'shop@example.org', phone: '+48 500 600 700',
  street: 'Factory Street', buildingNumber: '7', city: 'Warsaw', postCode: '00-001',
});

const shipping = (change: Partial<OrderShipping> = {}): OrderShipping => ({
  rateId: 'locker', label: 'Parcel locker', amountCents: 1499, vatRatePercent: 23, carrier: 'inpost',
  pickupPoint: { provider: 'inpost', code: 'WAW01M', name: null, address: null },
  address: { name: 'Jane Maria Buyer', line1: 'ul. Dluga 12/4', line2: null, postalCode: '00-950', city: 'Warsaw', country: 'PL' },
  phone: '+48 500 000 000',
  ...change,
});

const remote = (change: Partial<ShipxRemoteShipment>): ShipxRemoteShipment => ({
  id: '1', status: 'created', trackingNumber: null, offers: [], selectedOffer: null, transactions: [], ...change,
});

describe('ShipX domain', () => {
  it('picks the largest parcel template and defaults to medium', () => {
    expect(largestParcelTemplate(['small', 'large', 'medium'])).toBe('large');
    expect(largestParcelTemplate(['small'])).toBe('small');
    expect(largestParcelTemplate([])).toBe('medium');
  });

  it('derives the service from the carrier and pickup point', () => {
    expect(shipxServiceFor(shipping())).toBe('inpost_locker_standard');
    expect(shipxServiceFor(shipping({ pickupPoint: null }))).toBe('inpost_courier_standard');
    expect(shipxServiceFor(shipping({ carrier: 'other' }))).toBeNull();
  });

  it('normalises Polish phone numbers to nine digits', () => {
    expect(normalizeShipxPhone('+48 500 600 700')).toBe('500600700');
    expect(normalizeShipxPhone('0048500600700')).toBe('500600700');
    expect(normalizeShipxPhone('500-600-700')).toBe('500600700');
    expect(normalizeShipxPhone('+49 1512 3456789')).toBeNull();
    expect(normalizeShipxPhone('12345')).toBeNull();
  });

  it('splits names and street lines', () => {
    expect(splitPersonName('Jane Maria Buyer')).toEqual({ firstName: 'Jane Maria', lastName: 'Buyer' });
    expect(splitPersonName('Cher')).toEqual({ firstName: 'Cher', lastName: 'Cher' });
    expect(splitStreetAddress('ul. Dluga 12/4', null)).toEqual({ street: 'ul. Dluga', buildingNumber: '12/4' });
    expect(splitStreetAddress('Aleje Jerozolimskie 123A', 'lok. 5')).toEqual({ street: 'Aleje Jerozolimskie', buildingNumber: '123A lok. 5' });
    expect(splitStreetAddress('Garden Street 5 m. 7', null)).toEqual({ street: 'Garden Street', buildingNumber: '5 m. 7' });
    expect(splitStreetAddress('Rynek', '3')).toEqual({ street: 'Rynek', buildingNumber: '3' });
    expect(splitStreetAddress('Rynek', null)).toBeNull();
  });

  it.each([
    ['Czerniakowska 87A', { street: 'Czerniakowska', buildingNumber: '87A' }],
    ['Dluga 5/12', { street: 'Dluga', buildingNumber: '5/12' }],
    ['Dluga 5 / 12', { street: 'Dluga', buildingNumber: '5 / 12' }],
    ['Krotka 3 m. 4', { street: 'Krotka', buildingNumber: '3 m. 4' }],
    ['Prosta 10 lok 2', { street: 'Prosta', buildingNumber: '10 lok 2' }],
    ['al. Jerozolimskie 123B', { street: 'al. Jerozolimskie', buildingNumber: '123B' }],
    ['  Dluga   5/12b  ', { street: 'Dluga', buildingNumber: '5/12b' }],
    ['3 Maja 7', { street: '3 Maja', buildingNumber: '7' }],
    ['Prosta 10/', null],
    ['Prosta', null],
    ['', null],
  ])('splits %j into the street and the building number', (line, expected) => {
    expect(splitStreetAddress(line, null)).toEqual(expected);
  });

  it('takes the building number from the second line when the first has none', () => {
    expect(splitStreetAddress('Plac Zamkowy', ' 4 m. 2 ')).toEqual({ street: 'Plac Zamkowy', buildingNumber: '4 m. 2' });
    expect(splitStreetAddress('', '4')).toBeNull();
  });

  it('splits a 10 000-character address line in linear time', () => {
    const numbers = `Dluga${' 1'.repeat(4_997)}`;
    const spaces = `Dluga${' '.repeat(9_990)}x`;
    const startedAt = performance.now();
    expect(splitStreetAddress(numbers, null)).toEqual({ street: numbers.slice(0, -2), buildingNumber: '1' });
    expect(splitStreetAddress(spaces, null)).toBeNull();
    expect(performance.now() - startedAt).toBeLessThan(50);
  });

  it('builds a locker request without an address and a courier request with one', () => {
    const locker = buildShipxShipmentRequest({ orderId: 'order-1', memberEmail: 'buyer@example.org', shipping: shipping(), sender, parcelTemplate: 'small' });
    expect(locker).toEqual({
      ok: true,
      value: {
        reference: 'order-1', service: 'inpost_locker_standard', parcelTemplate: 'small', targetPoint: 'WAW01M', sender,
        receiver: { firstName: 'Jane Maria', lastName: 'Buyer', email: 'buyer@example.org', phone: '500000000', address: null },
      },
    });
    const courier = buildShipxShipmentRequest({ orderId: 'order-1', memberEmail: 'buyer@example.org', shipping: shipping({ pickupPoint: null }), sender, parcelTemplate: 'medium' });
    expect(courier).toMatchObject({
      ok: true,
      value: {
        service: 'inpost_courier_standard', targetPoint: null,
        receiver: { address: { street: 'ul. Dluga', buildingNumber: '12/4', city: 'Warsaw', postCode: '00-950', countryCode: 'PL' } },
      },
    });
  });

  it('refuses requests ShipX cannot accept', () => {
    const input = { orderId: 'order-1', memberEmail: 'buyer@example.org', sender, parcelTemplate: 'small' as const };
    expect(buildShipxShipmentRequest({ ...input, shipping: shipping({ phone: null }) })).toMatchObject({ ok: false, error: { code: 'validation' } });
    expect(buildShipxShipmentRequest({ ...input, shipping: shipping({ carrier: 'other' }) })).toMatchObject({ ok: false, error: { code: 'validation' } });
    expect(buildShipxShipmentRequest({
      ...input,
      shipping: shipping({ pickupPoint: null, address: { ...shipping().address, line1: 'Rynek' } }),
    })).toMatchObject({ ok: false, error: { code: 'validation', message: 'The building number cannot be read from the delivery address', details: { state: 'receiver_invalid', field: 'building_number' } } });
  });

  it('treats a shipment as bought only with a tracking number past the offer stages', () => {
    expect(shipxShipmentBought(remote({ status: 'confirmed', trackingNumber: '6001' }))).toBe(true);
    expect(shipxShipmentBought(remote({ status: 'offer_selected', trackingNumber: '6001' }))).toBe(false);
    expect(shipxShipmentBought(remote({ status: 'confirmed' }))).toBe(false);
  });

  it('chooses an offer to buy only when no purchase is running', () => {
    const selected = { id: '7', status: 'selected', service: 'inpost_locker_standard' };
    expect(shipxOfferToBuy(remote({ status: 'offer_selected', selectedOffer: selected, transactions: [{ status: 'failure' }] }), 'inpost_locker_standard')).toBe('7');
    expect(shipxOfferToBuy(remote({ status: 'offer_selected', selectedOffer: selected, transactions: [{ status: 'initiated' }] }), 'inpost_locker_standard')).toBeNull();
    expect(shipxOfferToBuy(remote({
      status: 'offers_prepared',
      offers: [{ id: '8', status: 'available', service: 'inpost_courier_standard' }, { id: '9', status: 'available', service: 'inpost_locker_standard' }],
    }), 'inpost_locker_standard')).toBe('9');
    expect(shipxOfferToBuy(remote({ status: 'confirmed', selectedOffer: selected }), 'inpost_locker_standard')).toBeNull();
  });

  it('selects the ShipX client from the environment and the order mode', () => {
    expect(shipxClientKind('sandbox', 'test')).toEqual({ ok: true, value: 'real' });
    expect(shipxClientKind('sandbox', 'live')).toEqual({
      ok: false,
      error: { code: 'validation', message: 'ShipX is configured for the sandbox; switch to production before shipping paid orders', details: { state: 'setup_missing', reason: 'sandbox_environment' } },
    });
    expect(shipxClientKind('production', 'live')).toEqual({ ok: true, value: 'real' });
    expect(shipxClientKind('production', 'test')).toEqual({ ok: true, value: 'fake' });
  });

  it('recognises an attempt that ShipX never confirmed and keeps the reference within the ShipX limit', () => {
    expect(shipxAttemptUnconfirmed({ shipxShipmentId: null, createAttemptedAt: '2026-11-08T10:00:00.000Z' })).toBe(true);
    expect(shipxAttemptUnconfirmed({ shipxShipmentId: null, createAttemptedAt: null })).toBe(false);
    expect(shipxAttemptUnconfirmed({ shipxShipmentId: '1', createAttemptedAt: '2026-11-08T10:00:00.000Z' })).toBe(false);
    expect(shipxReference('x'.repeat(120))).toHaveLength(100);
  });

  it('reports a failed payment or a dead offer and ignores running or earlier failures', () => {
    expect(shipxPurchaseFailure(remote({ status: 'offer_selected', transactions: [{ status: 'failure' }] }), 'inpost_locker_standard', 0)).toMatchObject({
      code: 'shipx_rejected', details: { error: 'transaction_failed', state: 'failed' },
    });
    expect(shipxPurchaseFailure(remote({ status: 'offer_selected', transactions: [{ status: 'failure' }] }), 'inpost_locker_standard', 1)).toBeNull();
    expect(shipxPurchaseFailure(remote({ status: 'offer_selected', transactions: [{ status: 'failure' }, { status: 'initiated' }] }), 'inpost_locker_standard', 0)).toBeNull();
    expect(shipxPurchaseFailure(remote({
      status: 'offers_prepared',
      offers: [{ id: '9', status: 'expired', service: 'inpost_locker_standard', unavailabilityReasons: ['Offer\nexpired'] }],
    }), 'inpost_locker_standard', 0)).toMatchObject({ code: 'shipx_rejected', message: 'The InPost offer expired before it was paid', details: { description: 'Offer expired' } });
    expect(shipxPurchaseFailure(remote({
      status: 'offers_prepared',
      offers: [{ id: '9', status: 'available', service: 'inpost_locker_standard' }],
    }), 'inpost_locker_standard', 0)).toBeNull();
    expect(shipxPurchaseFailure(remote({ status: 'confirmed', trackingNumber: '6001', transactions: [{ status: 'failure' }] }), 'inpost_locker_standard', 0)).toBeNull();
  });

  it('keeps only error keys, a short description and field keys from ShipX error bodies', () => {
    const sanitized = sanitizeShipxError(400, {
      status: 400,
      error: 'validation_failed',
      description: 'Some data are invalid.\nCheck details.',
      details: { receiver: [{ phone: ['invalid'], email: ['Bearer abc.def'] }], 'bad key!': ['invalid'], parcels: { template: ['required'] } },
      token: 'Bearer leaked',
    });
    expect(sanitized).toEqual({
      status: 400,
      error: 'validation_failed',
      description: 'Some data are invalid. Check details.',
      fields: { 'receiver.0.phone': ['invalid'], 'parcels.template': ['required'] },
    });
    expect(JSON.stringify(sanitized)).not.toContain('leaked');
    expect(sanitizeShipxError(502, '<html>gateway</html>')).toEqual({ status: 502, error: null, description: null, fields: {} });
    expect(sanitizeShipxError(400, { error: 'Not A Key', description: 'x'.repeat(400) })).toMatchObject({ error: null, description: 'x'.repeat(300) });
  });

  it('maps known ShipX errors to readable messages', () => {
    expect(shipxRejected({ status: 400, error: 'invalid_action', description: null, fields: {} })).toMatchObject({
      code: 'shipx_rejected', message: 'The InPost label is available only after the shipment is paid',
    });
    expect(shipxRejected({ status: 401, error: null, description: null, fields: {} }).message).toBe('InPost rejected the stored ShipX token');
    expect(shipxRejected({ status: 409, error: 'unknown_key', description: null, fields: {} }).message).toBe('InPost rejected the request (HTTP 409)');
  });

  it('validates the sender and the settings input', () => {
    expect(sender.phone).toBe('+48 500 600 700');
    expect(shipxSenderSchema.safeParse({ ...sender, phone: '123' }).success).toBe(false);
    expect(shipxSenderSchema.safeParse({ ...sender, postCode: '00001' }).success).toBe(false);
    expect(configureShipxInputSchema.safeParse({ organizationId: '12a' }).success).toBe(false);
    expect(configureShipxInputSchema.safeParse({ environment: 'staging' }).success).toBe(false);
    expect(configureShipxInputSchema.safeParse({ unexpected: true }).success).toBe(false);
    expect(configureShipxInputSchema.parse({ organizationId: ' 1234 ', token: ' abc ' })).toEqual({ organizationId: '1234', token: 'abc' });
  });
});
