import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { z } from 'zod';

import { BETTER_AUTH_PASSWORD_SIGN_IN_PATH, BETTER_AUTH_SIGN_UP_PATH } from '#adapters/auth/create-auth.js';
import { createOrderRepository } from '#adapters/db/repositories.js';
import {
  members,
  orderFulfilmentEvents,
  orderIssueEvents,
  orderShipmentEvents,
  products,
  shopManagementKeyEvents,
  tenantAdmins,
  tenantApiKeys,
  tenants,
  tenantSecrets,
  user,
} from '#adapters/db/schema.js';
import { createShipxShipmentRepository } from '#adapters/db/shipx.js';
import { createTestDatabase } from '#adapters/db/test-database-name.js';
import { fakeShipxShipmentId, fakeShipxTrackingNumber } from '#adapters/shipx/fake.js';
import {
  API_ROUTES,
  apiKeyCreateOutputSchema,
  apiKeysShopManagementCreateOutputSchema,
  SHOP_ORDER_ROUTES,
  shopOrderContracts,
} from '#core/contract/index.js';
import { orderSchema } from '#core/domain/index.js';

import { buildApp } from './app.js';
import { createDeps } from './composition.js';
import { envSchema } from './env.js';

const baseUrl = 'http://localhost:48730';
const acmeHost = 'acme.localhost:48730';
const studioHost = 'studio.localhost:48730';
const akademiaHost = 'akademia.localhost:48730';
const email = 'shop-orders-owner@example.test';
const password = 'shop-orders-password-15';
const now = '2026-11-15T10:00:00.000Z';
const expiresAt = '2026-11-22T00:00:00.000Z';
const READ = 'shop:orders:read';
const FULFIL = 'shop:fulfilment:write';

let database: Awaited<ReturnType<typeof createTestDatabase>>;
let deps: ReturnType<typeof createDeps>;
let app: ReturnType<typeof buildApp>;
let ownerId: string;
let ownerToken: string;

const envelope = <S extends z.ZodTypeAny>(schema: S) => z.object({ ok: z.literal(true), data: schema });
const errorOf = async (response: Response) =>
  z.object({ ok: z.literal(false), error: z.object({ code: z.string(), message: z.string() }) }).parse(await response.json()).error;

const ownerRequest = (method: string, path: string, body: unknown, host: string) => app.request(`${baseUrl}${path}`, {
  method,
  headers: { host, authorization: `Bearer ${ownerToken}`, 'content-type': 'application/json' },
  body: JSON.stringify(body),
});

const createKeyRecord = async (input: Record<string, unknown>, host = acmeHost) => {
  const response = await ownerRequest(API_ROUTES.apiKeysCreate.method, API_ROUTES.apiKeysCreate.path, input, host);
  expect(response.status).toBe(200);
  return envelope(apiKeyCreateOutputSchema).parse(await response.json()).data;
};

const createKey = async (input: Record<string, unknown>, host = acmeHost) => (await createKeyRecord(input, host)).secret;

const createShopKeyRecord = async (scopes: string[], host = acmeHost) => {
  const response = await ownerRequest(
    API_ROUTES.apiKeysShopManagementCreate.method,
    API_ROUTES.apiKeysShopManagementCreate.path,
    { name: `Shop ${scopes.join(' ')}`, scopes, expiresAt },
    host,
  );
  expect(response.status).toBe(200);
  return envelope(apiKeysShopManagementCreateOutputSchema).parse(await response.json()).data;
};

const createShopKey = async (scopes: string[], host = acmeHost) => (await createShopKeyRecord(scopes, host)).secret;

const keyed = (secret: string, method: string, path: string, body?: unknown, host = acmeHost) => app.request(`${baseUrl}${path}`, {
  method,
  headers: {
    host,
    'x-api-key': secret,
    ...(body === undefined ? {} : { 'content-type': 'application/json' }),
  },
  ...(body === undefined ? {} : { body: JSON.stringify(body) }),
});

const orderPath = (path: string, orderId: string, productId = 'any-product'): string =>
  path.replace(':orderId', orderId).replace(':productId', productId).replace(':reference', orderId);

const readRoutes = (orderId: string) => [
  orderPath(SHOP_ORDER_ROUTES.listOrders.path, orderId),
  `${SHOP_ORDER_ROUTES.exportOrders.path}?format=csv`,
  `${SHOP_ORDER_ROUTES.ordersPackingList.path}?format=csv`,
  orderPath(SHOP_ORDER_ROUTES.verifyOrder.path, orderId),
  orderPath(SHOP_ORDER_ROUTES.getOrder.path, orderId),
  orderPath(SHOP_ORDER_ROUTES.shipxShipment.path, orderId),
];

