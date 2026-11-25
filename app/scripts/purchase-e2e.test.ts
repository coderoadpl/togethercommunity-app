import { describe, expect, it } from 'vitest';

import { BETTER_AUTH_PASSWORD_SIGN_IN_PATH } from '#adapters/auth/create-auth.js';

import oldApiAddressPaid from '#adapters/payment/fixtures/checkout-completed-2020-03-02-address-paid.json' with { type: 'json' };
import oldApiLockerFree from '#adapters/payment/fixtures/checkout-completed-2020-03-02-locker-free.json' with { type: 'json' };
import cloverAddressPaid from '#adapters/payment/fixtures/checkout-completed-2025-09-30-address-paid.json' with { type: 'json' };
import cloverLockerFree from '#adapters/payment/fixtures/checkout-completed-2025-09-30-locker-free.json' with { type: 'json' };
import { createStripePaymentProvider } from '#adapters/payment/stripe.js';
import { API_KEY_HEADER, API_PATHS, healthOutputSchema, PURCHASE_SMOKE_ROUTES } from '#core/contract/index.js';
import { DEMO_SEED_PASSWORD, err, internal, purchaseSmokeStartSchema, SMOKE_TENANT_CREATOR_EMAIL, SMOKE_TENANT_ID, type PurchaseSmokeScenario } from '#core/domain/index.js';

import {
  assertTargetIdentity,
  FIXTURE,
  orderProblems,
  PURCHASE_CHECKS,
  purchaseE2eOptionsFromEnv,
  runPurchaseE2e,
  type OrderView,
  type PurchaseE2eOptions,
} from './purchase-e2e.js';
import {
  checkoutSessionIdFromUrl,
  confirmParams,
  eventPaymentIntent,
  generateForwardingSecret,
  LEGACY_ACCOUNT_API_VERSION,
  listRecentEvents,
  PROVIDER_API_ORIGIN,
  replayCheckoutSession,
  TEST_BUYER_ADDRESS,
  webhookSignatureHeader,
  type ProviderCheckoutSession,
} from './purchase-e2e-provider.js';

const PRODUCTION_FINGERPRINT = 'b1bfbb98b4f7';
const STAGING_FINGERPRINT = 'a71c3d05e9f2';

const productionEnv = {
  PURCHASE_E2E_PRODUCTION_SHOP_KEY: 'a'.repeat(43),
  PURCHASE_E2E_PRODUCTION_STRIPE_KEY: 'rk_test_production',
  PURCHASE_E2E_PRODUCTION_STRIPE_PUBLISHABLE_KEY: 'pk_test_production',
  PURCHASE_E2E_RUN_ID: 'production-run-1',
  PRODUCTION_DATABASE_FINGERPRINT: PRODUCTION_FINGERPRINT,
  PURCHASE_E2E_BASE_URL: 'https://acme.togethercommunity.app',
  PURCHASE_E2E_ENVIRONMENT: 'production',
};

const ignoredStaffEnv = {
  PURCHASE_E2E_STAFF_PASSWORD_PRODUCTION: 'unused-production-password',
  PURCHASE_E2E_STAFF_EMAIL: 'unused-staff@example.com',
  VERCEL_AUTOMATION_BYPASS_SECRET: 'unused-production-bypass',
};

const stagingEnv = {
  STRIPE_TEST_RESTRICTED_KEY_STAGING: 'rk_test_staging',
  STRIPE_TEST_PUBLISHABLE_KEY_STAGING: 'pk_test_staging',
  VERCEL_AUTOMATION_BYPASS_SECRET: 'bypass',
  PRODUCTION_DATABASE_FINGERPRINT: PRODUCTION_FINGERPRINT,
  PURCHASE_E2E_BASE_URL: 'https://acme.staging.togethercommunity.app',
  PURCHASE_E2E_ENVIRONMENT: 'staging',
};


const health = (environment: string, production: boolean, databaseFingerprint = production ? PRODUCTION_FINGERPRINT : STAGING_FINGERPRINT) => ({
  status: 'ok',
  database: 'up',
  version: '0.1.0',
  sha: 'a'.repeat(40),
  environment,
  production,
  commit: 'a'.repeat(40),
  databaseFingerprint,
  expectedMigrations: 82,
  appliedMigrations: 82,
  schemaCurrent: true,
  schemaFingerprint: 'c087b16a6bb6',
  schemaFingerprintMatch: true,
});

const meData = {
  tenantAccess: 'staff',
  userId: 'user-1',
  email: SMOKE_TENANT_CREATOR_EMAIL,
  name: 'Acme Creator',
  emailVerified: true,
  tenant: { id: 'tenant-acme', slug: 'acme', name: 'Acme Courses', staffRole: 'owner', memberId: null, banned: false },
};

const options: PurchaseE2eOptions = {
  baseUrl: 'https://acme.staging.togethercommunity.app',
  environment: 'staging',
  bypassSecret: 'bypass',
  staff: { email: SMOKE_TENANT_CREATOR_EMAIL, password: DEMO_SEED_PASSWORD },
  keys: { restricted: 'rk_test_example', publishable: 'pk_test_example' },
  lockerCode: 'WAW01M',
  runId: 'run-1',
  testOrderCap: 3,
  databaseFingerprint: { expected: STAGING_FINGERPRINT, production: PRODUCTION_FINGERPRINT },
  platformDomain: 'togethercommunity.app',
};

const HOST_PROBLEM = 'PURCHASE_E2E_BASE_URL: the base URL must be the https origin of the acme fixture workspace on a staging host of the platform domain';

