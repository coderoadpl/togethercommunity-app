import { Hono } from 'hono';
import { describe, expect, it, vi } from 'vitest';
import { appError, err, ok, orderListItemSchema, type Identity } from '#core/domain/index.js';
import type { AppVars } from './app-vars.js';
import { registerOrderVerificationRoutes } from './order-verification-routes.js';

const now = '2026-10-08T12:00:00.000Z';
const identity: Identity = { userId: 'staff', email: 'staff@example.org', name: 'Staff', emailVerified: true, image: null, tenantAccess: 'staff', tenantId: 'workspace', tenantSlug: 'workspace', tenantName: 'Workspace', staffRole: 'owner', memberId: null, memberDisplayName: null, memberBannedAt: null, memberDmOptOutAt: null, memberLanguage: null, memberVideoAutoplay: false };
const order = orderListItemSchema.parse({ id: 'order-number', tenantId: 'workspace', memberId: 'member', productId: 'physical', priceId: null, kind: 'one_time', status: 'paid', amountCents: 10500, currency: 'PLN', provider: 'simulated', providerObjectIds: {}, couponId: null, discountCents: 0, createdAt: now, memberEmail: 'buyer@example.org', memberName: 'Buyer', productTitle: 'Printed material', couponCode: null });
const harness = (actor: Identity) => {
  const app = new Hono<AppVars>();
  const findByReference = vi.fn(async () => order);
  const issueLine = vi.fn(async () => ok(order));
  app.use('*', async (c, next) => { c.set('identity', actor); await next(); });
  registerOrderVerificationRoutes(app, { clock: { nowIso: () => now }, orderVerification: { findByToken: async () => order, findByReference, issueLine } });
  return { app, findByReference, issueLine };
};

describe('order verification HTTP routes', () => {
  it('returns order details for staff and passes tenant and acting user to issuance', async () => {
    const h = harness(identity);
    const read = await h.app.request('/api/orders/verify/opaque-token');
    expect(read.status).toBe(200);
    expect(await read.json()).toMatchObject({ ok: true, data: { order: { id: 'order-number' } } });
    expect(h.findByReference).toHaveBeenCalledWith('workspace', 'opaque-token');
    const issue = await h.app.request('/api/orders/order-number/lines/physical/issue', { method: 'POST' });
    expect(issue.status).toBe(200);
    expect(h.issueLine).toHaveBeenCalledWith('workspace', { orderId: 'order-number', productId: 'physical', staffUserId: 'staff', occurredAt: now });
  });
  it('returns HTTP 409 when a physical line was already issued', async () => {
    const app = new Hono<AppVars>();
    app.use('*', async (c, next) => { c.set('identity', identity); await next(); });
    registerOrderVerificationRoutes(app, { clock: { nowIso: () => now }, orderVerification: { findByToken: async () => order, findByReference: async () => order, issueLine: async () => err(appError('conflict', 'Order line has already been issued')) } });
    const response = await app.request('/api/orders/order-number/lines/physical/issue', { method: 'POST' });
    expect(response.status).toBe(409);
    expect(await response.json()).toMatchObject({ ok: false, error: { code: 'conflict' } });
  });
  it('denies member reads and writes without storage access', async () => {
    const h = harness({ ...identity, staffRole: null, tenantAccess: 'member', memberId: 'member' });
    expect((await h.app.request('/api/orders/verify/opaque-token')).status).toBe(403);
    expect((await h.app.request('/api/orders/order-number/lines/physical/issue', { method: 'POST' })).status).toBe(403);
    expect(h.findByReference).not.toHaveBeenCalled();
    expect(h.issueLine).not.toHaveBeenCalled();
  });
  it('returns not found for unknown or cross-workspace references', async () => {
    const app = new Hono<AppVars>();
    app.use('*', async (c, next) => { c.set('identity', identity); await next(); });
    registerOrderVerificationRoutes(app, { clock: { nowIso: () => now }, orderVerification: { findByToken: async () => null, findByReference: async () => null, issueLine: async () => ok(order) } });
    expect((await app.request('/api/orders/verify/unknown')).status).toBe(404);
  });
});
