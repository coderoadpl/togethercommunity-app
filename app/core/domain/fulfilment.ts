import { z } from 'zod';

import { appError, validation, type AppError } from './errors.js';
import { stripeModeSchema } from './integration.js';
import { err, ok, type Result } from './result.js';
import { fulfilmentStatusSchema, shippingCarrierSchema, type FulfilmentStatus, type OrderShipping, type ShippingCarrier } from './shipping.js';

const TRACKING_NUMBER_MIN_LENGTH = 4;
const TRACKING_NUMBER_MAX_LENGTH = 64;

export const trackingNumberSchema = z
  .string()
  .trim()
  .min(TRACKING_NUMBER_MIN_LENGTH, `Tracking number must be at least ${TRACKING_NUMBER_MIN_LENGTH} characters`)
  .max(TRACKING_NUMBER_MAX_LENGTH, `Tracking number must be at most ${TRACKING_NUMBER_MAX_LENGTH} characters`);

export const orderShipmentSchema = z.object({
  carrier: shippingCarrierSchema,
  trackingNumber: z.string().min(1).max(TRACKING_NUMBER_MAX_LENGTH),
  shippedAt: z.string().datetime(),
  shippedBy: z.string().min(1),
});

export type OrderShipment = z.infer<typeof orderShipmentSchema>;

export const shipOrderInputSchema = z.object({
  orderId: z.string().min(1),
  carrier: shippingCarrierSchema,
  trackingNumber: trackingNumberSchema,
}).strict();

const TRACKING_URL_BY_CARRIER: Record<ShippingCarrier, ((trackingNumber: string) => string) | null> = {
  inpost: (trackingNumber) => `https://inpost.pl/sledzenie-przesylek?number=${encodeURIComponent(trackingNumber)}`,
  other: null,
};

export const shipmentTrackingUrl = (shipment: Pick<OrderShipment, 'carrier' | 'trackingNumber'>): string | null =>
  TRACKING_URL_BY_CARRIER[shipment.carrier]?.(shipment.trackingNumber) ?? null;

const SHIPPABLE_ORDER_STATUSES: ReadonlySet<string> = new Set(['paid', 'refunded', 'partially_refunded']);

export const orderShipmentAllowed = (order: {
  status: string;
  fulfilmentStatus?: FulfilmentStatus | null | undefined;
}): Result<void, AppError> => {
  if (!SHIPPABLE_ORDER_STATUSES.has(order.status)) return err(validation('Only paid orders can be shipped'));
  if (order.fulfilmentStatus === 'shipped') return err(appError('fulfilment_conflict', 'Order has already been shipped'));
  if (order.fulfilmentStatus !== 'to_pack') return err(validation('Order has nothing to ship'));
  return ok(undefined);
};

export const orderDeliveryDetails = (shipping: OrderShipping) => ({
  method: shipping.label,
  pickupPoint: shipping.pickupPoint === null ? null : {
    code: shipping.pickupPoint.code,
    name: shipping.pickupPoint.name,
    address: shipping.pickupPoint.address,
  },
  address: shipping.pickupPoint === null ? shipping.address : null,
});

export const memberFulfilmentSchema = z.object({
  status: fulfilmentStatusSchema,
  shippedAt: z.string().datetime().nullable(),
  carrier: shippingCarrierSchema.nullable(),
  trackingNumber: z.string().nullable(),
  trackingUrl: z.string().url().nullable(),
});

export type MemberFulfilment = z.infer<typeof memberFulfilmentSchema>;

export const memberFulfilmentView = (order: {
  fulfilmentStatus?: FulfilmentStatus | null | undefined;
  shipment?: OrderShipment | null | undefined;
}): MemberFulfilment | null => {
  if (order.fulfilmentStatus == null) return null;
  const shipment = order.fulfilmentStatus === 'shipped' ? order.shipment ?? null : null;
  return {
    status: order.fulfilmentStatus,
    shippedAt: shipment?.shippedAt ?? null,
    carrier: shipment?.carrier ?? null,
    trackingNumber: shipment?.trackingNumber ?? null,
    trackingUrl: shipment === null ? null : shipmentTrackingUrl(shipment),
  };
};

export const packingListQuerySchema = z.object({
  format: z.literal('csv'),
  fulfilmentStatus: fulfilmentStatusSchema.default('to_pack'),
  mode: stripeModeSchema.default('live'),
});
