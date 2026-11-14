import { describe, expect, it, vi } from 'vitest';

import {
  appError,
  err,
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
import type { TenantSecretResolver } from '../ports.js';
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

const credentials = { 'shipx.organizationId': '1234', 'shipx.token': 'shipx-token' } as const;

const secretRow = (key: TenantSecretKey): TenantSecret => ({
  id: key, tenantId: 'workspace', key, ciphertext: 'encrypted', iv: 'iv', authTag: 'tag', maskedPreview: '••••', updatedAt: '2026-11-01T00:00:00.000Z',
});

const NOW = '2026-11-08T10:00:00.000Z';

const harness = (options: {
  order?: OrderListItem | null;
  environment?: ShipxEnvironment;
  real?: ReturnType<typeof createScriptedShipxClient>;
  realAvailable?: boolean;
  secrets?: Partial<Record<TenantSecretKey, string>>;
  sender?: ShipxSender | null;
  ship?: OrderFulfilmentRepository['ship'];
} = {}) => {
  const order = options.order === undefined ? baseOrder : options.order;
  const real = options.real ?? createScriptedShipxClient();
  const fake = createScriptedShipxClient();
  const shipments = createShipxShipmentRepositoryFake();
  const settings = createShipxSettingsRepositoryFake({
    workspace: { environment: options.environment ?? 'production', sender: options.sender === undefined ? sender : options.sender },
  });
  const ship = vi.fn<OrderFulfilmentRepository['ship']>(options.ship ?? (async (_tenantId, input) => ok({ ...baseOrder, fulfilmentStatus: 'shipped', shipment: input.shipment })));
  const findById = vi.fn(async (tenantId: string, id: string) => (tenantId === order?.tenantId && id === order.id ? order : null));
  const wait = vi.fn(async () => undefined);
  const values: Partial<Record<TenantSecretKey, string>> = options.secrets ?? credentials;
  const resolve = vi.fn<TenantSecretResolver['resolve']>(async (_tenantId, key) => {
    const value = values[key];
    return value === undefined ? err(notFound(`No "${key}" secret`)) : ok(value);
  });
  let id = 0;
  const ids = { nextId: () => `id-${String(++id)}` };
  let now = NOW;
  const clock = { nowIso: () => now };
  const deps: CreateInpostShipmentDeps = {
    orderDetails: { findById },
    products: { findByIds: async (_tenantId, productIds) => [product('stand', 'small'), product('lamp', 'large')].filter((row) => productIds.includes(row.id)) },
    shipxShipments: shipments.repository,
    shipxSettings: settings.repository,
    tenantSecrets: { findByKey: async (_tenantId, key) => (values[key] === undefined ? null : secretRow(key)) },
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
  return { deps, real, fake, shipments, settings, ship, wait, resolve, row, eventTypes, seed, advance };
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

  it('requires credentials and a sender before calling ShipX', async () => {
    const missing = harness({ secrets: {} });
    expect(await createInpostShipment(write, { orderId: 'order-1' }, missing.deps)).toMatchObject({ ok: false, error: { code: 'integration_not_configured', details: { state: 'setup_missing', reason: 'credentials_missing' } } });
    const noSender = harness({ sender: null });
    expect(await createInpostShipment(write, { orderId: 'order-1' }, noSender.deps)).toMatchObject({ ok: false, error: { code: 'integration_not_configured', details: { state: 'setup_missing', reason: 'sender_missing' } } });
    expect(missing.real.calls.create).toEqual([]);
    expect(noSender.real.calls.create).toEqual([]);
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

describe('ShipX client selection', () => {
  it('sends test orders to the sandbox when the environment is the sandbox', async () => {
    const h = harness({ environment: 'sandbox', order: testOrder });
    expect(await createInpostShipment(write, { orderId: 'order-1' }, h.deps)).toMatchObject({ ok: true, value: { shipment: { environment: 'sandbox' } } });
    expect(h.real.calls.create).toHaveLength(1);
    expect(h.real.calls.credentials[0]).toEqual({ environment: 'sandbox', organizationId: '1234', token: 'shipx-token' });
    expect(h.fake.calls).toEqual(noCalls);
    expect(h.ship.mock.calls[0]?.[1].email).toBeNull();
  });

  it('refuses paid orders while the environment is the sandbox, before any row or call', async () => {
    const h = harness({ environment: 'sandbox' });
    expect(await createInpostShipment(write, { orderId: 'order-1' }, h.deps)).toEqual({
      ok: false,
      error: {
        code: 'validation',
        message: 'ShipX is configured for the sandbox; switch to production before shipping paid orders',
        details: { state: 'setup_missing', reason: 'sandbox_environment' },
      },
    });
    expect(h.real.calls).toEqual(noCalls);
    expect(h.fake.calls).toEqual(noCalls);
    expect(h.shipments.rows.size).toBe(0);
  });

  it('sends paid orders to production when the environment is production', async () => {
    const h = harness({ environment: 'production' });
    expect(await createInpostShipment(write, { orderId: 'order-1' }, h.deps)).toMatchObject({ ok: true });
    expect(h.real.calls.credentials[0]?.environment).toBe('production');
    expect(h.fake.calls).toEqual(noCalls);
  });

  it('answers test orders with the fake client when the environment is production', async () => {
    const h = harness({ environment: 'production', order: testOrder });
    expect(await createInpostShipment(write, { orderId: 'order-1' }, h.deps)).toMatchObject({ ok: true });
    expect(h.fake.calls.create).toHaveLength(1);
    expect(h.real.calls).toEqual(noCalls);
  });

  it('uses the fake client for every order in a deployment without the real client', async () => {
    const h = harness({ environment: 'sandbox', realAvailable: false });
    expect(await createInpostShipment(write, { orderId: 'order-1' }, h.deps)).toMatchObject({ ok: true });
    expect(h.fake.calls.create).toHaveLength(1);
    expect(h.real.calls).toEqual(noCalls);
  });

  it('reports a shipment created in another environment or organization instead of redirecting it', async () => {
    const h = harness({ environment: 'production' });
    h.seed({ shipxShipmentId: '1001', status: 'offer_selected', environment: 'sandbox' });
    expect(await createInpostShipment(write, { orderId: 'order-1' }, h.deps)).toMatchObject({
      ok: false,
      error: { code: 'conflict', message: expect.stringContaining('ShipX sandbox environment'), details: { state: 'environment_mismatch', environment: 'sandbox', settingsEnvironment: 'production' } },
    });
    expect(await inpostShipmentLabel(ctx(['order:read']), { orderId: 'order-1' }, h.deps)).toMatchObject({ ok: false, error: { code: 'conflict' } });
    h.seed({ shipxShipmentId: '1001', status: 'offer_selected', organizationId: '9999' });
    expect(await createInpostShipment(write, { orderId: 'order-1' }, h.deps)).toMatchObject({
      ok: false,
      error: { code: 'conflict', message: expect.stringContaining('different ShipX organization'), details: { state: 'organization_mismatch' } },
    });
    expect(h.real.calls).toEqual(noCalls);
    expect(h.row()?.operationStartedAt).toBeNull();
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
    const h = harness({ environment: 'production' });
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
      value: { available: true, reason: null, service: 'inpost_locker_standard', parcelTemplate: 'large', shipment: null },
    });
    expect(h.resolve).not.toHaveBeenCalled();
    const missing = harness({ secrets: { 'shipx.token': 'only-token' } });
    expect(await getInpostShipment(ctx(['order:read']), { orderId: 'order-1' }, missing.deps)).toMatchObject({ ok: true, value: { available: false, reason: 'credentials_missing' } });
    const noSender = harness({ sender: null });
    expect(await getInpostShipment(ctx(['order:read']), { orderId: 'order-1' }, noSender.deps)).toMatchObject({ ok: true, value: { available: false, reason: 'sender_missing' } });
    const sandbox = harness({ environment: 'sandbox' });
    expect(await getInpostShipment(ctx(['order:read']), { orderId: 'order-1' }, sandbox.deps)).toMatchObject({ ok: true, value: { available: false, reason: 'sandbox_environment' } });
    const sandboxTest = harness({ environment: 'sandbox', order: testOrder });
    expect(await getInpostShipment(ctx(['order:read']), { orderId: 'order-1' }, sandboxTest.deps)).toMatchObject({ ok: true, value: { available: true } });
  });

  it('sizes the parcel from the shipped products of a bundle and from every product when none is shipped', async () => {
    const ebook = productSchema.parse({ ...product('ebook', 'small'), type: 'digital_download', deliveryMethod: 'pickup', parcelTemplate: undefined });
    const bundle = orderListItemSchema.parse({ ...baseOrder, lines: [line('stand', 'physical'), line('ebook', 'digital_download'), line('shipping:locker', 'shipping')] });
    const parcelTemplate = async (stand: ReturnType<typeof product>) => {
      const h = harness({ order: bundle });
      h.deps.products = { findByIds: async (_tenantId, productIds) => [stand, ebook].filter((row) => productIds.includes(row.id)) };
      const view = await getInpostShipment(ctx(['order:read']), { orderId: 'order-1' }, h.deps);
      return view.ok ? view.value.parcelTemplate : view.error.code;
    };
    expect(await parcelTemplate(product('stand', 'small'))).toBe('small');
    expect(await parcelTemplate(productSchema.parse({ ...product('stand', 'small'), deliveryMethod: 'pickup' }))).toBe('medium');
  });

  it('reads the live ShipX status of a shipment waiting for payment when the order is opened', async () => {
    const h = harness();
    h.seed({ shipxShipmentId: '1001', status: 'offer_selected' });
    expect(await getInpostShipment(ctx(['order:read']), { orderId: 'order-1' }, h.deps)).toMatchObject({
      ok: true,
      value: { shipment: { shipxShipmentId: '1001', status: 'confirmed', trackingNumber: TRACKING } },
    });
    expect(h.real.calls.get).toEqual(['1001']);
    expect(h.row()).toMatchObject({ status: 'confirmed', trackingNumber: TRACKING });
    expect(await getInpostShipment(ctx(['order:read']), { orderId: 'order-1' }, h.deps)).toMatchObject({ ok: true });
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
    await getInpostShipment(ctx(['order:read']), { orderId: 'order-1' }, h.deps);
    expect(h.row()).toMatchObject({ status: 'offers_prepared', updatedAt: '2026-11-08T09:00:00.000Z' });
    expect(await h.eventTypes()).toEqual([]);
    await getInpostShipment(ctx(['order:read']), { orderId: 'order-1' }, h.deps);
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
    expect(await getInpostShipment(ctx(['order:read']), { orderId: 'order-1' }, h.deps)).toMatchObject({
      ok: true,
      value: { shipment: { status: 'confirmed', trackingNumber: TRACKING, boughtAt: NOW } },
    });
    expect(h.row()).toMatchObject({ status: 'confirmed', trackingNumber: TRACKING, boughtAt: NOW });
    expect(await h.eventTypes()).toEqual([]);
  });

  it('keeps the stored status when the live read fails or the settings changed', async () => {
    const failing = harness({ real: createScriptedShipxClient({ polls: [() => err(shipxUnavailable())] }) });
    failing.seed({ shipxShipmentId: '1001', status: 'offer_selected' });
    expect(await getInpostShipment(ctx(['order:read']), { orderId: 'order-1' }, failing.deps)).toMatchObject({ ok: true, value: { shipment: { status: 'offer_selected' } } });
    const moved = harness();
    moved.seed({ shipxShipmentId: '1001', status: 'offer_selected', environment: 'sandbox' });
    expect(await getInpostShipment(ctx(['order:read']), { orderId: 'order-1' }, moved.deps)).toMatchObject({ ok: true, value: { shipment: { status: 'offer_selected', environment: 'sandbox' } } });
    expect(moved.real.calls).toEqual(noCalls);
  });

  it('downloads the label of a bought shipment and records the download', async () => {
    const h = harness();
    await createInpostShipment(write, { orderId: 'order-1' }, h.deps);
    const label = await inpostShipmentLabel(ctx(['order:read']), { orderId: 'order-1' }, h.deps);
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
    expect(await inpostShipmentLabel(ctx(['order:read']), { orderId: 'order-1' }, h.deps)).toMatchObject({
      ok: false,
      error: { code: 'shipx_rejected', message: 'The InPost label is available only after the shipment is paid', details: { error: 'invalid_action' } },
    });
    expect(h.row()?.labelFetchedAt).toBeNull();
  });

  it('returns not found without a shipment, for other workspaces and requires order:read', async () => {
    const h = harness();
    expect(await inpostShipmentLabel(ctx(['order:read']), { orderId: 'order-1' }, h.deps)).toMatchObject({ ok: false, error: { code: 'not_found' } });
    expect(await inpostShipmentLabel(ctx(['order:read'], 'other-workspace'), { orderId: 'order-1' }, h.deps)).toMatchObject({ ok: false, error: { code: 'not_found' } });
    expect(await inpostShipmentLabel(ctx([]), { orderId: 'order-1' }, h.deps)).toMatchObject({ ok: false, error: { code: 'forbidden' } });
    expect(h.real.calls.label).toEqual([]);
  });
});

describe('ShipX settings', () => {
  const settingsHarness = () => {
    const secrets = createTenantSecretRepositoryFake();
    const settings = createShipxSettingsRepositoryFake();
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
    return { deps, secrets, settings };
  };

  it('stores the credentials encrypted, returns them masked and keeps the sender and environment', async () => {
    const h = settingsHarness();
    const saved = await configureShipx(ctx(['tenant:secret:write']), {
      environment: 'production', organizationId: '1234', token: 'secret-token-9876', sender,
    }, h.deps);
    expect(saved).toEqual({
      ok: true,
      value: {
        environment: 'production',
        sender,
        organizationId: { maskedPreview: '••••1234', updatedAt: '2026-11-08T10:00:00.000Z' },
        token: { maskedPreview: '••••9876', updatedAt: '2026-11-08T10:00:00.000Z' },
        configured: true,
      },
    });
    const stored = await h.secrets.repository.findByKey('workspace', 'shipx.token');
    expect(stored?.ciphertext).toBe('enc:secret-token-9876');
    expect(JSON.stringify(await getShipxSettings(ctx(['tenant:secret:read']), h.deps))).not.toContain('secret-token-9876');
  });

  it('clears the credentials without touching the sender', async () => {
    const h = settingsHarness();
    await configureShipx(ctx(['tenant:secret:write']), { organizationId: '1234', token: 'token-1', sender }, h.deps);
    expect(await configureShipx(ctx(['tenant:secret:write']), { clearCredentials: true }, h.deps)).toMatchObject({
      ok: true,
      value: { environment: 'sandbox', sender, organizationId: null, token: null, configured: false },
    });
    expect(await configureShipx(ctx(['tenant:secret:write']), { clearCredentials: true, token: 'x' }, h.deps)).toMatchObject({ ok: false, error: { code: 'validation' } });
  });

  it('validates input and requires the secret capabilities', async () => {
    const h = settingsHarness();
    expect(await configureShipx(ctx(['tenant:secret:write']), { organizationId: 'abc' }, h.deps)).toMatchObject({ ok: false, error: { code: 'validation' } });
    expect(await configureShipx(ctx(['tenant:secret:write']), { sender: { ...sender, postCode: '00001' } }, h.deps)).toMatchObject({ ok: false, error: { code: 'validation' } });
    expect(await configureShipx(ctx(['tenant:secret:read']), { environment: 'production' }, h.deps)).toMatchObject({ ok: false, error: { code: 'forbidden' } });
    expect(await getShipxSettings(ctx([]), h.deps)).toMatchObject({ ok: false, error: { code: 'forbidden' } });
    expect(h.settings.rows.size).toBe(0);
  });
});
