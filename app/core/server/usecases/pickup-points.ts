import {
  applyPickupPointLookup,
  err,
  hasActiveParcelLockerRate,
  notFound,
  ok,
  parcelLockerLookupView,
  pickupPointCodeSchema,
  validation,
  type AppError,
  type CheckoutShippingSelection,
  type ParcelLockerLookup,
  type PickupPointLookup,
  type Result,
} from '#core/domain/index.js';

import type { PickupPointDirectory } from '../pickup-point-ports.js';
import type { TenantRepository } from '../ports.js';

const UNAVAILABLE: PickupPointLookup = { kind: 'unavailable' };

const lookUp = async (code: string, directory: PickupPointDirectory | undefined): Promise<PickupPointLookup> =>
  directory === undefined ? UNAVAILABLE : directory.lookup(code);

export const verifyCheckoutPickupPoint = async (
  shipping: CheckoutShippingSelection,
  directory: PickupPointDirectory | undefined,
): Promise<Result<CheckoutShippingSelection, AppError>> => {
  if (shipping.pickupPoint === null) return ok(shipping);
  return applyPickupPointLookup(shipping, await lookUp(shipping.pickupPoint.code, directory));
};

export const lookupParcelLocker = async (
  tenantId: string,
  input: { code: string },
  deps: { tenants: Pick<TenantRepository, 'findSettings'>; pickupPoints?: PickupPointDirectory | undefined },
): Promise<Result<ParcelLockerLookup, AppError>> => {
  const code = pickupPointCodeSchema.safeParse(input.code);
  if (!code.success) return err(validation('Invalid parcel locker code', code.error.flatten()));
  const settings = await deps.tenants.findSettings(tenantId);
  if (!hasActiveParcelLockerRate(settings?.shippingRates)) return err(notFound('Parcel locker lookup is not available in this workspace'));
  return ok(parcelLockerLookupView(await lookUp(code.data, deps.pickupPoints)));
};
