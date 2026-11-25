import { describe, expect, it } from 'vitest';
import { z } from 'zod';

import { checkoutSnapshotSchema, orderSchema } from './commerce.js';
import { orderDeliveryDetails } from './fulfilment.js';
import {
  applyPickupPointLookup,
  checkoutShippingSnapshotSchema,
  orderShippingFrom,
  orderShippingSchema,
  SIMULATED_SHIPPING_DETAILS,
  type CheckoutShippingSelection,
} from './shipping.js';

const previousRelease = (() => {
  const shippingVatRateSchema = z.union([z.literal(5), z.literal(8), z.literal(23)]);
  const shippingCarrierSchema = z.enum(['inpost', 'other']);
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
  const checkoutShippingSnapshotSchema = z.object({
    ...shippingSelectionFields,
    allowedCountries: z.array(z.string().length(2)).min(1),
  });
  const SHIPPING_FIELD_MAX_LENGTH = { name: 200, line1: 300, line2: 300, postalCode: 30, city: 120, phone: 40 } as const;
  const shippingAddressSchema = z.object({
    name: z.string().max(SHIPPING_FIELD_MAX_LENGTH.name),
    line1: z.string().max(SHIPPING_FIELD_MAX_LENGTH.line1),
    line2: z.string().max(SHIPPING_FIELD_MAX_LENGTH.line2).nullable(),
    postalCode: z.string().max(SHIPPING_FIELD_MAX_LENGTH.postalCode),
    city: z.string().max(SHIPPING_FIELD_MAX_LENGTH.city),
    country: z.string().length(2),
  });
  const orderShippingSchema = z.object({
    ...shippingSelectionFields,
    address: shippingAddressSchema,
    phone: z.string().max(SHIPPING_FIELD_MAX_LENGTH.phone).nullable(),
  });
  const purchaseDeliverySchema = z.object({
    method: z.string().min(1),
    pickupPoint: z.object({ code: z.string().min(1), name: z.string().nullable(), address: z.string().nullable() }).nullable(),
    address: z.object({
      name: z.string(),
      line1: z.string(),
      line2: z.string().nullable(),
      postalCode: z.string(),
      city: z.string(),
      country: z.string(),
    }).nullable(),
  });
  return { checkoutShippingSnapshotSchema, orderShippingSchema, purchaseDeliverySchema };
})();

const selection: CheckoutShippingSelection = {
  rateId: 'locker', label: 'Parcel locker', amountCents: 1499, vatRatePercent: 23, carrier: 'inpost',
  pickupPoint: { provider: 'inpost', code: 'WAW01M', name: null, address: null }, allowedCountries: ['PL'],
};

const written = (() => {
  const unverified = applyPickupPointLookup(selection, { kind: 'unavailable' });
  if (!unverified.ok) throw new Error('Expected the unverified selection to be accepted');
  const snapshot = checkoutShippingSnapshotSchema.parse(JSON.parse(JSON.stringify(unverified.value)));
  const order = orderShippingFrom(snapshot, SIMULATED_SHIPPING_DETAILS);
  if (!order.ok) throw new Error('Expected an order shipping value');
  return { snapshot, order: orderShippingSchema.parse(JSON.parse(JSON.stringify(order.value))) };
})();

describe('stored pickup point rollback compatibility', () => {
  it('lets the previous release read a corrected order and strip its staff audit', () => {
    const corrected = { ...written.order, phone: '+48500000000', corrections: [
      { field: 'phone', from: null, to: '+48500000000', at: '2026-11-25T10:00:00.000Z', byUserId: 'staff', byEmail: 'staff@example.org' },
    ] };
    expect(previousRelease.orderShippingSchema.parse(corrected)).toEqual(previousRelease.orderShippingSchema.parse({ ...written.order, phone: '+48500000000' }));
    expect(orderSchema.extend({ shipping: previousRelease.orderShippingSchema }).safeParse({
      id: 'order', tenantId: 'workspace', memberId: 'buyer', productId: 'book', priceId: null, kind: 'one_time', status: 'paid',
      amountCents: 1200, currency: 'PLN', provider: 'simulated', providerObjectIds: {}, couponId: null, discountCents: 0, shipping: corrected, createdAt: '2026-11-25T09:00:00.000Z',
    }).success).toBe(true);
  });
  it('writes the unverified mark as one optional key that this release reads back', () => {
    expect(written.snapshot.pickupPoint).toEqual({ provider: 'inpost', code: 'WAW01M', name: null, address: null, verified: false });
    expect(written.order.pickupPoint).toEqual({ provider: 'inpost', code: 'WAW01M', name: null, address: null, verified: false });
  });

  it('lets the previous release parse a snapshot and an order written with the unverified mark', () => {
    expect(previousRelease.checkoutShippingSnapshotSchema.safeParse(written.snapshot).success).toBe(true);
    expect(previousRelease.orderShippingSchema.safeParse(written.order).success).toBe(true);
    expect(previousRelease.orderShippingSchema.parse(written.order).pickupPoint).toEqual({ provider: 'inpost', code: 'WAW01M', name: null, address: null });
  });

  it('lets the previous release parse a verified point, which carries no extra key', () => {
    const verified = applyPickupPointLookup(selection, { kind: 'found', point: {
      name: 'WAW01M', status: 'Operating', types: ['parcel_locker'], functions: ['parcel_collect'],
      locationDescription: 'Next to the main entrance', address: { line1: 'Main Street 1', line2: null },
    } });
    if (!verified.ok) throw new Error('Expected the verified selection to be accepted');
    expect(verified.value.pickupPoint).toEqual({ provider: 'inpost', code: 'WAW01M', name: 'Next to the main entrance', address: 'Main Street 1' });
    expect(previousRelease.checkoutShippingSnapshotSchema.safeParse(verified.value).success).toBe(true);
  });

  it('keeps the delivery details in e-mail payloads in the shape the previous release parses', () => {
    const delivery = orderDeliveryDetails(written.order);
    expect(delivery.pickupPoint).toEqual({ code: 'WAW01M', name: null, address: null });
    expect(previousRelease.purchaseDeliverySchema.safeParse(delivery).success).toBe(true);
  });

  it('keeps the order and snapshot records non-strict so the added key never fails a parse', () => {
    const order = orderSchema.parse({
      id: 'order-1', tenantId: 'tenant-a', memberId: 'member-1', productId: 'accessory', priceId: null, kind: 'one_time', status: 'paid',
      amountCents: 6399, currency: 'PLN', provider: 'stripe', providerObjectIds: {}, couponId: null, discountCents: 0,
      shipping: written.order, createdAt: '2026-11-22T10:00:00.000Z',
    });
    expect(order.shipping?.pickupPoint?.verified).toBe(false);
    const snapshot = checkoutSnapshotSchema.parse({
      id: 'snapshot-1', tenantId: 'tenant-a', salesLinkId: null, currency: 'PLN', createdAt: '2026-11-22T10:00:00.000Z',
      lines: [{ productId: 'accessory', name: 'Accessory', productType: 'physical', grossCents: 4900, netCents: 3984, vatCents: 916, vatRate: 23, vatExemptionBasis: null, vatExemptionBasisKind: null, issuedCount: null }],
      shipping: written.snapshot,
    });
    expect(snapshot.shipping?.pickupPoint?.verified).toBe(false);
  });
});
