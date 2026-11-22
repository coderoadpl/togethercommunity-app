import type { PickupPointRejectionReason } from '#core/domain/index.js';

export interface PickedPickupPoint {
  code: string;
  name: string | null;
  address: string | null;
}

export type LockerCheck =
  | { status: 'checking'; code: string }
  | { status: 'found'; code: string; name: string | null; address: string | null }
  | { status: 'rejected'; code: string; reason: PickupPointRejectionReason; name: string | null; address: string | null; byServer?: true }
  | { status: 'unavailable'; code: string };

export type CheckoutEvent =
  | { type: 'priceSelected'; priceId: string }
  | { type: 'couponVisibilityChanged'; visible: boolean }
  | { type: 'couponCodeChanged'; couponCode: string }
  | { type: 'shippingRateSelected'; rateId: string }
  | { type: 'pickupPointCodeChanged'; code: string }
  | { type: 'pickupPointSelected'; point: PickedPickupPoint }
  | { type: 'lockerCheckChanged'; check: LockerCheck };

export type LockerPickerEvent =
  | { type: 'pickerOpened' }
  | { type: 'pointSelected' }
  | { type: 'mapFailed' }
  | { type: 'mapRetryRequested' }
  | { type: 'pickerCancelled' };
