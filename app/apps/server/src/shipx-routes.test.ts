import { Hono } from 'hono';
import { describe, expect, it, vi } from 'vitest';
import { z } from 'zod';

import { createFakeShipxClient, fakeShipxShipmentId, fakeShipxTrackingNumber } from '#adapters/shipx/fake.js';
import { ok, orderListItemSchema, shipxOrderViewSchema, shipxSettingsViewSchema, type Identity, type OrderListItem } from '#core/domain/index.js';
import type { OrderFulfilmentRepository, ShipxClient } from '#core/server/index.js';
import { createInMemoryTenantDomainRepository } from '#core/server/testing/tenant-domain-fakes.js';
import { createTenantSecretRepositoryFake } from '#core/server/testing/tenant-secret-fake.js';
import { createShipxSettingsRepositoryFake, createShipxShipmentRepositoryFake } from '#core/server/testing/shipx-fakes.js';

import type { AppVars } from './app-vars.js';
import { registerShipxRoutes } from './shipx-routes.js';

const identity = (staffRole: 'owner' | 'admin' | null): Identity => ({
  userId: 'staff', email: 'staff@example.org', name: 'Staff', emailVerified: true, image: null,
  tenantAccess: staffRole === null ? 'member' : 'staff', tenantId: 'workspace', tenantSlug: 'workspace', tenantName: 'Workspace', staffRole,
  memberId: staffRole === null ? 'member' : null, memberDisplayName: null, memberBannedAt: null, memberDmOptOutAt: null, memberLanguage: null, memberVideoAutoplay: false,
});

const order = (mode: 'live' | 'test'): OrderListItem => orderListItemSchema.parse({
  id: 'order-1', tenantId: 'workspace', memberId: 'member', productId: 'stand', priceId: null, kind: 'one_time', status: 'paid', mode,
  amountCents: 7398, currency: 'PLN', provider: 'stripe', providerObjectIds: {}, couponId: null, discountCents: 0,
  createdAt: '2026-11-04T09:00:00.000Z', paidAt: '2026-11-04T09:01:00.000Z', memberEmail: 'buyer@example.org', memberName: 'Buyer',
  productTitle: 'Printed stand', couponCode: null, fulfilmentStatus: 'to_pack',
  shipping: {
    rateId: 'locker', label: 'Parcel locker', amountCents: 1499, vatRatePercent: 23, carrier: 'inpost',
    pickupPoint: { provider: 'inpost', code: 'WAW01M', name: null, address: null },
    address: { name: 'Jane Buyer', line1: 'Garden Street 5', line2: null, postalCode: '00-950', city: 'Warsaw', country: 'PL' },
    phone: '+48500000000',
  },
});

const secretCrypto = {
  encrypt: (plaintext: string) => ({ ciphertext: plaintext, iv: 'iv', authTag: 'tag' }),
  decrypt: (input: { ciphertext: string }) => ok(input.ciphertext),
};

const harness = (options: { staffRole?: 'owner' | 'admin' | null; mode?: 'live' | 'test' } = {}) => {
  const secrets = createTenantSecretRepositoryFake();
  const stored = order(options.mode ?? 'test');
  const live: ShipxClient = {
    createShipment: vi.fn(),
    getShipment: vi.fn(),
    findShipmentByReference: vi.fn(),
    buyOffer: vi.fn(),
    fetchLabel: vi.fn(),
  };
  const ship = vi.fn<OrderFulfilmentRepository['ship']>(async (_tenantId, input) => ok({ ...stored, fulfilmentStatus: 'shipped', shipment: input.shipment }));
  const app = new Hono<AppVars>();
  app.use('*', async (c, next) => { c.set('identity', identity(options.staffRole === undefined ? 'owner' : options.staffRole)); await next(); });
  registerShipxRoutes(app, {
    orderDetails: { findById: async (tenantId, id) => (tenantId === 'workspace' && id === stored.id ? stored : null) },
    orderFulfilment: { ship },
    products: { findByIds: async () => [] },
    tenantSecrets: secrets.repository,
    secretCrypto,
    secretResolver: {
      resolve: async (tenantId, key) => {
        const secret = await secrets.repository.findByKey(tenantId, key);
        return secret === null ? { ok: false, error: { code: 'not_found', message: 'missing' } } : ok(secret.ciphertext);
      },
    },
    shipxIntegration: {
      shipx: { real: live, fake: createFakeShipxClient() },
      shipxShipments: createShipxShipmentRepositoryFake().repository,
      shipxSettings: createShipxSettingsRepositoryFake().repository,
      wait: async () => undefined,
    },
    members: { findById: async () => null },
    tenants: { findSettings: async () => null },
    tenantDomains: createInMemoryTenantDomainRepository(),
    ids: { nextId: () => `id-${String(Math.random()).slice(2)}` },
    clock: { nowIso: () => '2026-11-08T10:00:00.000Z' },
    dispatchEmail: vi.fn(),
    appBaseUrl: 'https://app.together.test',
    baseDomain: 'together.test',
    singleTenantMode: false,
  });
  return { app, live, ship };
};

