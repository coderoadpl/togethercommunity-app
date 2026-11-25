import { describe, expect, it, vi } from 'vitest';
import { correctedOrderShipping, deliveryCorrectionAllowed, err, notFound, ok, orderListItemSchema, type Capability, type Identity, type OrderListItem, type PickupPointLookup } from '#core/domain/index.js';
import type { OrderDeliveryRepository } from '../order-fulfilment-ports.js';
import { correctOrderDelivery } from './order-delivery.js';

const identity: Identity = {
  userId: 'staff', email: 'staff@example.org', name: 'Staff', emailVerified: true, image: null,
  tenantAccess: 'staff', tenantId: 'workspace', tenantSlug: 'workspace', tenantName: 'Workspace', staffRole: 'owner',
  memberId: null, memberDisplayName: null, memberBannedAt: null, memberDmOptOutAt: null, memberLanguage: null, memberVideoAutoplay: false,
};
const ctx = (capabilities: Capability[] = ['order:write']) => ({ identity, capabilities });
const baseOrder = orderListItemSchema.parse({
  id: 'order', tenantId: 'workspace', memberId: 'buyer', productId: 'book', priceId: null, kind: 'one_time', status: 'paid',
  amountCents: 1200, currency: 'PLN', provider: 'simulated', providerObjectIds: {}, couponId: null, discountCents: 0,
  createdAt: '2026-11-25T09:00:00.000Z', memberEmail: 'buyer@example.org', memberName: 'Example Buyer', productTitle: 'Book', couponCode: null,
  fulfilmentStatus: 'to_pack', shipping: { rateId: 'locker', label: 'Locker', amountCents: 1200, vatRatePercent: 23, carrier: 'inpost',
    pickupPoint: { provider: 'inpost', code: 'ABC01M', name: null, address: null }, phone: null,
    address: { name: 'Example Buyer', line1: 'Street 1', line2: null, postalCode: '00-001', city: 'Example City', country: 'PL' } },
});
const harness = (change: Partial<OrderListItem> = {}) => {
  let order = { ...baseOrder, ...change };
  const shipments: Parameters<typeof deliveryCorrectionAllowed>[1][number][] = [];
  const lookup = vi.fn<() => Promise<PickupPointLookup>>(async () => ({ kind: 'found', point: { name: 'ABC02M', status: 'Operating', types: ['parcel_locker'], functions: ['parcel_collect'], locationDescription: 'From directory', address: { line1: 'Directory Street 2', line2: null } } }));
  const correctDelivery = vi.fn<OrderDeliveryRepository['correctDelivery']>(async (tenantId, command) => {
    if (tenantId !== order.tenantId) return err(notFound());
    const allowed = deliveryCorrectionAllowed(order, shipments);
    if (!allowed.ok) return allowed;
    if (order.shipping == null) throw new Error('Missing fixture shipping');
    const corrected = correctedOrderShipping(order.shipping, command);
    if (!corrected.ok) return corrected;
    order = { ...order, shipping: corrected.value };
    return ok({ order, recreateShipment: shipments.length > 0 });
  });
  return { correctDelivery, lookup, shipments, deps: {
    deliveries: { correctDelivery }, pickupPoints: { lookup }, clock: { nowIso: () => '2026-11-25T10:00:00.000Z' },
    orderDetails: { findById: async (tenantId: string) => tenantId === order.tenantId ? order : null },
  } };
};

