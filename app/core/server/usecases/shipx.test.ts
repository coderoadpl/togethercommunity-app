import { describe, expect, it, vi } from 'vitest';

import {
  appError,
  err,
  internal,
  memberSchema,
  notFound,
  ok,
  orderListItemSchema,
  productSchema,
  SHIPX_OPERATION_DEADLINE_MS,
  SHIPX_OPERATION_LEASE_MS,
  SHIPX_RECONCILE_MAX_PAGES,
  SHIPX_REQUEST_TIMEOUT_MS,
  shipxRejected,
  shipxUnavailable,
  type Capability,
  type Identity,
  type OrderLine,
  type OrderListItem,
  type OrderShipping,
  type ParcelTemplate,
  type ShipxEnvironment,
  type ShipxSender,
  type TenantSecret,
  type TenantSecretKey,
} from '#core/domain/index.js';

import type { OrderFulfilmentRepository } from '../order-fulfilment-ports.js';
import type { TenantSecretRepository, TenantSecretResolver } from '../ports.js';
import type { ShipxShipmentRecord } from '../shipx-ports.js';
import { createTenantSecretRepositoryFake } from '../testing/tenant-secret-fake.js';
import { createInMemoryTenantDomainRepository } from '../testing/tenant-domain-fakes.js';
import {
  createScriptedShipxClient,
  createShipxSettingsRepositoryFake,
  createShipxShipmentRepositoryFake,
  remoteShipment,
  shipmentRecord,
} from '../testing/shipx-fakes.js';
import {
  configureShipx,
  createInpostShipment,
  discardInpostShipmentAttempt,
  getInpostShipment,
  getShipxSettings,
  inpostShipmentLabel,
  refreshInpostShipment,
  type CreateInpostShipmentDeps,
} from './shipx.js';

const identity = (tenantId = 'workspace'): Identity => ({
  userId: 'staff', email: 'staff@example.org', name: 'Staff', emailVerified: true,
  image: null, tenantAccess: 'staff', tenantId, tenantSlug: 'acme', tenantName: 'Acme Shop', staffRole: 'owner',
  memberId: null, memberDisplayName: null, memberBannedAt: null, memberDmOptOutAt: null, memberLanguage: null, memberVideoAutoplay: false,
});

const ctx = (capabilities: Capability[], tenantId = 'workspace') => ({ identity: identity(tenantId), capabilities });

const sender: ShipxSender = {
  name: 'Anna Sender', company: 'Example Workshop', email: 'shop@example.org', phone: '500 600 700',
  street: 'Factory Street', buildingNumber: '7', city: 'Warsaw', postCode: '00-001',
};

const lockerShipping: OrderShipping = {
  rateId: 'locker', label: 'Parcel locker', amountCents: 1499, vatRatePercent: 23, carrier: 'inpost',
  pickupPoint: { provider: 'inpost', code: 'WAW01M', name: null, address: null },
  address: { name: 'Jane Buyer', line1: 'Garden Street 5', line2: null, postalCode: '00-950', city: 'Warsaw', country: 'PL' },
  phone: '+48500000000',
};

const line = (productId: string, productType: OrderLine['productType']): OrderLine => ({
  productId, name: productId, productType, grossCents: 1000, netCents: 1000, vatRate: 23, vatCents: 0, vatExemptionBasis: null,
  issuedCount: productType === 'physical' ? 0 : null,
});

const baseOrder = orderListItemSchema.parse({
  id: 'order-1', tenantId: 'workspace', memberId: 'member-1', productId: 'stand', priceId: null, kind: 'one_time',
  status: 'paid', amountCents: 3499, currency: 'PLN', provider: 'stripe', providerObjectIds: {}, couponId: null,
  discountCents: 0, createdAt: '2026-11-04T09:00:00.000Z', paidAt: '2026-11-04T09:01:00.000Z',
  memberEmail: 'buyer@example.org', memberName: 'Jane Buyer', productTitle: 'Printed stand', couponCode: null,
  lines: [line('stand', 'physical'), line('lamp', 'physical'), line('shipping:locker', 'shipping')],
  shipping: lockerShipping, fulfilmentStatus: 'to_pack',
});

const testOrder: OrderListItem = { ...baseOrder, mode: 'test' };

const product = (id: string, parcelTemplate: ParcelTemplate) => productSchema.parse({
  id, tenantId: 'workspace', type: 'physical', slug: id, title: id, description: '', coverUrl: null, priceCents: 1000,
  currency: 'PLN', published: true, deliveryMethod: 'shipping', parcelTemplate, accessItems: [], legacyId: null,
  createdAt: '2026-11-01T00:00:00.000Z',
});

const credentials = {
  'shipx.production.organizationId': '1234',
  'shipx.production.token': 'shipx-token',
  'shipx.sandbox.organizationId': '5678',
  'shipx.sandbox.token': 'sandbox-token',
} as const;

const productionOnly = { 'shipx.production.organizationId': '1234', 'shipx.production.token': 'shipx-token' } as const;
const sandboxOnly = { 'shipx.sandbox.organizationId': '5678', 'shipx.sandbox.token': 'sandbox-token' } as const;

const secretRow = (key: TenantSecretKey): TenantSecret => ({
  id: key, tenantId: 'workspace', key, ciphertext: 'encrypted', iv: 'iv', authTag: 'tag', maskedPreview: '••••', updatedAt: '2026-11-01T00:00:00.000Z',
});

const NOW = '2026-11-08T10:00:00.000Z';

const harness = (options: {
  order?: OrderListItem | null;
  real?: ReturnType<typeof createScriptedShipxClient>;
  realAvailable?: boolean;
  secrets?: Partial<Record<TenantSecretKey, string>>;
  sender?: ShipxSender | null;
  legacyEnvironment?: ShipxEnvironment;
  ship?: OrderFulfilmentRepository['ship'];
} = {}) => {
  const order = options.order === undefined ? baseOrder : options.order;
  const real = options.real ?? createScriptedShipxClient();
  const fake = createScriptedShipxClient();
  const shipments = createShipxShipmentRepositoryFake();
  const settings = createShipxSettingsRepositoryFake({
    workspace: {
      sender: options.sender === undefined ? sender : options.sender,
      ...(options.legacyEnvironment === undefined ? {} : { legacyEnvironment: options.legacyEnvironment }),
    },
  });
  const ship = vi.fn<OrderFulfilmentRepository['ship']>(options.ship ?? (async (_tenantId, input) => ok({ ...baseOrder, fulfilmentStatus: 'shipped', shipment: input.shipment })));
  const findById = vi.fn(async (tenantId: string, id: string) => (tenantId === order?.tenantId && id === order.id ? order : null));
  const wait = vi.fn(async () => undefined);
  const values: Partial<Record<TenantSecretKey, string>> = options.secrets ?? credentials;
  const resolve = vi.fn<TenantSecretResolver['resolve']>(async (_tenantId, key) => {
    const value = values[key];
    return value === undefined ? err(notFound(`No "${key}" secret`)) : ok(value);
  });
  const findByKey = vi.fn<TenantSecretRepository['findByKey']>(async (_tenantId, key) => (values[key] === undefined ? null : secretRow(key)));
  let id = 0;
  const ids = { nextId: () => `id-${String(++id)}` };
  let now = NOW;
  const clock = { nowIso: () => now };
  const deps: CreateInpostShipmentDeps = {
    orderDetails: { findById },
    products: { findByIds: async (_tenantId, productIds) => [product('stand', 'small'), product('lamp', 'large')].filter((row) => productIds.includes(row.id)) },
    shipxShipments: shipments.repository,
    shipxSettings: settings.repository,
    tenantSecrets: { findByKey },
    secrets: { resolve },
    shipx: { real: options.realAvailable === false ? null : real.client, fake: fake.client },
    ids,
    clock,
    wait,
    ship: {
      tenantDomains: createInMemoryTenantDomainRepository(),
      appBaseUrl: 'https://app.together.test',
      baseDomain: 'together.test',
      singleTenantMode: false,
      orderDetails: { findById },
      fulfilment: { ship },
      members: {
        findById: async () => memberSchema.parse({
          id: 'member-1', tenantId: 'workspace', userId: 'user-1', email: 'buyer@example.org', displayName: 'Jane Buyer',
          language: 'en', tags: [], marketingConsents: {}, externalCustomerIds: {}, createdAt: '2026-07-01T00:00:00.000Z', deletedAt: null,
        }),
      },
      tenants: { findSettings: async () => null },
      ids,
      clock,
      dispatchEmail: vi.fn(),
    },
  };
  const row = () => shipments.rows.get(shipments.key('workspace', 'order-1'));
  const eventTypes = async () => (await shipments.repository.listEvents('workspace', 'order-1')).map((event) => event.type);
  const seed = (change: Partial<ShipxShipmentRecord>) => shipments.rows.set(shipments.key('workspace', 'order-1'), shipmentRecord({ environment: 'production', ...change }));
  const advance = (milliseconds: number) => {
    now = new Date(Date.parse(now) + milliseconds).toISOString();
  };
  return { deps, real, fake, shipments, settings, ship, wait, resolve, findByKey, row, eventTypes, seed, advance };
};

const write = ctx(['order:write', 'order:read']);
const TRACKING = '520000011395200025754311';
const noCalls = { create: [], get: [], find: [], buy: [], label: [], credentials: [] };

