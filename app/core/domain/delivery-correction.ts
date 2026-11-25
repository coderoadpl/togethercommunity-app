import { z } from 'zod';
import { appError, validation, type AppError } from './errors.js';
import { orderShipmentAllowed } from './fulfilment.js';
import { err, ok, type Result } from './result.js';
import { SHIPX_STATUS_CANCELED, shipxLabelUsable } from './shipx.js';
import { normalizeLockerPhone, rateNeedsPolishMobile, pickupPointCodeSchema, SHIPPING_ALLOWED_COUNTRIES, SHIPPING_FIELD_MAX_LENGTH, storableText, type OrderShipping, type FulfilmentStatus } from './shipping.js';

const text = (max: number) => z.string().trim().min(1).max(max).refine(storableText);

const correctionAddressSchema = z.object({
  line1: text(SHIPPING_FIELD_MAX_LENGTH.line1).optional(),
  line2: z.string().trim().max(SHIPPING_FIELD_MAX_LENGTH.line2).refine(storableText).nullable().transform((value) => value === '' ? null : value).optional(),
  postalCode: text(SHIPPING_FIELD_MAX_LENGTH.postalCode).optional(),
  city: text(SHIPPING_FIELD_MAX_LENGTH.city).optional(),
}).strict();
const expectedSchema = z.object({
  phone: z.string().nullable().optional(),
  recipientName: z.string().optional(),
  address: z.object({
    line1: z.string().max(SHIPPING_FIELD_MAX_LENGTH.line1).optional(),
    line2: z.string().max(SHIPPING_FIELD_MAX_LENGTH.line2).nullable().optional(),
    postalCode: z.string().max(SHIPPING_FIELD_MAX_LENGTH.postalCode).optional(),
    city: z.string().max(SHIPPING_FIELD_MAX_LENGTH.city).optional(),
  }).strict().optional(),
  pickupPoint: z.string().nullable().optional(),
}).strict();

export const deliveryCorrectionInputSchema = z.object({
  expected: expectedSchema,
  orderId: z.string().min(1),
  phone: text(SHIPPING_FIELD_MAX_LENGTH.phone).optional(),
  recipientName: text(SHIPPING_FIELD_MAX_LENGTH.name).optional(),
  address: correctionAddressSchema.optional(),
  pickupPoint: z.object({ code: pickupPointCodeSchema, name: text(200).optional(), address: text(300).optional() }).strict().optional(),
}).strict().superRefine((input, ctx) => {
  const fields = ['phone', 'recipientName', 'pickupPoint'] as const;
  const addressFields = ['line1', 'line2', 'postalCode', 'city'] as const;
  const changed = fields.some((field) => input[field] !== undefined) || addressFields.some((field) => input.address?.[field] !== undefined);
  if (!changed) ctx.addIssue({ code: 'custom', message: 'Change at least one field' });
  for (const field of fields) {
    if ((input[field] !== undefined) !== (input.expected[field] !== undefined)) ctx.addIssue({ code: 'custom', path: [field], message: 'Each change requires its expected previous value' });
  }
  for (const field of addressFields) {
    if ((input.address?.[field] !== undefined) !== (input.expected.address?.[field] !== undefined)) ctx.addIssue({ code: 'custom', path: ['address', field], message: 'Each change requires its expected previous value' });
  }
});

export type DeliveryCorrectionInput = z.infer<typeof deliveryCorrectionInputSchema>;
export interface DeliveryCorrectionCommand {
  input: DeliveryCorrectionInput;
  pickupPoint: OrderShipping['pickupPoint'];
  at: string;
  byUserId: string;
  byEmail: string | null;
}

export const deliveryCorrectionReasonSchema = z.enum(['unchanged', 'history_full', 'country', 'postal_code', 'locker_not_allowed', 'locker_unavailable', 'locker_invalid']);
export const deliveryCorrectionRefused = (reason: z.infer<typeof deliveryCorrectionReasonSchema>): AppError =>
  validation('Delivery details cannot be corrected', { deliveryCorrection: reason });

