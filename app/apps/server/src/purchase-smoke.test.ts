import { randomUUID } from 'node:crypto';

import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

import { runSmokeTenantReseed } from '#adapters/db/smoke-tenant-reseed.js';
import { createTestDatabase } from '#adapters/db/test-database-name.js';
import { shopManagementKeys, shopManagementKeyEvents } from '#adapters/db/schema.js';
import { API_PATHS, PURCHASE_SMOKE_ROUTES } from '#core/contract/index.js';
import { ok, purchaseSmokeCheckoutSchema, purchaseSmokeScenarioSchema, SMOKE_TENANT_ID, SMOKE_TENANT_MEMBER_EMAIL, type PurchaseSmokeCheckout, type ShopManagementKey, type TenantSecretKey } from '#core/domain/index.js';
import { authenticateShopManagementKey, createShopManagementKey, fulfillStripeWebhook, getPurchaseSmokeResult, shopManagementKeyHash, startPurchaseSmokeCheckout, type StripeWebhookDeps } from '#core/server/index.js';
import type { PaymentWebhookEvent } from '#core/server/ports.js';
import type { PurchaseSmokeDeps } from '#core/server/usecases/purchase-smoke.js';

import { buildApp } from './app.js';
import { createDeps } from './composition.js';
import { envSchema } from './env.js';
import { purchaseSmokeRoutes } from './purchase-smoke-routes.js';
import { shopCatalogRoutes } from './shop-catalog-routes.js';
import { shopOrderRoutes } from './shop-order-routes.js';
import { shopSettingsRoutes } from './shop-settings-routes.js';
import { shopAssetsRoutes } from './shop-assets-routes.js';
import { shopDownloadRoutes } from './shop-download-routes.js';
import { shopIntegrationRoutes } from './shop-integration-routes.js';
import { shopProposalRoutes } from './shop-proposal-routes.js';
import { requestOriginPolicy } from './request-origin-policy.js';
import { selfAuthenticatingRouteManifestEntry } from './self-authenticating-route-manifest.js';
import { purchaseSmokeRouteAllowed } from './shop-machine-auth.js';

const NOW = '2026-11-20T12:00:00.000Z';
const EXPIRES = '2026-11-27T12:00:00.000Z';
const SECRET = 'purchase-smoke-test-secret';
const baseUrl = 'http://localhost:48730';
let database: Awaited<ReturnType<typeof createTestDatabase>>;
let deps: ReturnType<typeof createDeps>;
let key: ShopManagementKey;
let sequence = 0;
const paymentCreate = vi.fn(async () => ok({ sessionId: `cs_test_${++sequence}`, url: `https://checkout.stripe.com/test-${sequence}` }));

const smokeDeps = (): PurchaseSmokeDeps => ({ ...deps, fixtureBaseUrl: 'http://acme.localhost:48730' });
const seed = (purchaseFixtures = true) => runSmokeTenantReseed(database.db, {
  passwords: { member: 'synthetic-member-test-password', creator: 'synthetic-creator-test-password' },
  purchaseFixtures, nowIso: () => NOW,
});
const createKey = async (id: string, secret = SECRET): Promise<ShopManagementKey> => {
  const [owner] = await database.db.query.tenantAdmins.findMany({ where: (table, { eq }) => eq(table.tenantId, SMOKE_TENANT_ID) });
  if (owner === undefined) throw new Error('Fixture owner missing');
  const row: ShopManagementKey = {
    id, tenantId: SMOKE_TENANT_ID, name: 'Synthetic checkout automation', purpose: 'purchase-smoke', scopes: [], mode: 'direct',
    keyHash: shopManagementKeyHash(deps.apiKeyCrypto, secret, 'purchase-smoke'), issuedByUserId: owner.userId,
    createdAt: NOW, expiresAt: EXPIRES, revokedAt: null,
  };
  await deps.shopManagementKeys.create(SMOKE_TENANT_ID, row, {
    id: randomUUID(), tenantId: SMOKE_TENANT_ID, apiKeyId: row.id, kind: 'created', actorUserId: owner.userId,
    method: null, route: null, resourceId: null, at: NOW,
  });
  return row;
};
const setSecret = (name: TenantSecretKey, value: string) => deps.tenantSecrets.upsert(SMOKE_TENANT_ID, {
  id: randomUUID(), tenantId: SMOKE_TENANT_ID, key: name, ...deps.secretCrypto.encrypt(value), maskedPreview: 'fixture', updatedAt: NOW,
});
const configuredTestSlot = async () => {
  await setSecret('stripe.testRestrictedKey', 'rk_test_fixture');
  await setSecret('stripe.testWebhookSecret', 'whsec_fixture');
  await setSecret('stripe.testWebhookEndpointId', 'we_fixture');
};
const start = (input: unknown = { runId: 'run-1', scenario: 'digital-course' }, candidate = key) => startPurchaseSmokeCheckout(candidate, input, smokeDeps());
const checkout = async (runId = 'run-1'): Promise<PurchaseSmokeCheckout> => {
  const result = await start({ runId, scenario: 'digital-course' });
  if (!result.ok) throw new Error(JSON.stringify(result.error));
  return result.value;
};