describe('create InPost shipment', () => {
  it('creates, polls until paid, stores the tracking number and ships through the fulfilment use-case', async () => {
    const h = harness({
      real: createScriptedShipxClient({
        polls: [
          (id) => ok(remoteShipment(id, { status: 'offer_selected' })),
          (id) => ok(remoteShipment(id, { status: 'confirmed', trackingNumber: TRACKING })),
        ],
      }),
    });
    const result = await createInpostShipment(write, { orderId: 'order-1' }, h.deps);
    expect(result).toMatchObject({
      ok: true,
      value: {
        order: { fulfilmentStatus: 'shipped', shipment: { carrier: 'inpost', trackingNumber: TRACKING } },
        shipment: { shipxShipmentId: '1001', status: 'confirmed', trackingNumber: TRACKING, environment: 'production', boughtAt: NOW },
      },
    });
    expect(result.ok && result.value.shipment).not.toHaveProperty('organizationId');
    expect(h.real.calls.create).toHaveLength(1);
    expect(h.real.calls.create[0]).toMatchObject({
      reference: 'order-1',
      service: 'inpost_locker_standard',
      parcelTemplate: 'large',
      targetPoint: 'WAW01M',
      receiver: { firstName: 'Jane', lastName: 'Buyer', email: 'buyer@example.org', phone: '500000000', address: null },
    });
    expect(h.real.calls.buy).toEqual([]);
    expect(h.wait).toHaveBeenCalledTimes(1);
    expect(h.ship).toHaveBeenCalledTimes(1);
    expect(h.ship.mock.calls[0]?.[1].shipment).toMatchObject({ carrier: 'inpost', trackingNumber: TRACKING, shippedBy: 'staff' });
    expect(h.ship.mock.calls[0]?.[1].email?.payload.shipment.trackingUrl).toContain(TRACKING);
    expect(h.row()).toMatchObject({ organizationId: '1234', environment: 'production', operationStartedAt: null });
  });

  it('reuses the stored ShipX shipment on retry instead of creating a second one', async () => {
    const h = harness({
      real: createScriptedShipxClient({ polls: [(id) => ok(remoteShipment(id, { status: 'created' }))] }),
    });
    expect(await createInpostShipment(write, { orderId: 'order-1' }, h.deps)).toMatchObject({
      ok: false,
      error: { code: 'shipx_unavailable', details: { state: 'pending', shipmentId: '1001', status: 'created' } },
    });
    expect(h.row()).toMatchObject({ shipxShipmentId: '1001', status: 'created', operationStartedAt: null });
    expect(h.ship).not.toHaveBeenCalled();
    expect(h.real.calls.get).toHaveLength(10);

    const retry = createScriptedShipxClient();
    h.deps.shipx.real = retry.client;
    expect(await createInpostShipment(write, { orderId: 'order-1' }, h.deps)).toMatchObject({ ok: true });
    expect(retry.calls.create).toEqual([]);
    expect(retry.calls.get).toEqual(['1001']);
    expect(h.ship).toHaveBeenCalledTimes(1);
  });

  it('pays an offer that the automatic purchase left unpaid, only on a retry', async () => {
    const h = harness();
    h.seed({ shipxShipmentId: '1001', status: 'offer_selected' });
    const retry = createScriptedShipxClient({
      polls: [
        (id) => ok(remoteShipment(id, {
          status: 'offer_selected',
          selectedOffer: { id: '77', status: 'selected', service: 'inpost_locker_standard' },
          transactions: [{ status: 'failure' }],
        })),
        (id) => ok(remoteShipment(id, { status: 'confirmed', trackingNumber: TRACKING })),
      ],
    });
    h.deps.shipx.real = retry.client;
    expect(await createInpostShipment(write, { orderId: 'order-1' }, h.deps)).toMatchObject({ ok: true });
    expect(retry.calls.buy).toEqual([{ shipmentId: '1001', offerId: '77' }]);
  });

  it('confirms the purchase of a stored tracking number that is not bought yet before shipping the order', async () => {
    const h = harness();
    h.seed({ shipxShipmentId: '1001', status: 'offer_selected', trackingNumber: TRACKING });
    const unpaid = createScriptedShipxClient({ polls: [(id) => ok(remoteShipment(id, { status: 'offer_selected', trackingNumber: TRACKING }))] });
    h.deps.shipx.real = unpaid.client;
    expect(await createInpostShipment(write, { orderId: 'order-1' }, h.deps)).toMatchObject({
      ok: false,
      error: { code: 'shipx_unavailable', details: { state: 'pending', shipmentId: '1001', status: 'offer_selected' } },
    });
    expect(unpaid.calls.get.length).toBeGreaterThan(0);
    expect(h.ship).not.toHaveBeenCalled();

    const paid = createScriptedShipxClient();
    h.deps.shipx.real = paid.client;
    expect(await createInpostShipment(write, { orderId: 'order-1' }, h.deps)).toMatchObject({ ok: true });
    expect(paid.calls.get).toEqual(['1001']);
    expect(h.ship).toHaveBeenCalledTimes(1);
  });

  it('ships a stored bought shipment without reading ShipX again', async () => {
    const h = harness();
    h.seed({ shipxShipmentId: '1001', status: 'confirmed', trackingNumber: TRACKING, boughtAt: NOW });
    expect(await createInpostShipment(write, { orderId: 'order-1' }, h.deps)).toMatchObject({ ok: true });
    expect(h.real.calls).toEqual(noCalls);
    expect(h.ship.mock.calls[0]?.[1].shipment.trackingNumber).toBe(TRACKING);
  });

  it('keeps the order to pack and surfaces the ShipX reason when buying is rejected', async () => {
    const real = createScriptedShipxClient({
      polls: [(id) => ok(remoteShipment(id, {
        status: 'offers_prepared',
        offers: [{ id: '55', status: 'available', service: 'inpost_locker_standard' }],
      }))],
      buy: () => err(shipxRejected({ status: 422, error: 'transaction_failed', description: null, fields: {} })),
    });
    const h = harness({ real });
    h.seed({ shipxShipmentId: '1001', status: 'offers_prepared' });
    const result = await createInpostShipment(write, { orderId: 'order-1' }, h.deps);
    expect(result).toMatchObject({
      ok: false,
      error: { code: 'shipx_rejected', message: 'InPost could not charge the shipment; check the funds or the payment method in Manager Paczek', details: { error: 'transaction_failed' } },
    });
    expect(real.calls.buy).toEqual([{ shipmentId: '1001', offerId: '55' }]);
    expect(h.ship).not.toHaveBeenCalled();
    expect(h.row()?.trackingNumber).toBeNull();
    expect(await h.shipments.repository.listEvents('workspace', 'order-1')).toEqual([
      expect.objectContaining({ type: 'attempt_claimed', actorUserId: 'staff' }),
      expect.objectContaining({
        type: 'payment_failed', shipxShipmentId: '1001', actorUserId: 'staff',
        details: { status: 'offers_prepared', reason: 'InPost could not charge the shipment; check the funds or the payment method in Manager Paczek' },
      }),
      expect.objectContaining({ type: 'operation_finished', shipxShipmentId: '1001', actorUserId: 'staff', operationToken: 'id-1', details: { outcome: 'failed' } }),
    ]);
  });

  it('never repeats a purchase whose answer was lost and continues from the re-read status', async () => {
    const real = createScriptedShipxClient({
      polls: [
        (id) => ok(remoteShipment(id, { status: 'offers_prepared', offers: [{ id: '55', status: 'available', service: 'inpost_locker_standard' }] })),
        (id) => ok(remoteShipment(id, { status: 'offers_prepared', offers: [{ id: '55', status: 'available', service: 'inpost_locker_standard' }] })),
        (id) => ok(remoteShipment(id, { status: 'confirmed', trackingNumber: TRACKING })),
      ],
      buy: () => err(shipxUnavailable('InPost ShipX did not answer in time; retry in a moment')),
    });
    const h = harness({ real });
    h.seed({ shipxShipmentId: '1001', status: 'offers_prepared' });
    expect(await createInpostShipment(write, { orderId: 'order-1' }, h.deps)).toMatchObject({ ok: true, value: { shipment: { trackingNumber: TRACKING } } });
    expect(real.calls.buy).toHaveLength(1);
    expect(real.calls.get).toHaveLength(3);
  });

  it('reports a failed automatic purchase at once instead of waiting for the poll bound', async () => {
    const real = createScriptedShipxClient({
      polls: [(id) => ok(remoteShipment(id, { status: 'offer_selected', transactions: [{ status: 'failure' }] }))],
    });
    const h = harness({ real });
    expect(await createInpostShipment(write, { orderId: 'order-1' }, h.deps)).toMatchObject({
      ok: false,
      error: { code: 'shipx_rejected', details: { error: 'transaction_failed' } },
    });
    expect(real.calls.get).toHaveLength(1);
    expect(real.calls.buy).toEqual([]);
    expect(h.row()).toMatchObject({ shipxShipmentId: '1001', trackingNumber: null });
    expect(await h.eventTypes()).toEqual(['attempt_claimed', 'attempt_marked', 'shipment_created', 'payment_failed', 'operation_finished']);
  });

  it('surfaces an unavailable offer with its ShipX reasons', async () => {
    const real = createScriptedShipxClient({
      polls: [(id) => ok(remoteShipment(id, {
        status: 'offers_prepared',
        offers: [{ id: '55', status: 'unavailable', service: 'inpost_locker_standard', unavailabilityReasons: ['Insufficient funds'] }],
      }))],
    });
    const h = harness({ real });
    expect(await createInpostShipment(write, { orderId: 'order-1' }, h.deps)).toMatchObject({
      ok: false,
      error: { code: 'shipx_rejected', message: 'The InPost offer can no longer be paid', details: { error: 'offer_unavailable', description: 'Insufficient funds' } },
    });
  });

  it('stops polling at the overall deadline, keeps the shipment and tells staff to refresh', async () => {
    const h = harness();
    const slow = createScriptedShipxClient({
      polls: [(id) => {
        h.advance(5000);
        return ok(remoteShipment(id, { status: 'offer_selected' }));
      }],
    });
    h.deps.shipx.real = slow.client;
    h.deps.wait = vi.fn(async (milliseconds: number) => {
      h.advance(milliseconds);
    });
    expect(await createInpostShipment(write, { orderId: 'order-1' }, h.deps)).toMatchObject({
      ok: false,
      error: { code: 'shipx_unavailable', message: 'InPost has not confirmed the payment yet; refresh the order in a moment', details: { state: 'pending' } },
    });
    expect(slow.calls.get).toHaveLength(3);
    expect(h.row()).toMatchObject({ shipxShipmentId: '1001', status: 'offer_selected', operationStartedAt: null });
    const events = await h.shipments.repository.listEvents('workspace', 'order-1');
    expect(events.map((event) => event.type)).toEqual(['attempt_claimed', 'attempt_marked', 'shipment_created', 'status_refreshed', 'operation_finished']);
    expect(events[3]?.details).toEqual({ from: 'created', to: 'offer_selected', trackingNumber: null });
    expect(events[4]?.details).toEqual({ outcome: 'pending' });
  });

  it('surfaces a payment that fails after it started and never buys twice in one request', async () => {
    const offer = { id: '55', status: 'available', service: 'inpost_locker_standard' };
    const real = createScriptedShipxClient({
      polls: [
        (id) => ok(remoteShipment(id, { status: 'offers_prepared', offers: [offer] })),
        (id) => ok(remoteShipment(id, { status: 'offer_selected', offers: [offer], transactions: [{ status: 'initiated' }] })),
        (id) => ok(remoteShipment(id, { status: 'offers_prepared', offers: [offer], transactions: [{ status: 'failure' }] })),
        (id) => ok(remoteShipment(id, { status: 'confirmed', trackingNumber: TRACKING })),
      ],
    });
    const h = harness({ real });
    h.seed({ shipxShipmentId: '1001', status: 'offers_prepared' });
    expect(await createInpostShipment(write, { orderId: 'order-1' }, h.deps)).toMatchObject({
      ok: false,
      error: {
        code: 'shipx_rejected',
        message: 'InPost could not charge the shipment; check the funds or the payment method in Manager Paczek',
        details: { error: 'transaction_failed', state: 'failed' },
      },
    });
    expect(real.calls.buy).toEqual([{ shipmentId: '1001', offerId: '55' }]);
    expect(real.calls.get).toHaveLength(3);
    expect(h.ship).not.toHaveBeenCalled();
    expect(h.row()).toMatchObject({ shipxShipmentId: '1001', status: 'offers_prepared', trackingNumber: null, operationToken: null });
  });

  it('checks the deadline before the purchase and buys nothing once it passed', async () => {
    const h = harness();
    h.seed({ shipxShipmentId: '1001', status: 'offers_prepared' });
    const slow = createScriptedShipxClient({
      polls: [(id) => {
        h.advance(SHIPX_OPERATION_DEADLINE_MS);
        return ok(remoteShipment(id, { status: 'offers_prepared', offers: [{ id: '55', status: 'available', service: 'inpost_locker_standard' }] }));
      }],
    });
    h.deps.shipx.real = slow.client;
    expect(await createInpostShipment(write, { orderId: 'order-1' }, h.deps)).toMatchObject({
      ok: false,
      error: { code: 'shipx_unavailable', details: { state: 'pending', shipmentId: '1001', status: 'offers_prepared' } },
    });
    expect(slow.calls.get).toEqual(['1001']);
    expect(slow.calls.buy).toEqual([]);
    expect(h.row()).toMatchObject({ shipxShipmentId: '1001', operationStartedAt: null });
  });

  it('re-checks the deadline after recording the attempt and creates nothing', async () => {
    const h = harness();
    h.deps.shipxShipments = {
      ...h.shipments.repository,
      update: async (tenantId, orderId, token, patch, step) => {
        const updated = await h.shipments.repository.update(tenantId, orderId, token, patch, step);
        h.advance(SHIPX_OPERATION_DEADLINE_MS);
        return updated;
      },
    };
    expect(await createInpostShipment(write, { orderId: 'order-1' }, h.deps)).toMatchObject({
      ok: false,
      error: { code: 'shipx_unavailable', details: { state: 'pending', shipmentId: null } },
    });
    expect(h.real.calls).toEqual(noCalls);
    expect(h.row()).toBeUndefined();
  });

  it('checks the deadline before creating and before reconciling', async () => {
    const h = harness();
    h.deps.products = {
      findByIds: async () => {
        h.advance(SHIPX_OPERATION_DEADLINE_MS);
        return [product('stand', 'small')];
      },
    };
    expect(await createInpostShipment(write, { orderId: 'order-1' }, h.deps)).toMatchObject({
      ok: false,
      error: { code: 'shipx_unavailable', details: { state: 'pending', shipmentId: null } },
    });
    expect(h.real.calls).toEqual(noCalls);
    expect(h.row()).toBeUndefined();
    expect(await h.eventTypes()).toEqual(['attempt_claimed', 'attempt_released']);

    const unconfirmed = harness();
    unconfirmed.seed({ status: 'unknown', createAttemptedAt: '2026-11-08T09:55:00.000Z' });
    unconfirmed.deps.clock = { nowIso: () => NOW };
    unconfirmed.deps.shipxShipments = {
      ...unconfirmed.shipments.repository,
      acquire: async (tenantId, input) => {
        const acquired = await unconfirmed.shipments.repository.acquire(tenantId, input);
        unconfirmed.deps.clock = { nowIso: () => new Date(Date.parse(NOW) + SHIPX_OPERATION_DEADLINE_MS).toISOString() };
        return acquired;
      },
    };
    expect(await createInpostShipment(write, { orderId: 'order-1' }, unconfirmed.deps)).toMatchObject({
      ok: false,
      error: { code: 'shipx_unavailable', details: { state: 'pending', status: 'unknown' } },
    });
    expect(unconfirmed.real.calls).toEqual(noCalls);
    expect(unconfirmed.row()).toMatchObject({ status: 'unknown', createAttemptedAt: '2026-11-08T09:55:00.000Z' });
  });

  it('holds the lease well past the deadline and the slowest last call', async () => {
    expect(SHIPX_OPERATION_LEASE_MS).toBe(90_000);
    expect(SHIPX_OPERATION_LEASE_MS).toBeGreaterThan(SHIPX_OPERATION_DEADLINE_MS + SHIPX_REQUEST_TIMEOUT_MS);
    expect(SHIPX_OPERATION_LEASE_MS).toBeGreaterThan(SHIPX_OPERATION_DEADLINE_MS + SHIPX_RECONCILE_MAX_PAGES * SHIPX_REQUEST_TIMEOUT_MS);
    const running = harness();
    const startedAt = new Date(Date.parse(NOW) - SHIPX_OPERATION_DEADLINE_MS - SHIPX_REQUEST_TIMEOUT_MS).toISOString();
    running.seed({ shipxShipmentId: '1001', status: 'offers_prepared', operationToken: 'other', operationStartedAt: startedAt });
    expect(await createInpostShipment(write, { orderId: 'order-1' }, running.deps)).toMatchObject({ ok: false, error: { code: 'fulfilment_conflict' } });
    expect(running.real.calls).toEqual(noCalls);
    const stuck = harness();
    const expired = new Date(Date.parse(NOW) - SHIPX_OPERATION_LEASE_MS - 1).toISOString();
    stuck.seed({ shipxShipmentId: '1001', status: 'offer_selected', operationToken: 'crashed', operationStartedAt: expired });
    expect(await createInpostShipment(write, { orderId: 'order-1' }, stuck.deps)).toMatchObject({ ok: true });
  });

  it('stops without touching ShipX again when another request took the claim over', async () => {
    const h = harness();
    h.seed({ shipxShipmentId: '1001', status: 'offers_prepared' });
    const real = createScriptedShipxClient({
      polls: [(id) => {
        const current = h.row();
        if (current !== undefined) h.shipments.rows.set(h.shipments.key('workspace', 'order-1'), { ...current, operationToken: 'other', operationStartedAt: NOW });
        return ok(remoteShipment(id, { status: 'offers_prepared', offers: [{ id: '55', status: 'available', service: 'inpost_locker_standard' }] }));
      }],
    });
    h.deps.shipx.real = real.client;
    expect(await createInpostShipment(write, { orderId: 'order-1' }, h.deps)).toMatchObject({
      ok: false,
      error: { code: 'fulfilment_conflict', details: { state: 'lost_lock' } },
    });
    expect(real.calls.get).toEqual(['1001']);
    expect(real.calls.buy).toEqual([]);
    expect(h.row()).toMatchObject({ status: 'offers_prepared', operationToken: 'other', operationStartedAt: NOW });
    expect(await h.eventTypes()).toEqual(['attempt_claimed']);
  });

  it('releases the row when ShipX definitely rejects the shipment so the next click starts over', async () => {
    const real = createScriptedShipxClient({
      create: () => err(shipxRejected({ status: 400, error: 'validation_failed', description: 'Invalid', fields: { 'receiver.phone': ['invalid'] } })),
    });
    const h = harness({ real });
    const finish = vi.spyOn(h.shipments.repository, 'finishOperation');
    expect(await createInpostShipment(write, { orderId: 'order-1' }, h.deps)).toMatchObject({
      ok: false,
      error: { code: 'shipx_rejected', details: { fields: { 'receiver.phone': ['invalid'] } } },
    });
    expect(h.shipments.rows.size).toBe(0);
    expect(h.ship).not.toHaveBeenCalled();
    expect(finish).toHaveBeenCalledWith('workspace', 'order-1', 'id-1', { actorUserId: 'staff', at: NOW, outcome: 'released' });
    await expect(finish.mock.results[0]?.value).resolves.toEqual({ kind: 'lost_lock' });
    expect(await h.eventTypes()).toEqual(['attempt_claimed', 'attempt_marked', 'attempt_released']);
  });

  it('keeps an unconfirmed attempt after a lost answer and never sends a second create', async () => {
    const real = createScriptedShipxClient({ create: () => err(shipxUnavailable('InPost ShipX did not answer in time; retry in a moment')) });
    const h = harness({ real });
    expect(await createInpostShipment(write, { orderId: 'order-1' }, h.deps)).toMatchObject({
      ok: false,
      error: { code: 'shipx_unavailable', details: { state: 'unconfirmed' } },
    });
    expect(h.row()).toMatchObject({ shipxShipmentId: null, status: 'unknown', createAttemptedAt: NOW, operationStartedAt: null });
    expect((await h.shipments.repository.listEvents('workspace', 'order-1')).at(-1)).toMatchObject({ type: 'operation_finished', details: { outcome: 'unconfirmed' } });

    h.advance(60_000);
    expect(await createInpostShipment(write, { orderId: 'order-1' }, h.deps)).toMatchObject({
      ok: false,
      error: { code: 'conflict', message: 'ShipX did not confirm the previous attempt; check Manager Paczek', details: { state: 'unconfirmed', attemptedAt: NOW } },
    });
    expect(real.calls.create).toHaveLength(1);
    expect(real.calls.find).toEqual(['order-1']);
    expect(h.row()).toMatchObject({ status: 'unknown', createAttemptedAt: NOW });
    expect(h.ship).not.toHaveBeenCalled();
  });

  it('adopts the shipment that ShipX lists under the order reference', async () => {
    const real = createScriptedShipxClient({
      find: () => ok(remoteShipment('2002', { status: 'confirmed', trackingNumber: TRACKING, reference: 'order-1' })),
    });
    const h = harness({ real });
    h.seed({ status: 'unknown', createAttemptedAt: '2026-11-08T09:55:00.000Z' });
    expect(await createInpostShipment(write, { orderId: 'order-1' }, h.deps)).toMatchObject({
      ok: true,
      value: { shipment: { shipxShipmentId: '2002', trackingNumber: TRACKING } },
    });
    expect(real.calls.create).toEqual([]);
    expect(real.calls.get).toEqual([]);
    expect(h.ship.mock.calls[0]?.[1].shipment.trackingNumber).toBe(TRACKING);
    expect(await h.eventTypes()).toEqual(['attempt_claimed', 'shipment_adopted', 'offer_bought', 'operation_finished']);
  });

  it('pays an adopted shipment that is still waiting for payment', async () => {
    const real = createScriptedShipxClient({
      find: () => ok(remoteShipment('2002', { status: 'offers_prepared', reference: 'order-1' })),
      polls: [
        (id) => ok(remoteShipment(id, { status: 'offers_prepared', offers: [{ id: '9', status: 'available', service: 'inpost_locker_standard' }] })),
        (id) => ok(remoteShipment(id, { status: 'confirmed', trackingNumber: TRACKING })),
      ],
    });
    const h = harness({ real });
    h.seed({ status: 'unknown', createAttemptedAt: '2026-11-08T09:55:00.000Z' });
    expect(await createInpostShipment(write, { orderId: 'order-1' }, h.deps)).toMatchObject({ ok: true });
    expect(real.calls.buy).toEqual([{ shipmentId: '2002', offerId: '9' }]);
  });

  it('refuses a concurrent click while another request holds the operation, without calling ShipX', async () => {
    const h = harness();
    h.seed({ shipxShipmentId: '1001', status: 'offers_prepared', operationStartedAt: '2026-11-08T09:59:50.000Z' });
    expect(await createInpostShipment(write, { orderId: 'order-1' }, h.deps)).toMatchObject({ ok: false, error: { code: 'fulfilment_conflict', details: { state: 'lease_held' } } });
    expect(h.real.calls).toEqual(noCalls);
    expect(h.row()?.operationStartedAt).toBe('2026-11-08T09:59:50.000Z');
  });

  it('takes over an operation whose lease expired', async () => {
    const h = harness();
    h.seed({ shipxShipmentId: '1001', status: 'offer_selected', operationStartedAt: '2026-11-08T09:58:00.000Z' });
    expect(await createInpostShipment(write, { orderId: 'order-1' }, h.deps)).toMatchObject({ ok: true });
    expect(h.real.calls.get).toEqual(['1001']);
  });

  it('stores the shipment and reports the tracking number when staff shipped the order manually meanwhile', async () => {
    const h = harness({ ship: async () => err(appError('fulfilment_conflict', 'Order has already been shipped')) });
    expect(await createInpostShipment(write, { orderId: 'order-1' }, h.deps)).toMatchObject({
      ok: false,
      error: {
        code: 'fulfilment_conflict',
        message: `The order was marked as shipped meanwhile; the InPost shipment ${TRACKING} exists as well, reconcile it in Manager Paczek`,
        details: { state: 'manual_shipped', trackingNumber: TRACKING, shipxShipmentId: '1001' },
      },
    });
    expect(h.row()).toMatchObject({ shipxShipmentId: '1001', trackingNumber: TRACKING, operationStartedAt: null });
    expect((await h.shipments.repository.listEvents('workspace', 'order-1')).at(-1)).toMatchObject({ type: 'operation_finished', details: { outcome: 'bought' } });
  });

  it('clears the claim and records a failed operation when a ShipX call throws', async () => {
    const real = createScriptedShipxClient({
      polls: [() => {
        throw new Error('socket closed');
      }],
    });
    const h = harness({ real });
    await expect(createInpostShipment(write, { orderId: 'order-1' }, h.deps)).rejects.toThrow('socket closed');
    expect(h.row()).toMatchObject({ shipxShipmentId: '1001', operationToken: null, operationStartedAt: null });
    expect((await h.shipments.repository.listEvents('workspace', 'order-1')).at(-1)).toMatchObject({
      type: 'operation_finished', shipxShipmentId: '1001', operationToken: 'id-1', details: { outcome: 'failed' },
    });
  });

  it('builds a courier shipment with the address for address deliveries', async () => {
    const h = harness({ order: { ...baseOrder, shipping: { ...lockerShipping, rateId: 'courier', pickupPoint: null } } });
    expect(await createInpostShipment(write, { orderId: 'order-1' }, h.deps)).toMatchObject({ ok: true });
    expect(h.real.calls.create[0]).toMatchObject({
      service: 'inpost_courier_standard',
      targetPoint: null,
      receiver: { address: { street: 'Garden Street', buildingNumber: '5', city: 'Warsaw', postCode: '00-950', countryCode: 'PL' } },
    });
  });

  it('requires the credentials of the order slot before calling ShipX and creates without a sender when none is saved', async () => {
    const missing = harness({ secrets: sandboxOnly });
    expect(await createInpostShipment(write, { orderId: 'order-1' }, missing.deps)).toEqual({
      ok: false,
      error: {
        code: 'integration_not_configured',
        message: 'Save the InPost ShipX production organization id and token in Settings → Shipping',
        details: { state: 'setup_missing', reason: 'credentials_missing', environment: 'production' },
      },
    });
    expect(missing.real.calls).toEqual(noCalls);
    expect(missing.fake.calls).toEqual(noCalls);
    expect(missing.shipments.rows.size).toBe(0);
    const noSender = harness({ sender: null });
    expect(await createInpostShipment(write, { orderId: 'order-1' }, noSender.deps)).toMatchObject({ ok: true });
    expect(noSender.real.calls.create).toHaveLength(1);
    expect(noSender.real.calls.create[0]?.sender).toBeNull();
    const withSender = harness();
    expect(await createInpostShipment(write, { orderId: 'order-1' }, withSender.deps)).toMatchObject({ ok: true });
    expect(withSender.real.calls.create[0]?.sender).toEqual(sender);
  });

  it('refuses other carriers, shipped orders and orders of another workspace', async () => {
    const other = harness({ order: { ...baseOrder, shipping: { ...lockerShipping, carrier: 'other', pickupPoint: null } } });
    expect(await createInpostShipment(write, { orderId: 'order-1' }, other.deps)).toMatchObject({ ok: false, error: { code: 'validation' } });
    const shipped = harness({ order: { ...baseOrder, fulfilmentStatus: 'shipped' } });
    expect(await createInpostShipment(write, { orderId: 'order-1' }, shipped.deps)).toMatchObject({ ok: false, error: { code: 'fulfilment_conflict' } });
    const foreign = harness();
    expect(await createInpostShipment(ctx(['order:write'], 'other-workspace'), { orderId: 'order-1' }, foreign.deps)).toMatchObject({ ok: false, error: { code: 'not_found' } });
    expect(foreign.real.calls.create).toEqual([]);
  });

  it('requires order:write', async () => {
    const h = harness();
    expect(await createInpostShipment(ctx(['order:read']), { orderId: 'order-1' }, h.deps)).toMatchObject({ ok: false, error: { code: 'forbidden' } });
    expect(h.real.calls.create).toEqual([]);
  });
});