const lockerOrder: OrderView = {
  id: 'order-1',
  status: 'paid',
  mode: 'test',
  amountCents: FIXTURE.parcelPriceCents + FIXTURE.rateCents,
  salesLinkId: null,
  providerObjectIds: { checkoutSession: 'cs_test_1' },
  lines: [
    { productId: 'product-parcel', productType: 'physical', grossCents: FIXTURE.parcelPriceCents },
    { productId: `shipping:${FIXTURE.rateId}`, productType: 'shipping', grossCents: FIXTURE.rateCents },
  ],
  shipping: { pickupPoint: { code: 'WAW01M' }, address: { country: 'PL' } },
};

const lockerExpectation = {
  amountCents: FIXTURE.parcelPriceCents + FIXTURE.rateCents,
  productIds: ['product-parcel'],
  shippingCents: FIXTURE.rateCents,
  rateId: FIXTURE.rateId,
  lockerCode: 'WAW01M',
  salesLinkId: null,
};

const session = (overrides: Partial<ProviderCheckoutSession> = {}): ProviderCheckoutSession => ({
  id: 'cs_test_1',
  livemode: false,
  amount_total: 3799,
  payment_intent: null,
  payment_status: 'unpaid',
  status: 'open',
  ...overrides,
});

describe('purchaseE2eOptionsFromEnv', () => {
  it('reads the staging values and defaults the seeded staff account, the locker and the cap', () => {
    expect(purchaseE2eOptionsFromEnv({ ...stagingEnv, PURCHASE_E2E_RUN_ID: 'run-7' })).toMatchObject({
      options: {
        environment: 'staging',
        keys: { restricted: 'rk_test_staging', publishable: 'pk_test_staging' },
        staff: { email: SMOKE_TENANT_CREATOR_EMAIL, password: DEMO_SEED_PASSWORD },
        lockerCode: 'WAW01M',
        runId: 'run-7',
        bypassSecret: 'bypass',
        testOrderCap: 300,
        databaseFingerprint: { expected: null, production: PRODUCTION_FINGERPRINT },
      },
    });
  });

  it('reads only the production configuration and ignores credentials for staff and deployment protection', () => {
    expect(purchaseE2eOptionsFromEnv({ ...stagingEnv, ...productionEnv, ...ignoredStaffEnv })).toEqual({
      options: {
        environment: 'production',
        baseUrl: productionEnv.PURCHASE_E2E_BASE_URL,
        shopKey: productionEnv.PURCHASE_E2E_PRODUCTION_SHOP_KEY,
        keys: { restricted: 'rk_test_production', publishable: 'pk_test_production' },
        databaseFingerprint: { expected: PRODUCTION_FINGERPRINT, production: PRODUCTION_FINGERPRINT },
        platformDomain: 'togethercommunity.app',
        runId: 'production-run-1',
      },
    });
  });

  it('refuses production without its own values even when the staging ones are set', () => {
    expect(purchaseE2eOptionsFromEnv({
      ...stagingEnv,
      PURCHASE_E2E_BASE_URL: 'https://acme.togethercommunity.app',
      PURCHASE_E2E_ENVIRONMENT: 'production',
    })).toEqual({
      problems: [
        'PURCHASE_E2E_PRODUCTION_SHOP_KEY is not configured',
        'PURCHASE_E2E_PRODUCTION_STRIPE_KEY is not configured',
        'PURCHASE_E2E_PRODUCTION_STRIPE_PUBLISHABLE_KEY is not configured',
      ],
    });
  });

  it.each([
    'PURCHASE_E2E_PRODUCTION_SHOP_KEY',
    'PURCHASE_E2E_PRODUCTION_STRIPE_KEY',
    'PURCHASE_E2E_PRODUCTION_STRIPE_PUBLISHABLE_KEY',
    'PURCHASE_E2E_BASE_URL',
    'PRODUCTION_DATABASE_FINGERPRINT',
  ])('refuses missing %s in production', (variable) => {
    expect(purchaseE2eOptionsFromEnv({ ...productionEnv, [variable]: undefined })).toEqual({ problems: [`${variable} is not configured`] });
  });

  it.each([
    ['PURCHASE_E2E_PRODUCTION_SHOP_KEY', 'shop key with spaces', 'must be a shop management key'],
    ['PURCHASE_E2E_PRODUCTION_STRIPE_KEY', 'rk_live_example', 'must be a test-mode key starting with rk_test_'],
    ['PURCHASE_E2E_PRODUCTION_STRIPE_KEY', 'sk_test_example', 'must be a test-mode key starting with rk_test_'],
    ['PURCHASE_E2E_PRODUCTION_STRIPE_KEY', 'rk_test_', 'is not a valid test-mode key'],
    ['PURCHASE_E2E_PRODUCTION_STRIPE_PUBLISHABLE_KEY', 'pk_live_example', 'must be a test-mode key starting with pk_test_'],
    ['PURCHASE_E2E_PRODUCTION_STRIPE_PUBLISHABLE_KEY', 'pk_test_ ', 'is not a valid test-mode key'],
    ['PRODUCTION_DATABASE_FINGERPRINT', 'invalid', 'must be a 12-digit hexadecimal fingerprint'],
    ['PURCHASE_E2E_RUN_ID', 'invalid run id', 'must be a purchase smoke run identifier'],
  ])('refuses malformed %s (%s) in production', (variable, value, problem) => {
    expect(purchaseE2eOptionsFromEnv({ ...productionEnv, [variable]: value })).toEqual({ problems: [`${variable} ${problem}`] });
  });

  it('refuses a staging host for production and the production host for staging', () => {
    expect(purchaseE2eOptionsFromEnv({ ...productionEnv, PURCHASE_E2E_BASE_URL: 'https://acme.staging.togethercommunity.app' }))
      .toEqual({ problems: ['PURCHASE_E2E_BASE_URL: the base URL must be the https origin of the production acme fixture workspace'] });
    expect(purchaseE2eOptionsFromEnv({ ...stagingEnv, PURCHASE_E2E_BASE_URL: 'https://acme.togethercommunity.app' }))
      .toEqual({ problems: [HOST_PROBLEM] });
  });

  it('refuses staging without its keys or the bypass', () => {
    expect(purchaseE2eOptionsFromEnv({
      PURCHASE_E2E_BASE_URL: 'https://acme.staging.togethercommunity.app',
      PURCHASE_E2E_ENVIRONMENT: 'staging',
      PRODUCTION_DATABASE_FINGERPRINT: PRODUCTION_FINGERPRINT,
      STRIPE_TEST_RESTRICTED_KEY: 'rk_test_unsuffixed',
    })).toEqual({
      problems: [
        'STRIPE_TEST_RESTRICTED_KEY_STAGING is not configured',
        'STRIPE_TEST_PUBLISHABLE_KEY_STAGING is not configured',
        'VERCEL_AUTOMATION_BYPASS_SECRET is not configured',
      ],
    });
  });

  it.each([
    ['rk_live_example', 'pk_test_example', 'STRIPE_TEST_RESTRICTED_KEY_STAGING must be a test-mode key starting with rk_test_'],
    ['sk_test_example', 'pk_test_example', 'STRIPE_TEST_RESTRICTED_KEY_STAGING must be a test-mode key starting with rk_test_'],
    ['rk_test_example', 'pk_live_example', 'STRIPE_TEST_PUBLISHABLE_KEY_STAGING must be a test-mode key starting with pk_test_'],
  ])('refuses %s with %s', (restricted, publishable, problem) => {
    expect(purchaseE2eOptionsFromEnv({
      ...stagingEnv,
      STRIPE_TEST_RESTRICTED_KEY_STAGING: restricted,
      STRIPE_TEST_PUBLISHABLE_KEY_STAGING: publishable,
    })).toEqual({ problems: [problem] });
  });

  it.each([
    'https://studio.staging.togethercommunity.app',
    'http://acme.staging.togethercommunity.app',
    'https://acme.staging.example.net',
    'https://acme.togethercommunity.app',
    'https://acme.staging.togethercommunity.app:8443',
    'https://acme.staging.togethercommunity.app/path',
  ])('refuses %s', (baseUrl) => {
    expect(purchaseE2eOptionsFromEnv({ ...stagingEnv, PURCHASE_E2E_BASE_URL: baseUrl })).toEqual({ problems: [HOST_PROBLEM] });
  });

  it('names every missing input', () => {
    expect(purchaseE2eOptionsFromEnv({ PURCHASE_E2E_ENVIRONMENT: '' })).toEqual({
      problems: [
        'PURCHASE_E2E_ENVIRONMENT must be staging or production',
        'PURCHASE_E2E_BASE_URL is not configured',
        'STRIPE_TEST_RESTRICTED_KEY_STAGING is not configured',
        'STRIPE_TEST_PUBLISHABLE_KEY_STAGING is not configured',
        'PURCHASE_E2E_STAFF_PASSWORD_STAGING is not configured',
        'PRODUCTION_DATABASE_FINGERPRINT is not configured',
      ],
    });
  });
});