beforeAll(async () => {
  database = await createTestDatabase('together_purchase_smoke', process.env['DATABASE_URL'] ?? 'postgres://together:together@localhost:48912/postgres');
  deps = createDeps(envSchema.parse({
    NODE_ENV: 'test', DATABASE_URL: database.url, REALTIME_TRANSPORT: 'in-process', APP_BASE_URL: baseUrl,
    APP_BASE_DOMAIN: 'localhost', BETTER_AUTH_SECRET: 'purchase-smoke-tests-at-least-32-characters',
  }), { db: database.db, clock: { nowIso: () => NOW } });
  deps.payment.createCheckoutSession = paymentCreate;
}, 120_000);

afterAll(async () => { await deps?.close(); await database?.close(); });
beforeEach(async () => {
  vi.restoreAllMocks();
  await database.db.delete(shopManagementKeys);
  await seed();
  await configuredTestSlot();
  key = await createKey(randomUUID());
  paymentCreate.mockClear();
});

describe('exclusive purchase smoke use cases', () => {
  it.each(purchaseSmokeScenarioSchema.options)('starts only the seeded test scenario %s', async (scenario) => {
    const beforeStock = await database.db.query.productStock.findMany();
    const result = await start({ runId: 'scenarios', scenario });
    expect(result.ok, JSON.stringify(result)).toBe(true);
    expect(paymentCreate).toHaveBeenCalledWith(expect.objectContaining({ tenantId: SMOKE_TENANT_ID, mode: 'test', customerEmail: SMOKE_TENANT_MEMBER_EMAIL }), { restrictedKey: 'rk_test_fixture' });
    const [order] = await database.db.query.orders.findMany({ where: (table, { eq }) => eq(table.tenantId, SMOKE_TENANT_ID) });
    expect(order).toMatchObject({ mode: 'test', memberId: 'member-acme-smoke', status: 'pending', currency: 'PLN',
      amountCents: { 'digital-course': 9900, 'parcel-courier': 4099, 'parcel-locker': 3799, 'bundle-locker': 13699 }[scenario],
    });
    expect(await database.db.query.productStock.findMany()).toEqual(beforeStock);
    expect(await database.db.query.members.findMany({ where: (table, { eq }) => eq(table.tenantId, SMOKE_TENANT_ID) })).toHaveLength(2);
  });

  it.each([
    { scenario: 'arbitrary' }, { mode: 'live' }, { email: 'outsider@example.test' }, { workspace: 'tenant-other' },
    { productId: 'another-product' }, { priceId: 'another-price' }, { amountCents: 1 }, { lockerCode: 'OTHER' },
  ])('refuses caller-controlled checkout configuration %j', async (extra) => {
    expect((await start({ runId: 'bad-input', scenario: 'digital-course', ...extra })).ok).toBe(false);
    expect(paymentCreate).not.toHaveBeenCalled();
  });

  it.each([
    { tenantId: 'tenant-other' }, { purpose: undefined }, { mode: 'propose' as const },
    { scopes: ['shop:catalog:read' as const] }, { expiresAt: NOW }, { revokedAt: NOW },
  ])('refuses a key outside the exclusive purpose %j', async (overrides) => {
    expect((await start(undefined, { ...key, ...overrides })).ok).toBe(false);
    expect(paymentCreate).not.toHaveBeenCalled();
  });

  it('refuses a live slot, missing test slot, and changed fixture before provider writes', async () => {
    await setSecret('stripe.restrictedKey', 'rk_live_fixture');
    expect((await start()).ok).toBe(false);
    await deps.tenantSecrets.delete(SMOKE_TENANT_ID, 'stripe.restrictedKey');
    await deps.tenantSecrets.delete(SMOKE_TENANT_ID, 'stripe.testWebhookSecret');
    expect((await start()).ok).toBe(false);
    await configuredTestSlot();
    await deps.products.setPublished(SMOKE_TENANT_ID, 'product-acme-course', false);
    expect((await start()).ok).toBe(false);
    expect(paymentCreate).not.toHaveBeenCalled();
  });

  it('serializes duplicate checkout requests and enforces a cap including pending sessions', async () => {
    const results = await Promise.all([start(), start(), start()]);
    expect(results.every((result) => result.ok)).toBe(true);
    expect(results[0]).toEqual(results[1]);
    expect(paymentCreate).toHaveBeenCalledTimes(1);
    for (let index = 1; index < 40; index++) await checkout(`run-${index + 1}`);
    expect((await start({ runId: 'over-cap', scenario: 'digital-course' }))).toMatchObject({ ok: false, error: { code: 'rate_limited' } });
    expect(paymentCreate).toHaveBeenCalledTimes(40);
    await seed();
    await configuredTestSlot();
    expect((await start({ runId: 'after-reseed', scenario: 'digital-course' }))).toMatchObject({ ok: false, error: { code: 'rate_limited' } });
  });

  it('binds result reads to the creating key', async () => {
    const created = await checkout();
    const other = await createKey(randomUUID(), 'other-secret');
    expect(await getPurchaseSmokeResult(other, created.reference, deps)).toMatchObject({ ok: false, error: { code: 'not_found' } });
    expect(await getPurchaseSmokeResult(key, created.reference, deps)).toMatchObject({ ok: true, value: { paid: false, refundState: 'none', receipts: [] } });
  });

  it('keeps the normal seed unchanged without fixture enablement', async () => {
    await seed(false);
    expect(await deps.products.findById(SMOKE_TENANT_ID, 'product-acme-purchase-parcel')).toBeNull();
    expect((await deps.tenants.findSettings(SMOKE_TENANT_ID))?.shippingRates ?? []).toHaveLength(0);
  });
});

