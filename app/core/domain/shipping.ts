import { z } from 'zod';

import { appError, validation, type AppError } from './errors.js';
import type { ProductPersonalization } from './personalization.js';
import type { ProductCompliance } from './product-compliance.js';
import { err, ok, type Result } from './result.js';

const SHIPX_PHONE_PATTERN = /^\d{9}$/;

export const normalizeShipxPhone = (raw: string): string | null => {
  const value = raw.trim();
  if (!/^\+?[\d\s-]+$/.test(value)) return null;
  const digits = value.replace(/\D/g, '');
  if (value.startsWith('+') && !(digits.startsWith('48') && digits.length === 11)) return null;
  if (digits.startsWith('00') && !(digits.startsWith('0048') && digits.length === 13)) return null;
  const local = digits.length === 11 && digits.startsWith('48')
    ? digits.slice(2)
    : digits.length === 13 && digits.startsWith('0048') ? digits.slice(4) : digits;
  return SHIPX_PHONE_PATTERN.test(local) ? local : null;
};

export const normalizeLockerPhone = (raw: string): string | null => {
  const national = normalizeShipxPhone(raw);
  return national === null ? null : `+48${national}`;
};

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
  compliance?: ProductCompliance | null | undefined;
  personalization?: ProductPersonalization | null | undefined;
}): boolean => (product.checkoutConsentDefinitionIds?.length ?? 0) > 0 || needsShipping(product) || product.compliance != null ||
  product.personalization != null;

const shippingVatRateSchema = z.union([z.literal(5), z.literal(8), z.literal(23)]);

export const shippingCarrierSchema = z.enum(['inpost', 'other']);

export type ShippingCarrier = z.infer<typeof shippingCarrierSchema>;

export const rateNeedsPolishMobile = (rate: { carrier: ShippingCarrier }): boolean => rate.carrier === 'inpost';

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

export const pickupPointCodeSchema = z
  .string()
  .transform(normalizePickupPointCode)
  .pipe(z.string().regex(PICKUP_POINT_CODE_PATTERN, 'Parcel locker code must be 4–12 letters or digits'));

export const inpostGeowidgetPointSchema = z.object({
  name: z.string().trim().min(1),
  location_description: z.string().trim().nullish(),
  address: z.object({ line1: z.string().nullish(), line2: z.string().nullish() }).nullish(),
});

const UNPAIRED_SURROGATE = /[\uD800-\uDFFF]/u;

export const storableText = (value: string): boolean => !value.includes('\u0000') && !UNPAIRED_SURROGATE.test(value);

const storableOrDropped = (value: string): string | undefined => (storableText(value) ? value : undefined);

const checkoutPickupPointSchema = z.object({
  provider: z.literal('inpost'),
  code: pickupPointCodeSchema,
  name: z.string().trim().min(1).max(200).transform(storableOrDropped).optional(),
  address: z.string().trim().min(1).max(300).transform(storableOrDropped).optional(),
});

export const checkoutShippingInputSchema = z.object({
  rateId: z.string().trim().min(1).max(40),
  pickupPoint: checkoutPickupPointSchema.optional(),
  phone: z.string().trim().max(40).optional(),
});

export type CheckoutShippingInput = z.input<typeof checkoutShippingInputSchema>;

const storedPickupPointSchema = z.object({
  provider: z.literal('inpost'),
  code: z.string().min(1),
  name: z.string().nullable(),
  address: z.string().nullable(),
  verified: z.literal(false).optional(),
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
  phone: z.string().refine((phone) => normalizeLockerPhone(phone) === phone, 'Phone must be a canonical Polish number').optional(),
});

export type CheckoutShippingSnapshot = z.infer<typeof checkoutShippingSnapshotSchema>;

export type CheckoutShippingSelection = CheckoutShippingSnapshot & { deliveryEstimateDays?: { min: number; max: number } };

export const SHIPPING_FIELD_MAX_LENGTH = { name: 200, line1: 300, line2: 300, postalCode: 30, city: 120, phone: 40 } as const;

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
  corrections: z.array(z.object({
    field: z.enum(['phone', 'recipient_name', 'address', 'pickup_point']),
    from: z.string().nullable(),
    to: z.string(),
    at: z.string().datetime(),
    byUserId: z.string().min(1),
    byEmail: z.string().nullable(),
  })).max(50).optional(),
});

export type OrderShipping = z.infer<typeof orderShippingSchema>;