describe('forwarded webhook signature', () => {
  it('is accepted by the adapter the webhook route uses, with the secret the run stored', async () => {
    const secret = generateForwardingSecret();
    const payloadRaw = JSON.stringify({ ...oldApiLockerFree, livemode: false });
    const verified = await createStripePaymentProvider({ resolver: { resolve: async () => err(internal('unused')) } }).verifyWebhookEvent({
      tenantId: 'tenant-a',
      mode: 'test',
      payloadRaw,
      signatureHeader: webhookSignatureHeader(payloadRaw, secret, Math.floor(Date.now() / 1000)),
      webhookSecret: secret,
    });
    expect(verified).toMatchObject({ ok: true, value: { type: 'checkout.session.completed', livemode: false } });
  });

  it('is refused with any other secret', async () => {
    const payloadRaw = JSON.stringify({ ...oldApiLockerFree, livemode: false });
    const verified = await createStripePaymentProvider({ resolver: { resolve: async () => err(internal('unused')) } }).verifyWebhookEvent({
      tenantId: 'tenant-a',
      mode: 'test',
      payloadRaw,
      signatureHeader: webhookSignatureHeader(payloadRaw, generateForwardingSecret(), Math.floor(Date.now() / 1000)),
      webhookSecret: generateForwardingSecret(),
    });
    expect(verified.ok).toBe(false);
  });
});