describe('purchase key issuance, rollback and reseed', () => {
  it('issues only from an owner session and refuses mixed scopes, other workspaces, propose mode and long expiry', async () => {
    const tenant = await deps.tenants.findById(SMOKE_TENANT_ID);
    if (tenant === null) throw new Error('Missing tenant');
    const authenticated = await authenticateShopManagementKey(tenant, SECRET, null, deps);
    if (!authenticated.result.ok) throw new Error('Missing key authentication');
    const owner = { identity: authenticated.result.value.ctx.identity };
    const input = { name: 'Purchase key', purpose: 'purchase-smoke' as const, scopes: [], mode: 'direct' as const, expiresAt: EXPIRES };
    expect((await createShopManagementKey(owner, input, deps)).ok).toBe(true);
    expect((await createShopManagementKey(authenticated.result.value.ctx, input, deps)).ok).toBe(false);
    expect((await createShopManagementKey(owner, { ...input, scopes: ['shop:orders:read'] }, deps)).ok).toBe(false);
    expect((await createShopManagementKey(owner, { ...input, mode: 'propose' }, deps)).ok).toBe(false);
    expect((await createShopManagementKey({ identity: { ...owner.identity, tenantId: 'other' } }, input, deps)).ok).toBe(false);
    expect((await createShopManagementKey(owner, { ...input, expiresAt: '2027-11-20T12:00:00.000Z' }, deps)).ok).toBe(false);
  });

  it('stores previous-release fields valid and permanently expired, under its own hash domain', async () => {
    const [raw] = await database.db.query.shopManagementKeys.findMany({ where: (table, { eq }) => eq(table.id, key.id) });
    expect(raw).toMatchObject({ scopes: ['shop:catalog:read'], mode: 'direct', expiresAt: '1970-01-01T00:00:00.000Z', purposeExpiresAt: EXPIRES });
    expect(Date.parse(raw?.expiresAt ?? '')).toBeLessThan(Date.parse(NOW));
    expect(raw?.keyHash).toBe(deps.apiKeyCrypto.hash(`together:shop-management-key:purchase-smoke:${SECRET}`));
    expect(await deps.shopManagementKeys.findByHash(SMOKE_TENANT_ID, deps.apiKeyCrypto.hash(SECRET))).toBeNull();
  });

  it('restores a key history larger than the PostgreSQL parameter limit in bounded batches', async () => {
    for (let offset = 0; offset < 9000; offset += 500) {
      await database.db.insert(shopManagementKeyEvents).values(Array.from({ length: 500 }, (_, index) => ({
        id: `history-${offset + index}`, tenantId: SMOKE_TENANT_ID, apiKeyId: key.id, kind: 'request' as const, actorUserId: key.issuedByUserId,
        method: 'POST' as const, route: PURCHASE_SMOKE_ROUTES.start.path, resourceId: null, at: NOW,
      })));
    }
    const before = await database.db.query.shopManagementKeyEvents.findMany({ orderBy: (table, { asc }) => asc(table.id) });
    expect(before).toHaveLength(9001);
    await seed();
    expect(await database.db.query.shopManagementKeyEvents.findMany({ orderBy: (table, { asc }) => asc(table.id) })).toEqual(before);
    expect(await deps.shopManagementKeys.findByHash(SMOKE_TENANT_ID, key.keyHash)).toEqual(key);
  });

  it('preserves revocation, expiry, audit and rate limits without reviving a key', async () => {
    await deps.shopManagementKeyRateLimits.claim(SMOKE_TENANT_ID, { apiKeyId: key.id, period: 'day', windowStartedAt: NOW, limit: 10 });
    await deps.shopManagementKeys.revoke(SMOKE_TENANT_ID, key.id, NOW, {
      id: randomUUID(), tenantId: SMOKE_TENANT_ID, apiKeyId: key.id, kind: 'revoked', actorUserId: key.issuedByUserId,
      method: null, route: null, resourceId: null, at: NOW,
    }, { at: NOW, actorUserId: key.issuedByUserId, nextEventId: randomUUID });
    const oldKeys = await database.db.query.shopManagementKeys.findMany();
    const oldEvents = await database.db.query.shopManagementKeyEvents.findMany({ where: (table, { eq }) => eq(table.apiKeyId, key.id) });
    const oldLimits = await database.db.query.shopManagementKeyRateLimitBuckets.findMany();
    await seed();
    expect(await database.db.query.shopManagementKeys.findMany()).toEqual(oldKeys);
    expect(await database.db.query.shopManagementKeyEvents.findMany({ where: (table, { eq }) => eq(table.apiKeyId, key.id) })).toEqual(oldEvents);
    expect(await database.db.query.shopManagementKeyRateLimitBuckets.findMany()).toEqual(oldLimits);
    expect((await start()).ok).toBe(false);
    expect(paymentCreate).not.toHaveBeenCalled();
  });
});

