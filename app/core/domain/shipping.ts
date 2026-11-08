import { z } from 'zod';

import { appError, validation, type AppError } from './errors.js';
import { err, ok, type Result } from './result.js';

export const SHIPPING_ALLOWED_COUNTRIES = ['PL'] as const;

export const SHIPPING_RATES_MAX = 5;

export const FREE_ORDER_DELIVERY_UNAVAILABLE = 'Delivery is not available for free orders';

export const DELIVERY_METHODS = ['pickup', 'shipping'] as const;

export const deliveryMethodSchema = z.enum(DELIVERY_METHODS);

export type DeliveryMethod = z.infer<typeof deliveryMethodSchema>;

export const deliveryMethodAllowed = (type: string, deliveryMethod: DeliveryMethod): boolean =>
  deliveryMethod === 'pickup' || type === 'physical';

const needsShipping = (product: { deliveryMethod?: DeliveryMethod | undefined }): boolean =>
  product.deliveryMethod === 'shipping';

export const requiresWorkspaceCheckout = (product: {
  checkoutConsentDefinitionIds?: string[] | undefined;
  deliveryMethod?: DeliveryMethod | undefined;
}): boolean => (product.checkoutConsentDefinitionIds?.length ?? 0) > 0 || needsShipping(product);

const shippingVatRateSchema = z.union([z.literal(5), z.literal(8), z.literal(23)]);

const shippingCarrierSchema = z.enum(['inpost', 'other']);

const pickupPointKindSchema = z.enum(['none', 'inpost_locker']);

const deliveryEstimateDaysSchema = z
  .object({ min: z.number().int().positive(), max: z.number().int().positive() })
  .refine((estimate) => estimate.min <= estimate.max, {
    message: 'The minimum delivery estimate must not exceed the maximum',
    path: ['max'],
  });

const shippingRateIdSchema = z
  .string()
  .regex(/^[a-z0-9-]{1,40}$/, 'Rate id must be 1–40 lowercase letters, digits or hyphens');

export const shippingRateSchema = z.object({
  id: shippingRateIdSchema,
  label: z.string().trim().min(1).max(100),
  amountCents: z.number().int().nonnegative(),
  vatRatePercent: shippingVatRateSchema.default(23),
  carrier: shippingCarrierSchema,
  pickupPoint: pickupPointKindSchema,
  active: z.boolean(),
  deliveryEstimateDays: deliveryEstimateDaysSchema.optional(),
});

export type ShippingRate = z.output<typeof shippingRateSchema>;

export const shippingRatesSchema = z
  .array(shippingRateSchema)
  .max(SHIPPING_RATES_MAX, `At most ${SHIPPING_RATES_MAX} shipping rates are supported`)
  .refine((rates) => new Set(rates.map((rate) => rate.id)).size === rates.length, 'Shipping rate ids must be unique');

export const inpostGeowidgetTokenSchema = z.string().trim().min(1).max(4000);

export const publicShippingRateSchema = z.object({
  id: z.string(),
  label: z.string(),
  amountCents: z.number().int().nonnegative(),
  carrier: shippingCarrierSchema,
  pickupPoint: pickupPointKindSchema,
  deliveryEstimateDays: z.object({ min: z.number().int().positive(), max: z.number().int().positive() }).optional(),
});

export type PublicShippingRate = z.infer<typeof publicShippingRateSchema>;

export const publicShippingRates = (rates: ShippingRate[] | null | undefined): PublicShippingRate[] =>
  (rates ?? []).filter((rate) => rate.active).map((rate) => ({
    id: rate.id,
    label: rate.label,
    amountCents: rate.amountCents,
    carrier: rate.carrier,
    pickupPoint: rate.pickupPoint,
    ...(rate.deliveryEstimateDays === undefined ? {} : { deliveryEstimateDays: rate.deliveryEstimateDays }),
  }));

const PICKUP_POINT_CODE_PATTERN = /^[A-Z0-9]{4,12}$/;

export const normalizePickupPointCode = (code: string): string => code.trim().toUpperCase();

export const pickupPointCodeValid = (code: string): boolean =>
  PICKUP_POINT_CODE_PATTERN.test(normalizePickupPointCode(code));

const pickupPointCodeSchema = z
  .string()
  .transform(normalizePickupPointCode)
  .pipe(z.string().regex(PICKUP_POINT_CODE_PATTERN, 'Parcel locker code must be 4–12 letters or digits'));

export const inpostGeowidgetPointSchema = z.object({
  name: z.string().trim().min(1),
  location_description: z.string().trim().nullish(),
  address: z.object({ line1: z.string().nullish(), line2: z.string().nullish() }).nullish(),
});

const checkoutPickupPointSchema = z.object({
  provider: z.literal('inpost'),
  code: pickupPointCodeSchema,
  name: z.string().trim().min(1).max(200).optional(),
  address: z.string().trim().min(1).max(300).optional(),
});

export const checkoutShippingInputSchema = z.object({
  rateId: z.string().trim().min(1).max(40),
  pickupPoint: checkoutPickupPointSchema.optional(),
});

export type CheckoutShippingInput = z.input<typeof checkoutShippingInputSchema>;

const storedPickupPointSchema = z.object({
  provider: z.literal('inpost'),
  code: z.string().min(1),
  name: z.string().nullable(),
  address: z.string().nullable(),
});

const shippingSelectionFields = {
  rateId: z.string().min(1),
  label: z.string().min(1),
  amountCents: z.number().int().nonnegative(),
  vatRatePercent: shippingVatRateSchema,
  carrier: shippingCarrierSchema,
  pickupPoint: storedPickupPointSchema.nullable(),
};