describe('listRecentEvents', () => {
  const event = (overrides: Record<string, unknown> = {}) => ({
    id: 'evt_1', object: 'event', type: 'checkout.session.completed', livemode: false, created: 1,
    data: { object: { id: 'cs_test_1', payment_intent: 'pi_1' } }, ...overrides,
  });

  it('asks only for the forwarded types since the run started and keeps the raw event', async () => {
    const urls: URL[] = [];
    const listed = await listRecentEvents(async (input) => {
      urls.push(new URL(typeof input === 'string' ? input : input instanceof URL ? input.href : input.url));
      return new Response(JSON.stringify({ object: 'list', data: [event()], has_more: false }), { status: 200 });
    }, 'rk_test_example', 1_795_000_000);
    expect(urls[0]?.searchParams.get('types[0]')).toBe('checkout.session.completed');
    expect(urls[0]?.searchParams.get('types[1]')).toBe('charge.refunded');
    expect(urls[0]?.searchParams.get('created[gte]')).toBe('1795000000');
    expect(listed[0]?.raw).toEqual(event());
    expect(listed[0] === undefined ? null : eventPaymentIntent(listed[0].event)).toBe('pi_1');
  });

  it('stops on a live-mode event', async () => {
    await expect(listRecentEvents(
      async () => new Response(JSON.stringify({ object: 'list', data: [event({ livemode: true })], has_more: false }), { status: 200 }),
      'rk_test_example',
      1,
    )).rejects.toThrow();
  });
});

describe('checkoutSessionIdFromUrl', () => {
  it('reads the test-mode session id from the hosted payment page URL', () => {
    expect(checkoutSessionIdFromUrl('https://checkout.stripe.com/c/pay/cs_test_a1B2c3#fidkdWxOYHwnPyd1blpxYHZxWjA0')).toBe('cs_test_a1B2c3');
  });

  it.each([
    'https://checkout.stripe.com/c/pay/cs_live_a1B2c3',
    'https://acme.togethercommunity.app/checkout/fake?session=fake_123',
    'https://checkout.example.net/c/pay/cs_test_a1B2c3',
    'https://acme.togethercommunity.app/offer/x?status=success&session_id=cs_test_a1B2c3',
  ])('refuses %s', (url) => {
    expect(() => checkoutSessionIdFromUrl(url)).toThrow('not a test-mode payment page');
  });
});

describe('confirmParams', () => {
  const buyer = { ...TEST_BUYER_ADDRESS, email: 'buyer@together.dev' };

  it('confirms a digital session with the card and the amount only', () => {
    expect(confirmParams(session(), 'pm_1', buyer)).toEqual({ payment_method: 'pm_1', expected_amount: '3799' });
  });

  it('adds the delivery address, the rate and the terms when the session collects them', () => {
    expect(confirmParams(session({
      shipping_address_collection: { allowed_countries: ['PL'] },
      shipping_options: [{ shipping_rate: { id: 'shr_1' } }],
      consent_collection: { terms_of_service: 'required' },
    }), 'pm_1', buyer)).toEqual({
      payment_method: 'pm_1',
      expected_amount: '3799',
      'shipping[name]': TEST_BUYER_ADDRESS.name,
      'shipping[address][line1]': TEST_BUYER_ADDRESS.line1,
      'shipping[address][city]': TEST_BUYER_ADDRESS.city,
      'shipping[address][postal_code]': TEST_BUYER_ADDRESS.postalCode,
      'shipping[address][country]': 'PL',
      'shipping[phone]': TEST_BUYER_ADDRESS.phone,
      shipping_rate: 'shr_1',
      'consent[terms_of_service]': 'accepted',
    });
  });
});

describe('assertTargetIdentity', () => {
  const fingerprints = { expected: STAGING_FINGERPRINT, production: PRODUCTION_FINGERPRINT };

  it('accepts the environment and the database the run targets', () => {
    expect(() => { assertTargetIdentity(healthOutputSchema.parse(health('staging', false)), 'staging', fingerprints); }).not.toThrow();
  });

  it('refuses production when the run targets staging', () => {
    expect(() => { assertTargetIdentity(healthOutputSchema.parse(health('production', true)), 'staging', fingerprints); }).toThrow('health reports environment "production"');
  });

  it('accepts production only on the pinned production database', () => {
    const production = { expected: PRODUCTION_FINGERPRINT, production: PRODUCTION_FINGERPRINT };
    expect(() => { assertTargetIdentity(healthOutputSchema.parse(health('production', true)), 'production', production); }).not.toThrow();
    expect(() => { assertTargetIdentity(healthOutputSchema.parse(health('production', true, 'c0ffee000000')), 'production', production); })
      .toThrow('production answers from database c0ffee000000');
    expect(() => { assertTargetIdentity(healthOutputSchema.parse(health('production', false)), 'production', production); })
      .toThrow('health reports production=false for a production run');
  });

  it('refuses a staging deployment on the production database', () => {
    expect(() => { assertTargetIdentity(healthOutputSchema.parse(health('staging', false, PRODUCTION_FINGERPRINT)), 'staging', { expected: null, production: PRODUCTION_FINGERPRINT }); })
      .toThrow('staging answers from the production database');
  });

  it('refuses a database other than the pinned one', () => {
    expect(() => { assertTargetIdentity(healthOutputSchema.parse(health('staging', false, 'c0ffee000000')), 'staging', fingerprints); })
      .toThrow(`expected database fingerprint ${STAGING_FINGERPRINT}, received c0ffee000000`);
  });
});