const paidEvent = (created: PurchaseSmokeCheckout, snapshotId: string): PaymentWebhookEvent => ({
  id: `evt_paid_${created.sessionId}`, type: 'checkout.session.completed', apiVersion: '2025-09-30.clover',
  objectId: created.sessionId, mode: 'test', livemode: false,
  checkoutSession: {
    email: SMOKE_TENANT_MEMBER_EMAIL, subscriptionId: null, paymentIntentId: `pi_${created.sessionId}`, paymentStatus: 'paid', amountTotalCents: 9900,
    metadata: { tenantId: SMOKE_TENANT_ID, productId: 'product-acme-course', priceId: 'price-product-acme-course',
      memberEmail: SMOKE_TENANT_MEMBER_EMAIL, language: 'en', checkoutSnapshotId: snapshotId },
  },
});

const refundEvent = (created: PurchaseSmokeCheckout, id: string, amount: number): PaymentWebhookEvent => ({
  id, type: 'charge.refunded', apiVersion: '2025-09-30.clover', objectId: 'ch_test', mode: 'test', livemode: false,
  checkoutSession: null, tenantIds: [SMOKE_TENANT_ID],
  adjustment: { chargeId: null, paymentIntentId: `pi_${created.sessionId}`, invoiceId: null,
    refund: { full: amount === 9900, amountCents: 9900, amountRefundedCents: amount } },
});

