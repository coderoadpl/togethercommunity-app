export type CheckoutEvent =
  | { type: 'priceSelected'; priceId: string }
  | { type: 'couponVisibilityChanged'; visible: boolean }
  | { type: 'couponCodeChanged'; couponCode: string };
