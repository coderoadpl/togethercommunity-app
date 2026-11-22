import { createHmac } from 'node:crypto';

import { eq } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { z } from 'zod';

import { BETTER_AUTH_PASSWORD_SIGN_IN_PATH, BETTER_AUTH_SIGN_UP_PATH } from '#adapters/auth/create-auth.js';
import {
  checkoutConsentCaptures, consents, emailOutbox, orderRefundJobs, orders, processedPaymentEvents, productGrants, products, productStock, stockEvents, tenantAdmins, tenants,
} from '#adapters/db/schema.js';
import { createTestDatabase } from '#adapters/db/test-database-name.js';
import oldApiLockerFree from '#adapters/payment/fixtures/checkout-completed-2020-03-02-locker-free.json' with { type: 'json' };
import { createStripePaymentProvider, stripeCheckoutSessionParams } from '#adapters/payment/stripe.js';
import { createShopManagementClient, isProposedChange, type ShopManagementClient } from '#core/client/index.js';
import { API_PATHS, API_ROUTES, apiKeysShopManagementCreateOutputSchema, type ChangeProposalProposedOutput } from '#core/contract/index.js';
import { ok, type AppError, type Result } from '#core/domain/index.js';

import { buildApp } from '../apps/server/src/app.js';
import { createDeps } from '../apps/server/src/composition.js';
import { envSchema } from '../apps/server/src/env.js';

const baseUrl = 'http://localhost:48730';
const workspaceHost = 'acme.localhost:48730';
const email = 'old-api-owner@example.test';
const password = 'old-api-owner-password-15';
const buyerEmail = 'test.buyer@example.com';
const checkoutAt = '2026-11-15T10:00:00.000Z';
const expiresAt = '2026-11-22T00:00:00.000Z';
const termsUrl = 'https://acme.togethercommunity.app/terms';
const privacyUrl = 'https://acme.togethercommunity.app/privacy';
const locker = { id: 'locker', label: 'Parcel locker', amountCents: 0, vatRatePercent: 23, carrier: 'inpost', pickupPoint: 'inpost_locker', active: true } as const;

let database: Awaited<ReturnType<typeof createTestDatabase>>;
let deps: ReturnType<typeof createDeps>;
let app: ReturnType<typeof buildApp>;
let ownerToken: string;
let clockNow = checkoutAt;
type CheckoutInput = Parameters<ReturnType<typeof createDeps>['payment']['createCheckoutSession']>[0];
const checkouts: { input: CheckoutInput; sessionId: string }[] = [];

const envelope = <S extends z.ZodTypeAny>(schema: S) => z.object({ ok: z.literal(true), data: schema });

const unwrapped = <T>(result: Result<T, AppError>): T => {
  if (!result.ok) throw new Error(`${result.error.code}: ${result.error.message}`);
  return result.value;
};

const appliedChange = <A extends object>(result: Result<ChangeProposalProposedOutput | ({ outcome: 'applied' } & A), AppError>): A => {
  const value = unwrapped(result);
  if (isProposedChange(value)) throw new Error(`Expected a live change, got proposal ${value.proposal.id}`);
  return value;
};

const workspaceFetch: typeof fetch = async (input, init) => {
  const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;
  const headers = new Headers(init?.headers);
  headers.set('host', workspaceHost);
  return app.request(url, { ...init, headers });
};

const shopClient = (apiKey: string): ShopManagementClient => createShopManagementClient({ baseUrl, apiKey, fetchImpl: workspaceFetch });

const issueKey = async (name: string, scopes: string[]) => {
  const response = await app.request(`${baseUrl}${API_ROUTES.apiKeysShopManagementCreate.path}`, {
    method: API_ROUTES.apiKeysShopManagementCreate.method,
    headers: { host: workspaceHost, authorization: `Bearer ${ownerToken}`, 'content-type': 'application/json' },
    body: JSON.stringify({ name, scopes, expiresAt }),
  });
  expect(response.status).toBe(200);
  return envelope(apiKeysShopManagementCreateOutputSchema).parse(await response.json()).data.secret;
};

