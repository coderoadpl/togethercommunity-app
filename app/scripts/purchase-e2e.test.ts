import { describe, expect, it } from 'vitest';

import { BETTER_AUTH_PASSWORD_SIGN_IN_PATH } from '#adapters/auth/create-auth.js';

import oldApiAddressPaid from '#adapters/payment/fixtures/checkout-completed-2020-03-02-address-paid.json' with { type: 'json' };
import oldApiLockerFree from '#adapters/payment/fixtures/checkout-completed-2020-03-02-locker-free.json' with { type: 'json' };
import cloverAddressPaid from '#adapters/payment/fixtures/checkout-completed-2025-09-30-address-paid.json' with { type: 'json' };
import cloverLockerFree from '#adapters/payment/fixtures/checkout-completed-2025-09-30-locker-free.json' with { type: 'json' };
import { healthOutputSchema } from '#core/contract/index.js';
import { DEMO_SEED_PASSWORD, SMOKE_TENANT_CREATOR_EMAIL } from '#core/domain/index.js';

import {
  assertTargetIdentity,
  FIXTURE,
  orderProblems,
  purchaseE2eOptionsFromEnv,
  runPurchaseE2e,
  type OrderView,
  type PurchaseE2eOptions,
} from './purchase-e2e.js';
import {
  checkoutSessionIdFromUrl,
  confirmParams,
  replayCheckoutSession,
  TEST_BUYER_ADDRESS,
  type ProviderCheckoutSession,
} from './purchase-e2e-provider.js';

const PRODUCTION_FINGERPRINT = 'b1bfbb98b4f7';
const STAGING_FINGERPRINT = 'a71c3d05e9f2';

const testKeys = {
  STRIPE_TEST_RESTRICTED_KEY: 'rk_test_example',
  STRIPE_TEST_PUBLISHABLE_KEY: 'pk_test_example',
  PRODUCTION_DATABASE_FINGERPRINT: PRODUCTION_FINGERPRINT,
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
};

const HOST_PROBLEM = 'PURCHASE_E2E_BASE_URL must be the https origin of the acme fixture workspace on the platform domain';

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
  it('defaults the staging staff account, the locker and the cap', () => {
    const parsed = purchaseE2eOptionsFromEnv({
      ...testKeys,
      PURCHASE_E2E_BASE_URL: 'https://acme.staging.togethercommunity.app',
      PURCHASE_E2E_ENVIRONMENT: 'staging',
      PURCHASE_E2E_RUN_ID: 'run-7',
    });
    expect(parsed).toMatchObject({
      options: {
        staff: { email: SMOKE_TENANT_CREATOR_EMAIL, password: DEMO_SEED_PASSWORD },
        lockerCode: 'WAW01M',
        runId: 'run-7',
        bypassSecret: null,
        testOrderCap: 300,
        databaseFingerprint: { expected: null, production: PRODUCTION_FINGERPRINT },
      },
    });
  });

  it('never falls back to the demo password on production', () => {
    expect(purchaseE2eOptionsFromEnv({
      ...testKeys,
      PURCHASE_E2E_BASE_URL: 'https://acme.togethercommunity.app',
      PURCHASE_E2E_ENVIRONMENT: 'production',
    })).toEqual({ problems: ['PURCHASE_E2E_STAFF_PASSWORD is not configured'] });
  });

  it.each([
    ['rk_live_example', 'pk_test_example', 'STRIPE_TEST_RESTRICTED_KEY must be a test-mode key starting with rk_test_'],
    ['sk_test_example', 'pk_test_example', 'STRIPE_TEST_RESTRICTED_KEY must be a test-mode key starting with rk_test_'],
    ['rk_test_example', 'pk_live_example', 'STRIPE_TEST_PUBLISHABLE_KEY must be a test-mode key starting with pk_test_'],
  ])('refuses %s with %s', (restricted, publishable, problem) => {
    expect(purchaseE2eOptionsFromEnv({
      STRIPE_TEST_RESTRICTED_KEY: restricted,
      STRIPE_TEST_PUBLISHABLE_KEY: publishable,
      PRODUCTION_DATABASE_FINGERPRINT: PRODUCTION_FINGERPRINT,
      PURCHASE_E2E_BASE_URL: 'https://acme.staging.togethercommunity.app',
      PURCHASE_E2E_ENVIRONMENT: 'staging',
    })).toEqual({ problems: [problem] });
  });

  it('refuses a host that is not the fixture workspace', () => {
    expect(purchaseE2eOptionsFromEnv({
      ...testKeys,
      PURCHASE_E2E_BASE_URL: 'https://studio.staging.togethercommunity.app',
      PURCHASE_E2E_ENVIRONMENT: 'staging',
    })).toEqual({ problems: [HOST_PROBLEM] });
  });

  it.each([
    'http://acme.staging.togethercommunity.app',
    'https://acme.staging.example.net',
  ])('refuses %s', (baseUrl) => {
    expect(purchaseE2eOptionsFromEnv({
      ...testKeys,
      PURCHASE_E2E_BASE_URL: baseUrl,
      PURCHASE_E2E_ENVIRONMENT: 'staging',
    })).toEqual({ problems: [HOST_PROBLEM] });
  });

  it('pins production to the production database', () => {
    expect(purchaseE2eOptionsFromEnv({
      ...testKeys,
      PURCHASE_E2E_BASE_URL: 'https://acme.togethercommunity.app',
      PURCHASE_E2E_ENVIRONMENT: 'production',
      PURCHASE_E2E_STAFF_PASSWORD: 'fixture-owner-password',
    })).toMatchObject({ options: { databaseFingerprint: { expected: PRODUCTION_FINGERPRINT, production: PRODUCTION_FINGERPRINT } } });
  });

  it('names every missing input', () => {
    expect(purchaseE2eOptionsFromEnv({ PURCHASE_E2E_ENVIRONMENT: '' })).toEqual({
      problems: [
        'PURCHASE_E2E_BASE_URL is not configured',
        'PURCHASE_E2E_ENVIRONMENT must be staging or production',
        'STRIPE_TEST_RESTRICTED_KEY is not configured',
        'STRIPE_TEST_PUBLISHABLE_KEY is not configured',
        'PURCHASE_E2E_STAFF_PASSWORD is not configured',
        'PRODUCTION_DATABASE_FINGERPRINT is not configured',
      ],
    });
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

  it('reports a live or unpaid order', () => {
    expect(orderProblems({ ...lockerOrder, mode: 'live', status: 'failed' }, lockerExpectation)).toEqual([
      'mode live, expected test',
      'status failed, expected paid',
    ]);
  });

  it('reports delivery on a digital order', () => {
    expect(orderProblems(lockerOrder, { ...lockerExpectation, productIds: ['product-parcel'], shippingCents: null, lockerCode: null })).toEqual([
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
  const calls: Array<{ method: string; url: URL; redirect: RequestRedirect | undefined }> = [];
  const request: typeof fetch = async (input, init) => {
    const url = new URL(typeof input === 'string' ? input : input instanceof URL ? input.href : input.url);
    calls.push({ method: init?.method ?? 'GET', url, redirect: init?.redirect });
    return answer(url, init);
  };
  return { calls, request };
};

describe('runPurchaseE2e', () => {
  it('writes nothing when the host is not the targeted environment', async () => {
    const { calls, request } = recordingFetch(() => jsonResponse({ ok: true, data: health('production', true) }));
    const result = await runPurchaseE2e(options, request);
    expect(result.failing).toEqual(['target-identity']);
    expect(result.checks.filter((check) => check.status === 'skipped')).toHaveLength(13);
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