describe('orderProblems', () => {
  it('accepts a paid test order with its parcel-locker line', () => {
    expect(orderProblems(lockerOrder, lockerExpectation)).toEqual([]);
  });

  it('reports an order the webhook recorded without its delivery fee', () => {
    expect(orderProblems({
      ...lockerOrder,
      amountCents: FIXTURE.parcelPriceCents,
      lines: lockerOrder.lines?.slice(0, 1),
    }, lockerExpectation)).toEqual([
      `amount ${String(FIXTURE.parcelPriceCents)}, expected ${String(lockerExpectation.amountCents)}`,
      `shipping line [], expected one shipping:${FIXTURE.rateId} line of ${String(FIXTURE.rateCents)}`,
    ]);
  });

  it('accepts a paid courier order with its address and no locker', () => {
    expect(orderProblems({
      ...lockerOrder,
      amountCents: FIXTURE.parcelPriceCents + FIXTURE.courierRateCents,
      lines: [
        { productId: 'product-parcel', productType: 'physical', grossCents: FIXTURE.parcelPriceCents },
        { productId: `shipping:${FIXTURE.courierRateId}`, productType: 'shipping', grossCents: FIXTURE.courierRateCents },
      ],
      shipping: { pickupPoint: null, address: { country: 'PL' } },
    }, {
      ...lockerExpectation,
      amountCents: FIXTURE.parcelPriceCents + FIXTURE.courierRateCents,
      shippingCents: FIXTURE.courierRateCents,
      rateId: FIXTURE.courierRateId,
      lockerCode: null,
    })).toEqual([]);
  });

  it('reports a live or unpaid order', () => {
    expect(orderProblems({ ...lockerOrder, mode: 'live', status: 'failed' }, lockerExpectation)).toEqual([
      'mode live, expected test',
      'status failed, expected paid',
    ]);
  });

  it('reports delivery on a digital order', () => {
    expect(orderProblems(lockerOrder, { ...lockerExpectation, productIds: ['product-parcel'], shippingCents: null, rateId: null, lockerCode: null })).toEqual([
      'a digital order carries delivery',
    ]);
  });
});

describe('replayCheckoutSession', () => {
  it.each([
    ['2020-03-02', oldApiAddressPaid, 9519, 1599],
    ['2025-09-30.clover', cloverAddressPaid, 9519, 1599],
    ['2020-03-02', oldApiLockerFree, 8800, 0],
    ['2025-09-30.clover', cloverLockerFree, 8800, 0],
  ])('reads the delivery and its fee from a recorded %s session', async (version, event, amountTotalCents, shippingCostCents) => {
    await expect(replayCheckoutSession(event.data.object, version, {
      tenantId: 'tenant-a',
      amountTotalCents,
      shippingCostCents,
      shippingCountry: 'PL',
    })).resolves.toEqual([]);
  });

  it('reports a session whose delivery fee the parse cannot find', async () => {
    const withoutTotals = Object.fromEntries(Object.entries(oldApiAddressPaid.data.object).filter(([key]) => key !== 'total_details'));
    await expect(replayCheckoutSession(withoutTotals, '2020-03-02', {
      tenantId: 'tenant-a',
      amountTotalCents: 9519,
      shippingCostCents: 1599,
      shippingCountry: 'PL',
    })).resolves.toEqual(['2020-03-02: shipping cost null instead of 1599']);
  });
});

const jsonResponse = (body: unknown, init: ResponseInit = {}): Response =>
  new Response(JSON.stringify(body), { status: 200, headers: { 'content-type': 'application/json' }, ...init });

const recordingFetch = (answer: (url: URL, init: RequestInit | undefined) => Response) => {
  const calls: Array<{ method: string; url: URL; redirect: RequestRedirect | undefined; init: RequestInit | undefined }> = [];
  const request: typeof fetch = async (input, init) => {
    const url = new URL(typeof input === 'string' ? input : input instanceof URL ? input.href : input.url);
    calls.push({ method: init?.method ?? 'GET', url, redirect: init?.redirect, init });
    return answer(url, init);
  };
  return { calls, request };
};

describe('runPurchaseE2e', () => {
  it.each([
    ['the production host', { baseUrl: 'https://acme.togethercommunity.app' }],
    ['another workspace', { baseUrl: 'https://studio.staging.togethercommunity.app' }],
    ['a live key', { keys: { restricted: 'rk_live_example', publishable: 'pk_test_example' } }],
    ['no production fingerprint', { databaseFingerprint: { expected: null, production: null } }],
  ])('sends no request at all for %s', async (_name, override) => {
    const { calls, request } = recordingFetch(() => jsonResponse({ ok: true, data: health('staging', false) }));
    const result = await runPurchaseE2e({ ...options, ...override }, request);
    expect(result.failing).toEqual(['target-identity']);
    expect(calls).toEqual([]);
  });


  it('writes nothing when the host is not the targeted environment', async () => {
    const { calls, request } = recordingFetch(() => jsonResponse({ ok: true, data: health('production', true) }));
    const result = await runPurchaseE2e(options, request);
    expect(result.failing).toEqual(['target-identity']);
    expect(result.checks.filter((check) => check.status === 'skipped')).toHaveLength(PURCHASE_CHECKS.length - 1);
    expect(calls.map((call) => `${call.method} ${call.url.pathname}`)).toEqual(['GET /api/health']);
  });

  it('writes nothing once the workspace holds the capped number of test orders', async () => {
    const { calls, request } = recordingFetch((url) => {
      if (url.pathname === '/api/health') return jsonResponse({ ok: true, data: health('staging', false) });
      if (url.pathname === BETTER_AUTH_PASSWORD_SIGN_IN_PATH) return jsonResponse({ token: 'session-token', user: { id: 'user-1' } }, { headers: { 'content-type': 'application/json', 'set-auth-token': 'session-token' } });
      if (url.pathname === '/api/me') return jsonResponse({ ok: true, data: meData });
      if (url.pathname === '/api/orders') return jsonResponse({ ok: true, data: { orders: [], total: 3, page: 1, pageSize: 100 } });
      return jsonResponse({ ok: false, error: { code: 'internal', message: `unexpected ${url.pathname}` } }, { status: 500 });
    });
    const result = await runPurchaseE2e(options, request);
    expect(result.checks.slice(0, 3).map((check) => [check.name, check.status])).toEqual([
      ['target-identity', 'ok'],
      ['staff-sign-in', 'ok'],
      ['test-order-cap', 'failed'],
    ]);
    expect(calls.filter((call) => call.method === 'POST').map((call) => call.url.pathname)).toEqual([BETTER_AUTH_PASSWORD_SIGN_IN_PATH]);
    expect(calls.every((call) => call.url.origin !== 'https://api.stripe.com')).toBe(true);
    expect(calls.every((call) => call.redirect === 'error')).toBe(true);
  });
});