const stripeSignature = (payload: string, secret: string): string => {
  const timestamp = String(Math.floor(Date.now() / 1000));
  return `t=${timestamp},v1=${createHmac('sha256', secret).update(`${timestamp}.${payload}`).digest('hex')}`;
};

const tenantRows = async () => ({
  orders: await database.db.select({
    status: orders.status, mode: orders.mode, amountCents: orders.amountCents, cancelReason: orders.cancelReason, fulfilmentStatus: orders.fulfilmentStatus, shipping: orders.shipping,
  }).from(orders).where(eq(orders.tenantId, 'acme')),
  levels: await database.db.select({ onHand: productStock.onHand, reserved: productStock.reserved }).from(productStock).where(eq(productStock.tenantId, 'acme')),
  stockEvents: (await database.db.select({ type: stockEvents.type, occurredAt: stockEvents.occurredAt }).from(stockEvents).where(eq(stockEvents.tenantId, 'acme')))
    .map((row) => `${row.occurredAt} ${row.type}`).toSorted(),
  grants: (await database.db.select({ productId: productGrants.productId, mode: productGrants.mode }).from(productGrants).where(eq(productGrants.tenantId, 'acme')))
    .toSorted((a, b) => a.productId.localeCompare(b.productId)),
  emails: (await database.db.select({ kind: emailOutbox.kind, to: emailOutbox.to }).from(emailOutbox).where(eq(emailOutbox.tenantId, 'acme')))
    .toSorted((a, b) => `${a.kind}${a.to}`.localeCompare(`${b.kind}${b.to}`)),
  refundJobs: await database.db.select({ orderId: orderRefundJobs.orderId }).from(orderRefundJobs).where(eq(orderRefundJobs.tenantId, 'acme')),
  consents: await database.db.select({ email: consents.email, source: consents.source, termsUrl: consents.termsUrl, privacyUrl: consents.privacyUrl })
    .from(consents).where(eq(consents.tenantId, 'acme')),
  processedEvents: await database.db.select({ id: processedPaymentEvents.id, status: processedPaymentEvents.status })
    .from(processedPaymentEvents).where(eq(processedPaymentEvents.tenantId, 'acme')),
});

beforeAll(async () => {
  database = await createTestDatabase(
    'together_stripe_webhook_old_api_test',
    process.env['DATABASE_URL'] ?? 'postgres://together:together@localhost:48912/postgres',
  );
  deps = createDeps(envSchema.parse({
    NODE_ENV: 'test', DATABASE_URL: database.url, REALTIME_TRANSPORT: 'in-process',
    APP_BASE_URL: baseUrl, APP_BASE_DOMAIN: 'localhost',
    BETTER_AUTH_SECRET: 'stripe-webhook-old-api-test-secret-at-least-32-characters',
  }), { db: database.db, clock: { nowIso: () => clockNow } });
  const stripe = createStripePaymentProvider({ resolver: deps.secretResolver });
  app = buildApp({
    ...deps,
    dispatchEmail: () => undefined,
    payment: {
      ...deps.payment,
      verifyWebhookEvent: stripe.verifyWebhookEvent,
      createCheckoutSession: async (input) => {
        const created = await deps.payment.createCheckoutSession(input);
        if (created.ok) checkouts.push({ input, sessionId: created.value.sessionId });
        return created;
      },
    },
  });

  const signup = await app.request(`${baseUrl}${BETTER_AUTH_SIGN_UP_PATH}`, {
    method: 'POST', headers: { 'content-type': 'application/json', origin: baseUrl },
    body: JSON.stringify({ name: 'Old Api Owner', email, password }),
  });
  expect(signup.status).toBe(200);
  const ownerId = z.object({ user: z.object({ id: z.string() }) }).parse(await signup.json()).user.id;
  await database.db.execute(`update "user" set email_verified = true where id = '${ownerId}'`);
  await database.db.insert(tenants).values({ id: 'acme', slug: 'acme', name: 'Acme', createdAt: checkoutAt });
  await database.db.insert(tenantAdmins).values({ id: 'grant-acme', tenantId: 'acme', userId: ownerId, role: 'owner' });
  const signin = await app.request(`${baseUrl}${BETTER_AUTH_PASSWORD_SIGN_IN_PATH}`, {
    method: 'POST', headers: { 'content-type': 'application/json', origin: baseUrl },
    body: JSON.stringify({ email, password }),
  });
  expect(signin.status).toBe(200);
  ownerToken = z.object({ token: z.string() }).parse(await signin.json()).token;
}, 120_000);

