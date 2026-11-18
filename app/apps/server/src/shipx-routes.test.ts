import { Hono } from 'hono';
import { describe, expect, it, vi } from 'vitest';
import { z } from 'zod';

import { createFakeShipxClient, fakeShipxShipmentId, fakeShipxTrackingNumber } from '#adapters/shipx/fake.js';
import { ok, orderListItemSchema, shipxOrderViewSchema, shipxSettingsViewSchema, type Identity, type OrderListItem, type Tenant } from '#core/domain/index.js';
import type { OrderFulfilmentRepository } from '#core/server/index.js';
import { createInMemoryTenantDomainRepository } from '#core/server/testing/tenant-domain-fakes.js';
import { createTenantSecretRepositoryFake } from '#core/server/testing/tenant-secret-fake.js';
import { createShipxSettingsRepositoryFake, createShipxShipmentRepositoryFake, shipmentRecord } from '#core/server/testing/shipx-fakes.js';

import type { AppVars } from './app-vars.js';
import { requestOriginGuard } from './request-origin.js';
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

const workspace: Tenant = { id: 'workspace', slug: 'workspace', name: 'Workspace', status: 'active', plan: 'hosted', contentVersion: 1 };

const originGuard = () => requestOriginGuard({
  appBaseUrl: 'https://app.together.test',
  deploymentAuthOrigins: [],
  baseDomain: 'together.test',
  platformHost: null,
  singleTenantMode: false,
  tenants: {
    findById: async (id) => (id === workspace.id ? workspace : null),
    findBySlug: async (slug) => (slug === workspace.slug ? workspace : null),
    findSole: async () => workspace,
    findSettings: async () => null,
    updateSettings: async (_id, settings) => settings,
    createTenantWithOwnerGrant: async () => null,
    hasAny: async () => true,
  },
  tenantDomains: createInMemoryTenantDomainRepository(),
  authPort: { getAuthenticatedUser: async (headers) => (headers.get('cookie')?.includes('session=valid') === true ? { sessionId: 'session', userId: 'staff', email: 'staff@example.org', name: 'Staff', emailVerified: true, image: null } : null) },
});

const spiedClient = () => {
  const client = createFakeShipxClient();
  const spies = {
    createShipment: vi.spyOn(client, 'createShipment'),
    getShipment: vi.spyOn(client, 'getShipment'),
    fetchLabel: vi.spyOn(client, 'fetchLabel'),
  };
  return { client, spies };
};

const harness = (options: { staffRole?: 'owner' | 'admin' | null; mode?: 'live' | 'test'; guarded?: boolean; deployment?: 'fake' | 'real' } = {}) => {
  const secrets = createTenantSecretRepositoryFake();
  const stored = order(options.mode ?? 'test');
  const real = spiedClient();
  const fake = spiedClient();
  const carrier = fake.spies;
  const shipments = createShipxShipmentRepositoryFake();
  const writes = {
    refreshUnclaimed: vi.spyOn(shipments.repository, 'refreshUnclaimed'),
    markLabelFetched: vi.spyOn(shipments.repository, 'markLabelFetched'),
  };
  const ship = vi.fn<OrderFulfilmentRepository['ship']>(async (_tenantId, input) => ok({ ...stored, fulfilmentStatus: 'shipped', shipment: input.shipment }));
  const app = new Hono<AppVars>();
  if (options.guarded === true) app.use('/api/*', originGuard());
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
      shipx: { real: options.deployment === 'real' ? real.client : null, fake: fake.client },
      shipxShipments: shipments.repository,
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
  const seed = () => shipments.rows.set(shipments.key('workspace', 'order-1'), shipmentRecord({ shipxShipmentId: '1001', status: 'offer_selected', environment: 'sandbox', organizationId: '5678' }));
  const events = async () => shipments.repository.listEvents('workspace', 'order-1');
  return { app, real: real.spies, ship, carrier, writes, seed, events, shipments };
};

