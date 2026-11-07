import {
  inpostGeowidgetPointSchema,
  normalizePickupPointCode,
  pickupPointCodeValid,
  type CheckoutShippingInput,
  type PublicShippingRate,
} from '#core/domain/index.js';

import type { CheckoutEvent, PickedPickupPoint } from './events.js';

export interface CheckoutState {
  selectedPriceId: string | null;
  couponVisible: boolean;
  couponCode: string;
  shippingRateId: string | null;
  pickupPointCode: string;
  pickupPoint: PickedPickupPoint | null;
}

export const createCheckoutState = (couponCode: string): CheckoutState => ({
  selectedPriceId: null,
  couponVisible: couponCode !== '',
  couponCode,
  shippingRateId: null,
  pickupPointCode: '',
  pickupPoint: null,
});

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
    case 'pickupPointCodeChanged': {
      const pickupPointCode = event.code.toUpperCase();
      const unchanged = state.pickupPoint !== null && normalizePickupPointCode(pickupPointCode) === state.pickupPoint.code;
      return { ...state, pickupPointCode, pickupPoint: unchanged ? state.pickupPoint : null };
    }
    case 'pickupPointSelected':
      return { ...state, pickupPointCode: event.point.code, pickupPoint: event.point };
  }
};

export type DeliverySelection =
  | { status: 'not_required' }
  | { status: 'incomplete'; missing: 'rate' | 'pickup_point' }
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
  const picked = state.pickupPoint?.code === code ? state.pickupPoint : null;
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

export const parseGeowidgetPoint = (detail: unknown): PickedPickupPoint | null => {
  const parsed = inpostGeowidgetPointSchema.safeParse(detail);
  if (!parsed.success || !pickupPointCodeValid(parsed.data.name)) return null;
  const address = [parsed.data.address?.line1, parsed.data.address?.line2]
    .filter((line): line is string => typeof line === 'string' && line.trim() !== '')
    .map((line) => line.trim())
    .join(', ');
  return {
    code: normalizePickupPointCode(parsed.data.name),
    name: parsed.data.location_description == null || parsed.data.location_description === '' ? null : parsed.data.location_description,
    address: address === '' ? null : address,
  };
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
