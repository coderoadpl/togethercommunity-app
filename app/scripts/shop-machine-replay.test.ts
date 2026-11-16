import { createHmac } from 'node:crypto';

import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { z } from 'zod';

import { BETTER_AUTH_PASSWORD_SIGN_IN_PATH, BETTER_AUTH_SIGN_UP_PATH } from '#adapters/auth/create-auth.js';
import { emailOutbox, orders, shopManagementKeyEvents, shopManagementKeys, tenantAdmins, tenantApiKeys, tenants } from '#adapters/db/schema.js';
import { createTestDatabase } from '#adapters/db/test-database-name.js';
import { createShopManagementClient, type ShopManagementClient } from '#core/client/index.js';
import {
  API_PATHS,
  API_ROUTES,
  apiKeysShopManagementCreateOutputSchema,
  checkoutSessionOutputSchema,
  publicOfferOutputSchema,
  SHOP_CATALOG_ROUTES,
  SHOP_INTEGRATION_ROUTES,
  SHOP_ORDER_ROUTES,
  SHOP_SETTINGS_ROUTES,
} from '#core/contract/index.js';
import { err, notFound, ok, type AppError, type Result } from '#core/domain/index.js';

import { buildApp } from '../apps/server/src/app.js';
import { createDeps } from '../apps/server/src/composition.js';
import { envSchema } from '../apps/server/src/env.js';

const baseUrl = 'http://localhost:48730';
const workspaceHost = 'acme.localhost:48730';
const storefrontOrigin = 'https://store.example.test';
const storageHost = 'storage.example.test';
const email = 'shop-replay-owner@example.test';
const password = 'shop-replay-password-15';
const buyerEmail = 'buyer@example.org';
const now = '2026-11-15T10:00:00.000Z';
const expiresAt = '2026-11-22T00:00:00.000Z';
const png = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAABAAAAAQCAIAAACQkWg2AAAACXBIWXMAAAPoAAAD6AG1e1JrAAAAGUlEQVQokWMwTptJEmIY1ZA2GkrGwzVpAABIfDIQjwcm5wAAAABJRU5ErkJggg==', 'base64');
const storage = {
  provider: 'minio', endpoint: `https://${storageHost}`, region: 'eu-central-1',
  bucket: 'shop-assets', accessKeyId: 'access-key-id', secretAccessKey: 'secret-access-key',
} as const;
const sender = {
  name: 'Warehouse', company: 'Example Press', email: 'warehouse@example.test', phone: '600700800',
  street: 'Garden Street', buildingNumber: '5', city: 'Warsaw', postCode: '00-950',
};
const courier = { id: 'courier', label: 'Courier', amountCents: 1500, vatRatePercent: 23, carrier: 'other', pickupPoint: 'none', active: true } as const;

let database: Awaited<ReturnType<typeof createTestDatabase>>;
let deps: ReturnType<typeof createDeps>;
let app: ReturnType<typeof buildApp>;
let ownerToken: string;
const objects = new Map<string, Uint8Array>();
type CheckoutInput = Parameters<ReturnType<typeof createDeps>['payment']['createCheckoutSession']>[0];
const checkouts: { input: CheckoutInput; sessionId: string }[] = [];

const envelope = <S extends z.ZodTypeAny>(schema: S) => z.object({ ok: z.literal(true), data: schema });

const unwrapped = <T>(result: Result<T, AppError>): T => {
  if (!result.ok) throw new Error(`${result.error.code}: ${result.error.message}`);
  return result.value;
};

const unsignedUrl = (url: string): string => {
  const parsed = new URL(url);
  parsed.search = '';
  return parsed.toString();
};

const workspaceFetch: typeof fetch = async (input, init) => {
  const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;
  if (new URL(url).host === storageHost) {
    objects.set(unsignedUrl(url), new Uint8Array(await new Response(init?.body).arrayBuffer()));
    return new Response(null, { status: 200 });
  }
  const headers = new Headers(init?.headers);
  headers.set('host', workspaceHost);
  return app.request(url, { ...init, headers });
};

const shopClient = (apiKey: string): ShopManagementClient => createShopManagementClient({ baseUrl, apiKey, fetchImpl: workspaceFetch });