const productionOptions = () => {
  const parsed = purchaseE2eOptionsFromEnv({ ...stagingEnv, ...productionEnv, ...ignoredStaffEnv });
  if ('problems' in parsed || parsed.options.environment !== 'production') throw new Error('invalid fake production configuration');
  return parsed.options;
};

const scriptedTiming = () => {
  let now = Date.parse('2026-11-25T12:00:00.000Z');
  return {
    pollIntervalMs: 10,
    webhookTimeoutMs: 20,
    refundTimeoutMs: 20,
    now: () => now,
    wait: async (ms: number) => { now += ms; },
  };
};

const productionScenarios = [
  { scenario: 'digital-course', index: 1, amount: 9900 },
  { scenario: 'parcel-courier', index: 2, amount: 4099 },
  { scenario: 'parcel-locker', index: 3, amount: 3799 },
  { scenario: 'bundle-locker', index: 4, amount: 13699 },
].map(({ scenario, index, amount }) => ({
  scenario,
  amount,
  sessionId: `cs_test_${String(index)}`,
  reference: `00000000-0000-4000-8000-00000000000${String(index)}`,
  paymentIntent: `pi_${String(index)}`,
  eventId: `evt_checkout_${String(index)}`,
}));

interface FakeProductionOverrides {
  noCheckoutReceipt?: PurchaseSmokeScenario;
  wrongCheckoutEvent?: PurchaseSmokeScenario;
  noReceiptVersion?: PurchaseSmokeScenario;
  publicStatusStaysPending?: PurchaseSmokeScenario;
  ownStatusStaysUnpaid?: PurchaseSmokeScenario;
  noRefundReceipt?: boolean;
  wrongRefundPaymentIntent?: boolean;
  pendingWebhooks?: number;
}