describe('ShipX slot selection', () => {
  const slotOf = { live: 'production', test: 'sandbox' } as const;
  const slotCredentials = {
    production: { environment: 'production', organizationId: '1234', token: 'shipx-token' },
    sandbox: { environment: 'sandbox', organizationId: '5678', token: 'sandbox-token' },
  } as const;
  const orderOf = { live: baseOrder, test: testOrder } as const;

  it.each(['live', 'test'] as const)('resolves only the %s slot for every ShipX operation of the order', async (mode) => {
    const slot = slotOf[mode];
    const other = slot === 'production' ? 'sandbox' : 'production';
    const h = harness({
      order: orderOf[mode],
      real: createScriptedShipxClient({ polls: [(id) => ok(remoteShipment(id, { status: 'offer_selected' }))] }),
    });
    expect(await getInpostShipment(ctx(['order:read']), { orderId: 'order-1' }, h.deps)).toMatchObject({ ok: true, value: { available: true, environment: slot } });
    expect(await createInpostShipment(write, { orderId: 'order-1' }, h.deps)).toMatchObject({ ok: false, error: { code: 'shipx_unavailable', details: { state: 'pending' } } });
    expect(h.row()).toMatchObject({ environment: slot, organizationId: slotCredentials[slot].organizationId });
    expect(await refreshInpostShipment(write, { orderId: 'order-1' }, h.deps)).toMatchObject({ ok: true, value: { environment: slot, shipment: { environment: slot } } });
    expect(await inpostShipmentLabel(write, { orderId: 'order-1' }, h.deps)).toMatchObject({ ok: true });
    h.seed({ environment: slot, organizationId: slotCredentials[slot].organizationId, status: 'unknown', createAttemptedAt: '2026-11-08T09:55:00.000Z' });
    expect(await createInpostShipment(write, { orderId: 'order-1' }, h.deps)).toMatchObject({ ok: false, error: { code: 'conflict', details: { state: 'unconfirmed' } } });
    expect(await discardInpostShipmentAttempt(write, { orderId: 'order-1' }, h.deps)).toEqual({ ok: true, value: { discarded: true } });

    expect(h.real.calls.create).toHaveLength(1);
    expect(h.real.calls.label).toHaveLength(1);
    expect(h.real.calls.find).toHaveLength(1);
    expect(h.real.calls.credentials.length).toBeGreaterThan(3);
    expect(new Set(h.real.calls.credentials.map((used) => JSON.stringify(used)))).toEqual(new Set([JSON.stringify(slotCredentials[slot])]));
    expect(h.fake.calls).toEqual(noCalls);
    const resolved = h.resolve.mock.calls.map(([, key]) => key);
    expect(resolved.length).toBeGreaterThan(0);
    expect(resolved.every((key) => key.startsWith(`shipx.${slot}.`))).toBe(true);
    expect(resolved.some((key) => key.startsWith(`shipx.${other}.`) || key === 'shipx.organizationId' || key === 'shipx.token')).toBe(false);
  });

  it('ships a test-mode order through the real client against the sandbox slot and sends no e-mail', async () => {
    const h = harness({ order: testOrder });
    expect(await createInpostShipment(write, { orderId: 'order-1' }, h.deps)).toMatchObject({ ok: true, value: { shipment: { environment: 'sandbox' } } });
    expect(h.real.calls.credentials[0]).toEqual(slotCredentials.sandbox);
    expect(h.fake.calls).toEqual(noCalls);
    expect(h.row()).toMatchObject({ environment: 'sandbox', organizationId: '5678' });
    expect(h.ship.mock.calls[0]?.[1].email).toBeNull();
  });

  it('ships a live order through the real client against the production slot', async () => {
    const h = harness();
    expect(await createInpostShipment(write, { orderId: 'order-1' }, h.deps)).toMatchObject({ ok: true, value: { shipment: { environment: 'production' } } });
    expect(h.real.calls.credentials[0]).toEqual(slotCredentials.production);
    expect(h.fake.calls).toEqual(noCalls);
  });

  it.each([
    ['test', productionOnly, 'sandbox'],
    ['live', sandboxOnly, 'production'],
  ] as const)('refuses a %s order whose slot is missing and leaves the other mode working', async (mode, secrets, missingSlot) => {
    const h = harness({ order: orderOf[mode], secrets });
    expect(await getInpostShipment(ctx(['order:read']), { orderId: 'order-1' }, h.deps)).toMatchObject({
      ok: true, value: { available: false, reason: 'credentials_missing', environment: missingSlot },
    });
    expect(await createInpostShipment(write, { orderId: 'order-1' }, h.deps)).toMatchObject({
      ok: false,
      error: {
        code: 'integration_not_configured',
        message: `Save the InPost ShipX ${missingSlot} organization id and token in Settings → Shipping`,
        details: { state: 'setup_missing', reason: 'credentials_missing', environment: missingSlot },
      },
    });
    expect(h.real.calls).toEqual(noCalls);
    expect(h.fake.calls).toEqual(noCalls);
    expect(h.shipments.rows.size).toBe(0);

    const otherMode = mode === 'test' ? 'live' : 'test';
    const other = harness({ order: orderOf[otherMode], secrets });
    expect(await getInpostShipment(ctx(['order:read']), { orderId: 'order-1' }, other.deps)).toMatchObject({ ok: true, value: { available: true, reason: null } });
    expect(await createInpostShipment(write, { orderId: 'order-1' }, other.deps)).toMatchObject({ ok: true });
    expect(other.real.calls.credentials[0]).toEqual(slotCredentials[slotOf[otherMode]]);
  });

  it('never falls back to the fake client for a test-mode order in a deployment with the real client', async () => {
    const h = harness({ order: testOrder, secrets: productionOnly });
    expect(await createInpostShipment(write, { orderId: 'order-1' }, h.deps)).toMatchObject({ ok: false, error: { code: 'integration_not_configured' } });
    expect(h.fake.calls).toEqual(noCalls);
    expect(h.real.calls).toEqual(noCalls);
  });

  it.each(['live', 'test'] as const)('uses the fake client for a %s order in a deployment without the real client, with the slot credentials', async (mode) => {
    const h = harness({ order: orderOf[mode], realAvailable: false });
    expect(await createInpostShipment(write, { orderId: 'order-1' }, h.deps)).toMatchObject({ ok: true, value: { shipment: { environment: slotOf[mode] } } });
    expect(h.fake.calls.create).toHaveLength(1);
    expect(h.fake.calls.credentials[0]).toEqual(slotCredentials[slotOf[mode]]);
    expect(h.real.calls).toEqual(noCalls);
    const unconfigured = harness({ order: orderOf[mode], realAvailable: false, secrets: {} });
    expect(await createInpostShipment(write, { orderId: 'order-1' }, unconfigured.deps)).toMatchObject({
      ok: false, error: { code: 'integration_not_configured', details: { environment: slotOf[mode] } },
    });
    expect(unconfigured.fake.calls).toEqual(noCalls);
  });

  it('reports a shipment created in another environment or organization instead of redirecting it', async () => {
    const h = harness();
    h.seed({ shipxShipmentId: '1001', status: 'offer_selected', environment: 'sandbox' });
    expect(await createInpostShipment(write, { orderId: 'order-1' }, h.deps)).toMatchObject({
      ok: false,
      error: { code: 'conflict', message: expect.stringContaining('ShipX sandbox environment'), details: { state: 'environment_mismatch', environment: 'sandbox', settingsEnvironment: 'production' } },
    });
    expect(await inpostShipmentLabel(write, { orderId: 'order-1' }, h.deps)).toMatchObject({ ok: false, error: { code: 'conflict' } });
    h.seed({ shipxShipmentId: '1001', status: 'offer_selected', organizationId: '9999' });
    expect(await createInpostShipment(write, { orderId: 'order-1' }, h.deps)).toMatchObject({
      ok: false,
      error: { code: 'conflict', message: expect.stringContaining('different ShipX organization'), details: { state: 'organization_mismatch' } },
    });
    expect(h.real.calls).toEqual(noCalls);
    expect(h.row()?.operationStartedAt).toBeNull();
  });

  it('keeps a test-mode shipment that the fake client created under production behind the environment conflict and shows its stored status', async () => {
    const h = harness({ order: testOrder });
    h.seed({ shipxShipmentId: '9000000001', status: 'offer_selected', environment: 'production', organizationId: '1234' });
    expect(await getInpostShipment(ctx(['order:read']), { orderId: 'order-1' }, h.deps)).toMatchObject({
      ok: true, value: { environment: 'sandbox', shipment: { shipxShipmentId: '9000000001', status: 'offer_selected', environment: 'production' } },
    });
    expect(await refreshInpostShipment(write, { orderId: 'order-1' }, h.deps)).toMatchObject({
      ok: true, value: { shipment: { status: 'offer_selected', environment: 'production' } },
    });
    expect(await createInpostShipment(write, { orderId: 'order-1' }, h.deps)).toMatchObject({
      ok: false,
      error: { code: 'conflict', details: { state: 'environment_mismatch', environment: 'production', settingsEnvironment: 'sandbox' } },
    });
    expect(await inpostShipmentLabel(write, { orderId: 'order-1' }, h.deps)).toMatchObject({
      ok: false, error: { code: 'conflict', details: { state: 'environment_mismatch' } },
    });
    expect(h.real.calls).toEqual(noCalls);
    expect(h.fake.calls).toEqual(noCalls);
    expect(h.row()).toMatchObject({ status: 'offer_selected', environment: 'production', operationStartedAt: null });
  });

  it('answers the organization conflict when the slot now holds another organization than the stored shipment', async () => {
    const h = harness({ order: testOrder });
    h.seed({ shipxShipmentId: '1001', status: 'offer_selected', environment: 'sandbox', organizationId: '1234' });
    expect(await createInpostShipment(write, { orderId: 'order-1' }, h.deps)).toMatchObject({
      ok: false, error: { code: 'conflict', details: { state: 'organization_mismatch' } },
    });
    expect(await inpostShipmentLabel(write, { orderId: 'order-1' }, h.deps)).toMatchObject({ ok: false, error: { code: 'conflict', details: { state: 'organization_mismatch' } } });
    expect(h.real.calls).toEqual(noCalls);
  });
});