describe('correct order delivery', () => {
  it('authorizes before reading or looking up a locker and scopes to the tenant', async () => {
    const h = harness();
    expect(await correctOrderDelivery(ctx(['order:read']), { orderId: 'order', expected: { phone: null }, phone: '500000000' }, h.deps)).toMatchObject({ ok: false, error: { code: 'forbidden' } });
    expect(await correctOrderDelivery({ ...ctx(), identity: { ...identity, tenantId: 'other' } }, { orderId: 'order', expected: { phone: null }, phone: '500000000' }, h.deps)).toMatchObject({ ok: false, error: { code: 'not_found' } });
    expect(h.correctDelivery).not.toHaveBeenCalled();
    expect(h.lookup).not.toHaveBeenCalled();
  });
  it.each([{ fulfilmentStatus: null }, { status: 'pending' }, { fulfilmentStatus: 'shipped' }] as const)('refuses orders outside to-pack state %o', async (change) => {
    const h = harness(change);
    expect(await correctOrderDelivery(ctx(), { orderId: 'order', expected: { phone: null }, phone: '500000000' }, h.deps)).toMatchObject({ ok: false });
    expect(h.correctDelivery).not.toHaveBeenCalled();
  });
  it('refuses bought shipments in the locked repository operation', async () => {
    const h = harness();
    h.shipments.push({ status: 'confirmed', trackingNumber: 'TRACK001', boughtAt: null, operationToken: null, providerShipmentId: 'draft', createAttemptedAt: null });
    expect(await correctOrderDelivery(ctx(), { orderId: 'order', expected: { phone: null }, phone: '500000000' }, h.deps)).toMatchObject({ ok: false, error: { code: 'delivery_correction_shipment_bought' } });
  });
  it('rejects unchanged values and foreign locker phones', async () => {
    const h = harness();
    expect(await correctOrderDelivery(ctx(), { orderId: 'order', expected: { recipientName: 'Example Buyer' }, recipientName: 'Example Buyer' }, h.deps)).toMatchObject({ ok: false, error: { details: { deliveryCorrection: 'unchanged' } } });
    expect(await correctOrderDelivery(ctx(), { orderId: 'order', expected: { phone: null }, phone: '+44 7700 900000' }, h.deps)).toMatchObject({ ok: false, error: { code: 'locker_phone_invalid' } });
    expect(h.correctDelivery).not.toHaveBeenCalled();
  });
  it('stores directory data rather than submitted locker labels and appends the staff audit', async () => {
    const h = harness();
    expect(await correctOrderDelivery(ctx(), { orderId: 'order', expected: { phone: null, pickupPoint: 'ABC01M' }, phone: '500 000 000', pickupPoint: { code: 'abc02m', name: 'Untrusted', address: 'Untrusted' } }, h.deps)).toMatchObject({ ok: true, value: { order: { shipping: {
      phone: '+48500000000', pickupPoint: { code: 'ABC02M', name: 'From directory', address: 'Directory Street 2' },
      corrections: [{ field: 'phone', byUserId: 'staff', byEmail: 'staff@example.org' }, { field: 'pickup_point', from: 'ABC01M', to: 'ABC02M' }],
    } }, recreateShipment: false } });
    expect(await correctOrderDelivery(ctx(), { orderId: 'order', expected: { recipientName: 'Example Buyer' }, recipientName: 'Corrected Buyer' }, h.deps)).toMatchObject({ ok: true, value: { order: { shipping: { corrections: [expect.anything(), expect.anything(), { field: 'recipient_name', from: 'Example Buyer', to: 'Corrected Buyer', at: '2026-11-25T10:00:00.000Z', byUserId: 'staff', byEmail: 'staff@example.org' }] } } } });
  });
  it.each(['not_found', 'unavailable'] as const)('refuses an unverified locker: %s', async (kind) => {
    const h = harness();
    h.lookup.mockResolvedValue({ kind });
    expect(await correctOrderDelivery(ctx(), { orderId: 'order', expected: { pickupPoint: 'ABC01M' }, pickupPoint: { code: 'ABC02M' } }, h.deps)).toMatchObject({ ok: false, error: { code: 'validation' } });
    expect(h.correctDelivery).not.toHaveBeenCalled();
  });
  it('refuses a correction once a shipment exists', async () => {
    const h = harness();
    h.shipments.push({ status: 'offers_prepared', trackingNumber: null, boughtAt: null, operationToken: null, providerShipmentId: 'draft', createAttemptedAt: null });
    expect(await correctOrderDelivery(ctx(), { orderId: 'order', expected: { phone: null }, phone: '500000000' }, h.deps)).toMatchObject({ ok: false, error: { code: 'delivery_correction_shipment_exists' } });
    expect(h.shipments).toHaveLength(1);
  });
});
