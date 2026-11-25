import { describe, expect, it } from 'vitest';

import type { PublicShippingRate } from '#core/domain/index.js';

import { createCheckoutState, geowidgetAccess, lockerCheckDue, lockerCheckFrom, lockerRefusal, lockerRejection, parseGeowidgetPoint, pickedPickupPoint, reduceCheckoutState, selectDelivery, submitLockerCheckDue, typedLockerCheck } from './checkout-state.js';

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
      lockerPhone: '',
      lockerPhoneValidationFailed: false,
      pickupPoint: null,
      lockerCheck: null,
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

const withPhone = () => reduceCheckoutState(createCheckoutState(''), { type: 'lockerPhoneChanged', phone: '500000000' });

describe('delivery selection', () => {
  it('requires a Polish phone for lockers, persists it between rates, and ignores it for couriers', () => {
    const locker = { ...createCheckoutState(''), shippingRateId: 'locker', pickupPointCode: 'ABC01M' };
    expect(selectDelivery(locker, { required: true, rates })).toEqual({ status: 'incomplete', missing: 'locker_phone' });
    const foreign = reduceCheckoutState(locker, { type: 'lockerPhoneChanged', phone: '+44 7700 900000' });
    expect(selectDelivery(foreign, { required: true, rates })).toEqual({ status: 'incomplete', missing: 'locker_phone' });
    const valid = reduceCheckoutState(foreign, { type: 'lockerPhoneChanged', phone: '500 000 000' });
    expect(selectDelivery(valid, { required: true, rates })).toMatchObject({ status: 'ready', shipping: { phone: '+48500000000' } });
    const rejected = reduceCheckoutState(valid, { type: 'lockerPhoneValidationFailed', phone: valid.lockerPhone });
    expect(selectDelivery(rejected, { required: true, rates })).toEqual({ status: 'incomplete', missing: 'locker_phone' });
    const courier = reduceCheckoutState(rejected, { type: 'shippingRateSelected', rateId: 'courier' });
    expect(courier.lockerPhone).toBe('500 000 000');
    expect(selectDelivery(courier, { required: true, rates })).toEqual({ status: 'ready', shipping: { rateId: 'courier' } });
    const corrected = reduceCheckoutState(rejected, { type: 'lockerPhoneChanged', phone: '+48 500 000 000' });
    expect(selectDelivery(corrected, { required: true, rates }).status).toBe('ready');
    expect(reduceCheckoutState(corrected, { type: 'lockerPhoneValidationFailed', phone: '500 000 000' })).toEqual(corrected);
  });

  it('needs nothing when no product is shipped', () => {
    expect(selectDelivery(withPhone(), { required: false, rates })).toEqual({ status: 'not_required' });
  });

  it('waits for a rate, then for a valid locker code on a locker rate', () => {
    const initial = withPhone();
    expect(selectDelivery(initial, { required: true, rates })).toEqual({ status: 'incomplete', missing: 'rate' });
    const locker = reduceCheckoutState(initial, { type: 'shippingRateSelected', rateId: 'locker' });
    expect(selectDelivery(locker, { required: true, rates })).toEqual({ status: 'incomplete', missing: 'pickup_point' });
    const invalid = reduceCheckoutState(locker, { type: 'pickupPointCodeChanged', code: 'waw-1' });
    expect(invalid.pickupPointCode).toBe('WAW-1');
    expect(selectDelivery(invalid, { required: true, rates })).toEqual({ status: 'incomplete', missing: 'pickup_point' });
    const typed = reduceCheckoutState(locker, { type: 'pickupPointCodeChanged', code: ' waw01m' });
    expect(selectDelivery(typed, { required: true, rates })).toEqual({ status: 'ready', shipping: { rateId: 'locker', phone: '+48500000000', pickupPoint: { provider: 'inpost', code: 'WAW01M' } } });
  });

  it('ignores the locker for a courier rate and rejects an unknown rate', () => {
    const courier = reduceCheckoutState(withPhone(), { type: 'shippingRateSelected', rateId: 'courier' });
    expect(selectDelivery(courier, { required: true, rates })).toEqual({ status: 'ready', shipping: { rateId: 'courier' } });
    const unknown = reduceCheckoutState(courier, { type: 'shippingRateSelected', rateId: 'retired' });
    expect(selectDelivery(unknown, { required: true, rates })).toEqual({ status: 'incomplete', missing: 'rate' });
  });

  it('sends the picked locker name and address while the code names that locker, also after the code is edited back', () => {
    const locker = reduceCheckoutState(withPhone(), { type: 'shippingRateSelected', rateId: 'locker' });
    const picked = reduceCheckoutState(locker, { type: 'pickupPointSelected', point: { code: 'KRA010', name: 'Next to the shop', address: 'Main Street 1, Cracow' } });
    expect(picked.pickupPointCode).toBe('KRA010');
    expect(selectDelivery(picked, { required: true, rates })).toEqual({ status: 'ready', shipping: { rateId: 'locker', phone: '+48500000000', pickupPoint: { provider: 'inpost', code: 'KRA010', name: 'Next to the shop', address: 'Main Street 1, Cracow' } } });
    const edited = reduceCheckoutState(picked, { type: 'pickupPointCodeChanged', code: 'KRA011' });
    expect(pickedPickupPoint(edited)).toBeNull();
    expect(selectDelivery(edited, { required: true, rates })).toEqual({ status: 'ready', shipping: { rateId: 'locker', phone: '+48500000000', pickupPoint: { provider: 'inpost', code: 'KRA011' } } });
    const retyped = reduceCheckoutState(edited, { type: 'pickupPointCodeChanged', code: 'kra010' });
    expect(pickedPickupPoint(retyped)).toEqual({ code: 'KRA010', name: 'Next to the shop', address: 'Main Street 1, Cracow' });
    expect(selectDelivery(retyped, { required: true, rates })).toEqual({ status: 'ready', shipping: { rateId: 'locker', phone: '+48500000000', pickupPoint: { provider: 'inpost', code: 'KRA010', name: 'Next to the shop', address: 'Main Street 1, Cracow' } } });
  });

  it('parses the point chosen on the parcel locker map', () => {
    expect(parseGeowidgetPoint({ name: 'kra010', location_description: 'Next to the shop', address: { line1: 'Main Street 1', line2: '30-001 Cracow' } }))
      .toEqual({ code: 'KRA010', name: 'Next to the shop', address: 'Main Street 1, 30-001 Cracow' });
    expect(parseGeowidgetPoint({ name: 'KRA010' })).toEqual({ code: 'KRA010', name: null, address: null });
    expect(parseGeowidgetPoint({ name: 'not a code' })).toBeNull();
    expect(parseGeowidgetPoint(null)).toBeNull();
  });

  it('offers the parcel locker map only to a buyer without a staff session in live mode', () => {
    expect(geowidgetAccess({ token: 'public-map-token', staffSession: false, testMode: false })).toEqual({ status: 'map', token: 'public-map-token' });
    expect(geowidgetAccess({ token: 'public-map-token', staffSession: true, testMode: false })).toEqual({ status: 'withheld_for_staff' });
    expect(geowidgetAccess({ token: 'public-map-token', staffSession: true, testMode: true })).toEqual({ status: 'withheld_for_staff' });
    expect(geowidgetAccess({ token: 'public-map-token', staffSession: false, testMode: true })).toEqual({ status: 'withheld_for_staff' });
    expect(geowidgetAccess({ token: null, staffSession: false, testMode: false })).toEqual({ status: 'unavailable' });
    expect(geowidgetAccess({ token: null, staffSession: true, testMode: true })).toEqual({ status: 'unavailable' });
  });
});