const writeRoutes = (orderId: string, productId = 'any-product') => [
  [orderPath(SHOP_ORDER_ROUTES.shipOrder.path, orderId), { carrier: 'other', trackingNumber: 'REFUSED01' }],
  [orderPath(SHOP_ORDER_ROUTES.issueOrderLine.path, orderId, productId), undefined],
  [orderPath(SHOP_ORDER_ROUTES.shipxCreate.path, orderId), undefined],
  [orderPath(SHOP_ORDER_ROUTES.shipxRefresh.path, orderId), undefined],
  [orderPath(SHOP_ORDER_ROUTES.shipxDiscard.path, orderId), undefined],
  [orderPath(SHOP_ORDER_ROUTES.shipxLabel.path, orderId), undefined],
] as const;

const lockerShipping = {
  rateId: 'locker', label: 'Parcel locker', amountCents: 1499, vatRatePercent: 23, carrier: 'inpost',
  pickupPoint: { provider: 'inpost', code: 'WAW01M', name: null, address: null },
  address: { name: 'Jane Buyer', line1: 'Garden Street 5', line2: null, postalCode: '00-950', city: 'Warsaw', country: 'PL' },
  phone: '+48500000000',
};

const courierShipping = {
  ...lockerShipping, rateId: 'courier', label: 'Courier', carrier: 'other', pickupPoint: null,
};

const order = (tenantId: string, id: string, options: { mode?: 'live' | 'test'; shipping?: typeof lockerShipping | typeof courierShipping | null; quantity?: number } = {}) => orderSchema.parse({
  id, tenantId, memberId: `member-${tenantId}`, productId: `book-${tenantId}`, priceId: null, kind: 'one_time', status: 'paid',
  mode: options.mode ?? 'live', amountCents: 6398, currency: 'PLN', provider: 'simulated', providerObjectIds: {}, couponId: null,
  discountCents: 0, createdAt: now, paidAt: now,
  ...(options.shipping === null ? {} : { shipping: options.shipping ?? lockerShipping, fulfilmentStatus: 'to_pack' }),
  lines: [
    {
      productId: `book-${tenantId}`, name: 'Printed handbook', productType: 'physical', grossCents: 4899, netCents: 4666, vatCents: 233, vatRate: 5, vatExemptionBasis: null, issuedCount: 0,
      ...(options.quantity === undefined ? {} : { quantity: options.quantity }),
    },
    ...(options.shipping === null ? [] : [
      { productId: 'shipping:locker', name: 'Parcel locker', productType: 'shipping', grossCents: 1499, netCents: 1219, vatCents: 280, vatRate: 23, vatExemptionBasis: null, issuedCount: null },
    ]),
  ],
});

const listIds = async (response: Response) => {
  expect(response.status).toBe(200);
  return envelope(shopOrderContracts.listOrders.output).parse(await response.json()).data.orders.map((entry) => entry.id).toSorted();
};

beforeAll(async () => {
  database = await createTestDatabase(
    'together_shop_order_routes_test',
    process.env['DATABASE_URL'] ?? 'postgres://together:together@localhost:48912/postgres',
  );
  deps = createDeps(envSchema.parse({
    NODE_ENV: 'test', DATABASE_URL: database.url, REALTIME_TRANSPORT: 'in-process',
    APP_BASE_URL: baseUrl, APP_BASE_DOMAIN: 'localhost',
    BETTER_AUTH_SECRET: 'shop-order-routes-test-secret-at-least-32-characters',
  }), { db: database.db, clock: { nowIso: () => now } });
  app = buildApp(deps);

  const signup = await app.request(`${baseUrl}${BETTER_AUTH_SIGN_UP_PATH}`, {
    method: 'POST', headers: { 'content-type': 'application/json', origin: baseUrl },
    body: JSON.stringify({ name: 'Shop Orders Owner', email, password }),
  });
  expect(signup.status).toBe(200);
  ownerId = z.object({ user: z.object({ id: z.string() }) }).parse(await signup.json()).user.id;
  await database.db.execute(`update "user" set email_verified = true where id = '${ownerId}'`);
  await database.db.insert(user).values({ id: 'buyer', email: 'buyer@example.org', name: 'Buyer' });
  for (const tenantId of ['acme', 'studio', 'akademia']) {
    await database.db.insert(tenants).values({ id: tenantId, slug: tenantId, name: 'Workspace', createdAt: now });
    await database.db.insert(tenantAdmins).values({ id: `grant-${tenantId}`, tenantId, userId: ownerId, role: 'owner' });
    await database.db.insert(members).values({ id: `member-${tenantId}`, tenantId, userId: 'buyer', email: 'buyer@example.org', displayName: 'Buyer', createdAt: now });
    await database.db.insert(products).values({
      id: `book-${tenantId}`, tenantId, type: 'physical', deliveryMethod: 'shipping', description: '', slug: 'printed-handbook',
      title: 'Printed handbook', priceCents: 4899, currency: 'PLN', published: true, vatRate: 5, createdAt: now,
    });
  }
  const orders = createOrderRepository(database.db);
  await orders.create('acme', order('acme', 'acme-live-courier', { shipping: courierShipping }));
  await orders.create('acme', order('acme', 'acme-live-pickup', { shipping: null }));
  await orders.create('acme', order('acme', 'acme-test-locker', { mode: 'test' }));
  await orders.create('studio', order('studio', 'studio-live-locker'));
  await orders.create('akademia', order('akademia', 'akademia-live-locker'));
  await orders.create('akademia', order('akademia', 'akademia-live-leased'));

  const signin = await app.request(`${baseUrl}${BETTER_AUTH_PASSWORD_SIGN_IN_PATH}`, {
    method: 'POST', headers: { 'content-type': 'application/json', origin: baseUrl },
    body: JSON.stringify({ email, password }),
  });
  expect(signin.status).toBe(200);
  ownerToken = z.object({ token: z.string() }).parse(await signin.json()).token;
}, 120_000);