describe('stored single ShipX connection', () => {
  const legacy = { 'shipx.organizationId': '4321', 'shipx.token': 'legacy-token' } as const;
  const orderOf = { production: baseOrder, sandbox: testOrder } as const;
  const isLegacy = (key: TenantSecretKey) => key === 'shipx.organizationId' || key === 'shipx.token';
  const readKeys = (h: ReturnType<typeof harness>) => [
    ...h.findByKey.mock.calls.map(([, key]) => key),
    ...h.resolve.mock.calls.map(([, key]) => key),
  ];

  it.each(['production', 'sandbox'] as const)('serves the %s slot named by the stored environment and never the other slot', async (stored) => {
    const other = stored === 'production' ? 'sandbox' : 'production';
    const named = harness({ order: orderOf[stored], secrets: legacy, legacyEnvironment: stored });
    expect(await getInpostShipment(ctx(['order:read']), { orderId: 'order-1' }, named.deps)).toMatchObject({
      ok: true, value: { available: true, reason: null, environment: stored },
    });
    expect(await createInpostShipment(write, { orderId: 'order-1' }, named.deps)).toMatchObject({ ok: true, value: { shipment: { environment: stored } } });
    expect(named.real.calls.credentials.length).toBeGreaterThan(0);
    expect(named.real.calls.credentials.every((used) => used.organizationId === '4321' && used.token === 'legacy-token' && used.environment === stored)).toBe(true);
    expect(named.row()).toMatchObject({ environment: stored, organizationId: '4321' });
    expect(new Set(named.resolve.mock.calls.map(([, key]) => key)))
      .toEqual(new Set([`shipx.${stored}.organizationId`, `shipx.${stored}.token`, 'shipx.organizationId', 'shipx.token']));

    const unnamed = harness({ order: orderOf[other], secrets: legacy, legacyEnvironment: stored });
    expect(await getInpostShipment(ctx(['order:read']), { orderId: 'order-1' }, unnamed.deps)).toMatchObject({
      ok: true, value: { available: false, reason: 'credentials_missing', environment: other },
    });
    expect(await createInpostShipment(write, { orderId: 'order-1' }, unnamed.deps)).toMatchObject({
      ok: false, error: { code: 'integration_not_configured', details: { state: 'setup_missing', reason: 'credentials_missing', environment: other } },
    });
    expect(readKeys(unnamed).length).toBeGreaterThan(0);
    expect(readKeys(unnamed).every((key) => key.startsWith(`shipx.${other}.`))).toBe(true);
    expect(unnamed.real.calls).toEqual(noCalls);
    expect(unnamed.fake.calls).toEqual(noCalls);
  });

  it('ignores the stored connection without a stored environment', async () => {
    const h = harness({ secrets: legacy });
    expect(await createInpostShipment(write, { orderId: 'order-1' }, h.deps)).toMatchObject({
      ok: false, error: { code: 'integration_not_configured', details: { environment: 'production' } },
    });
    expect(readKeys(h).some(isLegacy)).toBe(false);
    expect(h.real.calls).toEqual(noCalls);
  });

  it('takes each field from the slot row first and from the stored connection only for a missing row', async () => {
    const h = harness({ secrets: { ...legacy, 'shipx.production.token': 'new-token' }, legacyEnvironment: 'production' });
    expect(await getInpostShipment(ctx(['order:read']), { orderId: 'order-1' }, h.deps)).toMatchObject({ ok: true, value: { available: true } });
    expect(await createInpostShipment(write, { orderId: 'order-1' }, h.deps)).toMatchObject({ ok: true });
    expect(h.real.calls.credentials[0]).toEqual({ organizationId: '4321', token: 'new-token', environment: 'production' });
    expect(readKeys(h)).not.toContain('shipx.token');
  });

  it('never falls back to the stored connection for a slot row that cannot be decrypted', async () => {
    const h = harness({ secrets: { ...legacy, 'shipx.production.organizationId': '1234', 'shipx.production.token': 'damaged' }, legacyEnvironment: 'production' });
    h.resolve.mockImplementation(async (_tenantId, key) => {
      if (key === 'shipx.production.token') return err(internal('Stored secret failed integrity verification'));
      return key === 'shipx.production.organizationId' ? ok('1234') : ok('legacy-token');
    });
    expect(await createInpostShipment(write, { orderId: 'order-1' }, h.deps)).toMatchObject({
      ok: false, error: { code: 'integration_not_configured', details: { environment: 'production' } },
    });
    expect(h.resolve.mock.calls.map(([, key]) => key).some(isLegacy)).toBe(false);
    expect(h.real.calls).toEqual(noCalls);
  });

  it('resolves neither the slot nor the stored connection after the slot was cleared', async () => {
    const h = harness({ legacyEnvironment: 'production' });
    const rows = createTenantSecretRepositoryFake([
      { ...secretRow('shipx.organizationId'), ciphertext: 'enc:4321' },
      { ...secretRow('shipx.token'), ciphertext: 'enc:legacy-token' },
    ]);
    const crypto = {
      encrypt: (plaintext: string) => ({ ciphertext: `enc:${plaintext}`, iv: 'iv', authTag: 'tag' }),
      decrypt: (input: { ciphertext: string }) => ok(input.ciphertext.slice(4)),
    };
    h.deps.tenantSecrets = rows.repository;
    h.deps.secrets = {
      resolve: async (tenantId, key) => {
        const row = await rows.repository.findByKey(tenantId, key);
        return row === null ? err(notFound(`No "${key}" secret`)) : crypto.decrypt(row);
      },
    };
    expect(await getInpostShipment(ctx(['order:read']), { orderId: 'order-1' }, h.deps)).toMatchObject({ ok: true, value: { available: true } });
    const settingsDeps = { shipxSettings: h.deps.shipxSettings, tenantSecrets: rows.repository, secretCrypto: crypto, ids: h.deps.ids, clock: h.deps.clock };
    expect(await configureShipx(ctx(['tenant:secret:write']), { production: { clearCredentials: true } }, settingsDeps)).toMatchObject({
      ok: true, value: { production: { organizationId: null, token: null, configured: false } },
    });
    expect(rows.rows).toEqual([]);
    expect(await getInpostShipment(ctx(['order:read']), { orderId: 'order-1' }, h.deps)).toMatchObject({
      ok: true, value: { available: false, reason: 'credentials_missing' },
    });
    expect(await createInpostShipment(write, { orderId: 'order-1' }, h.deps)).toMatchObject({ ok: false, error: { code: 'integration_not_configured' } });
    expect(h.real.calls).toEqual(noCalls);
  });
});

