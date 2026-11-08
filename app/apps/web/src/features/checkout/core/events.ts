export interface PickedPickupPoint {
  code: string;
  name: string | null;
  address: string | null;
}

export type CheckoutEvent =
  | { type: 'priceSelected'; priceId: string }
  | { type: 'couponVisibilityChanged'; visible: boolean }
  | { type: 'couponCodeChanged'; couponCode: string }
  | { type: 'shippingRateSelected'; rateId: string }
  | { type: 'pickupPointCodeChanged'; code: string }
  | { type: 'pickupPointSelected'; point: PickedPickupPoint };