afterAll(async () => { await database?.close(); });

describe('a live sales-link bundle paid under the 2020-03-02 webhook API version', () => {
  it('records one paid locker order after the stock hold expired and ignores the redelivered payload', async () => {
    const provisioning = shopClient(await issueKey('Provisioning', ['shop:settings:read', 'shop:settings:write', 'shop:integrations:read', 'shop:integrations:write']));
    const catalog = shopClient(await issueKey('Catalog', ['shop:catalog:read', 'shop:catalog:write']));
    appliedChange(await provisioning.updateSettings({ termsUrl, privacyUrl, supportEmail: 'support@example.test', shippingRates: [locker] }));
    unwrapped(await provisioning.configureStripe({ mode: 'live', restrictedKey: 'rk_live_old_api_fixture' }));

    const course = appliedChange(await catalog.createProduct({ title: 'Course One', slug: 'course-one', type: 'course', priceCents: 4900, currency: 'PLN', vatRate: 23 })).product;
    appliedChange(await catalog.createProductPrice({ productId: course.id, kind: 'one_time', amountCents: 4900, currency: 'PLN' }));
    await database.db.update(products).set({ published: true }).where(eq(products.id, course.id));
    const book = appliedChange(await catalog.createProduct({
      title: 'Printed book', slug: 'printed-book', type: 'physical', priceCents: 3900, currency: 'PLN', deliveryMethod: 'shipping', vatRate: 5,
    })).product;
    appliedChange(await catalog.createProductPrice({ productId: book.id, kind: 'one_time', amountCents: 3900, currency: 'PLN' }));
    appliedChange(await catalog.enableProductStock({ productId: book.id, onHand: 49, lowStockThreshold: null }));
    appliedChange(await catalog.publishProduct({ id: book.id }));
    const link = appliedChange(await catalog.createSalesLink({ slug: 'book-bundle', title: 'Book bundle', heading: 'Book bundle', productIds: [course.id, book.id], active: true })).salesLink;

    const handoff = await app.request(`${baseUrl}${API_PATHS.checkoutSession}`, {
      method: 'POST',
      headers: { host: workspaceHost, 'content-type': 'application/json' },
      body: JSON.stringify({
        productId: course.id, salesLinkId: link.id, email: buyerEmail, termsAccepted: true, language: 'en',
        shipping: { rateId: 'locker', pickupPoint: { provider: 'inpost', code: 'waw01m' } },
      }),
    });
    expect(await handoff.json()).toStrictEqual({ ok: true, data: expect.objectContaining({ url: expect.any(String) }) });
    expect(handoff.status).toBe(200);
    const [checkout] = checkouts;
    if (checkout === undefined) throw new Error('No checkout session was created');
    expect(checkout.input).toMatchObject({ mode: 'live', salesLinkId: link.id, stripeTerms: { termsUrl, privacyUrl }, shipping: { option: { amountCents: 0 } } });
    expect((await tenantRows()).levels).toStrictEqual([{ onHand: 49, reserved: 1 }]);

    clockNow = '2026-11-15T10:40:00.000Z';
    expect(await deps.releaseExpiredStockReservations()).toStrictEqual(ok({ released: 1 }));
    expect((await tenantRows()).levels).toStrictEqual([{ onHand: 49, reserved: 0 }]);
    clockNow = '2026-11-15T10:42:00.000Z';

    const params = stripeCheckoutSessionParams(checkout.input);
    expect(params.metadata).toMatchObject({ stripeTerms: 'true', termsUrl, privacyUrl, salesLinkId: link.id, productIds: JSON.stringify([course.id, book.id]) });
    const payload = JSON.stringify({
      ...oldApiLockerFree,
      id: 'evt_old_api_bundle',
      data: { object: {
        ...oldApiLockerFree.data.object,
        id: checkout.sessionId, payment_intent: 'pi_old_api_bundle', customer_email: buyerEmail,
        customer_details: { ...oldApiLockerFree.data.object.customer_details, email: buyerEmail },
        success_url: params.success_url, cancel_url: params.cancel_url, metadata: params.metadata,
      } },
    });
    const webhookSecret = unwrapped(await deps.secretResolver.resolve('acme', 'stripe.webhookSecret'));
    const deliver = () => app.request(`${baseUrl}${API_PATHS.stripeWebhook.replace(':tenantId', 'acme')}`, {
      method: 'POST', headers: { host: workspaceHost, 'stripe-signature': stripeSignature(payload, webhookSecret), 'content-type': 'application/json' }, body: payload,
    });

    const first = await deliver();
    expect(await first.json()).toStrictEqual({ ok: true, data: { received: true, processed: true } });
    expect(first.status).toBe(200);

    const settled = await tenantRows();
    expect(settled).toStrictEqual({
      orders: [{
        status: 'paid', mode: 'live', amountCents: 8800, cancelReason: null, fulfilmentStatus: 'to_pack',
        shipping: {
          rateId: 'locker', label: 'Parcel locker', amountCents: 0, vatRatePercent: 23, carrier: 'inpost', phone: '+48500100200',
          address: { name: 'Test Buyer', line1: 'Garden Street 5', line2: null, postalCode: '00-950', city: 'Warsaw', country: 'PL' },
          pickupPoint: { provider: 'inpost', code: 'WAW01M', name: null, address: null },
        },
      }],
      levels: [{ onHand: 48, reserved: 0 }],
      stockEvents: [
        '2026-11-15 10:00:00+00 reserved', '2026-11-15 10:00:00+00 tracking_enabled', '2026-11-15 10:40:00+00 released', '2026-11-15 10:42:00+00 committed_late',
      ],
      grants: [{ productId: course.id, mode: 'live' }],
      emails: [{ kind: 'welcome-sign-in', to: buyerEmail }],
      refundJobs: [],
      consents: [{ email: buyerEmail, source: 'checkout', termsUrl, privacyUrl }],
      processedEvents: [{ id: 'evt_old_api_bundle', status: 'processed' }],
    });
    expect(await database.db.select({ capture: checkoutConsentCaptures.capture }).from(checkoutConsentCaptures)
      .where(eq(checkoutConsentCaptures.id, `stripe:${checkout.sessionId}`))).toStrictEqual([
      { capture: expect.objectContaining({ termsAccepted: true, termsUrl, privacyUrl }) },
    ]);
    expect(await database.db.select({ payload: emailOutbox.payload }).from(emailOutbox).where(eq(emailOutbox.kind, 'welcome-sign-in')))
      .toStrictEqual([{ payload: expect.objectContaining({ purchase: expect.objectContaining({ totalCents: 8800, currency: 'PLN' }) }) }]);

    const replay = await deliver();
    expect(await replay.json()).toStrictEqual({ ok: true, data: { received: true, processed: false } });
    expect(replay.status).toBe(200);
    expect(await tenantRows()).toStrictEqual(settled);
  });
});