const productionFetch = (overrides: FakeProductionOverrides = {}) => {
  const confirmed = new Set<string>();
  const refunds = new Map<string, number>();
  const publicReads = new Map<string, number>();
  const refundReads = new Map<string, number>();
  const okResponse = (data: unknown) => jsonResponse({ ok: true, data });
  const receipt = (eventId: string, type: string, apiVersion: string | null, refundedAmountCents: number | null = null) =>
    ({ eventId, type, apiVersion, appliedAt: '2026-11-25T12:00:02.000Z', refundedAmountCents });
  return recordingFetch((url, init) => {
    const headers = new Headers(init?.headers);
    const method = init?.method ?? 'GET';
    if (url.origin === productionEnv.PURCHASE_E2E_BASE_URL) {
      if (url.pathname === API_PATHS.health) return okResponse(health('production', true));
      if (method === 'POST' && url.pathname === PURCHASE_SMOKE_ROUTES.start.path) {
        const started = purchaseSmokeStartSchema.parse(JSON.parse(String(init?.body)));
        const selected = productionScenarios.find(({ scenario }) => scenario === started.scenario);
        if (selected === undefined) throw new Error('unexpected scenario');
        const { reference, sessionId } = selected;
        return okResponse({ ...started, reference, sessionId, url: `https://checkout.stripe.com/c/pay/${sessionId}` });
      }
      const scenario = productionScenarios.find(({ reference, sessionId }) =>
        url.pathname === PURCHASE_SMOKE_ROUTES.result.path.replace(':reference', reference) ||
        (url.pathname === API_PATHS.publicCheckoutSessionStatus && url.searchParams.get('session_id') === sessionId));
      if (method === 'GET' && scenario !== undefined) {
        const { sessionId, reference, eventId } = scenario;
        const paid = confirmed.has(sessionId);
        if (url.pathname === API_PATHS.publicCheckoutSessionStatus) {
          const count = (publicReads.get(sessionId) ?? 0) + 1;
          publicReads.set(sessionId, count);
          return okResponse({ status: paid && count > 1 && scenario.scenario !== overrides.publicStatusStaysPending ? 'paid' : 'pending' });
        }
        const refunded = refunds.get(sessionId) ?? 0;
        const count = (refundReads.get(sessionId) ?? 0) + 1;
        if (refunded > 0) refundReads.set(sessionId, count);
        const reflected = count > 1 ? refunded : 0;
        return okResponse({
          runId: productionEnv.PURCHASE_E2E_RUN_ID, scenario: scenario.scenario, reference, sessionId,
          paid: paid && scenario.scenario !== overrides.ownStatusStaysUnpaid,
          refundedAmountCents: reflected,
          refundState: reflected === 0 ? 'none' : reflected === scenario.amount ? 'full' : 'partial',
          receipts: [
            ...(paid && scenario.scenario !== overrides.noCheckoutReceipt
              ? [receipt(scenario.scenario === overrides.wrongCheckoutEvent ? 'evt_wrong_checkout' : eventId,
                'checkout.session.completed', scenario.scenario === overrides.noReceiptVersion ? null : '2025-09-30.clover')]
              : []),
            ...(reflected > 0 && overrides.noRefundReceipt !== true
              ? [receipt(`evt_refund_${sessionId}`, 'charge.refunded', '2025-09-30.clover', reflected)]
              : []),
          ],
        });
      }
    }
    if (url.origin === PROVIDER_API_ORIGIN) {
      if (method === 'POST' && url.pathname === '/v1/payment_methods') return jsonResponse({ id: 'pm_fixture' });
      if (method === 'GET' && url.pathname === '/v1/events') {
        return jsonResponse({ data: productionScenarios.filter(({ sessionId }) => confirmed.has(sessionId)).map(({ sessionId, paymentIntent, eventId }) => ({
          id: eventId, type: 'checkout.session.completed', livemode: false, api_version: '2020-03-02',
          pending_webhooks: overrides.pendingWebhooks ?? 5, data: { object: { id: sessionId, payment_intent: paymentIntent } },
        })), has_more: false });
      }
      if (method === 'GET' && url.pathname === '/v1/webhook_endpoints') {
        const webhookPath = API_PATHS.stripeWebhook.replace(':tenantId', SMOKE_TENANT_ID);
        return jsonResponse({ data: [{
          id: 'we_production', url: `${productionEnv.PURCHASE_E2E_BASE_URL}${webhookPath}?mode=test`,
          api_version: '2025-09-30.clover', livemode: false,
        }], has_more: false });
      }
      if (method === 'POST' && url.pathname === '/v1/refunds') {
        const params = new URLSearchParams(String(init?.body));
        const intent = params.get('payment_intent');
        const scenario = productionScenarios.find(({ paymentIntent }) => paymentIntent === intent);
        if (scenario === undefined || !confirmed.has(scenario.sessionId)) throw new Error('refund of an unconfirmed payment');
        const amount = Number(params.get('amount'));
        refunds.set(scenario.sessionId, amount);
        return jsonResponse({ id: 're_fixture', amount, payment_intent: intent });
      }
      const scenario = productionScenarios.find(({ sessionId }) => [
        `/v1/checkout/sessions/${sessionId}`, `/v1/payment_pages/${sessionId}`, `/v1/payment_pages/${sessionId}/confirm`,
      ].includes(url.pathname));
      if (scenario !== undefined) {
        const { sessionId, amount, paymentIntent } = scenario;
        if (method === 'POST' && url.pathname.endsWith('/confirm')) {
          confirmed.add(sessionId);
          return jsonResponse({ livemode: false });
        }
        if (method === 'GET' && url.pathname === `/v1/payment_pages/${sessionId}`) return jsonResponse({ livemode: false });
        if (method === 'GET' && url.pathname === `/v1/checkout/sessions/${sessionId}`) {
          const paid = confirmed.has(sessionId);
          const version = headers.get('stripe-version');
          const raw = version === LEGACY_ACCOUNT_API_VERSION ? oldApiAddressPaid.data.object : cloverLockerFree.data.object;
          return jsonResponse({
            ...(version === null ? {} : { ...raw, metadata: { ...raw.metadata, tenantId: SMOKE_TENANT_ID }, total_details: { amount_shipping: FIXTURE.rateCents },
              ...(version === LEGACY_ACCOUNT_API_VERSION ? {} : { shipping_cost: { amount_total: FIXTURE.rateCents } }) }),
            id: sessionId, livemode: false, amount_total: amount, payment_status: paid ? 'paid' : 'unpaid',
            payment_intent: paid ? (overrides.wrongRefundPaymentIntent === true && scenario.scenario === 'digital-course' ? 'pi_other' : paymentIntent) : null,
          });
        }
      }
    }
    throw new Error(`unexpected request: ${method} ${url.href}`);
  });
};

const checkByName = (result: Awaited<ReturnType<typeof runPurchaseE2e>>, name: string) =>
  result.checks.find((check) => check.name === name);