afterAll(async () => { await database?.close(); });

describe('shop order routes with a shop management key', () => {
  it('lists only the key workspace orders and filters by the requested mode', async () => {
    const secret = await createShopKey([READ]);
    expect(await listIds(await keyed(secret, 'GET', SHOP_ORDER_ROUTES.listOrders.path)))
      .toEqual(['acme-live-courier', 'acme-live-pickup', 'acme-test-locker']);
    expect(await listIds(await keyed(secret, 'GET', `${SHOP_ORDER_ROUTES.listOrders.path}?mode=live`)))
      .toEqual(['acme-live-courier', 'acme-live-pickup']);
    expect(await listIds(await keyed(secret, 'GET', `${SHOP_ORDER_ROUTES.listOrders.path}?mode=test`)))
      .toEqual(['acme-test-locker']);

    const paged = await keyed(secret, 'GET', `${SHOP_ORDER_ROUTES.listOrders.path}?mode=live&page=2&pageSize=1`);
    expect(envelope(shopOrderContracts.listOrders.output).parse(await paged.json()).data).toMatchObject({ total: 2, page: 2, pageSize: 1 });

    const invalid = await keyed(secret, 'GET', `${SHOP_ORDER_ROUTES.listOrders.path}?mode=staging`);
    expect(invalid.status).toBe(400);
    expect((await errorOf(invalid)).code).toBe('validation');
  });

  it('rejects an unknown query parameter or body field instead of ignoring it', async () => {
    const secret = await createShopKey([READ, FULFIL]);
    for (const path of [
      `${SHOP_ORDER_ROUTES.listOrders.path}?fulfillmentStatus=to_pack`,
      `${SHOP_ORDER_ROUTES.exportOrders.path}?format=csv&fulfillmentStatus=to_pack`,
      `${SHOP_ORDER_ROUTES.ordersPackingList.path}?format=csv&mod=live`,
    ]) {
      const response = await keyed(secret, 'GET', path);
      expect(response.status, path).toBe(400);
      expect((await errorOf(response)).code).toBe('validation');
    }
    const shipped = await keyed(secret, 'POST', orderPath(SHOP_ORDER_ROUTES.shipOrder.path, 'acme-live-courier'), {
      carrier: 'other', trackingNumber: 'MANUAL0002', trackingUrl: 'https://carrier.example.test/MANUAL0002',
    });
    expect(shipped.status).toBe(400);
    expect((await errorOf(shipped)).code).toBe('validation');
  });

  it('serves order detail, verification, the export and the packing list to a read key', async () => {
    const secret = await createShopKey([READ]);
    const detail = await keyed(secret, 'GET', orderPath(SHOP_ORDER_ROUTES.getOrder.path, 'acme-live-pickup'));
    expect(envelope(shopOrderContracts.getOrder.output).parse(await detail.json()).data).toMatchObject({ order: { id: 'acme-live-pickup' }, invoice: null });
    const verified = await keyed(secret, 'GET', orderPath(SHOP_ORDER_ROUTES.verifyOrder.path, 'acme-live-pickup'));
    expect(envelope(shopOrderContracts.verifyOrder.output).parse(await verified.json()).data.order.id).toBe('acme-live-pickup');

    const exported = await keyed(secret, 'GET', `${SHOP_ORDER_ROUTES.exportOrders.path}?format=csv`);
    const file = envelope(shopOrderContracts.exportOrders.output).parse(await exported.json()).data;
    expect(file).toMatchObject({ filename: 'sales-acme.csv', mimeType: 'text/csv; charset=utf-8' });
    expect(file.content.split('\n')).toHaveLength(3);

    const packing = await keyed(secret, 'GET', `${SHOP_ORDER_ROUTES.ordersPackingList.path}?format=csv`);
    const list = envelope(shopOrderContracts.ordersPackingList.output).parse(await packing.json()).data;
    expect(list.filename).toBe('packing-list-acme.csv');
    expect(list.content).toContain('acme-live-courier');
    expect(list.content).not.toContain('acme-test-locker');
    expect(list.content).not.toContain('studio-live-locker');

    const badExport = await keyed(secret, 'GET', `${SHOP_ORDER_ROUTES.exportOrders.path}?format=xml`);
    expect(badExport.status).toBe(400);
  });

  it('refuses every fulfilment call with a read key', async () => {
    const secret = await createShopKey([READ]);
    for (const [path, body] of writeRoutes('acme-live-courier')) {
      const response = await keyed(secret, 'POST', path, body);
      expect(response.status, path).toBe(403);
      expect(await errorOf(response), path).toEqual({ code: 'forbidden', message: `${FULFIL} is not permitted` });
    }
  });

  it('refuses every read with a fulfilment-only key', async () => {
    const secret = await createShopKey([FULFIL]);
    for (const path of readRoutes('acme-live-courier')) {
      const response = await keyed(secret, 'GET', path);
      expect(response.status, path).toBe(403);
      expect(await errorOf(response), path).toEqual({ code: 'forbidden', message: `${READ} is not permitted` });
    }
  });

  it('ships an eligible order once with a manual carrier and no ShipX configuration, as the issuing owner', async () => {
    expect((await database.db.select().from(tenantSecrets)).filter((row) => row.tenantId === 'acme')).toEqual([]);
    const secret = await createShopKey([READ, FULFIL]);
    const path = orderPath(SHOP_ORDER_ROUTES.shipOrder.path, 'acme-live-courier');
    const shipped = await keyed(secret, 'POST', path, { carrier: 'other', trackingNumber: 'MANUAL0001' });
    expect(shipped.status).toBe(200);
    expect(envelope(shopOrderContracts.shipOrder.output).parse(await shipped.json()).data.order).toMatchObject({
      id: 'acme-live-courier', fulfilmentStatus: 'shipped', shipment: { carrier: 'other', trackingNumber: 'MANUAL0001', shippedBy: ownerId },
    });

    const repeated = await keyed(secret, 'POST', path, { carrier: 'other', trackingNumber: 'MANUAL0002' });
    expect(repeated.status).toBe(409);
    expect(await errorOf(repeated)).toEqual({ code: 'fulfilment_conflict', message: 'Order has already been shipped' });

    const events = (await database.db.select().from(orderFulfilmentEvents)).filter((event) => event.orderId === 'acme-live-courier');
    expect(events).toHaveLength(1);
    expect(events[0]).toMatchObject({ tenantId: 'acme', type: 'shipped', actorUserId: ownerId });
    expect(await listIds(await keyed(secret, 'GET', `${SHOP_ORDER_ROUTES.listOrders.path}?mode=live&fulfilmentStatus=to_pack`))).toEqual([]);
  });

  it('issues a physical order line once, as the issuing owner', async () => {
    const secret = await createShopKey([FULFIL]);
    const path = orderPath(SHOP_ORDER_ROUTES.issueOrderLine.path, 'acme-live-pickup', 'book-acme');
    const issued = await keyed(secret, 'POST', path);
    expect(issued.status).toBe(200);
    expect(envelope(shopOrderContracts.issueOrderLine.output).parse(await issued.json()).data.order.lines?.[0]).toMatchObject({ issuedCount: 1 });

    const repeated = await keyed(secret, 'POST', path);
    expect(repeated.status).toBe(409);
    expect(await errorOf(repeated)).toEqual({ code: 'conflict', message: 'Order line has already been issued' });

    const events = (await database.db.select().from(orderIssueEvents)).filter((event) => event.orderId === 'acme-live-pickup');
    expect(events).toHaveLength(1);
    expect(events[0]).toMatchObject({ tenantId: 'acme', productId: 'book-acme', staffUserId: ownerId });
  });

  it('issues a line of several units with the session count body, then the rest, and refuses an over-issue', async () => {
    const orderId = 'acme-live-pickup-units';
    await createOrderRepository(database.db).create('acme', order('acme', orderId, { shipping: null, quantity: 3 }));
    const secret = await createShopKey([FULFIL]);
    const path = orderPath(SHOP_ORDER_ROUTES.issueOrderLine.path, orderId, 'book-acme');
    const issuedLine = async (response: Response) => {
      expect(response.status).toBe(200);
      return envelope(shopOrderContracts.issueOrderLine.output).parse(await response.json()).data.order.lines?.[0];
    };

    for (const body of [{ count: 0 }, { count: 1.5 }, { count: '2' }, { count: 2, force: true }]) {
      const invalid = await keyed(secret, 'POST', path, body);
      expect(invalid.status, JSON.stringify(body)).toBe(400);
      expect((await errorOf(invalid)).code).toBe('validation');
    }
    expect(await issuedLine(await keyed(secret, 'POST', path, { orderId: 'other-order', productId: 'other-product', count: 2 })))
      .toMatchObject({ productId: 'book-acme', quantity: 3, issuedCount: 2 });

    const overIssued = await keyed(secret, 'POST', path, { count: 2 });
    expect(overIssued.status).toBe(409);
    expect(await errorOf(overIssued)).toEqual({ code: 'conflict', message: 'Issue count exceeds the quantity left to issue' });

    expect(await issuedLine(await keyed(secret, 'POST', path))).toMatchObject({ quantity: 3, issuedCount: 3 });
    const repeated = await keyed(secret, 'POST', path, { count: 1 });
    expect(repeated.status).toBe(409);
    expect(await errorOf(repeated)).toEqual({ code: 'conflict', message: 'Order line has already been issued' });

    const events = (await database.db.select().from(orderIssueEvents)).filter((event) => event.orderId === orderId);
    expect(events.map((event) => event.issuedCount).toSorted()).toEqual([2, 3]);
  });

  it('serves the line quantity on the keyed list, detail, export and packing list', async () => {
    const orderId = 'acme-live-courier-units';
    await createOrderRepository(database.db).create('acme', order('acme', orderId, { shipping: courierShipping, quantity: 2 }));
    const secret = await createShopKey([READ]);
    const quantityOf = (lines: { productId: string; quantity?: number | undefined }[] | undefined) =>
      lines?.find((line) => line.productId === 'book-acme')?.quantity;

    const listed = await keyed(secret, 'GET', `${SHOP_ORDER_ROUTES.listOrders.path}?mode=live&fulfilmentStatus=to_pack`);
    const listedOrders = envelope(shopOrderContracts.listOrders.output).parse(await listed.json()).data.orders;
    expect(quantityOf(listedOrders.find((entry) => entry.id === orderId)?.lines)).toBe(2);

    const detail = await keyed(secret, 'GET', orderPath(SHOP_ORDER_ROUTES.getOrder.path, orderId));
    expect(quantityOf(envelope(shopOrderContracts.getOrder.output).parse(await detail.json()).data.order.lines)).toBe(2);

    const exported = await keyed(secret, 'GET', `${SHOP_ORDER_ROUTES.exportOrders.path}?format=json&fulfilmentStatus=to_pack`);
    const exportedOrders = z.array(z.object({ id: z.string(), lines: z.array(z.object({ productId: z.string(), quantity: z.number().optional() })) }))
      .parse(JSON.parse(envelope(shopOrderContracts.exportOrders.output).parse(await exported.json()).data.content));
    expect(quantityOf(exportedOrders.find((entry) => entry.id === orderId)?.lines)).toBe(2);

    const packing = await keyed(secret, 'GET', `${SHOP_ORDER_ROUTES.ordersPackingList.path}?format=csv`);
    const rows = envelope(shopOrderContracts.ordersPackingList.output).parse(await packing.json()).data.content.split('\n');
    expect(rows[0]).toMatch(/,quantity$/);
    expect(rows.find((row) => row.startsWith(`"${orderId}"`))).toMatch(/"Printed handbook × 2",.*,"2"$/);
  });

  it('treats an order of another workspace as not found on every route and leaves it untouched', async () => {
    const secret = await createShopKey([READ, FULFIL]);
    for (const path of readRoutes('studio-live-locker').slice(3)) {
      const response = await keyed(secret, 'GET', path);
      expect(response.status, path).toBe(404);
      expect((await errorOf(response)).code, path).toBe('not_found');
    }
    for (const [path, body] of writeRoutes('studio-live-locker', 'book-studio')) {
      const response = await keyed(secret, 'POST', path, body);
      expect(response.status, path).toBe(404);
      expect((await errorOf(response)).code, path).toBe('not_found');
    }
    expect(await listIds(await keyed(secret, 'GET', SHOP_ORDER_ROUTES.listOrders.path))).not.toContain('studio-live-locker');

    const wrongHost = await keyed(secret, 'GET', SHOP_ORDER_ROUTES.listOrders.path, undefined, studioHost);
    expect(wrongHost.status).toBe(401);

    const studioSecret = await createShopKey([READ], studioHost);
    const untouched = await keyed(studioSecret, 'GET', orderPath(SHOP_ORDER_ROUTES.getOrder.path, 'studio-live-locker'), undefined, studioHost);
    expect(envelope(shopOrderContracts.getOrder.output).parse(await untouched.json()).data.order).toMatchObject({ fulfilmentStatus: 'to_pack', shipment: null });
    const issuedLine = (await database.db.select().from(orderIssueEvents)).filter((event) => event.orderId === 'studio-live-locker');
    expect(issuedLine).toEqual([]);
  });

  it('creates, refreshes and labels an InPost shipment through the fake ShipX client and keeps the lease rules', async () => {
    const configured = await ownerRequest(API_ROUTES.shipxConfigure.method, API_ROUTES.shipxConfigure.path, {
      environment: 'production',
      organizationId: '1234',
      token: 'shipx-token-5678',
      sender: { name: 'Anna Sender', email: 'shop@example.org', phone: '500600700', street: 'Factory Street', buildingNumber: '7', city: 'Warsaw', postCode: '00-001' },
    }, akademiaHost);
    expect(configured.status).toBe(200);
    const secret = await createShopKey([READ, FULFIL], akademiaHost);
    const at = (path: string, orderId = 'akademia-live-locker') => orderPath(path, orderId);

    const before = await keyed(secret, 'GET', at(SHOP_ORDER_ROUTES.shipxShipment.path), undefined, akademiaHost);
    expect(envelope(shopOrderContracts.shipxShipment.output).parse(await before.json()).data).toMatchObject({ available: true, service: 'inpost_locker_standard', shipment: null });

    const created = await keyed(secret, 'POST', at(SHOP_ORDER_ROUTES.shipxCreate.path), undefined, akademiaHost);
    expect(created.status).toBe(200);
    const tracking = fakeShipxTrackingNumber(fakeShipxShipmentId('akademia-live-locker'));
    expect(envelope(shopOrderContracts.shipxCreate.output).parse(await created.json()).data).toMatchObject({
      order: { fulfilmentStatus: 'shipped', shipment: { carrier: 'inpost', trackingNumber: tracking, shippedBy: ownerId } },
      shipment: { trackingNumber: tracking, environment: 'production' },
    });

    const refreshed = await keyed(secret, 'POST', at(SHOP_ORDER_ROUTES.shipxRefresh.path), undefined, akademiaHost);
    expect(refreshed.status).toBe(200);
    expect(envelope(shopOrderContracts.shipxRefresh.output).parse(await refreshed.json()).data.shipment).toMatchObject({ trackingNumber: tracking });

    const label = await keyed(secret, 'POST', at(SHOP_ORDER_ROUTES.shipxLabel.path), undefined, akademiaHost);
    expect(label.status).toBe(200);
    expect(label.headers.get('content-type')).toBe('application/pdf');
    expect(label.headers.get('content-disposition')).toBe(`attachment; filename="inpost-${tracking}.pdf"`);
    expect(label.headers.get('cache-control')).toBe('private, no-store');
    expect(new TextDecoder().decode((await label.arrayBuffer()).slice(0, 5))).toBe('%PDF-');

    const again = await keyed(secret, 'POST', at(SHOP_ORDER_ROUTES.shipxCreate.path), undefined, akademiaHost);
    expect(again.status).toBe(409);
    expect((await errorOf(again)).code).toBe('fulfilment_conflict');

    const shipmentEvents = (await database.db.select().from(orderShipmentEvents)).filter((event) => event.orderId === 'akademia-live-locker');
    expect(shipmentEvents.map((event) => event.type)).toEqual(expect.arrayContaining(['attempt_claimed', 'shipment_created', 'operation_finished', 'label_fetched']));
    expect(shipmentEvents.every((event) => event.actorUserId === ownerId)).toBe(true);

    const leased = 'akademia-live-leased';
    const shipments = createShipxShipmentRepository(database.db);
    const held = await shipments.acquire('akademia', {
      id: 'held-lease', orderId: leased, token: 'held-token', environment: 'production', organizationId: '1234',
      now, leaseExpiredBefore: '2026-11-15T09:58:30.000Z', actorUserId: 'another-request',
    });
    expect(held.kind).toBe('acquired');
    const busy = await keyed(secret, 'POST', at(SHOP_ORDER_ROUTES.shipxCreate.path, leased), undefined, akademiaHost);
    expect(busy.status).toBe(409);
    expect(await errorOf(busy)).toEqual({ code: 'fulfilment_conflict', message: 'Another request is creating the InPost shipment for this order; refresh the order in a moment' });
    const busyDiscard = await keyed(secret, 'POST', at(SHOP_ORDER_ROUTES.shipxDiscard.path, leased), undefined, akademiaHost);
    expect(busyDiscard.status).toBe(409);
    expect((await errorOf(busyDiscard)).code).toBe('fulfilment_conflict');

    await shipments.finishOperation('akademia', leased, 'held-token', { actorUserId: 'another-request', at: now, outcome: 'failed' });
    const discarded = await keyed(secret, 'POST', at(SHOP_ORDER_ROUTES.shipxDiscard.path, leased), undefined, akademiaHost);
    expect(discarded.status).toBe(200);
    expect(envelope(shopOrderContracts.shipxDiscard.output).parse(await discarded.json()).data).toEqual({ discarded: true });
    expect(await shipments.findByOrder('akademia', leased)).toBeNull();
    const leasedOrder = await keyed(secret, 'GET', at(SHOP_ORDER_ROUTES.getOrder.path, leased), undefined, akademiaHost);
    expect(envelope(shopOrderContracts.getOrder.output).parse(await leasedOrder.json()).data.order).toMatchObject({ fulfilmentStatus: 'to_pack' });
  });

  it('passes the parcel template from the keyed create body to ShipX, keeps the product template without one and refuses an unknown template', async () => {
    const configured = await ownerRequest(API_ROUTES.shipxConfigure.method, API_ROUTES.shipxConfigure.path, {
      environment: 'production',
      organizationId: '1234',
      token: 'shipx-token-5678',
      sender: { name: 'Anna Sender', email: 'shop@example.org', phone: '500600700', street: 'Factory Street', buildingNumber: '7', city: 'Warsaw', postCode: '00-001' },
    }, akademiaHost);
    expect(configured.status).toBe(200);
    const orders = createOrderRepository(database.db);
    for (const id of ['akademia-template-large', 'akademia-template-default', 'akademia-template-invalid']) {
      await orders.create('akademia', order('akademia', id));
    }
    const shipx = deps.shipxIntegration?.shipx;
    if (shipx === undefined) throw new Error('Expected the ShipX integration');
    const createShipment = vi.spyOn(shipx.fake, 'createShipment');
    const secret = await createShopKey([READ, FULFIL], akademiaHost);
    const createWith = async (orderId: string, body?: unknown) => {
      createShipment.mockClear();
      const response = await keyed(secret, 'POST', orderPath(SHOP_ORDER_ROUTES.shipxCreate.path, orderId), body, akademiaHost);
      return { status: response.status, body: await response.json() as unknown, templates: createShipment.mock.calls.map((call) => call[1].parcelTemplate) };
    };

    try {
      expect(await createWith('akademia-template-large', { parcelTemplate: 'large' })).toMatchObject({ status: 200, templates: ['large'] });
      expect(await createWith('akademia-template-default')).toMatchObject({ status: 200, templates: ['medium'] });
      expect(await createWith('akademia-template-invalid', { parcelTemplate: 'huge' }))
        .toMatchObject({ status: 400, body: { ok: false, error: { code: 'validation' } }, templates: [] });
      expect(await createWith('akademia-template-invalid', { parcelTemplate: 'large', carrier: 'inpost' }))
        .toMatchObject({ status: 400, body: { ok: false, error: { code: 'validation' } }, templates: [] });
    } finally {
      createShipment.mockRestore();
    }
    const untouched = await keyed(secret, 'GET', orderPath(SHOP_ORDER_ROUTES.getOrder.path, 'akademia-template-invalid'), undefined, akademiaHost);
    expect(envelope(shopOrderContracts.getOrder.output).parse(await untouched.json()).data.order).toMatchObject({ fulfilmentStatus: 'to_pack', shipment: null });
  });

  it('refuses a catalog-only key with forbidden and legacy keys as invalid', async () => {
    const catalog = await createShopKey(['shop:catalog:read', 'shop:catalog:write']);
    const listed = await keyed(catalog, 'GET', SHOP_ORDER_ROUTES.listOrders.path);
    expect(listed.status).toBe(403);
    expect(await errorOf(listed)).toEqual({ code: 'forbidden', message: `${READ} is not permitted` });
    const shipped = await keyed(catalog, 'POST', orderPath(SHOP_ORDER_ROUTES.shipOrder.path, 'acme-test-locker'), { carrier: 'other', trackingNumber: 'REFUSED01' });
    expect(shipped.status).toBe(403);
    expect(await errorOf(shipped)).toEqual({ code: 'forbidden', message: `${FULFIL} is not permitted` });

    const importSecret = await createKey({ name: 'Importer', scopes: ['import:content'], expiresAt });
    const unscopedSecret = 'legacy-unscoped-shop-orders-secret';
    const deps = createDeps(envSchema.parse({
      NODE_ENV: 'test', DATABASE_URL: database.url, REALTIME_TRANSPORT: 'in-process',
      APP_BASE_URL: baseUrl, APP_BASE_DOMAIN: 'localhost',
      BETTER_AUTH_SECRET: 'shop-order-routes-test-secret-at-least-32-characters',
    }), { db: database.db });
    await database.db.insert(tenantApiKeys).values({
      id: 'legacy-unscoped-orders', tenantId: 'acme', name: 'Legacy', keyHash: deps.apiKeyCrypto.hash(unscopedSecret),
      scopes: null, createdAt: now, expiresAt: null, revokedAt: null,
    });
    for (const secret of [importSecret, unscopedSecret]) {
      for (const [method, path, body] of [
        ['GET', SHOP_ORDER_ROUTES.listOrders.path, undefined],
        ['POST', orderPath(SHOP_ORDER_ROUTES.shipOrder.path, 'acme-test-locker'), { carrier: 'other', trackingNumber: 'REFUSED01' }],
      ] as const) {
        const response = await keyed(secret, method, path, body);
        expect(response.status, path).toBe(401);
        expect(await errorOf(response)).toEqual({ code: 'unauthorized', message: 'Invalid API key' });
      }
    }
    const untouched = await keyed(await createShopKey([READ]), 'GET', orderPath(SHOP_ORDER_ROUTES.getOrder.path, 'acme-test-locker'));
    expect(envelope(shopOrderContracts.getOrder.output).parse(await untouched.json()).data.order).toMatchObject({ fulfilmentStatus: 'to_pack', shipment: null });
  });
});

