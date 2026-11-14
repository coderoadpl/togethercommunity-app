import { Hono } from 'hono';
import { describe, expect, it, vi } from 'vitest';
import { z } from 'zod';

import { orderExportFileSchema, orderListItemSchema, type Identity, type OrderListItem } from '#core/domain/index.js';
import type { OrderRepository } from '#core/server/index.js';
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

const harness = () => {
  const stored = [order('live-order', 'live'), order('test-order', 'test')];
  const list = vi.fn<OrderRepository['list']>(async (_tenantId, filters) => {
    const orders = stored.filter((item) => filters.mode === undefined || item.mode === filters.mode);
    return { orders, total: orders.length };
  });
  const app = new Hono<AppVars>();
  app.use('*', async (c, next) => { c.set('identity', identity); await next(); });
  registerOrderFulfilmentRoutes(app, {
    orders: { list },
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
  return { app, list };
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