describe('typed locker code check', () => {
  const typed = (code: string) => reduceCheckoutState(
    reduceCheckoutState(withPhone(), { type: 'shippingRateSelected', rateId: 'locker' }),
    { type: 'pickupPointCodeChanged', code },
  );

  it('asks for a check once per valid typed code and never for a malformed one or a map choice', () => {
    expect(lockerCheckDue(typed('waw'))).toBeNull();
    expect(lockerCheckDue(typed('waw01m'))).toBe('WAW01M');
    const checking = reduceCheckoutState(typed('waw01m'), { type: 'lockerCheckChanged', check: { status: 'checking', code: 'WAW01M' } });
    expect(lockerCheckDue(checking)).toBe('WAW01M');
    const found = reduceCheckoutState(checking, { type: 'lockerCheckChanged', check: lockerCheckFrom('WAW01M', {
      status: 'found', code: 'WAW01M', name: 'Next to the main entrance', address: 'Main Street 1', usable: true, reason: null,
    }) });
    expect(lockerCheckDue(found)).toBeNull();
    expect(typedLockerCheck(found)).toEqual({ status: 'found', code: 'WAW01M', name: 'Next to the main entrance', address: 'Main Street 1' });
    const mapped = reduceCheckoutState(typed(''), { type: 'pickupPointSelected', point: { code: 'KRA14A', name: null, address: null } });
    expect(lockerCheckDue(mapped)).toBeNull();
  });

  it('blocks the delivery for a refused code and forgets the verdict when the code changes', () => {
    const refused = reduceCheckoutState(typed('missing1'), { type: 'lockerCheckChanged', check: lockerCheckFrom('MISSING1', { status: 'not_found' }) });
    expect(selectDelivery(refused, { required: true, rates })).toEqual({ status: 'incomplete', missing: 'pickup_point_rejected' });
    const edited = reduceCheckoutState(refused, { type: 'pickupPointCodeChanged', code: 'waw01m' });
    expect(typedLockerCheck(edited)).toBeNull();
    expect(selectDelivery(edited, { required: true, rates })).toMatchObject({ status: 'ready' });
  });

  it('lets the buyer pay when the carrier cannot be asked', () => {
    const unavailable = reduceCheckoutState(typed('waw01m'), { type: 'lockerCheckChanged', check: lockerCheckFrom('WAW01M', null) });
    expect(typedLockerCheck(unavailable)).toEqual({ status: 'unavailable', code: 'WAW01M' });
    expect(selectDelivery(unavailable, { required: true, rates })).toMatchObject({ status: 'ready' });
  });

  it('ignores a verdict for a code the buyer has already replaced', () => {
    const state = typed('waw01m');
    expect(reduceCheckoutState(state, { type: 'lockerCheckChanged', check: { status: 'unavailable', code: 'KRA14A' } })).toBe(state);
  });

  it('drops a check in progress once the code changes, so retyping the code shows no stale checking line', () => {
    const checking = reduceCheckoutState(typed('waw01m'), { type: 'lockerCheckChanged', check: { status: 'checking', code: 'WAW01M' } });
    const edited = reduceCheckoutState(checking, { type: 'pickupPointCodeChanged', code: 'waw01' });
    expect(edited.lockerCheck).toBeNull();
    const retyped = reduceCheckoutState(edited, { type: 'pickupPointCodeChanged', code: 'waw01m' });
    expect(typedLockerCheck(retyped)).toBeNull();
    const answered = reduceCheckoutState(retyped, { type: 'lockerCheckChanged', check: lockerCheckFrom('WAW01M', {
      status: 'found', code: 'WAW01M', name: null, address: null, usable: true, reason: null,
    }) });
    expect(typedLockerCheck(answered)).toMatchObject({ status: 'found', code: 'WAW01M' });
  });

  it('honours a server refusal of a map choice until the buyer chooses another point', () => {
    const point = { code: 'KRA010', name: 'Next to the shop', address: 'Main Street 1, Cracow' };
    const picked = reduceCheckoutState(typed(''), { type: 'pickupPointSelected', point });
    expect(lockerCheckDue(picked)).toBeNull();
    const refusal = lockerRefusal('KRA010', { pickupPointReason: 'not_operating' });
    if (refusal === null) throw new Error('Expected a refusal');
    const refused = reduceCheckoutState(picked, { type: 'lockerCheckChanged', check: refusal });
    expect(typedLockerCheck(refused)).toBeNull();
    expect(lockerRejection(refused)).toMatchObject({ code: 'KRA010', reason: 'not_operating' });
    expect(selectDelivery(refused, { required: true, rates })).toEqual({ status: 'incomplete', missing: 'pickup_point_rejected' });
    expect(selectDelivery(reduceCheckoutState(refused, { type: 'pickupPointSelected', point }), { required: true, rates }))
      .toEqual({ status: 'incomplete', missing: 'pickup_point_rejected' });
    const changed = reduceCheckoutState(refused, { type: 'pickupPointSelected', point: { code: 'KRA011', name: null, address: null } });
    expect(lockerRejection(changed)).toBeNull();
    expect(selectDelivery(changed, { required: true, rates })).toMatchObject({ status: 'ready' });
  });

  it('keeps a server refusal of the unchanged code over a preview answer that arrives after it', () => {
    const checking = reduceCheckoutState(typed('waw01m'), { type: 'lockerCheckChanged', check: { status: 'checking', code: 'WAW01M' } });
    const refusal = lockerRefusal('WAW01M', { pickupPointReason: 'not_operating' });
    if (refusal === null) throw new Error('Expected a refusal');
    const refused = reduceCheckoutState(checking, { type: 'lockerCheckChanged', check: refusal });
    const lateFound = reduceCheckoutState(refused, { type: 'lockerCheckChanged', check: lockerCheckFrom('WAW01M', {
      status: 'found', code: 'WAW01M', name: 'Next to the main entrance', address: 'Main Street 1', usable: true, reason: null,
    }) });
    expect(lateFound).toBe(refused);
    expect(reduceCheckoutState(refused, { type: 'lockerCheckChanged', check: lockerCheckFrom('WAW01M', null) })).toBe(refused);
    expect(lockerRejection(lateFound)).toMatchObject({ code: 'WAW01M', reason: 'not_operating' });
    expect(selectDelivery(lateFound, { required: true, rates })).toEqual({ status: 'incomplete', missing: 'pickup_point_rejected' });
    const retyped = reduceCheckoutState(reduceCheckoutState(lateFound, { type: 'pickupPointCodeChanged', code: 'waw01' }), { type: 'pickupPointCodeChanged', code: 'waw01m' });
    const fresh = reduceCheckoutState(retyped, { type: 'lockerCheckChanged', check: lockerCheckFrom('WAW01M', {
      status: 'found', code: 'WAW01M', name: null, address: null, usable: true, reason: null,
    }) });
    expect(typedLockerCheck(fresh)).toMatchObject({ status: 'found' });
  });

  it('runs a submit-time check only when the chosen delivery needs a locker', () => {
    const checking = reduceCheckoutState(typed('missing1'), { type: 'lockerCheckChanged', check: { status: 'checking', code: 'MISSING1' } });
    expect(submitLockerCheckDue(checking, selectDelivery(checking, { required: true, rates }))).toBe('MISSING1');
    const courier = reduceCheckoutState(checking, { type: 'shippingRateSelected', rateId: 'courier' });
    expect(lockerCheckDue(courier)).toBe('MISSING1');
    expect(submitLockerCheckDue(courier, selectDelivery(courier, { required: true, rates }))).toBeNull();
  });

  it('turns an unusable point and a server refusal into a refusal reason', () => {
    expect(lockerCheckFrom('CLOSED01', { status: 'found', code: 'CLOSED01', name: null, address: null, usable: false, reason: 'not_operating' }))
      .toEqual({ status: 'rejected', code: 'CLOSED01', reason: 'not_operating', name: null, address: null });
    expect(lockerRefusal(' sendonly1 ', { pickupPointReason: 'not_usable' })).toEqual({ status: 'rejected', code: 'SENDONLY1', reason: 'not_usable', name: null, address: null, byServer: true });
    expect(lockerRefusal('WAW01M', { fieldErrors: {} })).toBeNull();
  });
});
