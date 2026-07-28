export type CheckoutEvent =
  | { type: 'priceSelected'; priceId: string }
  | { type: 'couponOpened' }
  | { type: 'couponCodeChanged'; couponCode: string };