const envelope = <S extends z.ZodTypeAny>(data: S) => z.object({ ok: z.literal(true), data });

const SLOT_CREDENTIALS = {
  sandbox: { organizationId: '5678', token: 'sandbox-token-5678' },
  production: { organizationId: '1234', token: 'production-token-1234' },
} as const;

const sender = { name: 'Anna Sender', email: 'shop@example.org', phone: '500600700', street: 'Factory Street', buildingNumber: '7', city: 'Warsaw', postCode: '00-001' };

const post = (app: Hono<AppVars>, body: unknown) => app.request('/api/integrations/shipx/configure', {
  method: 'POST',
  headers: { 'content-type': 'application/json' },
  body: JSON.stringify(body),
});

const configure = (app: Hono<AppVars>, slots: ReadonlyArray<'sandbox' | 'production'> = ['sandbox']) =>
  post(app, { sender, ...Object.fromEntries(slots.map((slot) => [slot, SLOT_CREDENTIALS[slot]])) });

describe('InPost ShipX HTTP routes', () => {
  it('configures one slot and never returns the token', async () => {
    const h = harness();
    const saved = await configure(h.app);
    expect(saved.status).toBe(200);
    const text = await saved.text();
    expect(text).not.toContain('sandbox-token-5678');
    expect(envelope(shipxSettingsViewSchema).parse(JSON.parse(text)).data).toMatchObject({
      sandbox: { configured: true, organizationId: { maskedPreview: '••••5678' }, token: { maskedPreview: '••••5678' } },
      production: { configured: false, organizationId: null, token: null },
    });
    const view = await h.app.request('/api/integrations/shipx');
    expect(await view.text()).not.toContain('sandbox-token-5678');
  });

  it.each([
    ['environment', { environment: 'production', organizationId: '1234', token: 'production-token-1234', sender }],
    ['credentials', { organizationId: '1234', token: 'production-token-1234' }],
    ['clear', { clearCredentials: true }],
  ])('refuses the previous top-level %s shape with validation and stores nothing', async (_shape, body) => {
    const h = harness();
    const refused = await post(h.app, body);
    expect(refused.status).toBe(400);
    expect(await refused.json()).toMatchObject({ ok: false, error: { code: 'validation' } });
    const view = await h.app.request('/api/integrations/shipx');
    expect(envelope(shipxSettingsViewSchema).parse(await view.json()).data).toEqual({
      sender: null,
      sandbox: { organizationId: null, token: null, configured: false },
      production: { organizationId: null, token: null, configured: false },
    });
  });

  it('creates the shipment of a test order with the fake client in a deployment without the real client, then serves the label as an attachment', async () => {
    const h = harness();
    await configure(h.app);
    const before = await h.app.request('/api/orders/order-1/shipx');
    expect(envelope(shipxOrderViewSchema).parse(await before.json()).data).toMatchObject({ available: true, environment: 'sandbox', service: 'inpost_locker_standard' });

    const created = await h.app.request('/api/orders/order-1/shipx', { method: 'POST' });
    expect(created.status).toBe(200);
    const tracking = fakeShipxTrackingNumber(fakeShipxShipmentId('order-1'));
    expect(h.ship.mock.calls[0]?.[1].shipment).toMatchObject({ carrier: 'inpost', trackingNumber: tracking });
    expect(h.carrier.createShipment.mock.calls[0]?.[0]).toEqual({ environment: 'sandbox', ...SLOT_CREDENTIALS.sandbox });
    expect(h.real.createShipment).not.toHaveBeenCalled();

    const label = await h.app.request('/api/orders/order-1/shipx/label', { method: 'POST' });
    expect(label.status).toBe(200);
    expect(label.headers.get('content-type')).toBe('application/pdf');
    expect(label.headers.get('content-disposition')).toBe(`attachment; filename="inpost-${tracking}.pdf"`);
    expect(label.headers.get('cache-control')).toBe('private, no-store');
    expect(new TextDecoder().decode((await label.arrayBuffer()).slice(0, 5))).toBe('%PDF-');
  });

  it('passes the parcel template staff chose to ShipX and keeps the product template without one', async () => {
    const createWith = async (init: RequestInit) => {
      const h = harness();
      await configure(h.app);
      const response = await h.app.request('/api/orders/order-1/shipx', { method: 'POST', ...init });
      const body: unknown = await response.json();
      return { status: response.status, body, templates: h.carrier.createShipment.mock.calls.map((call) => call[1].parcelTemplate) };
    };
    const json = (body: unknown): RequestInit => ({ headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });

    expect(await createWith(json({ orderId: 'order-1', parcelTemplate: 'large' }))).toMatchObject({ status: 200, templates: ['large'] });
    expect(await createWith({})).toMatchObject({ status: 200, templates: ['medium'] });
    expect(await createWith(json({}))).toMatchObject({ status: 200, templates: ['medium'] });
    expect(await createWith(json({ parcelTemplate: 'huge' }))).toMatchObject({ status: 400, body: { ok: false, error: { code: 'validation' } }, templates: [] });
    expect(await createWith({ headers: { 'content-type': 'application/json' }, body: '{' })).toMatchObject({ status: 400, body: { ok: false, error: { code: 'validation' } }, templates: [] });
  });

  it.each([
    ['test', 'sandbox'],
    ['live', 'production'],
  ] as const)('sends a %s order to the %s slot through the real client in a deployment that has one', async (mode, slot) => {
    const h = harness({ mode, deployment: 'real' });
    await configure(h.app, ['sandbox', 'production']);
    const created = await h.app.request('/api/orders/order-1/shipx', { method: 'POST' });
    expect(created.status).toBe(200);
    expect(h.real.createShipment.mock.calls.map((call) => call[0])).toEqual([{ environment: slot, ...SLOT_CREDENTIALS[slot] }]);
    expect(h.carrier.createShipment).not.toHaveBeenCalled();
    expect(h.shipments.rows.get(h.shipments.key('workspace', 'order-1'))).toMatchObject({ environment: slot, organizationId: SLOT_CREDENTIALS[slot].organizationId });
  });

  it.each([
    ['live', ['sandbox'], 'production'],
    ['test', ['production'], 'sandbox'],
  ] as const)('refuses a %s order whose slot is missing with HTTP 412 naming the slot, without calling ShipX', async (mode, slots, missing) => {
    const h = harness({ mode, deployment: 'real' });
    await configure(h.app, slots);
    const view = await h.app.request('/api/orders/order-1/shipx');
    expect(envelope(shipxOrderViewSchema).parse(await view.json()).data).toMatchObject({ available: false, reason: 'credentials_missing', environment: missing });
    const refused = await h.app.request('/api/orders/order-1/shipx', { method: 'POST' });
    expect(refused.status).toBe(412);
    expect(await refused.json()).toMatchObject({
      ok: false,
      error: { code: 'integration_not_configured', details: { state: 'setup_missing', reason: 'credentials_missing', environment: missing } },
    });
    expect(h.real.createShipment).not.toHaveBeenCalled();
    expect(h.carrier.createShipment).not.toHaveBeenCalled();
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
    expect((await member.app.request('/api/orders/order-1/shipx/label', { method: 'POST' })).status).toBe(403);
    expect((await member.app.request('/api/orders/order-1/shipx/refresh', { method: 'POST' })).status).toBe(403);
    expect((await member.app.request('/api/integrations/shipx')).status).toBe(403);
  });

  it('keeps the owner-only configuration away from admins', async () => {
    const h = harness({ staffRole: 'admin' });
    expect((await configure(h.app)).status).toBe(403);
    expect((await h.app.request('/api/integrations/shipx')).status).toBe(200);
  });

  it('returns not found for a label before any shipment exists', async () => {
    const h = harness();
    const response = await h.app.request('/api/orders/order-1/shipx/label', { method: 'POST' });
    expect(response.status).toBe(404);
    expect(response.headers.get('content-type')).toBe('application/json');
  });
});