const paidCheckout = async () => {
  const created = await checkout();
  const tenant = await deps.tenants.findById(SMOKE_TENANT_ID);
  const snapshot = await database.db.query.checkoutSnapshots.findFirst({ where: (table, { eq }) => eq(table.providerSessionId, created.sessionId) });
  if (tenant === null || snapshot === undefined) throw new Error('Missing fixture');
  const payment = paidEvent(created, snapshot.id);
  const apply = (event: PaymentWebhookEvent) => fulfillStripeWebhook(tenant, event, { ...deps, exposeMagicLinks: false });
  expect(await apply(payment)).toMatchObject({ ok: true, value: { processed: true } });
  return { created, payment, apply, result: () => getPurchaseSmokeResult(key, created.reference, deps) };
};

it('records paid and partial/full refund evidence only after successful application', async () => {
  const created = await checkout();
  const tenant = await deps.tenants.findById(SMOKE_TENANT_ID);
  const [order] = await database.db.query.orders.findMany({ where: (table, { eq }) => eq(table.tenantId, SMOKE_TENANT_ID) });
  if (tenant === null || order === undefined) throw new Error('Missing fixture');
  const snapshots = await database.db.query.checkoutSnapshots.findMany();
  const snapshot = snapshots.find((row) => row.providerSessionId === created.sessionId);
  if (snapshot === undefined) throw new Error('Missing checkout snapshot');
  const event = paidEvent(created, snapshot.id);
  const originalLiveGrants = await database.db.query.productGrants.findMany({ where: (table, { eq }) => eq(table.mode, 'live') });
  const invalidSignature = await buildApp(deps).request(baseUrl + '/api/webhooks/stripe/tenant-acme?mode=test', {
    method: 'POST', headers: { host: 'acme.localhost:48730', 'stripe-signature': 'invalid', 'content-type': 'application/json' }, body: '{}',
  });
  expect(invalidSignature.status).toBe(400);
  expect(await getPurchaseSmokeResult(key, created.reference, deps)).toMatchObject({ ok: true, value: { paid: false, receipts: [] } });
  const changedBuyer = event.checkoutSession === null ? event : { ...event, checkoutSession: { ...event.checkoutSession, email: 'outside@example.test' } };
  expect(await fulfillStripeWebhook(tenant, changedBuyer, { ...deps, exposeMagicLinks: false })).toMatchObject({ ok: true, value: { processed: false } });
  expect(await getPurchaseSmokeResult(key, created.reference, deps)).toMatchObject({ ok: true, value: { paid: false, receipts: [] } });
  const transaction = deps.paymentTransaction;
  const failedTransaction: StripeWebhookDeps = {
    ...deps, exposeMagicLinks: false,
    paymentTransaction: {
      run: (operation) => transaction.run((repositories) => operation({
        ...repositories, processedPaymentEvents: {
          ...repositories.processedPaymentEvents,
          finalize: async () => { throw new Error('Injected failure after receipt write'); },
        },
      })),
    },
  };
  const failed = await fulfillStripeWebhook(tenant, event, failedTransaction);
  expect(failed.ok).toBe(false);
  expect(await getPurchaseSmokeResult(key, created.reference, deps)).toMatchObject({ ok: true, value: { paid: false, receipts: [] } });
  const ignored = await fulfillStripeWebhook(tenant, { ...event, type: 'unhandled.event' }, { ...deps, exposeMagicLinks: false });
  expect(ignored).toMatchObject({ ok: true, value: { processed: false } });
  expect(await getPurchaseSmokeResult(key, created.reference, deps)).toMatchObject({ ok: true, value: { paid: false, receipts: [] } });
  expect(await fulfillStripeWebhook(tenant, { ...event, mode: 'live', livemode: true }, { ...deps, exposeMagicLinks: false })).toMatchObject({ ok: true, value: { processed: false } });
  expect(await fulfillStripeWebhook(tenant, event, { ...deps, exposeMagicLinks: false })).toMatchObject({ ok: true, value: { processed: true } });
  expect(await getPurchaseSmokeResult(key, created.reference, deps)).toMatchObject({ ok: true, value: {
    paid: true, receipts: [expect.objectContaining({ eventId: event.id, type: event.type, apiVersion: event.apiVersion })],
  } });
  for (const [amount, state] of [[100, 'partial'], [9900, 'full']] as const) {
    const refund = refundEvent(created, `evt_refund_${amount}`, amount);
    expect(await fulfillStripeWebhook(tenant, refund, { ...deps, exposeMagicLinks: false })).toMatchObject({ ok: true, value: { processed: true } });
    expect(await getPurchaseSmokeResult(key, created.reference, deps)).toMatchObject({ ok: true, value: {
      paid: true, refundState: state, refundedAmountCents: amount,
      receipts: expect.arrayContaining([expect.objectContaining({ eventId: refund.id, type: 'charge.refunded', refundedAmountCents: amount })]),
    } });
  }
  expect(await database.db.query.productGrants.findMany({ where: (table, { eq }) => eq(table.mode, 'live') })).toEqual(originalLiveGrants);
});

