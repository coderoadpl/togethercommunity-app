import { describe, expect, it } from 'vitest';

import { createCheckoutState, reduceCheckoutState } from './checkout-state.js';

describe('checkout state', () => {
  it('reveals and prefills a coupon supplied by the URL', () => {
    expect(createCheckoutState('partner20')).toEqual({
      selectedPriceId: null,
      couponVisible: true,
      couponCode: 'partner20',
    });
  });

  it('keeps coupon and price transitions independent', () => {
    const initial = createCheckoutState('');
    const revealed = reduceCheckoutState(initial, { type: 'couponOpened' });
    const entered = reduceCheckoutState(revealed, {
      type: 'couponCodeChanged',
      couponCode: 'SAVE20',
    });
    const selected = reduceCheckoutState(entered, {
      type: 'priceSelected',
      priceId: 'price-yearly',
    });

    expect(selected).toEqual({
      selectedPriceId: 'price-yearly',
      couponVisible: true,
      couponCode: 'SAVE20',
    });
  });
});