describe('InPost ShipX side effects stay behind POST and the request origin', () => {
  const crossSite = { cookie: 'session=valid', origin: 'https://evil.test', 'sec-fetch-site': 'cross-site' };
  const sameOrigin = { cookie: 'session=valid', origin: 'https://workspace.together.test', 'sec-fetch-site': 'same-origin' };
  const at = (path: string) => `https://workspace.together.test/api/orders/order-1/shipx${path}`;

  const untouched = async (h: ReturnType<typeof harness>) => {
    expect(h.carrier.getShipment).not.toHaveBeenCalled();
    expect(h.carrier.fetchLabel).not.toHaveBeenCalled();
    expect(h.writes.refreshUnclaimed).not.toHaveBeenCalled();
    expect(h.writes.markLabelFetched).not.toHaveBeenCalled();
    expect(await h.events()).toEqual([]);
    expect(h.shipments.rows.get(h.shipments.key('workspace', 'order-1'))).toMatchObject({ status: 'offer_selected', trackingNumber: null, labelFetchedAt: null });
  };

  it('serves the stored view of a shipment waiting for payment on GET without calling ShipX or writing', async () => {
    const h = harness();
    await configure(h.app);
    h.seed();
    const view = await h.app.request('/api/orders/order-1/shipx');
    expect(view.status).toBe(200);
    expect(envelope(shipxOrderViewSchema).parse(await view.json()).data.shipment).toMatchObject({ shipxShipmentId: '1001', status: 'offer_selected', trackingNumber: null });
    await untouched(h);
  });

  it('lets a cross-site cookie GET through the guard but reaches neither ShipX nor a write, and has no GET label route', async () => {
    const h = harness({ guarded: true });
    await configure(h.app);
    h.seed();
    expect((await h.app.request(at(''), { headers: crossSite })).status).toBe(200);
    expect((await h.app.request(at('/label'), { headers: crossSite })).status).toBe(404);
    await untouched(h);
  });

  it.each(['/refresh', '/label'])('rejects a cross-site cookie POST to %s before ShipX or the repository is reached', async (path) => {
    const h = harness({ guarded: true });
    await configure(h.app);
    h.seed();
    const response = await h.app.request(at(path), { method: 'POST', headers: crossSite });
    expect(response.status).toBe(403);
    expect(await response.json()).toEqual({ ok: false, error: { code: 'forbidden', message: 'Request origin is not allowed' } });
    await untouched(h);
  });

  it('refreshes the shipment and serves the label for a cookie POST from the workspace origin', async () => {
    const h = harness({ guarded: true });
    await configure(h.app);
    h.seed();
    const tracking = fakeShipxTrackingNumber('1001');
    const refreshed = await h.app.request(at('/refresh'), { method: 'POST', headers: sameOrigin });
    expect(refreshed.status).toBe(200);
    expect(envelope(shipxOrderViewSchema).parse(await refreshed.json()).data).toMatchObject({ available: true, shipment: { status: 'confirmed', trackingNumber: tracking } });
    expect(h.carrier.getShipment).toHaveBeenCalledTimes(1);
    const label = await h.app.request(at('/label'), { method: 'POST', headers: sameOrigin });
    expect(label.status).toBe(200);
    expect(label.headers.get('content-type')).toBe('application/pdf');
    expect(label.headers.get('content-disposition')).toBe(`attachment; filename="inpost-${tracking}.pdf"`);
    expect(label.headers.get('cache-control')).toBe('private, no-store');
    expect((await h.events()).map((event) => event.type)).toEqual(['status_refreshed', 'offer_bought', 'label_fetched']);
  });
});