const ownerRequest = (method: string, path: string, body?: unknown) => app.request(`${baseUrl}${path}`, {
  method,
  headers: { host: workspaceHost, authorization: `Bearer ${ownerToken}`, ...(body === undefined ? {} : { 'content-type': 'application/json' }) },
  ...(body === undefined ? {} : { body: JSON.stringify(body) }),
});

const issueKey = async (name: string, scopes: string[]) => {
  const response = await ownerRequest(API_ROUTES.apiKeysShopManagementCreate.method, API_ROUTES.apiKeysShopManagementCreate.path, { name, scopes, expiresAt });
  expect(response.status).toBe(200);
  return envelope(apiKeysShopManagementCreateOutputSchema).parse(await response.json()).data;
};

const outboxRows = async () => (await database.db.select().from(emailOutbox)).filter((row) => row.tenantId === 'acme');

beforeAll(async () => {
  database = await createTestDatabase(
    'together_shop_machine_replay_test',
    process.env['DATABASE_URL'] ?? 'postgres://together:together@localhost:48912/postgres',
  );
  deps = createDeps(envSchema.parse({
    NODE_ENV: 'test', DATABASE_URL: database.url, REALTIME_TRANSPORT: 'in-process',
    APP_BASE_URL: baseUrl, APP_BASE_DOMAIN: 'localhost',
    BETTER_AUTH_SECRET: 'shop-machine-replay-test-secret-at-least-32-characters',
  }), { db: database.db, clock: { nowIso: () => now } });
  app = buildApp({
    ...deps,
    dispatchEmail: () => undefined,
    payment: {
      ...deps.payment,
      createCheckoutSession: async (input) => {
        const created = await deps.payment.createCheckoutSession(input);
        if (created.ok) checkouts.push({ input, sessionId: created.value.sessionId });
        return created;
      },
    },
    storage: {
      ...deps.storage,
      probe: async () => ok({ code: 'storage.available', message: 'Storage is available.' }),
      head: async ({ url }) => ok({ sizeBytes: objects.get(url)?.byteLength ?? 0 }),
      getObject: async ({ url }) => {
        const bytes = objects.get(url);
        return bytes === undefined ? err(notFound('missing')) : ok(new Uint8Array(bytes));
      },
      putObject: async ({ url, body }) => {
        objects.set(url, new Uint8Array(body));
        return ok(undefined);
      },
      delete: async ({ url }) => {
        objects.delete(url);
        return ok({ deleted: true as const });
      },
    },
  });

  const signup = await app.request(`${baseUrl}${BETTER_AUTH_SIGN_UP_PATH}`, {
    method: 'POST', headers: { 'content-type': 'application/json', origin: baseUrl },
    body: JSON.stringify({ name: 'Shop Replay Owner', email, password }),
  });
  expect(signup.status).toBe(200);
  const ownerId = z.object({ user: z.object({ id: z.string() }) }).parse(await signup.json()).user.id;
  await database.db.execute(`update "user" set email_verified = true where id = '${ownerId}'`);
  await database.db.insert(tenants).values({ id: 'acme', slug: 'acme', name: 'Acme', createdAt: now });
  await database.db.insert(tenantAdmins).values({ id: 'grant-acme', tenantId: 'acme', userId: ownerId, role: 'owner' });
  const signin = await app.request(`${baseUrl}${BETTER_AUTH_PASSWORD_SIGN_IN_PATH}`, {
    method: 'POST', headers: { 'content-type': 'application/json', origin: baseUrl },
    body: JSON.stringify({ email, password }),
  });
  expect(signin.status).toBe(200);
  ownerToken = z.object({ token: z.string() }).parse(await signin.json()).token;
}, 120_000);

afterAll(async () => { await database?.close(); });