describe('discard an unconfirmed InPost attempt', () => {
  it('removes the unconfirmed attempt so the next click creates the shipment', async () => {
    const h = harness();
    h.seed({ status: 'unknown', createAttemptedAt: '2026-11-08T09:55:00.000Z' });
    expect(await discardInpostShipmentAttempt(write, { orderId: 'order-1' }, h.deps)).toEqual({ ok: true, value: { discarded: true } });
    expect(h.row()).toBeUndefined();
    expect(await h.shipments.repository.listEvents('workspace', 'order-1')).toEqual([{
      orderId: 'order-1', shipxShipmentId: null, type: 'attempt_discarded', actorUserId: 'staff', operationToken: null,
      details: { status: 'unknown', createAttemptedAt: '2026-11-08T09:55:00.000Z' }, createdAt: NOW,
    }]);
    expect(await createInpostShipment(write, { orderId: 'order-1' }, h.deps)).toMatchObject({ ok: true });
    expect(h.real.calls.create).toHaveLength(1);
  });

  it('resets a claim left before any ShipX call so a changed environment or organization cannot block the order', async () => {
    const h = harness();
    const expired = new Date(Date.parse(NOW) - SHIPX_OPERATION_LEASE_MS - 1).toISOString();
    h.seed({ status: 'creating', environment: 'sandbox', operationToken: 'crashed', operationStartedAt: expired });
    expect(await createInpostShipment(write, { orderId: 'order-1' }, h.deps)).toMatchObject({ ok: false, error: { code: 'conflict', details: { state: 'environment_mismatch' } } });
    expect(await discardInpostShipmentAttempt(write, { orderId: 'order-1' }, h.deps)).toEqual({ ok: true, value: { discarded: true } });
    expect(h.row()).toBeUndefined();
    expect((await h.shipments.repository.listEvents('workspace', 'order-1')).at(-1)).toMatchObject({
      type: 'attempt_discarded', details: { status: 'creating', createAttemptedAt: null },
    });
    expect(await createInpostShipment(write, { orderId: 'order-1' }, h.deps)).toMatchObject({ ok: true, value: { shipment: { environment: 'production' } } });
    expect(h.real.calls.create).toHaveLength(1);

    const running = harness();
    running.seed({ status: 'creating', operationToken: 'other', operationStartedAt: '2026-11-08T09:59:55.000Z' });
    expect(await discardInpostShipmentAttempt(write, { orderId: 'order-1' }, running.deps)).toMatchObject({ ok: false, error: { code: 'fulfilment_conflict', details: { state: 'lease_held' } } });
    expect(running.row()).toBeDefined();
  });

  it('refuses rows without an unconfirmed attempt, running operations and staff without order:write', async () => {
    const h = harness();
    expect(await discardInpostShipmentAttempt(write, { orderId: 'order-1' }, h.deps)).toMatchObject({ ok: false, error: { code: 'validation' } });
    h.seed({ shipxShipmentId: '1001', status: 'confirmed' });
    expect(await discardInpostShipmentAttempt(write, { orderId: 'order-1' }, h.deps)).toMatchObject({ ok: false, error: { code: 'validation' } });
    h.seed({ status: 'unknown', createAttemptedAt: '2026-11-08T09:55:00.000Z', operationStartedAt: '2026-11-08T09:59:55.000Z' });
    expect(await discardInpostShipmentAttempt(write, { orderId: 'order-1' }, h.deps)).toMatchObject({ ok: false, error: { code: 'fulfilment_conflict', details: { state: 'lease_held' } } });
    expect(await discardInpostShipmentAttempt(ctx(['order:read']), { orderId: 'order-1' }, h.deps)).toMatchObject({ ok: false, error: { code: 'forbidden' } });
    expect(await discardInpostShipmentAttempt(ctx(['order:write'], 'other-workspace'), { orderId: 'order-1' }, h.deps)).toMatchObject({ ok: false, error: { code: 'not_found' } });
    expect(h.row()).toBeDefined();
  });
});