it('records cumulative partial advances, but not smaller, equal or duplicate deliveries', async () => {
  const { created, payment, apply, result } = await paidCheckout();
  const first = refundEvent(created, 'evt_refund_100', 100);
  const second = refundEvent(created, 'evt_refund_300', 300);
  for (const refund of [first, second, refundEvent(created, 'evt_refund_late', 100), { ...second, id: 'evt_refund_equal' }]) {
    expect(await apply(refund)).toEqual(ok({ processed: true }));
  }
  expect(await apply(second)).toEqual(ok({ processed: false }));
  expect(await result()).toMatchObject({ ok: true, value: { paid: true, refundState: 'partial', refundedAmountCents: 300, receipts: [
    expect.objectContaining({ eventId: payment.id }),
    expect.objectContaining({ eventId: first.id, refundedAmountCents: 100 }),
    expect.objectContaining({ eventId: second.id, refundedAmountCents: 300 }),
  ] } });
});

it('records an equal cumulative advance only once across concurrent deliveries', async () => {
  const { created, apply, result } = await paidCheckout();
  expect(await apply(refundEvent(created, 'evt_refund_100', 100))).toEqual(ok({ processed: true }));
  const advances = [refundEvent(created, 'evt_refund_300_a', 300), refundEvent(created, 'evt_refund_300_b', 300)];
  expect(await Promise.all(advances.map(apply))).toEqual([ok({ processed: true }), ok({ processed: true })]);
  const applied = await result();
  expect(applied).toMatchObject({ ok: true, value: { refundState: 'partial', refundedAmountCents: 300 } });
  if (!applied.ok) throw new Error('Missing result');
  expect(applied.value.receipts.filter(({ refundedAmountCents }) => refundedAmountCents === 300)).toEqual([
    expect.objectContaining({ eventId: expect.stringMatching(/^evt_refund_300_[ab]$/) }),
  ]);
});

it('handles late partial and duplicate full refunds without certifying unapplied effects', async () => {
  const { created, payment, apply, result } = await paidCheckout();
  const partial = refundEvent(created, 'evt_refund_100', 100);
  const full = refundEvent(created, 'evt_full', 9900);
  expect(await apply(partial)).toEqual(ok({ processed: true }));
  expect(await apply(full)).toEqual(ok({ processed: true }));
  const applied = await result();
  expect(applied).toMatchObject({ ok: true, value: { refundState: 'full', refundedAmountCents: 9900, receipts: [
    expect.objectContaining({ eventId: full.id, refundedAmountCents: 9900 }),
    expect.objectContaining({ eventId: payment.id }),
    expect.objectContaining({ eventId: partial.id, refundedAmountCents: 100 }),
  ] } });
  for (const late of [
    refundEvent(created, 'evt_partial_late', 300),
    { ...full, id: 'evt_full_duplicate' },
    { ...payment, id: 'evt_paid_duplicate' },
  ]) {
    expect((await apply(late)).ok).toBe(true);
    expect(await result()).toEqual(applied);
    if (late.type === 'charge.refunded') {
      expect(await database.db.query.processedPaymentEvents.findFirst({ where: (table, { eq }) => eq(table.id, `test:${late.id}`) })).toMatchObject({ status: 'processed' });
    }
  }
});