export const checkoutShippingSnapshotSchema = z.object({
  ...shippingSelectionFields,
  allowedCountries: z.array(z.string().length(2)).min(1),
});

export type CheckoutShippingSnapshot = z.infer<typeof checkoutShippingSnapshotSchema>;

export type CheckoutShippingSelection = CheckoutShippingSnapshot & { deliveryEstimateDays?: { min: number; max: number } };

const SHIPPING_FIELD_MAX_LENGTH = { name: 200, line1: 300, line2: 300, postalCode: 30, city: 120, phone: 40 } as const;

const shippingAddressSchema = z.object({
  name: z.string().max(SHIPPING_FIELD_MAX_LENGTH.name),
  line1: z.string().max(SHIPPING_FIELD_MAX_LENGTH.line1),
  line2: z.string().max(SHIPPING_FIELD_MAX_LENGTH.line2).nullable(),
  postalCode: z.string().max(SHIPPING_FIELD_MAX_LENGTH.postalCode),
  city: z.string().max(SHIPPING_FIELD_MAX_LENGTH.city),
  country: z.string().length(2),
});

export const orderShippingSchema = z.object({
  ...shippingSelectionFields,
  address: shippingAddressSchema,
  phone: z.string().max(SHIPPING_FIELD_MAX_LENGTH.phone).nullable(),
});

export type OrderShipping = z.infer<typeof orderShippingSchema>;

export const fulfilmentStatusSchema = z.enum(['to_pack']);

export type FulfilmentStatus = z.infer<typeof fulfilmentStatusSchema>;

export interface CollectedShipping {
  name: string | null;
  phone: string | null;
  address: {
    line1: string | null;
    line2: string | null;
    postalCode: string | null;
    city: string | null;
    country: string | null;
    state: string | null;
  };
}

export const SIMULATED_SHIPPING_DETAILS: CollectedShipping = {
  name: 'Simulated Buyer',
  phone: '+48500000000',
  address: { line1: 'Example Street 1', line2: null, postalCode: '00-001', city: 'Warsaw', country: 'PL', state: null },
};

export const resolveCheckoutShipping = (
  products: Array<{ deliveryMethod?: DeliveryMethod | undefined }>,
  rates: ShippingRate[] | null | undefined,
  input: z.output<typeof checkoutShippingInputSchema> | undefined,
): Result<CheckoutShippingSelection | null, AppError> => {
  const required = products.some(needsShipping);
  if (!required) {
    return input === undefined ? ok(null) : err(validation('Shipping is not available for the selected products'));
  }
  if (input === undefined) return err(appError('shipping_required', 'Choose a delivery option before checkout'));
  const rate = (rates ?? []).find((candidate) => candidate.id === input.rateId && candidate.active);
  if (rate === undefined) return err(validation('The selected delivery option is not available'));
  if (rate.pickupPoint === 'none' && input.pickupPoint !== undefined) {
    return err(validation('The selected delivery option does not use a pickup point'));
  }
  if (rate.pickupPoint !== 'none' && input.pickupPoint === undefined) {
    return err(validation('Choose a parcel locker for the selected delivery option'));
  }
  return ok({
    rateId: rate.id,
    label: rate.label,
    amountCents: rate.amountCents,
    vatRatePercent: rate.vatRatePercent,
    carrier: rate.carrier,
    pickupPoint: input.pickupPoint === undefined ? null : {
      provider: input.pickupPoint.provider,
      code: input.pickupPoint.code,
      name: input.pickupPoint.name ?? null,
      address: input.pickupPoint.address ?? null,
    },
    allowedCountries: [...SHIPPING_ALLOWED_COUNTRIES],
    ...(rate.deliveryEstimateDays === undefined ? {} : { deliveryEstimateDays: rate.deliveryEstimateDays }),
  });
};

const truncate = (value: string, maxLength: number): string => {
  if (value.length <= maxLength) return value;
  const cut = value.slice(0, maxLength);
  return /[\uD800-\uDBFF]$/.test(cut) ? cut.slice(0, -1) : cut;
};

export const orderShippingFrom = (
  snapshot: CheckoutShippingSnapshot,
  collected: CollectedShipping | null | undefined,
): Result<OrderShipping, AppError> => {
  const country = collected?.address.country?.toUpperCase() ?? null;
  if (collected == null || country === null || !snapshot.allowedCountries.includes(country)) {
    return err(validation('Checkout shipping address is missing or outside the allowed countries'));
  }
  return ok({
    rateId: snapshot.rateId,
    label: snapshot.label,
    amountCents: snapshot.amountCents,
    vatRatePercent: snapshot.vatRatePercent,
    carrier: snapshot.carrier,
    pickupPoint: snapshot.pickupPoint,
    address: {
      name: truncate(collected.name ?? '', SHIPPING_FIELD_MAX_LENGTH.name),
      line1: truncate(collected.address.line1 ?? '', SHIPPING_FIELD_MAX_LENGTH.line1),
      line2: collected.address.line2 === null || collected.address.line2 === '' ? null : truncate(collected.address.line2, SHIPPING_FIELD_MAX_LENGTH.line2),
      postalCode: truncate(collected.address.postalCode ?? '', SHIPPING_FIELD_MAX_LENGTH.postalCode),
      city: truncate(collected.address.city ?? '', SHIPPING_FIELD_MAX_LENGTH.city),
      country,
    },
    phone: collected.phone === null ? null : truncate(collected.phone, SHIPPING_FIELD_MAX_LENGTH.phone),
  });
};