describe('InPost shipment view and label', () => {
  it('reports readiness with the largest parcel template without decrypting the credentials', async () => {
    const h = harness();
    expect(await getInpostShipment(ctx(['order:read']), { orderId: 'order-1' }, h.deps)).toEqual({
      ok: true,
      value: { available: true, reason: null, environment: 'production', service: 'inpost_locker_standard', parcelTemplate: 'large', shipment: null },
    });
    expect(h.resolve).not.toHaveBeenCalled();
    const missing = harness({ secrets: { ...sandboxOnly, 'shipx.production.token': 'only-token' } });
    expect(await getInpostShipment(ctx(['order:read']), { orderId: 'order-1' }, missing.deps)).toMatchObject({ ok: true, value: { available: false, reason: 'credentials_missing', environment: 'production' } });
    const noSender = harness({ sender: null });
    expect(await getInpostShipment(ctx(['order:read']), { orderId: 'order-1' }, noSender.deps)).toMatchObject({ ok: true, value: { available: true, reason: null } });
    const sandboxTest = harness({ order: testOrder, secrets: sandboxOnly });
    expect(await getInpostShipment(ctx(['order:read']), { orderId: 'order-1' }, sandboxTest.deps)).toMatchObject({ ok: true, value: { available: true, environment: 'sandbox' } });
  });

  const ebook = productSchema.parse({ ...product('ebook', 'small'), type: 'digital_download', deliveryMethod: 'pickup', parcelTemplate: undefined });
  const course = productSchema.parse({ ...product('course', 'large'), type: 'course', deliveryMethod: 'pickup' });

  const sizedParcel = async (lines: OrderLine[] | undefined, catalog: ReturnType<typeof product>[]) => {
    const h = harness({ order: orderListItemSchema.parse({ ...baseOrder, lines }) });
    h.deps.products = { findByIds: async (_tenantId, productIds) => catalog.filter((row) => productIds.includes(row.id)) };
    const view = await getInpostShipment(ctx(['order:read']), { orderId: 'order-1' }, h.deps);
    const created = await createInpostShipment(write, { orderId: 'order-1' }, h.deps);
    return {
      view: view.ok ? view.value.parcelTemplate : view.error.code,
      created: created.ok ? h.real.calls.create[0]?.parcelTemplate : created.error.code,
    };
  };

  it('sizes the parcel from the physical lines of the order, whatever delivery the catalog now shows for their products', async () => {
    const bundle = [line('stand', 'physical'), line('ebook', 'digital_download'), line('shipping:locker', 'shipping')];
    expect(await sizedParcel(bundle, [product('stand', 'small'), ebook])).toEqual({ view: 'small', created: 'small' });
    expect(await sizedParcel(bundle, [productSchema.parse({ ...product('stand', 'small'), deliveryMethod: 'pickup' }), ebook])).toEqual({ view: 'small', created: 'small' });
  });

  it('buys the label for a physical line whose product was switched to pickup after the purchase', async () => {
    const lines = [line('lamp', 'physical'), line('stand', 'physical'), line('shipping:locker', 'shipping')];
    const lamp = productSchema.parse({ ...product('lamp', 'large'), deliveryMethod: 'pickup' });
    expect(await sizedParcel(lines, [lamp, product('stand', 'small')])).toEqual({ view: 'large', created: 'large' });
  });

  it('sizes the parcel from every product of an order without a physical line', async () => {
    expect(await sizedParcel(undefined, [product('stand', 'small')])).toEqual({ view: 'small', created: 'small' });
    const lines = [line('ebook', 'digital_download'), line('course', 'course'), line('shipping:locker', 'shipping')];
    expect(await sizedParcel(lines, [ebook, course])).toEqual({ view: 'large', created: 'large' });
  });

  it('buys the parcel template staff chose instead of the largest product template', async () => {
    const lines = [line('stand', 'physical'), line('shipping:locker', 'shipping')];
    const larger = harness({ order: orderListItemSchema.parse({ ...baseOrder, lines }) });
    expect(await createInpostShipment(write, { orderId: 'order-1', parcelTemplate: 'large' }, larger.deps)).toMatchObject({ ok: true });
    expect(larger.real.calls.create.map((request) => request.parcelTemplate)).toEqual(['large']);
    const smaller = harness();
    expect(await createInpostShipment(write, { orderId: 'order-1', parcelTemplate: 'small' }, smaller.deps)).toMatchObject({ ok: true });
    expect(smaller.real.calls.create.map((request) => request.parcelTemplate)).toEqual(['small']);
  });

  it('keeps the largest product template, medium for products without one, when staff choose no template', async () => {
    expect(await sizedParcel(undefined, [productSchema.parse({ ...product('stand', 'small'), parcelTemplate: undefined })])).toEqual({ view: 'medium', created: 'medium' });
    const h = harness();
    expect(await createInpostShipment(write, { orderId: 'order-1' }, h.deps)).toMatchObject({ ok: true });
    expect(h.real.calls.create.map((request) => request.parcelTemplate)).toEqual(['large']);
  });

  it('rejects an unknown parcel template before claiming the order or calling ShipX', async () => {
    const h = harness();
    expect(await createInpostShipment(write, { orderId: 'order-1', parcelTemplate: 'huge' }, h.deps)).toMatchObject({ ok: false, error: { code: 'validation' } });
    expect(await createInpostShipment(write, { orderId: 'order-1', parcelTemplate: 'large', extra: true }, h.deps)).toMatchObject({ ok: false, error: { code: 'validation' } });
    expect(h.real.calls).toEqual(noCalls);
    expect(h.row()).toBeUndefined();
  });

  it('returns the stored view of a shipment waiting for payment without calling ShipX or writing', async () => {
    const h = harness();
    h.seed({ shipxShipmentId: '1001', status: 'offer_selected' });
    const repository = h.shipments.repository;
    const writes = [
      vi.spyOn(repository, 'acquire'), vi.spyOn(repository, 'update'), vi.spyOn(repository, 'finishOperation'), vi.spyOn(repository, 'release'),
      vi.spyOn(repository, 'refreshUnclaimed'), vi.spyOn(repository, 'markLabelFetched'), vi.spyOn(repository, 'discardUnconfirmed'),
    ];
    expect(await getInpostShipment(ctx(['order:read']), { orderId: 'order-1' }, h.deps)).toMatchObject({
      ok: true,
      value: { available: true, reason: null, shipment: { shipxShipmentId: '1001', status: 'offer_selected', trackingNumber: null } },
    });
    expect(h.real.calls).toEqual(noCalls);
    expect(h.fake.calls).toEqual(noCalls);
    expect(h.resolve).not.toHaveBeenCalled();
    for (const write of writes) expect(write).not.toHaveBeenCalled();
    expect(await h.eventTypes()).toEqual([]);
  });

  it('refreshes a shipment waiting for payment with its live ShipX status', async () => {
    const h = harness();
    h.seed({ shipxShipmentId: '1001', status: 'offer_selected' });
    expect(await refreshInpostShipment(write, { orderId: 'order-1' }, h.deps)).toMatchObject({
      ok: true,
      value: { shipment: { shipxShipmentId: '1001', status: 'confirmed', trackingNumber: TRACKING } },
    });
    expect(h.real.calls.get).toEqual(['1001']);
    expect(h.row()).toMatchObject({ status: 'confirmed', trackingNumber: TRACKING });
    expect(await refreshInpostShipment(write, { orderId: 'order-1' }, h.deps)).toMatchObject({ ok: true });
    expect(h.real.calls.get).toEqual(['1001']);
    expect(await h.eventTypes()).toEqual(['status_refreshed', 'offer_bought']);
  });

  it('records a changed live status once and writes nothing while ShipX reports the same status', async () => {
    const h = harness({
      real: createScriptedShipxClient({
        polls: [
          (id) => ok(remoteShipment(id, { status: 'offers_prepared' })),
          (id) => ok(remoteShipment(id, { status: 'offer_selected' })),
        ],
      }),
    });
    h.seed({ shipxShipmentId: '1001', status: 'offers_prepared' });
    h.advance(60_000);
    await refreshInpostShipment(write, { orderId: 'order-1' }, h.deps);
    expect(h.row()).toMatchObject({ status: 'offers_prepared', updatedAt: '2026-11-08T09:00:00.000Z' });
    expect(await h.eventTypes()).toEqual([]);
    await refreshInpostShipment(write, { orderId: 'order-1' }, h.deps);
    expect(h.row()).toMatchObject({ status: 'offer_selected' });
    expect(await h.shipments.repository.listEvents('workspace', 'order-1')).toEqual([{
      orderId: 'order-1', shipxShipmentId: '1001', type: 'status_refreshed', actorUserId: 'staff', operationToken: null,
      details: { from: 'offers_prepared', to: 'offer_selected', trackingNumber: null }, createdAt: '2026-11-08T10:01:00.000Z',
    }]);
  });

  it('drops a slow live read when another request confirmed the shipment meanwhile', async () => {
    const h = harness();
    h.seed({ shipxShipmentId: '1001', status: 'offer_selected' });
    const slow = createScriptedShipxClient({
      polls: [(id) => {
        const current = h.row();
        if (current !== undefined) {
          h.shipments.rows.set(h.shipments.key('workspace', 'order-1'), {
            ...current, status: 'confirmed', trackingNumber: TRACKING, boughtAt: NOW, updatedAt: NOW,
          });
        }
        return ok(remoteShipment(id, { status: 'offer_selected' }));
      }],
    });
    h.deps.shipx.real = slow.client;
    expect(await refreshInpostShipment(write, { orderId: 'order-1' }, h.deps)).toMatchObject({
      ok: true,
      value: { shipment: { status: 'confirmed', trackingNumber: TRACKING, boughtAt: NOW } },
    });
    expect(h.row()).toMatchObject({ status: 'confirmed', trackingNumber: TRACKING, boughtAt: NOW });
    expect(await h.eventTypes()).toEqual([]);
  });

  it('keeps the stored status when the live read fails or the settings changed', async () => {
    const failing = harness({ real: createScriptedShipxClient({ polls: [() => err(shipxUnavailable())] }) });
    failing.seed({ shipxShipmentId: '1001', status: 'offer_selected' });
    expect(await refreshInpostShipment(write, { orderId: 'order-1' }, failing.deps)).toMatchObject({ ok: true, value: { shipment: { status: 'offer_selected' } } });
    const moved = harness();
    moved.seed({ shipxShipmentId: '1001', status: 'offer_selected', environment: 'sandbox' });
    expect(await refreshInpostShipment(write, { orderId: 'order-1' }, moved.deps)).toMatchObject({ ok: true, value: { shipment: { status: 'offer_selected', environment: 'sandbox' } } });
    expect(moved.real.calls).toEqual(noCalls);
  });

  it('downloads the label of a bought shipment and records the download', async () => {
    const h = harness();
    await createInpostShipment(write, { orderId: 'order-1' }, h.deps);
    const label = await inpostShipmentLabel(write, { orderId: 'order-1' }, h.deps);
    expect(label).toMatchObject({ ok: true, value: { filename: `inpost-${TRACKING}.pdf`, contentType: 'application/pdf' } });
    expect(h.real.calls.label).toEqual(['1001']);
    expect(h.row()?.labelFetchedAt).toBe(NOW);
    const events = await h.shipments.repository.listEvents('workspace', 'order-1');
    expect(events.map((event) => event.type)).toEqual([
      'attempt_claimed', 'attempt_marked', 'shipment_created', 'status_refreshed', 'offer_bought', 'operation_finished', 'label_fetched',
    ]);
    expect(events.every((event) => event.actorUserId === 'staff')).toBe(true);
    expect(events.map((event) => event.operationToken)).toEqual(['id-1', 'id-1', 'id-1', 'id-1', 'id-1', 'id-1', null]);
    expect(events.map((event) => event.shipxShipmentId)).toEqual([null, null, '1001', '1001', '1001', '1001', '1001']);
    expect(events[3]?.details).toEqual({ from: 'created', to: 'confirmed', trackingNumber: TRACKING });
    expect(events[4]?.details).toEqual({ status: 'confirmed', trackingNumber: TRACKING });
    expect(events[5]?.details).toEqual({ outcome: 'bought' });
    expect(await h.shipments.repository.listEvents('other-workspace', 'order-1')).toEqual([]);
  });

  it('maps a label requested before payment to the ShipX invalid_action error', async () => {
    const real = createScriptedShipxClient({
      label: err(shipxRejected({ status: 400, error: 'invalid_action', description: 'Shipment not paid', fields: {} })),
    });
    const h = harness({ real });
    h.seed({ shipxShipmentId: '1001', status: 'created' });
    expect(await inpostShipmentLabel(write, { orderId: 'order-1' }, h.deps)).toMatchObject({
      ok: false,
      error: { code: 'shipx_rejected', message: 'The InPost label is available only after the shipment is paid', details: { error: 'invalid_action' } },
    });
    expect(h.row()?.labelFetchedAt).toBeNull();
  });

  it('returns not found without a shipment, for other workspaces and requires order:write', async () => {
    const h = harness();
    expect(await inpostShipmentLabel(write, { orderId: 'order-1' }, h.deps)).toMatchObject({ ok: false, error: { code: 'not_found' } });
    expect(await inpostShipmentLabel(ctx(['order:write', 'order:read'], 'other-workspace'), { orderId: 'order-1' }, h.deps)).toMatchObject({ ok: false, error: { code: 'not_found' } });
    expect(await inpostShipmentLabel(ctx([]), { orderId: 'order-1' }, h.deps)).toMatchObject({ ok: false, error: { code: 'forbidden' } });
    h.seed({ shipxShipmentId: '1001', status: 'confirmed', trackingNumber: TRACKING, boughtAt: NOW });
    expect(await inpostShipmentLabel(ctx(['order:read']), { orderId: 'order-1' }, h.deps)).toMatchObject({ ok: false, error: { code: 'forbidden' } });
    expect(await inpostShipmentLabel(ctx(['order:write', 'order:read'], 'other-workspace'), { orderId: 'order-1' }, h.deps)).toMatchObject({ ok: false, error: { code: 'not_found' } });
    expect(h.real.calls).toEqual(noCalls);
    expect(h.row()?.labelFetchedAt).toBeNull();
    expect(await h.eventTypes()).toEqual([]);
  });

  it('refuses the refresh to staff without order:write and to other workspaces, without calling ShipX or writing', async () => {
    const h = harness();
    h.seed({ shipxShipmentId: '1001', status: 'offer_selected' });
    expect(await refreshInpostShipment(ctx(['order:read']), { orderId: 'order-1' }, h.deps)).toMatchObject({ ok: false, error: { code: 'forbidden' } });
    expect(await refreshInpostShipment(ctx(['order:write', 'order:read'], 'other-workspace'), { orderId: 'order-1' }, h.deps)).toMatchObject({ ok: false, error: { code: 'not_found' } });
    expect(await refreshInpostShipment(write, { orderId: '' }, h.deps)).toMatchObject({ ok: false, error: { code: 'validation' } });
    expect(h.real.calls).toEqual(noCalls);
    expect(h.fake.calls).toEqual(noCalls);
    expect(h.row()).toMatchObject({ status: 'offer_selected', trackingNumber: null });
    expect(await h.eventTypes()).toEqual([]);
  });

  it('answers the refresh with the readiness of the view and leaves rows without a ShipX id or credentials untouched', async () => {
    const h = harness();
    expect(await refreshInpostShipment(write, { orderId: 'order-1' }, h.deps)).toEqual(await getInpostShipment(ctx(['order:read']), { orderId: 'order-1' }, h.deps));
    h.seed({ status: 'unknown', createAttemptedAt: '2026-11-08T09:55:00.000Z' });
    expect(await refreshInpostShipment(write, { orderId: 'order-1' }, h.deps)).toMatchObject({ ok: true, value: { shipment: { shipxShipmentId: null, status: 'unknown' } } });
    const missing = harness({ secrets: { 'shipx.production.token': 'only-token' } });
    missing.seed({ shipxShipmentId: '1001', status: 'offer_selected' });
    expect(await refreshInpostShipment(write, { orderId: 'order-1' }, missing.deps)).toMatchObject({ ok: true, value: { reason: 'credentials_missing', shipment: { status: 'offer_selected' } } });
    expect(h.real.calls).toEqual(noCalls);
    expect(missing.real.calls).toEqual(noCalls);
  });
});