it('enumerates the mounted application surface and authorizes exactly the two classified routes', async () => {
  const app = buildApp(deps);
  const classified = [
    ...shopCatalogRoutes(deps), ...shopOrderRoutes(deps), ...shopSettingsRoutes(deps), ...shopAssetsRoutes(deps),
    ...shopDownloadRoutes(deps), ...shopIntegrationRoutes(deps), ...shopProposalRoutes(deps), ...purchaseSmokeRoutes(deps),
  ];
  const allClasses = [
    ['/*', 'middleware:security-headers'],
    ['/*', 'middleware:marketing-signup-cors'],
    ['/*', 'middleware:telemetry'],
    ['/api/*', 'middleware:shop-key-switch'],
    ['/*', 'middleware:body-limit'],
    ['/*', 'middleware:sign-in-timing'],
    ['/*', 'middleware:public-rate-limit'],
    ['/api/*', 'middleware:route-existence'],
    [API_PATHS.memberProductDownload, 'middleware:member-download-navigation'],
    ['/api/*', 'middleware:request-origin'],
    [API_PATHS.operatorTenantProvision, 'middleware:operator-secret'],
    [API_PATHS.operatorTenantReadiness, 'middleware:operator-secret'],
    [API_PATHS.operatorOrganizationCreate, 'middleware:operator-secret'],
    [API_PATHS.operatorOrganizationLimits, 'middleware:operator-secret'],
    ['/*', 'middleware:impersonation'],
    [API_PATHS.getPublicSurvey, 'middleware:public-cors'],
    [API_PATHS.submitSurvey, 'middleware:tenant-cors'],
    [API_PATHS.publicOffer, 'middleware:public-cors'],
    [API_PATHS.getPublicSalesLink, 'middleware:public-cors'],
    [API_PATHS.publicNavigation, 'middleware:public-cors'],
    [API_PATHS.publicCourseStructure, 'middleware:public-cors'],
    [API_PATHS.publicSpaceFeed, 'middleware:public-cors'],
    [API_PATHS.publicSpaceThread, 'middleware:public-cors'],
    [API_PATHS.publicSpaceEvents, 'middleware:public-cors'],
    [API_PATHS.publicSpaceEvent, 'middleware:public-cors'],
    [API_PATHS.studentLesson, 'middleware:public-cors'],
    [API_PATHS.studentLessonEditions, 'middleware:public-cors'],
    [API_PATHS.studentLessonEdition, 'middleware:public-cors'],
    [API_PATHS.publicPaymentConfig, 'middleware:public-cors'],
    [API_PATHS.publicCheckoutSessionStatus, 'middleware:public-cors'],
    [API_PATHS.couponCheckoutValidation, 'middleware:public-cors'],
    [API_PATHS.checkoutSession, 'middleware:public-cors'],
    [API_PATHS.authConfig, 'middleware:public-cors'],
    [API_PATHS.authResolve, 'middleware:tenant-cors'],
    ['/api/*', 'middleware:session-identity'],
    ['/api/*', 'handler:auth-or-not-found'],
    ['/*', 'middleware:tenant-redirect'],
  ];
  const routes = app.routes;
  const allRoutes = routes.filter((route) => route.method === 'ALL');
  expect(allRoutes.map((route) => route.path)).toEqual(allClasses.map(([path]) => path));
  const inventory = routes.map((route) => ({
    method: route.method, path: route.path,
    mechanism: route.method === 'ALL' ? allClasses[allRoutes.indexOf(route)]?.[1] : selfAuthenticatingRouteManifestEntry(route)?.mechanism ?? null,
    originPolicy: requestOriginPolicy(route.method, route.path) ?? null,
    machineClass: classified.find((candidate) => candidate.method === route.method && candidate.path === route.path)?.proposeMode?.kind ?? null,
    machineScope: classified.find((candidate) => candidate.method === route.method && candidate.path === route.path)?.scope ?? null,
    purchaseSmoke: purchaseSmokeRouteAllowed({ ...route, proposeMode: classified.find((candidate) => candidate.method === route.method && candidate.path === route.path)?.proposeMode }),
  })).sort((a, b) => `${a.path} ${a.method}`.localeCompare(`${b.path} ${b.method}`));
  expect(inventory.map((route) => [route.method, route.path, route.mechanism, route.originPolicy, route.machineClass, route.machineScope, route.purchaseSmoke ? 'allow' : 'deny'].join(' | '))).toMatchSnapshot();
  expect(inventory.filter((route) => route.purchaseSmoke).map(({ method, path }) => ({ method, path }))).toEqual(Object.values(PURCHASE_SMOKE_ROUTES));
  vi.spyOn(deps.shopManagementKeyRateLimits, 'claim').mockResolvedValue(true);
  for (const route of routes.filter((route) => route.path.startsWith('/api/m2m/shop/'))) {
    const definition = classified.find((candidate) => candidate.method === route.method && candidate.path === route.path);
    expect(definition, `${route.method} ${route.path} classification`).toBeDefined();
    if (definition !== undefined && purchaseSmokeRouteAllowed(definition)) continue;
    const response = await app.request(`${baseUrl}${route.path.replace(/:[A-Za-z]+/g, 'probe')}`, {
      method: route.method, headers: { host: 'acme.localhost:48730', 'x-api-key': SECRET, 'content-type': 'application/json' },
      ...(route.method === 'GET' ? {} : { body: '{}' }),
    });
    expect(response.status, `${route.method} ${route.path}`).toBe(403);
  }
  const started = await app.request(`${baseUrl}${PURCHASE_SMOKE_ROUTES.start.path}`, {
    method: 'POST', headers: { host: 'acme.localhost:48730', 'x-api-key': SECRET, 'content-type': 'application/json' },
    body: JSON.stringify({ runId: 'http-run', scenario: 'digital-course' }),
  });
  expect(started.status).toBe(200);
  const body: unknown = await started.json();
  if (typeof body !== 'object' || body === null || !('data' in body)) throw new Error('Unexpected envelope');
  const startedCheckout = purchaseSmokeCheckoutSchema.parse(body.data);
  const result = await app.request(`${baseUrl}${PURCHASE_SMOKE_ROUTES.result.path.replace(':reference', startedCheckout.reference)}`, {
    headers: { host: 'acme.localhost:48730', 'x-api-key': SECRET },
  });
  expect(result.status).toBe(200);
  vi.restoreAllMocks();
});

