import {
  inpostGeowidgetPointSchema,
  normalizePickupPointCode,
  pickupPointCodeValid,
  pickupPointDetails,
  pickupPointRejectionReason,
  type CheckoutShippingInput,
  type ParcelLockerLookup,
  type PublicShippingRate,
} from '#core/domain/index.js';

import type { CheckoutEvent, LockerCheck, PickedPickupPoint } from './events.js';

export interface CheckoutState {
  selectedPriceId: string | null;
  couponVisible: boolean;
  couponCode: string;
  shippingRateId: string | null;
  pickupPointCode: string;
  pickupPoint: PickedPickupPoint | null;
  lockerCheck: LockerCheck | null;
}

export const createCheckoutState = (couponCode: string): CheckoutState => ({
  selectedPriceId: null,
  couponVisible: couponCode !== '',
  couponCode,
  shippingRateId: null,
  pickupPointCode: '',
  pickupPoint: null,
  lockerCheck: null,
});

const lockerCheckFor = (check: LockerCheck | null, code: string): LockerCheck | null =>
  check !== null && check.code === normalizePickupPointCode(code) ? check : null;

const refusedByServer = (current: LockerCheck | null, next: LockerCheck): boolean =>
  current?.status === 'rejected' && current.byServer === true && current.code === next.code &&
  !(next.status === 'rejected' && next.byServer === true);

export const reduceCheckoutState = (
  state: CheckoutState,
  event: CheckoutEvent,
): CheckoutState => {
  switch (event.type) {
    case 'priceSelected':
      return { ...state, selectedPriceId: event.priceId };
    case 'couponVisibilityChanged':
      return { ...state, couponVisible: event.visible };
    case 'couponCodeChanged':
      return { ...state, couponCode: event.couponCode };
    case 'shippingRateSelected':
      return { ...state, shippingRateId: event.rateId };
    case 'pickupPointCodeChanged':
      return { ...state, pickupPointCode: event.code.toUpperCase(), lockerCheck: lockerCheckFor(state.lockerCheck, event.code) };
    case 'pickupPointSelected':
      return { ...state, pickupPointCode: event.point.code, pickupPoint: event.point, lockerCheck: lockerCheckFor(state.lockerCheck, event.point.code) };
    case 'lockerCheckChanged':
      return event.check.code === normalizePickupPointCode(state.pickupPointCode) && !refusedByServer(state.lockerCheck, event.check)
        ? { ...state, lockerCheck: event.check }
        : state;
  }
};

export const pickedPickupPoint = (state: CheckoutState): PickedPickupPoint | null =>
  state.pickupPoint !== null && normalizePickupPointCode(state.pickupPointCode) === state.pickupPoint.code ? state.pickupPoint : null;

export const typedLockerCheck = (state: CheckoutState): LockerCheck | null =>
  pickedPickupPoint(state) === null && state.lockerCheck !== null && state.lockerCheck.code === normalizePickupPointCode(state.pickupPointCode)
    ? state.lockerCheck
    : null;

export const lockerRejection = (state: CheckoutState): Extract<LockerCheck, { status: 'rejected' }> | null =>
  state.lockerCheck?.status === 'rejected' && state.lockerCheck.code === normalizePickupPointCode(state.pickupPointCode) ? state.lockerCheck : null;

export const lockerCheckDue = (state: CheckoutState): string | null => {
  if (pickedPickupPoint(state) !== null || !pickupPointCodeValid(state.pickupPointCode)) return null;
  const check = typedLockerCheck(state);
  return check === null || check.status === 'checking' ? normalizePickupPointCode(state.pickupPointCode) : null;
};

export const lockerCheckFrom = (code: string, lookup: ParcelLockerLookup | null): LockerCheck => {
  if (lookup === null || lookup.status === 'unavailable') return { status: 'unavailable', code };
  if (lookup.status === 'not_found') return { status: 'rejected', code, reason: 'not_found', name: null, address: null };
  const point = { code, name: lookup.name, address: lookup.address };
  return lookup.reason === null ? { status: 'found', ...point } : { status: 'rejected', ...point, reason: lookup.reason };
};

export const lockerRefusal = (code: string, details: unknown): LockerCheck | null => {
  const reason = pickupPointRejectionReason(details);
  return reason === null ? null : { status: 'rejected', code: normalizePickupPointCode(code), reason, name: null, address: null, byServer: true };
};

export type DeliverySelection =
  | { status: 'not_required' }
  | { status: 'incomplete'; missing: 'rate' | 'pickup_point' | 'pickup_point_rejected' }
  | { status: 'ready'; shipping: CheckoutShippingInput };

export const selectDelivery = (
  state: CheckoutState,
  input: { required: boolean; rates: PublicShippingRate[] },
): DeliverySelection => {
  if (!input.required) return { status: 'not_required' };
  const rate = input.rates.find((candidate) => candidate.id === state.shippingRateId);
  if (rate === undefined) return { status: 'incomplete', missing: 'rate' };
  if (rate.pickupPoint === 'none') return { status: 'ready', shipping: { rateId: rate.id } };
  if (!pickupPointCodeValid(state.pickupPointCode)) return { status: 'incomplete', missing: 'pickup_point' };
  const code = normalizePickupPointCode(state.pickupPointCode);
  const picked = pickedPickupPoint(state);
  if (lockerRejection(state) !== null) return { status: 'incomplete', missing: 'pickup_point_rejected' };
  return {
    status: 'ready',
    shipping: {
      rateId: rate.id,
      pickupPoint: {
        provider: 'inpost',
        code,
        ...(picked?.name == null ? {} : { name: picked.name }),
        ...(picked?.address == null ? {} : { address: picked.address }),
      },
    },
  };
};

export const deliveryPickupPointCode = (delivery: DeliverySelection): string | null =>
  delivery.status === 'ready' ? delivery.shipping.pickupPoint?.code ?? null : null;

export const submitLockerCheckDue = (state: CheckoutState, delivery: DeliverySelection): string | null =>
  deliveryPickupPointCode(delivery) === null ? null : lockerCheckDue(state);

export const parseGeowidgetPoint = (detail: unknown): PickedPickupPoint | null => {
  const parsed = inpostGeowidgetPointSchema.safeParse(detail);
  if (!parsed.success || !pickupPointCodeValid(parsed.data.name)) return null;
  return pickupPointDetails({
    name: parsed.data.name,
    locationDescription: parsed.data.location_description ?? null,
    address: parsed.data.address == null ? null : { line1: parsed.data.address.line1 ?? null, line2: parsed.data.address.line2 ?? null },
  });
};

export type GeowidgetAccess =
  | { status: 'map'; token: string }
  | { status: 'withheld_for_staff' }
  | { status: 'unavailable' };

export const geowidgetAccess = (input: {
  token: string | null;
  staffSession: boolean;
  testMode: boolean;
}): GeowidgetAccess => {
  if (input.token === null) return { status: 'unavailable' };
  if (input.staffSession || input.testMode) return { status: 'withheld_for_staff' };
  return { status: 'map', token: input.token };
};