describe('shop management key history of keyed order writes', () => {
  it('writes one row per fulfilment call that reaches its handler, with the route template and the order id', async () => {
    const orderId = 'acme-history-courier';
    await createOrderRepository(database.db).create('acme', order('acme', orderId, { shipping: courierShipping }));
    const { apiKey, secret } = await createShopKeyRecord([READ, FULFIL]);
    const templates = [
      SHOP_ORDER_ROUTES.shipOrder.path,
      SHOP_ORDER_ROUTES.issueOrderLine.path,
      SHOP_ORDER_ROUTES.shipxCreate.path,
      SHOP_ORDER_ROUTES.shipxRefresh.path,
      SHOP_ORDER_ROUTES.shipxDiscard.path,
      SHOP_ORDER_ROUTES.shipxLabel.path,
    ];
    const expected = [];
    const statuses = [];
    for (const [index, [path, body]] of writeRoutes(orderId, 'book-acme').entries()) {
      const response = await keyed(secret, 'POST', path, body === undefined ? undefined : { ...body, trackingNumber: 'HISTORY01' });
      statuses.push(response.status);
      expected.push({ actorUserId: ownerId, method: 'POST', route: templates[index], resourceId: orderId });
    }
    expect(statuses[0]).toBe(200);
    expect(statuses.slice(1).some((status) => status >= 400)).toBe(true);
    const rows = (await database.db.select().from(shopManagementKeyEvents))
      .filter((event) => event.apiKeyId === apiKey.id && event.kind === 'request')
      .map(({ actorUserId, method, route, resourceId }) => ({ actorUserId, method, route, resourceId }));
    const byRoute = <T extends { route: string | null | undefined }>(entries: T[]) => entries.toSorted((left, right) => (left.route ?? '').localeCompare(right.route ?? ''));
    expect(byRoute(rows)).toEqual(byRoute(expected));
  });

  it('refuses a keyed ship with a retryable 503 and leaves the order unshipped when its history row cannot be written', async () => {
    const orderId = 'acme-history-down-courier';
    await createOrderRepository(database.db).create('acme', order('acme', orderId, { shipping: courierShipping }));
    const { apiKey, secret } = await createShopKeyRecord([READ, FULFIL]);
    const historyDown = buildApp({
      ...deps,
      shopManagementKeyEvents: { ...deps.shopManagementKeyEvents, record: async () => { throw new Error('history unavailable'); } },
    });

    const refused = await historyDown.request(`${baseUrl}${orderPath(SHOP_ORDER_ROUTES.shipOrder.path, orderId)}`, {
      method: 'POST',
      headers: { host: acmeHost, 'x-api-key': secret, 'content-type': 'application/json' },
      body: JSON.stringify({ carrier: 'other', trackingNumber: 'NEVERSHIPPED' }),
    });

    expect(refused.status).toBe(503);
    expect(refused.headers.get('retry-after')).toMatch(/^[1-9]\d*$/);
    expect(await errorOf(refused)).toMatchObject({ code: 'unavailable' });
    const untouched = await keyed(secret, 'GET', orderPath(SHOP_ORDER_ROUTES.getOrder.path, orderId));
    expect(envelope(shopOrderContracts.getOrder.output).parse(await untouched.json()).data.order).toMatchObject({ fulfilmentStatus: 'to_pack', shipment: null });
    expect((await database.db.select().from(orderFulfilmentEvents)).filter((event) => event.orderId === orderId)).toEqual([]);
    expect((await database.db.select().from(orderShipmentEvents)).filter((event) => event.orderId === orderId)).toEqual([]);
    expect((await database.db.select().from(shopManagementKeyEvents))
      .filter((event) => event.apiKeyId === apiKey.id && event.kind === 'request')).toEqual([]);
  });
});