export const deliveryCorrectionAllowed = (order: { status: string; fulfilmentStatus?: FulfilmentStatus | null | undefined }, shipments: readonly { status: string; trackingNumber: string | null; boughtAt: string | null; operationToken: string | null; providerShipmentId: string | null; createAttemptedAt: string | null }[]): Result<void, AppError> => {
  if (order.fulfilmentStatus === 'shipped') return err(appError('delivery_correction_shipped', 'The order has already been shipped'));
  const allowed = orderShipmentAllowed(order);
  if (!allowed.ok) return allowed;
  const nonCanceled = shipments.filter((shipment) => shipment.status !== SHIPX_STATUS_CANCELED);
  if (nonCanceled.some((shipment) => shipxLabelUsable(shipment) || shipment.boughtAt !== null)) {
    return err(appError('delivery_correction_shipment_bought', 'The shipment has already been bought'));
  }
  if (nonCanceled.some((shipment) => shipment.operationToken !== null || shipment.providerShipmentId !== null || shipment.createAttemptedAt !== null)) return err(appError('delivery_correction_shipment_exists', 'An InPost shipment already exists'));
  return ok(undefined);
};

const addressLine = (address: OrderShipping['address']): string =>
  [address.line1, address.line2, `${address.postalCode} ${address.city}`].filter((value) => value !== null && value !== '').join(', ');

export const correctedOrderShipping = (shipping: OrderShipping, command: DeliveryCorrectionCommand): Result<OrderShipping, AppError> => {
  const { input } = command;
  const expected = input.expected;
  if ((input.phone !== undefined && shipping.phone !== expected.phone)
    || (input.recipientName !== undefined && shipping.address.name !== expected.recipientName)
    || (input.pickupPoint !== undefined && (shipping.pickupPoint?.code ?? null) !== expected.pickupPoint)
    || (['line1', 'line2', 'postalCode', 'city'] as const).some((field) => input.address?.[field] !== undefined && shipping.address[field] !== expected.address?.[field])) {
    return err(appError('delivery_correction_conflict', 'Delivery details changed since they were opened'));
  }
  if (!SHIPPING_ALLOWED_COUNTRIES.some((country) => country === shipping.address.country)) return err(deliveryCorrectionRefused('country'));
  if (input.pickupPoint !== undefined && shipping.pickupPoint === null) return err(deliveryCorrectionRefused('locker_not_allowed'));
  if (input.pickupPoint !== undefined && (command.pickupPoint === null || command.pickupPoint.verified === false || command.pickupPoint.code !== input.pickupPoint.code)) return err(deliveryCorrectionRefused('locker_invalid'));
  const phone = input.phone === undefined ? shipping.phone : rateNeedsPolishMobile(shipping) ? normalizeLockerPhone(input.phone) : input.phone;
  if (input.phone !== undefined && phone === null) return err(appError('locker_phone_invalid', 'InPost deliveries need a Polish mobile number'));
  if (input.address?.postalCode !== undefined && shipping.address.country === 'PL' && !/^\d{2}-\d{3}$/.test(input.address.postalCode)) return err(deliveryCorrectionRefused('postal_code'));
  const address = {
    ...shipping.address,
    name: input.recipientName ?? shipping.address.name,
    line1: input.address?.line1 ?? shipping.address.line1,
    line2: input.address?.line2 === undefined ? shipping.address.line2 : input.address.line2,
    postalCode: input.address?.postalCode ?? shipping.address.postalCode,
    city: input.address?.city ?? shipping.address.city,
  };
  const pickupPoint = input.pickupPoint === undefined ? shipping.pickupPoint : command.pickupPoint;
  const changes: NonNullable<OrderShipping['corrections']> = [];
  const record = (field: NonNullable<OrderShipping['corrections']>[number]['field'], from: string | null, to: string | null, changed = from !== to) => {
    if (changed && to !== null) changes.push({ field, from, to, at: command.at, byUserId: command.byUserId, byEmail: command.byEmail });
  };
  record('phone', shipping.phone, phone);
  record('recipient_name', shipping.address.name, address.name);
  record('address', addressLine(shipping.address), addressLine(address), (['line1', 'line2', 'postalCode', 'city'] as const).some((field) => shipping.address[field] !== address[field]));
  record('pickup_point', shipping.pickupPoint?.code ?? null, pickupPoint?.code ?? null);
  if (changes.length === 0) return err(deliveryCorrectionRefused('unchanged'));
  const corrections = [...(shipping.corrections ?? []), ...changes];
  if (corrections.length > 50) return err(deliveryCorrectionRefused('history_full'));
  return ok({ ...shipping, phone, address, pickupPoint, corrections });
};