it('refuses mixed credentials and wrong workspace without creating a checkout', async () => {
  const app = buildApp(deps);
  for (const headers of [
    { host: 'acme.localhost:48730', cookie: 'unexpected=session' },
    { host: 'acme.localhost:48730', authorization: 'Bearer unexpected' },
    { host: 'acme.localhost:48730', 'x-tenant': 'studio' },
    { host: 'studio.localhost:48730' },
  ]) {
    const response = await app.request(`${baseUrl}${PURCHASE_SMOKE_ROUTES.start.path}`, {
      method: 'POST', headers: { ...headers, 'x-api-key': SECRET, 'content-type': 'application/json' },
      body: JSON.stringify({ runId: 'wrong-context', scenario: 'digital-course' }),
    });
    expect(response.status, JSON.stringify(headers)).toBeGreaterThanOrEqual(400);
    expect(response.status).toBeLessThan(500);
  }
  expect(paymentCreate).not.toHaveBeenCalled();
});

it('serializes revoke and purge with reseeding without resurrecting credentials', async () => {
  const event = (apiKeyId: string, kind: 'revoked' | 'purged') => ({
    id: randomUUID(), tenantId: SMOKE_TENANT_ID, apiKeyId, kind, actorUserId: key.issuedByUserId,
    method: null, route: null, resourceId: null, at: NOW,
  });
  const withdrawal = { at: NOW, actorUserId: key.issuedByUserId, nextEventId: randomUUID };
  await Promise.all([seed(), deps.shopManagementKeys.revoke(SMOKE_TENANT_ID, key.id, NOW, event(key.id, 'revoked'), withdrawal)]);
  expect(await deps.shopManagementKeys.findByHash(SMOKE_TENANT_ID, key.keyHash)).toMatchObject({ revokedAt: NOW, expiresAt: EXPIRES });
  await Promise.all([seed(), deps.shopManagementKeys.purge(SMOKE_TENANT_ID, (id) => event(id, 'purged'), withdrawal)]);
  expect(await deps.shopManagementKeys.findByHash(SMOKE_TENANT_ID, key.keyHash)).toBeNull();
});