const envelope = <S extends z.ZodTypeAny>(data: S) => z.object({ ok: z.literal(true), data });

const configure = (app: Hono<AppVars>, environment: 'sandbox' | 'production' = 'sandbox') => app.request('/api/integrations/shipx/configure', {
  method: 'POST',
  headers: { 'content-type': 'application/json' },
  body: JSON.stringify({
    environment,
    organizationId: '1234',
    token: 'sandbox-token-5678',
    sender: { name: 'Anna Sender', email: 'shop@example.org', phone: '500600700', street: 'Factory Street', buildingNumber: '7', city: 'Warsaw', postCode: '00-001' },
  }),
});

describe('InPost ShipX HTTP routes', () => {
  it('configures the integration and never returns the token', async () => {
    const h = harness();
    const saved = await configure(h.app);
    expect(saved.status).toBe(200);
    const text = await saved.text();
    expect(text).not.toContain('sandbox-token-5678');
    expect(envelope(shipxSettingsViewSchema).parse(JSON.parse(text)).data).toMatchObject({
      environment: 'sandbox', configured: true, token: { maskedPreview: '••••5678' },
    });
    const view = await h.app.request('/api/integrations/shipx');
    expect(await view.text()).not.toContain('sandbox-token-5678');
  });

  it('creates the shipment of a test order with the fake client in production, then serves the label as an attachment', async () => {
    const h = harness();
    await configure(h.app, 'production');
    const before = await h.app.request('/api/orders/order-1/shipx');
    expect(envelope(shipxOrderViewSchema).parse(await before.json()).data).toMatchObject({ available: true, service: 'inpost_locker_standard' });

    const created = await h.app.request('/api/orders/order-1/shipx', { method: 'POST' });
    expect(created.status).toBe(200);
    const tracking = fakeShipxTrackingNumber(fakeShipxShipmentId('order-1'));
    expect(h.ship.mock.calls[0]?.[1].shipment).toMatchObject({ carrier: 'inpost', trackingNumber: tracking });
    expect(h.live.createShipment).not.toHaveBeenCalled();

    const label = await h.app.request('/api/orders/order-1/shipx/label');
    expect(label.status).toBe(200);
    expect(label.headers.get('content-type')).toBe('application/pdf');
    expect(label.headers.get('content-disposition')).toBe(`attachment; filename="inpost-${tracking}.pdf"`);
    expect(label.headers.get('cache-control')).toBe('private, no-store');
    expect(new TextDecoder().decode((await label.arrayBuffer()).slice(0, 5))).toBe('%PDF-');
  });

  it('refuses a paid order while ShipX is set to the sandbox, without calling ShipX', async () => {
    const h = harness({ mode: 'live' });
    await configure(h.app);
    const view = await h.app.request('/api/orders/order-1/shipx');
    expect(envelope(shipxOrderViewSchema).parse(await view.json()).data).toMatchObject({ available: false, reason: 'sandbox_environment' });
    const refused = await h.app.request('/api/orders/order-1/shipx', { method: 'POST' });
    expect(refused.status).toBe(400);
    expect(await refused.json()).toMatchObject({ ok: false, error: { code: 'validation', message: 'ShipX is configured for the sandbox; switch to production before shipping paid orders' } });
    expect(h.live.createShipment).not.toHaveBeenCalled();
    expect(h.ship).not.toHaveBeenCalled();
  });

  it('discards only an unconfirmed attempt and requires order:write', async () => {
    const h = harness();
    const none = await h.app.request('/api/orders/order-1/shipx/discard', { method: 'POST' });
    expect(none.status).toBe(400);
    const member = harness({ staffRole: null });
    expect((await member.app.request('/api/orders/order-1/shipx/discard', { method: 'POST' })).status).toBe(403);
  });

  it('reports a missing configuration with HTTP 412 and keeps members out', async () => {
    const h = harness();
    const missing = await h.app.request('/api/orders/order-1/shipx', { method: 'POST' });
    expect(missing.status).toBe(412);
    expect(h.ship).not.toHaveBeenCalled();
    const member = harness({ staffRole: null });
    expect((await member.app.request('/api/orders/order-1/shipx/label')).status).toBe(403);
    expect((await member.app.request('/api/integrations/shipx')).status).toBe(403);
  });

  it('keeps the owner-only configuration away from admins', async () => {
    const h = harness({ staffRole: 'admin' });
    expect((await configure(h.app)).status).toBe(403);
    expect((await h.app.request('/api/integrations/shipx')).status).toBe(200);
  });

  it('returns not found for a label before any shipment exists', async () => {
    const h = harness();
    const response = await h.app.request('/api/orders/order-1/shipx/label');
    expect(response.status).toBe(404);
    expect(response.headers.get('content-type')).toBe('application/json');
  });
});