describe('ShipX settings', () => {
  const settingsHarness = (options: { legacyEnvironment?: 'sandbox' | 'production'; secrets?: TenantSecret[] } = {}) => {
    const secrets = createTenantSecretRepositoryFake(options.secrets ?? []);
    const settings = createShipxSettingsRepositoryFake(
      options.legacyEnvironment === undefined ? {} : { workspace: { sender: null, legacyEnvironment: options.legacyEnvironment } },
    );
    let id = 0;
    const deps = {
      shipxSettings: settings.repository,
      tenantSecrets: secrets.repository,
      secretCrypto: {
        encrypt: (plaintext: string) => ({ ciphertext: `enc:${plaintext}`, iv: 'iv', authTag: 'tag' }),
        decrypt: (input: { ciphertext: string }) => ok(input.ciphertext.slice(4)),
      },
      ids: { nextId: () => `secret-${String(++id)}` },
      clock: { nowIso: () => '2026-11-08T10:00:00.000Z' },
    };
    const stored = () => secrets.rows.filter((row) => row.tenantId === 'workspace').map((row) => `${row.key}=${row.ciphertext}`).sort();
    return { deps, secrets, settings, stored };
  };
  const owner = ctx(['tenant:secret:write']);
  const unset = { organizationId: null, token: null, configured: false };
  const legacyRow = (key: TenantSecretKey): TenantSecret => ({ ...secretRow(key), ciphertext: `enc:legacy-${key}` });

  it('stores each slot encrypted, returns them masked and keeps the sender', async () => {
    const h = settingsHarness();
    const saved = await configureShipx(owner, {
      sender,
      production: { organizationId: '1234', token: 'secret-token-9876' },
      sandbox: { organizationId: '5678', token: 'sandbox-token-4321' },
    }, h.deps);
    expect(saved).toEqual({
      ok: true,
      value: {
        sender,
        production: {
          organizationId: { maskedPreview: '••••1234', updatedAt: '2026-11-08T10:00:00.000Z' },
          token: { maskedPreview: '••••9876', updatedAt: '2026-11-08T10:00:00.000Z' },
          configured: true,
        },
        sandbox: {
          organizationId: { maskedPreview: '••••5678', updatedAt: '2026-11-08T10:00:00.000Z' },
          token: { maskedPreview: '••••4321', updatedAt: '2026-11-08T10:00:00.000Z' },
          configured: true,
        },
      },
    });
    expect(h.stored()).toEqual([
      'shipx.production.organizationId=enc:1234',
      'shipx.production.token=enc:secret-token-9876',
      'shipx.sandbox.organizationId=enc:5678',
      'shipx.sandbox.token=enc:sandbox-token-4321',
    ]);
    const shown = JSON.stringify(await getShipxSettings(ctx(['tenant:secret:read']), h.deps));
    expect(shown).not.toContain('secret-token-9876');
    expect(shown).not.toContain('sandbox-token-4321');
    expect(h.settings.legacyReads).toEqual([]);
  });

  it('counts a slot as configured with its organization id and token, without a sender', async () => {
    const h = settingsHarness();
    expect(await configureShipx(owner, { sandbox: { organizationId: '5678', token: 'sandbox-token' } }, h.deps)).toMatchObject({
      ok: true, value: { sender: null, sandbox: { configured: true }, production: unset },
    });
    expect(await configureShipx(owner, { production: { token: 'only-token' } }, h.deps)).toMatchObject({
      ok: true, value: { sandbox: { configured: true }, production: { organizationId: null, configured: false } },
    });
  });

  it.each(['sandbox', 'production'] as const)('shows the stored single connection only in the %s slot named by the stored environment', async (environment) => {
    const other = environment === 'sandbox' ? 'production' : 'sandbox';
    const previewed = (key: TenantSecretKey, maskedPreview: string): TenantSecret => ({ ...legacyRow(key), maskedPreview });
    const h = settingsHarness({ legacyEnvironment: environment, secrets: [previewed('shipx.organizationId', '••••4321'), previewed('shipx.token', '••••oken')] });
    expect(await getShipxSettings(ctx(['tenant:secret:read']), h.deps)).toEqual({
      ok: true,
      value: {
        sender: null,
        [environment]: {
          organizationId: { maskedPreview: '••••4321', updatedAt: '2026-11-01T00:00:00.000Z' },
          token: { maskedPreview: '••••oken', updatedAt: '2026-11-01T00:00:00.000Z' },
          configured: true,
        },
        [other]: unset,
      },
    });
    expect(await configureShipx(owner, { [environment]: { token: 'new-token-7777' } }, h.deps)).toMatchObject({
      ok: true,
      value: {
        [environment]: {
          organizationId: { maskedPreview: '••••4321' },
          token: { maskedPreview: '••••7777', updatedAt: '2026-11-08T10:00:00.000Z' },
          configured: true,
        },
        [other]: unset,
      },
    });
    const unnamed = settingsHarness({ secrets: [previewed('shipx.organizationId', '••••4321'), previewed('shipx.token', '••••oken')] });
    expect(await getShipxSettings(ctx(['tenant:secret:read']), unnamed.deps)).toEqual({ ok: true, value: { sender: null, sandbox: unset, production: unset } });
  });

  it('saves one slot without reading, writing or deleting the rows of the other slot', async () => {
    const h = settingsHarness({ secrets: [legacyRow('shipx.organizationId'), legacyRow('shipx.token')] });
    await configureShipx(owner, { production: { organizationId: '1234', token: 'production-token' } }, h.deps);
    const findByKey = vi.spyOn(h.secrets.repository, 'findByKey');
    const upsertMany = vi.spyOn(h.secrets.repository, 'upsertMany');
    const remove = vi.spyOn(h.secrets.repository, 'delete');
    expect(await configureShipx(owner, { sandbox: { organizationId: '5678', token: 'sandbox-token' } }, h.deps)).toMatchObject({ ok: true });
    expect(upsertMany.mock.calls.flatMap(([, rows]) => rows.map((row) => row.key))).toEqual(['shipx.sandbox.organizationId', 'shipx.sandbox.token']);
    expect(remove).not.toHaveBeenCalled();
    expect(findByKey).not.toHaveBeenCalled();
    expect(h.stored()).toEqual([
      'shipx.organizationId=enc:legacy-shipx.organizationId',
      'shipx.production.organizationId=enc:1234',
      'shipx.production.token=enc:production-token',
      'shipx.sandbox.organizationId=enc:5678',
      'shipx.sandbox.token=enc:sandbox-token',
      'shipx.token=enc:legacy-shipx.token',
    ]);
    await configureShipx(owner, { sandbox: { token: 'sandbox-token-2' } }, h.deps);
    expect(h.stored()).toContain('shipx.production.token=enc:production-token');
    expect(h.stored()).toContain('shipx.sandbox.token=enc:sandbox-token-2');
  });

  it('clears one slot without touching the other slot or the sender', async () => {
    const h = settingsHarness({ legacyEnvironment: 'production' });
    await configureShipx(owner, {
      sender,
      production: { organizationId: '1234', token: 'production-token' },
      sandbox: { organizationId: '5678', token: 'sandbox-token' },
    }, h.deps);
    expect(await configureShipx(owner, { sandbox: { clearCredentials: true } }, h.deps)).toMatchObject({
      ok: true, value: { sender, sandbox: unset, production: { configured: true } },
    });
    expect(h.stored()).toEqual(['shipx.production.organizationId=enc:1234', 'shipx.production.token=enc:production-token']);
    expect(await configureShipx(owner, { production: { clearCredentials: true } }, h.deps)).toMatchObject({
      ok: true, value: { sender, sandbox: unset, production: unset },
    });
    expect(h.stored()).toEqual([]);
  });

  it.each(['sandbox', 'production'] as const)('also deletes the legacy rows when clearing the %s slot named by the stored environment', async (environment) => {
    const other = environment === 'sandbox' ? 'production' : 'sandbox';
    const legacy = [legacyRow('shipx.organizationId'), legacyRow('shipx.token')];
    const matching = settingsHarness({ legacyEnvironment: environment, secrets: legacy });
    await configureShipx(owner, { [environment]: { organizationId: '1234', token: 'slot-token' }, [other]: { organizationId: '5678', token: 'other-token' } }, matching.deps);
    expect(await configureShipx(owner, { [environment]: { clearCredentials: true } }, matching.deps)).toMatchObject({ ok: true, value: { [environment]: unset } });
    expect(matching.stored()).toEqual([`shipx.${other}.organizationId=enc:5678`, `shipx.${other}.token=enc:other-token`]);
    expect(matching.settings.legacyReads).toContain('workspace');

    const differing = settingsHarness({ legacyEnvironment: other, secrets: legacy });
    await configureShipx(owner, { [environment]: { organizationId: '1234', token: 'slot-token' } }, differing.deps);
    await configureShipx(owner, { [environment]: { clearCredentials: true } }, differing.deps);
    expect(differing.stored()).toEqual(['shipx.organizationId=enc:legacy-shipx.organizationId', 'shipx.token=enc:legacy-shipx.token']);
  });

  it('changes nothing for a field left out and saves or removes the shared sender on its own', async () => {
    const h = settingsHarness();
    await configureShipx(owner, { sender, sandbox: { organizationId: '5678', token: 'sandbox-token' } }, h.deps);
    const before = h.stored();
    expect(await configureShipx(owner, {}, h.deps)).toMatchObject({ ok: true, value: { sender, sandbox: { configured: true } } });
    expect(await configureShipx(owner, { sender: null }, h.deps)).toMatchObject({ ok: true, value: { sender: null, sandbox: { configured: true } } });
    expect(h.stored()).toEqual(before);
  });

  it('refuses clearing a slot together with new credentials for it, before any write', async () => {
    const h = settingsHarness();
    expect(await configureShipx(owner, { sender, production: { clearCredentials: true, token: 'x' } }, h.deps)).toMatchObject({
      ok: false, error: { code: 'validation', message: 'Clearing the production credentials cannot be combined with new production credentials' },
    });
    expect(await configureShipx(owner, { sandbox: { clearCredentials: true, organizationId: '5678' } }, h.deps)).toMatchObject({ ok: false, error: { code: 'validation' } });
    expect(h.settings.rows.size).toBe(0);
    expect(h.stored()).toEqual([]);
  });

  it.each([
    ['environment', { environment: 'production' }],
    ['organizationId', { organizationId: '1234' }],
    ['token', { token: 'shipx-token' }],
    ['clearCredentials', { clearCredentials: true }],
  ])('refuses the previous top-level %s field', async (_field, input) => {
    const h = settingsHarness();
    expect(await configureShipx(owner, input, h.deps)).toMatchObject({ ok: false, error: { code: 'validation' } });
    expect(h.stored()).toEqual([]);
  });

  it('validates input and requires the secret capabilities', async () => {
    const h = settingsHarness();
    expect(await configureShipx(owner, { production: { organizationId: 'abc' } }, h.deps)).toMatchObject({ ok: false, error: { code: 'validation' } });
    expect(await configureShipx(owner, { sandbox: { token: 'x', extra: true } }, h.deps)).toMatchObject({ ok: false, error: { code: 'validation' } });
    expect(await configureShipx(owner, { sender: { ...sender, postCode: '00001' } }, h.deps)).toMatchObject({ ok: false, error: { code: 'validation' } });
    expect(await configureShipx(owner, { sender: { ...sender, phone: '123' } }, h.deps)).toMatchObject({ ok: false, error: { code: 'validation' } });
    expect(await configureShipx(ctx(['tenant:secret:read']), { sandbox: { token: 'x' } }, h.deps)).toMatchObject({ ok: false, error: { code: 'forbidden' } });
    expect(await getShipxSettings(ctx([]), h.deps)).toMatchObject({ ok: false, error: { code: 'forbidden' } });
    expect(h.settings.rows.size).toBe(0);
  });
});
