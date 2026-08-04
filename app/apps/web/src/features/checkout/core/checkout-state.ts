import type { CheckoutEvent } from './events.js';

export interface CheckoutState {
  selectedPriceId: string | null;
  couponVisible: boolean;
  couponCode: string;
}

export const createCheckoutState = (couponCode: string): CheckoutState => ({
  selectedPriceId: null,
  couponVisible: couponCode !== '',
  couponCode,
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
  }
};