describe('production purchase machine run', () => {
  it('runs the four test scenarios, attributes applied receipts and confines all credentials by route and origin', async () => {
    const { calls, request } = productionFetch();
    const result = await runPurchaseE2e(productionOptions(), request, scriptedTiming());
    expect(result.failing).toEqual([]);
    expect(result.checks.map(({ name, status }) => [name, status])).toEqual([
      'target', ...productionScenarios.flatMap(({ scenario }) => [`start ${scenario}`, `pay ${scenario}`, `paid ${scenario}`]),
      'delivery', 'api version', 'refund full', 'refund partial', 'replay',
    ].map((name) => [name, 'ok']));
    expect(checkByName(result, 'delivery')?.detail).toContain('pending_webhooks=5');
    expect(checkByName(result, 'api version')?.detail).toContain('test endpoint: 2025-09-30.clover; checkout receipts: digital-course: 2025-09-30.clover');
    expect(calls.filter(({ url }) => url.pathname === API_PATHS.publicCheckoutSessionStatus)).toHaveLength(8);
    expect(calls.filter(({ method, url }) => method === 'POST' && url.pathname === '/v1/refunds').map(({ init }) => [
      new Headers(init?.headers).get('idempotency-key'), String(init?.body),
    ])).toEqual([
      ['purchase-e2e:production-run-1:digital-course', 'payment_intent=pi_1&amount=9900'],
      ['purchase-e2e:production-run-1:parcel-courier', 'payment_intent=pi_2&amount=500'],
    ]);
    expect(calls.filter(({ url }) => url.pathname === PURCHASE_SMOKE_ROUTES.start.path).map(({ init }) => JSON.parse(String(init?.body))))
      .toEqual(productionScenarios.map(({ scenario }) => ({ runId: productionEnv.PURCHASE_E2E_RUN_ID, scenario })));
    expect(calls.filter(({ url }) => url.pathname.endsWith('/result'))).toHaveLength(12);
    for (const { url, init, redirect } of calls) {
      const headers = new Headers(init?.headers);
      expect(redirect).toBe('error');
      expect(init?.credentials).toBe('omit');
      expect(headers.has('cookie')).toBe(false);
      expect(headers.has('x-vercel-protection-bypass')).toBe(false);
      expect(url.pathname).not.toBe(BETTER_AUTH_PASSWORD_SIGN_IN_PATH);
      const sent = `${url.href} ${JSON.stringify([...headers])} ${String(init?.body)}`;
      for (const value of Object.values(ignoredStaffEnv)) expect(sent).not.toContain(value);
      if (url.origin === PROVIDER_API_ORIGIN) {
        expect(sent).not.toContain(productionEnv.PURCHASE_E2E_PRODUCTION_SHOP_KEY);
        const key = url.pathname === '/v1/payment_methods' || url.pathname.startsWith('/v1/payment_pages/')
          ? productionEnv.PURCHASE_E2E_PRODUCTION_STRIPE_PUBLISHABLE_KEY
          : productionEnv.PURCHASE_E2E_PRODUCTION_STRIPE_KEY;
        expect(headers.get('authorization')).toBe(`Bearer ${key}`);
      } else {
        expect(url.origin).toBe(productionEnv.PURCHASE_E2E_BASE_URL);
        expect(sent).not.toContain(productionEnv.PURCHASE_E2E_PRODUCTION_STRIPE_KEY);
        expect(sent).not.toContain(productionEnv.PURCHASE_E2E_PRODUCTION_STRIPE_PUBLISHABLE_KEY);
        expect(headers.has('authorization')).toBe(false);
        const machinePath = url.pathname === PURCHASE_SMOKE_ROUTES.start.path || productionScenarios.some(({ reference }) =>
          url.pathname === PURCHASE_SMOKE_ROUTES.result.path.replace(':reference', reference));
        if (machinePath) expect(headers.get(API_KEY_HEADER)).toBe(productionEnv.PURCHASE_E2E_PRODUCTION_SHOP_KEY);
        else expect(sent).not.toContain(productionEnv.PURCHASE_E2E_PRODUCTION_SHOP_KEY);
      }
    }
  });

  it.each([
    { noCheckoutReceipt: 'digital-course' },
    { wrongCheckoutEvent: 'digital-course' },
    { publicStatusStaysPending: 'digital-course' },
    { ownStatusStaysUnpaid: 'digital-course' },
  ] as const)('fails paid proof when either surface has no valid evidence (%o), even with no pending webhooks', async (overrides) => {
    const { request } = productionFetch({ ...overrides, pendingWebhooks: 0 });
    const result = await runPurchaseE2e(productionOptions(), request, scriptedTiming());
    expect(result.failing).toEqual(['paid digital-course']);
    expect(checkByName(result, 'delivery')?.detail).toContain('digital-course: evt_checkout_1 pending_webhooks=0');
    expect(checkByName(result, 'refund full')?.status).toBe('skipped');
  });

  it('fails the API version check when the app did not record the received version', async () => {
    const { request } = productionFetch({ noReceiptVersion: 'parcel-locker' });
    const result = await runPurchaseE2e(productionOptions(), request, scriptedTiming());
    expect(result.failing).toEqual(['api version']);
    expect(checkByName(result, 'api version')?.detail).toContain('parcel-locker: missing');
  });

  it('fails both refunds when the order shows the correct amounts but has no applied refund receipts', async () => {
    const { request } = productionFetch({ noRefundReceipt: true, pendingWebhooks: 0 });
    const result = await runPurchaseE2e(productionOptions(), request, scriptedTiming());
    expect(result.failing).toEqual(['refund full', 'refund partial']);
    expect(checkByName(result, 'refund full')?.detail).toContain('state=full, refunded=9900, matching refund receipt=false');
    expect(checkByName(result, 'refund partial')?.detail).toContain('state=partial, refunded=500, matching refund receipt=false');
  });

  it('refuses to refund when the provider reports a different payment intent for the confirmed session', async () => {
    const { calls, request } = productionFetch({ wrongRefundPaymentIntent: true });
    const result = await runPurchaseE2e(productionOptions(), request, scriptedTiming());
    expect(result.failing).toEqual(['refund full']);
    expect(calls.filter(({ method, url }) => method === 'POST' && url.pathname === '/v1/refunds').map(({ init }) => String(init?.body)))
      .toEqual(['payment_intent=pi_2&amount=500']);
  });

  it('refuses a different production database before sending any credentials', async () => {
    const { calls, request } = recordingFetch(() => jsonResponse({ ok: true, data: health('production', true, STAGING_FINGERPRINT) }));
    const result = await runPurchaseE2e(productionOptions(), request, scriptedTiming());
    expect(result.failing).toEqual(['target']);
    expect(calls.map(({ url }) => url.pathname)).toEqual([API_PATHS.health]);
    expect(new Headers(calls[0]?.init?.headers).has(API_KEY_HEADER)).toBe(false);
  });
});
