import { Hono } from 'hono';
import { describe, expect, it, vi } from 'vitest';
import { z } from 'zod';

import { correctedOrderShipping, err, notFound, ok, orderExportFileSchema, orderListItemSchema, type Identity, type OrderListItem } from '#core/domain/index.js';
import type { OrderDeliveryRepository, OrderPersonalizationRepository, OrderRepository } from '#core/server/index.js';
import { createInMemoryTenantDomainRepository } from '#core/server/testing/tenant-domain-fakes.js';

import type { AppVars } from './app-vars.js';
import { registerOrderFulfilmentRoutes } from './order-fulfilment-routes.js';

const identity: Identity = { userId: 'staff', email: 'staff@example.org', name: 'Staff', emailVerified: true, image: null, tenantAccess: 'staff', tenantId: 'workspace', tenantSlug: 'workspace', tenantName: 'Workspace', staffRole: 'owner', memberId: null, memberDisplayName: null, memberBannedAt: null, memberDmOptOutAt: null, memberLanguage: null, memberVideoAutoplay: false };

const order = (id: string, mode: 'live' | 'test'): OrderListItem => orderListItemSchema.parse({
  id, tenantId: 'workspace', memberId: 'member', productId: 'stand', priceId: null, kind: 'one_time', status: 'paid', mode,
  amountCents: 7398, currency: 'PLN', provider: 'stripe', providerObjectIds: {}, couponId: null, discountCents: 0,
  createdAt: '2026-11-04T09:00:00.000Z', paidAt: '2026-11-04T09:01:00.000Z', memberEmail: 'buyer@example.org', memberName: 'Buyer',
  productTitle: 'Printed stand', couponCode: null, fulfilmentStatus: 'to_pack',
  shipping: {
    rateId: 'locker', label: 'Parcel locker', amountCents: 1499, vatRatePercent: 23, carrier: 'inpost',
    pickupPoint: { provider: 'inpost', code: 'WAW01M', name: null, address: null },
    address: { name: 'Buyer', line1: 'Garden Street 5', line2: null, postalCode: '00-950', city: 'Warsaw', country: 'PL' },
    phone: null,
  },
});

const harness = (correctPersonalization: OrderPersonalizationRepository['correctPersonalization'] = async () => ok(order('live-order', 'live')), viewer: Identity = identity) => {
  const stored = [order('live-order', 'live'), order('test-order', 'test')];
  const list = vi.fn<OrderRepository['list']>(async (_tenantId, filters) => {
    const orders = stored.filter((item) => filters.mode === undefined || item.mode === filters.mode);
    return { orders, total: orders.length };
  });
  const correctDelivery = vi.fn<OrderDeliveryRepository['correctDelivery']>(async (tenantId, command) => {
    const current = stored.find((row) => row.id === command.input.orderId && row.tenantId === tenantId);
    if (current?.shipping == null) return err(notFound());
    const corrected = correctedOrderShipping(current.shipping, command);
    return corrected.ok ? ok({ order: { ...current, shipping: corrected.value }, recreateShipment: false }) : corrected;
  });
  const app = new Hono<AppVars>();
  app.use('*', async (c, next) => { c.set('identity', viewer); await next(); });
  registerOrderFulfilmentRoutes(app, {
    orders: { list },
    orderDetails: { findById: async (tenantId, orderId) => stored.find((row) => row.id === orderId && row.tenantId === tenantId) ?? null },
    orderDeliveries: { correctDelivery },
    orderPersonalizations: { correctPersonalization },
    members: { findById: async () => null },
    tenants: { findSettings: async () => null },
    tenantDomains: createInMemoryTenantDomainRepository(),
    ids: { nextId: () => 'id-1' },
    clock: { nowIso: () => '2026-11-05T10:00:00.000Z' },
    dispatchEmail: vi.fn(),
    appBaseUrl: 'https://app.together.test',
    baseDomain: 'together.test',
    singleTenantMode: false,
  });
  return { app, list, correctDelivery };
};

const orderPackingListEnvelope = z.object({ ok: z.literal(true), data: orderExportFileSchema });

const rows = async (response: Response): Promise<string[]> => {
  const body: unknown = await response.json();
  const parsed = orderPackingListEnvelope.parse(body);
  return parsed.data.content.split('\n').slice(1);
};

