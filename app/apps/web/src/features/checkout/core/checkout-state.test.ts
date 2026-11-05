import { describe, expect, it } from 'vitest';

import type { PublicShippingRate } from '#core/domain/index.js';

import { createCheckoutState, parseGeowidgetPoint, reduceCheckoutState, selectDelivery } from './checkout-state.js';

const rates: PublicShippingRate[] = [
  { id: 'locker', label: 'Parcel locker', amountCents: 1499, carrier: 'inpost', pickupPoint: 'inpost_locker' },
  { id: 'courier', label: 'Courier', amountCents: 1999, carrier: 'other', pickupPoint: 'none' },
];

describe('checkout state', () => {
  it('reveals and prefills a coupon supplied by the URL', () => {
    expect(createCheckoutState('partner20')).toEqual({
      selectedPriceId: null,
      couponVisible: true,
      couponCode: 'partner20',
      shippingRateId: null,
      pickupPointCode: '',
      pickupPoint: null,
    });
  });

  it('keeps coupon and price transitions independent', () => {
    const initial = createCheckoutState('');
    const revealed = reduceCheckoutState(initial, { type: 'couponVisibilityChanged', visible: true });
    const entered = reduceCheckoutState(revealed, {
      type: 'couponCodeChanged',
      couponCode: 'SAVE20',
    });
    const selected = reduceCheckoutState(entered, {
      type: 'priceSelected',
      priceId: 'price-yearly',
    });

    expect(selected).toEqual({
      ...initial,
      selectedPriceId: 'price-yearly',
      couponVisible: true,
      couponCode: 'SAVE20',
    });
    expect(reduceCheckoutState(selected, { type: 'couponVisibilityChanged', visible: false })).toEqual({
      ...selected,
      couponVisible: false,
    });
  });
});

describe('delivery selection', () => {
  it('needs nothing when no product is shipped', () => {
    expect(selectDelivery(createCheckoutState(''), { required: false, rates })).toEqual({ status: 'not_required' });
  });

  it('waits for a rate, then for a valid locker code on a locker rate', () => {
    const initial = createCheckoutState('');
    expect(selectDelivery(initial, { required: true, rates })).toEqual({ status: 'incomplete', missing: 'rate' });
    const locker = reduceCheckoutState(initial, { type: 'shippingRateSelected', rateId: 'locker' });
    expect(selectDelivery(locker, { required: true, rates })).toEqual({ status: 'incomplete', missing: 'pickup_point' });
    const invalid = reduceCheckoutState(locker, { type: 'pickupPointCodeChanged', code: 'waw-1' });
    expect(invalid.pickupPointCode).toBe('WAW-1');
    expect(selectDelivery(invalid, { required: true, rates })).toEqual({ status: 'incomplete', missing: 'pickup_point' });
    const typed = reduceCheckoutState(locker, { type: 'pickupPointCodeChanged', code: ' waw01m' });
    expect(selectDelivery(typed, { required: true, rates })).toEqual({ status: 'ready', shipping: { rateId: 'locker', pickupPoint: { provider: 'inpost', code: 'WAW01M' } } });
  });

  it('ignores the locker for a courier rate and rejects an unknown rate', () => {
    const courier = reduceCheckoutState(createCheckoutState(''), { type: 'shippingRateSelected', rateId: 'courier' });
    expect(selectDelivery(courier, { required: true, rates })).toEqual({ status: 'ready', shipping: { rateId: 'courier' } });
    const unknown = reduceCheckoutState(courier, { type: 'shippingRateSelected', rateId: 'retired' });
    expect(selectDelivery(unknown, { required: true, rates })).toEqual({ status: 'incomplete', missing: 'rate' });
  });

  it('sends the picked locker name and address until the code is edited to another locker', () => {
    const locker = reduceCheckoutState(createCheckoutState(''), { type: 'shippingRateSelected', rateId: 'locker' });
    const picked = reduceCheckoutState(locker, { type: 'pickupPointSelected', point: { code: 'KRA010', name: 'Next to the shop', address: 'Main Street 1, Cracow' } });
    expect(picked.pickupPointCode).toBe('KRA010');
    expect(selectDelivery(picked, { required: true, rates })).toEqual({ status: 'ready', shipping: { rateId: 'locker', pickupPoint: { provider: 'inpost', code: 'KRA010', name: 'Next to the shop', address: 'Main Street 1, Cracow' } } });
    const edited = reduceCheckoutState(picked, { type: 'pickupPointCodeChanged', code: 'KRA011' });
    expect(edited.pickupPoint).toBeNull();
    expect(selectDelivery(edited, { required: true, rates })).toEqual({ status: 'ready', shipping: { rateId: 'locker', pickupPoint: { provider: 'inpost', code: 'KRA011' } } });
  });

  it('parses the point chosen on the parcel locker map', () => {
    expect(parseGeowidgetPoint({ name: 'kra010', location_description: 'Next to the shop', address: { line1: 'Main Street 1', line2: '30-001 Cracow' } }))
      .toEqual({ code: 'KRA010', name: 'Next to the shop', address: 'Main Street 1, 30-001 Cracow' });
    expect(parseGeowidgetPoint({ name: 'KRA010' })).toEqual({ code: 'KRA010', name: null, address: null });
    expect(parseGeowidgetPoint({ name: 'not a code' })).toBeNull();
    expect(parseGeowidgetPoint(null)).toBeNull();
  });
});