describe('shop management key replay on a clean workspace', () => {
  it('provisions, sells, settles once, ships and revokes with three separately scoped keys', async () => {
    const provisioningKey = await issueKey('Provisioning', ['shop:settings:read', 'shop:settings:write', 'shop:integrations:read', 'shop:integrations:write']);
    const catalogKey = await issueKey('Catalog', ['shop:catalog:read', 'shop:catalog:write']);
    const warehouseKey = await issueKey('Warehouse', ['shop:orders:read', 'shop:fulfilment:write']);
    expect((await database.db.select().from(shopManagementKeys)).map((key) => key.id).toSorted())
      .toEqual([provisioningKey, catalogKey, warehouseKey].map((key) => key.apiKey.id).toSorted());
    expect(await database.db.select().from(tenantApiKeys)).toEqual([]);
    const provisioning = shopClient(provisioningKey.secret);
    const catalog = shopClient(catalogKey.secret);
    const warehouse = shopClient(warehouseKey.secret);

    const settings = unwrapped(await provisioning.updateSettings({
      termsUrl: 'https://brand.example.test/terms',
      privacyUrl: 'https://brand.example.test/privacy',
      supportEmail: 'support@example.test',
      invoiceSellerName: 'Example Press Ltd',
      invoiceSellerAddress: 'Garden Street 5, 00-950 Warsaw',
      shippingRates: [courier],
    })).settings;
    expect(settings).toMatchObject({ invoiceSellerName: 'Example Press Ltd', shippingRates: [courier] });
    expect(unwrapped(await provisioning.configureStripe({ mode: 'test', restrictedKey: 'rk_test_replay_fixture' })))
      .toEqual({ mode: 'test', webhookUrl: 'http://acme.localhost:48730/api/webhooks/stripe/acme?mode=test' });
    expect(unwrapped(await provisioning.configureStripe({ mode: 'live', restrictedKey: 'rk_live_replay_fixture' })))
      .toEqual({ mode: 'live', webhookUrl: 'http://acme.localhost:48730/api/webhooks/stripe/acme' });
    unwrapped(await provisioning.configureStorage(storage));
    expect(unwrapped(await provisioning.configureShipx({ environment: 'sandbox', sender, organizationId: '12345', token: 'shipx-token-abcd' })))
      .toMatchObject({ environment: 'sandbox', configured: true });
    const masked = JSON.stringify(unwrapped(await provisioning.listIntegrationSecrets()));
    for (const secret of ['rk_test_replay_fixture', 'rk_live_replay_fixture', 'secret-access-key', 'shipx-token-abcd']) expect(masked).not.toContain(secret);
    expect(await provisioning.listProducts()).toMatchObject({ ok: false, error: { code: 'forbidden' } });

    const draft = unwrapped(await catalog.createProduct({
      title: 'Printed handbook', slug: 'printed-handbook', type: 'physical', priceCents: 4900, currency: 'PLN',
      deliveryMethod: 'shipping', vatRate: 5,
    })).product;
    const cover = unwrapped(await catalog.uploadProductCover({
      kind: 'product-cover', fileName: 'cover.png', contentType: 'image/png', sizeBytes: png.byteLength, body: png,
    }));
    unwrapped(await catalog.updateProduct({ id: draft.id, coverUrl: cover.url }));
    const price = unwrapped(await catalog.createProductPrice({ productId: draft.id, kind: 'one_time', amountCents: 4900, currency: 'PLN' })).price;
    unwrapped(await catalog.enableProductStock({ productId: draft.id, onHand: 20, lowStockThreshold: null }));
    expect(unwrapped(await catalog.publishProduct({ id: draft.id })).product).toMatchObject({ published: true, coverUrl: cover.url });
    expect(await catalog.listOrders()).toMatchObject({ ok: false, error: { code: 'forbidden' } });

    const browserPreflight = await app.request(`${baseUrl}${SHOP_CATALOG_ROUTES.listProducts.path}`, {
      method: 'OPTIONS',
      headers: { host: workspaceHost, origin: storefrontOrigin, 'access-control-request-method': 'GET', 'access-control-request-headers': 'x-api-key' },
    });
    expect(browserPreflight.headers.get('access-control-allow-origin')).toBeNull();
    const browserRead = await app.request(`${baseUrl}${SHOP_CATALOG_ROUTES.listProducts.path}`, {
      headers: { host: workspaceHost, origin: storefrontOrigin, 'x-api-key': catalogKey.secret },
    });
    expect(browserRead.headers.get('access-control-allow-origin')).toBeNull();

    const offerResponse = await app.request(`${baseUrl}${API_PATHS.publicOffer}`, { headers: { host: workspaceHost, origin: storefrontOrigin } });
    expect(offerResponse.status).toBe(200);
    expect(offerResponse.headers.get('access-control-allow-origin')).toBe('*');
    const offered = envelope(publicOfferOutputSchema).parse(await offerResponse.json()).data.products.find((entry) => entry.id === draft.id);
    expect(offered).toMatchObject({ title: 'Printed handbook', prices: [expect.objectContaining({ id: price.id, amountCents: 4900 })] });

    const preflight = await app.request(`${baseUrl}${API_PATHS.checkoutSession}`, {
      method: 'OPTIONS',
      headers: { host: workspaceHost, origin: storefrontOrigin, 'access-control-request-method': 'POST', 'access-control-request-headers': 'content-type' },
    });
    expect(preflight.status).toBe(204);
    expect(preflight.headers.get('access-control-allow-origin')).toBe('*');
    const handoff = await app.request(`${baseUrl}${API_PATHS.checkoutSession}`, {
      method: 'POST',
      headers: { host: workspaceHost, origin: storefrontOrigin, 'content-type': 'application/json' },
      body: JSON.stringify({ productId: draft.id, priceId: price.id, email: buyerEmail, termsAccepted: true, language: 'en', shipping: { rateId: 'courier' } }),
    });
    expect(handoff.status).toBe(200);
    expect(handoff.headers.get('access-control-allow-origin')).toBe('*');
    const { url: hostedUrl } = envelope(checkoutSessionOutputSchema).parse(await handoff.json()).data;
    expect(checkouts).toHaveLength(1);
    const [checkout] = checkouts;
    if (checkout === undefined) throw new Error('No checkout session was created');
    expect(hostedUrl).toContain(checkout.sessionId);
    expect(checkout.input).toMatchObject({
      mode: 'live', productId: draft.id, priceId: price.id, priceCents: 4900, currency: 'PLN',
      successUrl: expect.stringMatching(/^http:\/\/acme\.localhost:48730\/checkout\/[^?]+\?status=success/u),
      shipping: { option: { label: 'Courier', amountCents: 1500 } },
    });
    expect(unwrapped(await catalog.getProductStock(draft.id)).stock).toMatchObject({ onHand: 20, reserved: 1 });

    const payload = JSON.stringify({
      id: 'evt_replay_paid', type: 'checkout.session.completed', livemode: true, created: Math.floor(Date.parse(now) / 1000),
      data: { object: {
        id: checkout.sessionId, payment_status: 'paid', amount_total: 6400, payment_intent: 'pi_replay_paid',
        customer_details: { email: buyerEmail, phone: '+48500000000' },
        collected_information: { shipping_details: { name: 'Jane Buyer', address: { line1: 'Garden Street 5', line2: null, postal_code: '00-950', city: 'Warsaw', state: null, country: 'PL' } } },
        shipping_cost: { amount_total: 1500 },
        metadata: {
          tenantId: 'acme', productId: draft.id, priceId: price.id, memberEmail: buyerEmail, language: 'en',
          checkoutSnapshotId: checkout.input.checkoutSnapshotId ?? '', checkoutConsentCaptureId: checkout.input.checkoutConsentCaptureId ?? '',
        },
      } },
    });
    const webhookSecret = unwrapped(await deps.secretResolver.resolve('acme', 'stripe.webhookSecret'));
    const timestamp = Math.floor(Date.parse(now) / 1000);
    const signature = `t=${String(timestamp)},v1=${createHmac('sha256', webhookSecret).update(`${String(timestamp)}.${payload}`).digest('hex')}`;
    const deliver = () => app.request(`${baseUrl}${API_PATHS.stripeWebhook.replace(':tenantId', 'acme')}`, {
      method: 'POST', headers: { host: workspaceHost, 'stripe-signature': signature, 'content-type': 'application/json' }, body: payload,
    });

    const forged = await app.request(`${baseUrl}${API_PATHS.stripeWebhook.replace(':tenantId', 'acme')}`, {
      method: 'POST', headers: { host: workspaceHost, 'stripe-signature': `t=${String(timestamp)},v1=${'0'.repeat(64)}`, 'content-type': 'application/json' }, body: payload,
    });
    expect(forged.status).toBe(400);
    expect((await database.db.select().from(orders)).filter((row) => row.tenantId === 'acme')).toEqual([]);

    const first = await deliver();
    expect(first.status).toBe(200);
    expect(await first.json()).toEqual({ ok: true, data: { received: true, processed: true } });
    const settled = unwrapped(await catalog.getProductStock(draft.id)).stock;
    expect(settled).toMatchObject({ onHand: 19, reserved: 0 });

    const replay = await deliver();
    expect(replay.status).toBe(200);
    expect(await replay.json()).toEqual({ ok: true, data: { received: true, processed: false } });
    const paidOrders = (await database.db.select().from(orders)).filter((row) => row.tenantId === 'acme');
    expect(paidOrders).toHaveLength(1);
    expect(paidOrders[0]).toMatchObject({ status: 'paid', mode: 'live', amountCents: 6400 });
    expect(unwrapped(await catalog.getProductStock(draft.id)).stock).toEqual(settled);

    const toPack = unwrapped(await warehouse.listOrders({ mode: 'live', fulfilmentStatus: 'to_pack', pageSize: 100 }));
    expect(toPack.total).toBe(1);
    const [order] = toPack.orders;
    if (order === undefined) throw new Error('The paid order is missing from the to-pack list');
    expect(order).toMatchObject({ id: paidOrders[0]?.id, mode: 'live', status: 'paid', fulfilmentStatus: 'to_pack', shipping: { rateId: 'courier', address: { city: 'Warsaw', country: 'PL' } } });
    expect(order.lines?.find((line) => line.productType === 'physical')).toMatchObject({ quantity: 1, issuedCount: 0 });
    const shipped = unwrapped(await warehouse.shipOrder({ orderId: order.id, carrier: 'other', trackingNumber: 'TRACK0001' })).order;
    expect(shipped).toMatchObject({ fulfilmentStatus: 'shipped', shipment: { carrier: 'other', trackingNumber: 'TRACK0001' } });
    expect(await warehouse.shipOrder({ orderId: order.id, carrier: 'other', trackingNumber: 'TRACK0002' }))
      .toMatchObject({ ok: false, error: { code: 'fulfilment_conflict' } });
    expect(unwrapped(await warehouse.listOrders({ mode: 'live', fulfilmentStatus: 'to_pack' })).total).toBe(0);

    const mail = await outboxRows();
    const purchase = mail.filter((row) => row.kind === 'welcome-sign-in' && row.to === buyerEmail);
    expect(purchase).toHaveLength(1);
    expect(purchase[0]?.payload).toMatchObject({ purchase: { orderNumber: order.id, totalCents: 6400, currency: 'PLN' } });
    const tracking = mail.filter((row) => row.kind === 'order-shipped' && row.to === buyerEmail);
    expect(tracking).toHaveLength(1);
    expect(tracking[0]?.payload).toMatchObject({ shipment: { orderNumber: order.id, carrier: 'other', trackingNumber: 'TRACK0001' } });

    const revoked = await ownerRequest(API_ROUTES.apiKeysShopManagementRevoke.method, API_PATHS.apiKeysShopManagementRevoke.replace(':id', warehouseKey.apiKey.id));
    expect(revoked.status).toBe(200);
    expect(await warehouse.listOrders({ mode: 'live' })).toEqual({ ok: false, error: { code: 'unauthorized', message: 'Invalid API key' } });
    expect(unwrapped(await catalog.getProductStock(draft.id)).stock).toEqual(settled);

    const history = await database.db.select().from(shopManagementKeyEvents);
    const requestsOf = (apiKeyId: string) => history
      .filter((event) => event.apiKeyId === apiKeyId && event.kind === 'request')
      .map(({ route, resourceId }) => `${route ?? ''} ${resourceId ?? '-'}`)
      .toSorted();
    expect(requestsOf(warehouseKey.apiKey.id)).toEqual([
      `${SHOP_ORDER_ROUTES.shipOrder.path} ${order.id}`,
      `${SHOP_ORDER_ROUTES.shipOrder.path} ${order.id}`,
    ]);
    expect(requestsOf(provisioningKey.apiKey.id)).toEqual([
      `${SHOP_INTEGRATION_ROUTES.shipxConfigure.path} -`,
      `${SHOP_INTEGRATION_ROUTES.storageConfigure.path} -`,
      `${SHOP_INTEGRATION_ROUTES.stripeConfigure.path} -`,
      `${SHOP_INTEGRATION_ROUTES.stripeConfigure.path} -`,
      `${SHOP_SETTINGS_ROUTES.updateSettings.path} -`,
    ]);
    const recorded = JSON.stringify(history.map(({ route, resourceId }) => ({ route, resourceId })));
    for (const secret of ['rk_test_replay_fixture', 'rk_live_replay_fixture', 'access-key-id', 'secret-access-key', '12345', 'shipx-token-abcd']) {
      expect(recorded).not.toContain(secret);
    }
  });
});