export const fulfilmentStatusSchema = z.enum(['to_pack', 'shipped']);

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
  const needsPhone = rateNeedsPolishMobile(rate);
  const phone = needsPhone ? normalizeLockerPhone(input.phone ?? '') : null;
  if (needsPhone && phone === null) {
    return err(appError('locker_phone_invalid', 'InPost deliveries need a Polish mobile number (9 digits, optional +48)'));
  }
  return ok({
    ...(phone === null ? {} : { phone }),
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

export const PICKUP_POINT_REJECTION_REASONS = ['not_found', 'not_usable', 'not_operating'] as const;

const pickupPointRejectionReasonSchema = z.enum(PICKUP_POINT_REJECTION_REASONS);

export type PickupPointRejectionReason = z.infer<typeof pickupPointRejectionReasonSchema>;

export const PICKUP_POINT_REJECTION_MESSAGES: Readonly<Record<PickupPointRejectionReason, string>> = {
  not_found: 'No InPost parcel locker has this code',
  not_usable: 'This InPost point cannot hold parcels for collection',
  not_operating: 'This InPost parcel locker is not operating',
};

const pickupPointRejected = (reason: PickupPointRejectionReason): AppError =>
  validation(PICKUP_POINT_REJECTION_MESSAGES[reason], { pickupPointReason: reason });

const pickupPointRejectionDetailsSchema = z.object({ pickupPointReason: pickupPointRejectionReasonSchema });

export const pickupPointRejectionReason = (details: unknown): PickupPointRejectionReason | null => {
  const parsed = pickupPointRejectionDetailsSchema.safeParse(details);
  return parsed.success ? parsed.data.pickupPointReason : null;
};

export interface InpostPoint {
  name: string;
  status: string;
  types: readonly string[];
  functions: readonly string[];
  locationDescription: string | null;
  address: { line1: string | null; line2: string | null } | null;
}

export type PickupPointLookup =
  | { kind: 'found'; point: InpostPoint }
  | { kind: 'not_found' }
  | { kind: 'unavailable' };

const INPOST_OPERATING_STATUS = 'Operating';
const INPOST_REFUSED_STATUSES: ReadonlySet<string> = new Set(['NonOperating', 'Disabled', 'Removed']);
const INPOST_COLLECT_FUNCTION = 'parcel_collect';
const INPOST_LOCKER_TYPE = 'parcel_locker';

export const inpostPointRejection = (
  point: Pick<InpostPoint, 'status' | 'types' | 'functions'>,
): Exclude<PickupPointRejectionReason, 'not_found'> | null => {
  if (point.status !== INPOST_OPERATING_STATUS) return 'not_operating';
  return point.types.includes(INPOST_LOCKER_TYPE) && point.functions.includes(INPOST_COLLECT_FUNCTION) ? null : 'not_usable';
};

const withKnownPointStatus = (lookup: PickupPointLookup): PickupPointLookup =>
  lookup.kind === 'found' && lookup.point.status !== INPOST_OPERATING_STATUS && !INPOST_REFUSED_STATUSES.has(lookup.point.status)
    ? { kind: 'unavailable' }
    : lookup;

const PICKUP_POINT_NAME_MAX_LENGTH = 200;
const PICKUP_POINT_ADDRESS_MAX_LENGTH = 300;

const presentText = (value: string | null | undefined): string | null => {
  const trimmed = value?.trim() ?? '';
  return trimmed === '' ? null : trimmed;
};

export interface PickupPointDetails {
  code: string;
  name: string | null;
  address: string | null;
}

export const pickupPointDetails = (point: Pick<InpostPoint, 'name' | 'locationDescription' | 'address'>): PickupPointDetails => {
  const name = presentText(point.locationDescription);
  const address = [point.address?.line1, point.address?.line2]
    .map(presentText)
    .filter((line): line is string => line !== null)
    .join(', ');
  return {
    code: normalizePickupPointCode(point.name),
    name: name === null ? null : truncate(name, PICKUP_POINT_NAME_MAX_LENGTH),
    address: address === '' ? null : truncate(address, PICKUP_POINT_ADDRESS_MAX_LENGTH),
  };
};

export const applyPickupPointLookup = (
  selection: CheckoutShippingSelection,
  lookup: PickupPointLookup,
): Result<CheckoutShippingSelection, AppError> => {
  const requested = selection.pickupPoint;
  if (requested === null) return ok(selection);
  const known = withKnownPointStatus(lookup);
  switch (known.kind) {
    case 'not_found':
      return err(pickupPointRejected('not_found'));
    case 'unavailable':
      return ok({ ...selection, pickupPoint: { ...requested, verified: false } });
    case 'found': {
      const rejection = inpostPointRejection(known.point);
      if (rejection !== null) return err(pickupPointRejected(rejection));
      return ok({ ...selection, pickupPoint: { provider: 'inpost', ...pickupPointDetails(known.point) } });
    }
  }
};

export const parcelLockerLookupSchema = z.discriminatedUnion('status', [
  z.object({
    status: z.literal('found'),
    code: z.string(),
    name: z.string().nullable(),
    address: z.string().nullable(),
    usable: z.boolean(),
    reason: pickupPointRejectionReasonSchema.exclude(['not_found']).nullable(),
  }),
  z.object({ status: z.literal('not_found') }),
  z.object({ status: z.literal('unavailable') }),
]);

export type ParcelLockerLookup = z.infer<typeof parcelLockerLookupSchema>;

export const parcelLockerLookupView = (lookup: PickupPointLookup): ParcelLockerLookup => {
  const known = withKnownPointStatus(lookup);
  if (known.kind !== 'found') return { status: known.kind };
  const reason = inpostPointRejection(known.point);
  return { status: 'found', ...pickupPointDetails(known.point), usable: reason === null, reason };
};

export const hasActiveParcelLockerRate = (rates: ShippingRate[] | null | undefined): boolean =>
  (rates ?? []).some((rate) => rate.active && rate.pickupPoint === 'inpost_locker');

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
    phone: snapshot.phone ?? (collected.phone === null ? null : truncate(collected.phone, SHIPPING_FIELD_MAX_LENGTH.phone)),
  });
};
