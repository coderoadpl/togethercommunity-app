import { z } from 'zod';
import { appError, validation, type AppError } from './errors.js';
import { orderShipmentAllowed } from './fulfilment.js';
import { err, ok, type Result } from './result.js';
import { shipxShipmentBought } from './shipx.js';
import { normalizeLockerPhone, pickupPointCodeSchema, SHIPPING_ALLOWED_COUNTRIES, SHIPPING_FIELD_MAX_LENGTH, storableText, type OrderShipping, type FulfilmentStatus } from './shipping.js';

const text = (max: number) => z.string().trim().min(1).max(max).refine(storableText);

export const deliveryCorrectionInputSchema = z.object({
  orderId: z.string().min(1),
  phone: text(SHIPPING_FIELD_MAX_LENGTH.phone).optional(),
  recipientName: text(SHIPPING_FIELD_MAX_LENGTH.name).optional(),
  address: z.object({
    line1: text(SHIPPING_FIELD_MAX_LENGTH.line1),
    line2: z.string().trim().max(SHIPPING_FIELD_MAX_LENGTH.line2).refine(storableText).nullable().transform((value) => value === '' ? null : value),
    postalCode: text(SHIPPING_FIELD_MAX_LENGTH.postalCode),
    city: text(SHIPPING_FIELD_MAX_LENGTH.city),
  }).strict().optional(),
  pickupPoint: z.object({ code: pickupPointCodeSchema, name: text(200).optional(), address: text(300).optional() }).strict().optional(),
}).strict().refine((input) => input.phone !== undefined || input.recipientName !== undefined || input.address !== undefined || input.pickupPoint !== undefined);

export type DeliveryCorrectionInput = z.infer<typeof deliveryCorrectionInputSchema>;
export interface DeliveryCorrectionCommand {
  input: DeliveryCorrectionInput;
  pickupPoint: OrderShipping['pickupPoint'];
  at: string;
  byUserId: string;
  byEmail: string | null;
}

export const deliveryCorrectionReasonSchema = z.enum(['unchanged', 'history_full', 'country', 'postal_code', 'locker_not_allowed', 'locker_unavailable', 'locker_invalid', 'shipment_busy', 'draft_outdated']);
export const deliveryCorrectionRefused = (reason: z.infer<typeof deliveryCorrectionReasonSchema>): AppError =>
  validation('Delivery details cannot be corrected', { deliveryCorrection: reason });

export const deliveryCorrectionAllowed = (order: { status: string; fulfilmentStatus?: FulfilmentStatus | null | undefined }, shipments: readonly { status: string; trackingNumber: string | null; boughtAt: string | null; operationToken: string | null }[]): Result<void, AppError> => {
  if (order.fulfilmentStatus === 'shipped') return err(appError('delivery_correction_shipped', 'The order has already been shipped'));
  const allowed = orderShipmentAllowed(order);
  if (!allowed.ok) return allowed;
  if (shipments.some((shipment) => shipxShipmentBought(shipment) || shipment.boughtAt !== null)) {
    return err(appError('delivery_correction_shipment_bought', 'The shipment has already been bought'));
  }
  if (shipments.some((shipment) => shipment.operationToken !== null)) return err(deliveryCorrectionRefused('shipment_busy'));
  return ok(undefined);
};

export const deliveryCorrectionAfterShipment = (shipping: OrderShipping | null | undefined, shipment: { createdAt: string; createAttemptedAt?: string | null }): boolean =>
  shipping?.corrections?.some((correction) => Date.parse(correction.at) > Date.parse(shipment.createAttemptedAt ?? shipment.createdAt)) ?? false;

const addressLine = (address: OrderShipping['address']): string =>
  [address.line1, address.line2, `${address.postalCode} ${address.city}`].filter((value) => value !== null && value !== '').join(', ');

export const correctedOrderShipping = (shipping: OrderShipping, command: DeliveryCorrectionCommand): Result<OrderShipping, AppError> => {
  const { input } = command;
  if (!SHIPPING_ALLOWED_COUNTRIES.some((country) => country === shipping.address.country)) return err(deliveryCorrectionRefused('country'));
  if (input.pickupPoint !== undefined && shipping.pickupPoint === null) return err(deliveryCorrectionRefused('locker_not_allowed'));
  if (input.pickupPoint !== undefined && (command.pickupPoint === null || command.pickupPoint.verified === false || command.pickupPoint.code !== input.pickupPoint.code)) return err(deliveryCorrectionRefused('locker_invalid'));
  const phone = input.phone === undefined ? shipping.phone : shipping.pickupPoint === null ? input.phone : normalizeLockerPhone(input.phone);
  if (input.phone !== undefined && phone === null) return err(appError('locker_phone_invalid', 'Parcel lockers need a Polish mobile number'));
  if (input.address !== undefined && shipping.address.country === 'PL' && !/^\d{2}-\d{3}$/.test(input.address.postalCode)) return err(deliveryCorrectionRefused('postal_code'));
  const address = { ...shipping.address, ...input.address, name: input.recipientName ?? shipping.address.name };
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