describe('packing list HTTP route', () => {
  it('returns only test-mode rows for mode=test and only live rows by default', async () => {
    const h = harness();
    const test = await h.app.request('/api/orders/packing-list?format=csv&mode=test');
    expect(test.status).toBe(200);
    const testRows = await rows(test);
    expect(testRows).toHaveLength(1);
    expect(testRows[0]).toMatch(/^"test-order",/);
    expect(h.list).toHaveBeenLastCalledWith('workspace', expect.objectContaining({ mode: 'test', fulfilmentStatus: 'to_pack' }));

    const live = await h.app.request('/api/orders/packing-list?format=csv');
    expect(live.status).toBe(200);
    const liveRows = await rows(live);
    expect(liveRows).toHaveLength(1);
    expect(liveRows[0]).toMatch(/^"live-order",/);
    expect(h.list).toHaveBeenLastCalledWith('workspace', expect.objectContaining({ mode: 'live', fulfilmentStatus: 'to_pack' }));
  });

  it('rejects an unknown payment mode without reading orders', async () => {
    const h = harness();
    const response = await h.app.request('/api/orders/packing-list?format=csv&mode=staging');
    expect(response.status).toBe(400);
    expect(h.list).not.toHaveBeenCalled();
  });
});

describe('order personalisation correction HTTP route', () => {
  it('passes the path order id, the body and the staff identity to the correction and returns the order', async () => {
    const correct = vi.fn<OrderPersonalizationRepository['correctPersonalization']>(async () => ok(order('live-order', 'live')));
    const h = harness(correct);
    const response = await h.app.request('/api/orders/live-order/personalization', {
      method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ productId: 'stand', text: ' For Alex ' }),
    });
    expect(response.status).toBe(200);
    expect(z.object({ ok: z.literal(true), data: z.object({ order: orderListItemSchema }) }).parse(await response.json()).data.order.id).toBe('live-order');
    expect(correct).toHaveBeenCalledWith('workspace', { orderId: 'live-order', productId: 'stand', text: 'For Alex', editedAt: '2026-11-05T10:00:00.000Z', editedBy: 'staff' });
  });

  it('refuses an empty text or an attempt to change the accepted condition without writing', async () => {
    const correct = vi.fn<OrderPersonalizationRepository['correctPersonalization']>(async () => ok(order('live-order', 'live')));
    const h = harness(correct);
    for (const body of [{ productId: 'stand', text: '' }, { productId: 'stand', text: 'Hi', condition: 'Other' }]) {
      const response = await h.app.request('/api/orders/live-order/personalization', {
        method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body),
      });
      expect(response.status).toBe(400);
    }
    expect(correct).not.toHaveBeenCalled();
  });

  it('refuses a member without order:write and writes nothing', async () => {
    const correct = vi.fn<OrderPersonalizationRepository['correctPersonalization']>(async () => ok(order('live-order', 'live')));
    const h = harness(correct, { ...identity, staffRole: null, tenantAccess: 'member', memberId: 'member' });
    const response = await h.app.request('/api/orders/live-order/personalization', {
      method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ productId: 'stand', text: 'For Alex' }),
    });
    expect(response.status).toBe(403);
    expect(correct).not.toHaveBeenCalled();
  });
});


describe('order delivery correction HTTP route', () => {
  it('uses the path id and returns a staff-only audited order', async () => {
    const h = harness();
    const response = await h.app.request('/api/orders/live-order/delivery-details', {
      method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ orderId: 'test-order', phone: '500 000 000' }),
    });
    expect(response.status).toBe(200);
    const body = z.object({ data: z.object({ order: orderListItemSchema, recreateShipment: z.boolean() }) }).parse(await response.json());
    expect(body.data.order.id).toBe('live-order');
    expect(body.data.order.shipping?.corrections).toEqual([{ field: 'phone', from: null, to: '+48500000000', at: '2026-11-05T10:00:00.000Z', byUserId: 'staff', byEmail: 'staff@example.org' }]);
  });
  it('denies member access and another tenant without writing', async () => {
    for (const viewer of [{ ...identity, staffRole: null, tenantAccess: 'member' as const, memberId: 'member' }, { ...identity, tenantId: 'other' }]) {
      const h = harness(undefined, viewer);
      const response = await h.app.request('/api/orders/live-order/delivery-details', {
        method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ phone: '500000000' }),
      });
      expect(response.status).toBe(viewer.tenantId === 'other' ? 404 : 403);
      expect(h.correctDelivery).not.toHaveBeenCalled();
    }
  });
  it('rejects forged audit data and a country change', async () => {
    const h = harness();
    for (const body of [{ phone: '500000000', byEmail: 'other@example.org' }, { address: { line1: 'Street 1', line2: null, postalCode: '00-001', city: 'City', country: 'GB' } }]) {
      const response = await h.app.request('/api/orders/live-order/delivery-details', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });
      expect(response.status).toBe(400);
    }
    expect(h.correctDelivery).not.toHaveBeenCalled();
  });
});
