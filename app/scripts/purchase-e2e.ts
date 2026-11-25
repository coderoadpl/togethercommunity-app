import { pathToFileURL } from 'node:url';

import { z } from 'zod';

import { createAuthE2eClient } from '#adapters/auth/e2e-http.js';
import { STRIPE_WEBHOOK_API_VERSION } from '#adapters/payment/stripe.js';
import { createApiClient } from '#core/client/index.js';
import {
  API_PATHS,
  checkoutSessionOutputSchema,
  envelopeSchema,
  healthOutputSchema,
  meOutputSchema,
  TENANT_HEADER,
} from '#core/contract/index.js';
import {
  DEMO_SEED_PASSWORD,
  SMOKE_TENANT_CREATOR_EMAIL,
  SMOKE_TENANT_ID,
  SMOKE_TENANT_SLUG,
  type AppError,
  type Result,
} from '#core/domain/index.js';

import {
  checkoutSessionIdFromUrl,
  completeTestCheckout,
  LEGACY_ACCOUNT_API_VERSION,
  listPaymentRefunds,
  paymentIntentOf,
  replayCheckoutSession,
  retrieveCheckoutSession,
  TEST_BUYER_ADDRESS,
  testModeKeyProblem,
} from './purchase-e2e-provider.js';

type Fetch = typeof fetch;

export type PurchaseE2eEnvironment = 'staging' | 'production';

export interface PurchaseE2eOptions {
  baseUrl: string;
  environment: PurchaseE2eEnvironment;
  bypassSecret: string | null;
  staff: { email: string; password: string };
  keys: { restricted: string; publishable: string };
  lockerCode: string;
  runId: string;
  testOrderCap: number;
  databaseFingerprint: { expected: string | null; production: string | null };
}

export interface PurchaseE2eCheck {
  name: string;
  status: 'ok' | 'failed' | 'skipped';
  ms: number;
  detail: string | null;
}

export interface PurchaseE2eResult {
  ok: boolean;
  failing: string[];
  checks: PurchaseE2eCheck[];
}

export const FIXTURE = {
  parcelSlug: 'purchase-e2e-parcel',
  parcelTitle: 'Purchase test parcel',
  parcelPriceCents: 2500,
  bundleSlug: 'purchase-e2e-bundle',
  rateId: 'purchase-e2e-locker',
  rateLabel: 'Purchase test parcel locker',
  rateCents: 1299,
  digitalProductId: 'product-acme-course',
  digitalPriceCents: 9900,
  stockFloor: 5,
  stockRefill: 50,
  partialRefundCents: 500,
} as const;

export const PURCHASE_CHECKS = [
  'target-identity',
  'staff-sign-in',
  'test-order-cap',
  'test-slot-configure',
  'fixtures',
  'coupon-refused-in-test-mode',
  'digital-purchase',
  'locker-purchase',
  'sales-link-purchase',
  'webhook-signature-seen',
  'stock-untouched',
  'payload-replay',
  'full-refund',
  'partial-refund',
] as const;

export type PurchaseCheckName = (typeof PURCHASE_CHECKS)[number];

interface Timing {
  pollIntervalMs: number;
  webhookTimeoutMs: number;
  refundTimeoutMs: number;
  now: () => number;
  wait: (ms: number) => Promise<void>;
}

const DEFAULT_TIMING: Timing = {
  pollIntervalMs: 3_000,
  webhookTimeoutMs: 120_000,
  refundTimeoutMs: 600_000,
  now: Date.now,
  wait: (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
};

/** The deployment's clock and the runner's differ; a fresh webhook stamp must not read as stale. */
const CLOCK_SKEW_MS = 30_000;

const BYPASS_HEADER = 'x-vercel-protection-bypass';

const RUN_ORDERS = 3;

const TEST_COUPON_REFUSAL = 'Test checkout requires a paid price without a coupon';

const TEST_SESSION_COOKIE = 'together_stripe_test';

const valueOf = <T>(result: Result<T, AppError>, name: string): T => {
  if (!result.ok) throw new Error(`${name} failed with ${result.error.code}: ${result.error.message}`);
  return result.value;
};

const createRun = () => {
  const checks: PurchaseE2eCheck[] = [];
  return {
    step: async <T>(name: PurchaseCheckName, probe: () => Promise<T>): Promise<T | null> => {
      const startedAt = Date.now();
      try {
        const value = await probe();
        checks.push({ name, status: 'ok', ms: Date.now() - startedAt, detail: null });
        return value;
      } catch (cause) {
        checks.push({ name, status: 'failed', ms: Date.now() - startedAt, detail: cause instanceof Error ? cause.message : String(cause) });
        return null;
      }
    },
    skip: (name: PurchaseCheckName, reason: string): void => {
      checks.push({ name, status: 'skipped', ms: 0, detail: reason });
    },
    skipRest: (reason: string): void => {
      for (const name of PURCHASE_CHECKS) {
        if (!checks.some((check) => check.name === name)) checks.push({ name, status: 'skipped', ms: 0, detail: reason });
      }
    },
    result: (): PurchaseE2eResult => {
      const failing = checks.filter((check) => check.status === 'failed').map((check) => check.name);
      return { ok: failing.length === 0, failing, checks };
    },
  };
};

export const assertTargetIdentity = (
  health: z.output<typeof healthOutputSchema>,
  environment: PurchaseE2eEnvironment,
  fingerprints: PurchaseE2eOptions['databaseFingerprint'],
): void => {
  if (health.database !== 'up') throw new Error('health reported the database down');
  if (health.environment !== environment) {
    throw new Error(`health reports environment "${health.environment}", the run targets ${environment}`);
  }
  if (health.production !== (environment === 'production')) {
    throw new Error(`health reports production=${String(health.production)} for ${environment}`);
  }
  const observed = health.databaseFingerprint;
  if (observed === null) throw new Error('health reported no database fingerprint');
  if (environment === 'staging' && observed === fingerprints.production) {
    throw new Error(`staging answers from the production database (fingerprint ${observed})`);
  }
  if (fingerprints.expected !== null && observed !== fingerprints.expected) {
    throw new Error(`expected database fingerprint ${fingerprints.expected}, received ${observed}`);
  }
};

const testSessionCookie = (response: Response): string => {
  const cookie = response.headers.getSetCookie()
    .map((header) => header.split(';')[0] ?? '')
    .find((pair) => pair.startsWith(`${TEST_SESSION_COOKIE}=`));
  if (cookie === undefined) throw new Error('the test checkout switch set no session cookie');
  return cookie;
};

export interface OrderView {
  id: string;
  status: string;
  mode: string;
  amountCents: number;
  salesLinkId?: string | null | undefined;
  providerObjectIds: Record<string, string>;
  lines?: Array<{ productId: string; productType: string; grossCents: number; quantity?: number | undefined }> | undefined;
  shipping?: { pickupPoint?: { code: string } | null | undefined; address: { country: string | null } } | null | undefined;
}

export interface OrderExpectation {
  amountCents: number;
  productIds: readonly string[];
  shippingCents: number | null;
  lockerCode: string | null;
  salesLinkId: string | null;
}

export const orderProblems = (order: OrderView, expected: OrderExpectation): string[] => {
  const problems: string[] = [];
  if (order.mode !== 'test') problems.push(`mode ${order.mode}, expected test`);
  if (order.status !== 'paid') problems.push(`status ${order.status}, expected paid`);
  if (order.amountCents !== expected.amountCents) problems.push(`amount ${String(order.amountCents)}, expected ${String(expected.amountCents)}`);
  const lines = order.lines ?? [];
  const productLines = lines.filter((line) => line.productType !== 'shipping').map((line) => line.productId).sort();
  if (JSON.stringify(productLines) !== JSON.stringify([...expected.productIds].sort())) {
    problems.push(`product lines ${productLines.join(',') || 'none'}, expected ${[...expected.productIds].sort().join(',')}`);
  }
  const shippingLines = lines.filter((line) => line.productType === 'shipping');
  if (expected.shippingCents === null) {
    if (shippingLines.length > 0 || order.shipping != null) problems.push('a digital order carries delivery');
  } else {
    if (shippingLines.length !== 1 || shippingLines[0]?.productId !== `shipping:${FIXTURE.rateId}` || shippingLines[0].grossCents !== expected.shippingCents) {
      problems.push(`shipping line ${JSON.stringify(shippingLines)}, expected one shipping:${FIXTURE.rateId} line of ${String(expected.shippingCents)}`);
    }
    if (order.shipping?.pickupPoint?.code !== expected.lockerCode) {
      problems.push(`parcel locker ${String(order.shipping?.pickupPoint?.code ?? null)}, expected ${String(expected.lockerCode)}`);
    }
    if (order.shipping?.address.country !== TEST_BUYER_ADDRESS.country) {
      problems.push(`delivery country ${String(order.shipping?.address.country ?? null)}, expected ${TEST_BUYER_ADDRESS.country}`);
    }
  }
  const lineTotal = lines.reduce((sum, line) => sum + line.grossCents, 0);
  if (lines.length > 0 && lineTotal !== order.amountCents) problems.push(`lines sum to ${String(lineTotal)}, the order to ${String(order.amountCents)}`);
  if ((order.salesLinkId ?? null) !== expected.salesLinkId) {
    problems.push(`sales link ${String(order.salesLinkId ?? null)}, expected ${String(expected.salesLinkId)}`);
  }
  return problems;
};

const ORDER_REFUND_TERMINAL = new Set(['succeeded', 'failed', 'blocked_permission', 'skipped_refunded', 'resolved_externally', 'unconfirmed']);

interface Purchase {
  orderId: string;
  sessionId: string;
  paymentIntentId: string;
  amountCents: number;
}

export const runPurchaseE2e = async (
  options: PurchaseE2eOptions,
  unguardedRequest: Fetch = fetch,
  timing: Timing = DEFAULT_TIMING,
): Promise<PurchaseE2eResult> => {
  const request: Fetch = (input, init) => unguardedRequest(input, { ...init, redirect: 'error' });
  const run = createRun();
  const origin = new URL(options.baseUrl).origin;
  const bypass: Record<string, string> = options.bypassSecret === null ? {} : { [BYPASS_HEADER]: options.bypassSecret };
  const startedAt = timing.now();

  const identity = await run.step('target-identity', async () => {
    const response = await request(new URL(API_PATHS.health, origin), { headers: { ...bypass, [TENANT_HEADER]: SMOKE_TENANT_SLUG } });
    const health = envelopeSchema(healthOutputSchema).parse(await response.json());
    if (!health.ok) throw new Error(`health failed with ${health.error.code}`);
    assertTargetIdentity(health.data, options.environment, options.databaseFingerprint);
    return true;
  });
  if (identity === null) {
    run.skipRest('the target is not the expected deployment');
    return run.result();
  }

  const token = await run.step('staff-sign-in', async () => {
    const signedIn = await createAuthE2eClient({ connectUrl: origin, origin, headers: bypass, request }).signInEmail(options.staff);
    if (signedIn.status !== 200 || signedIn.token === null || signedIn.token === '') {
      throw new Error(`staff sign-in returned HTTP ${String(signedIn.status)}`);
    }
    const response = await request(new URL(API_PATHS.me, origin), {
      headers: { ...bypass, authorization: `Bearer ${signedIn.token}`, [TENANT_HEADER]: SMOKE_TENANT_SLUG },
    });
    const me = envelopeSchema(meOutputSchema).parse(await response.json());
    if (!me.ok) throw new Error(`staff identity failed with ${me.error.code}`);
    if (me.data.tenant?.id !== SMOKE_TENANT_ID) {
      throw new Error(`the host resolves workspace ${me.data.tenant?.id ?? 'none'}, the run writes only to ${SMOKE_TENANT_ID}`);
    }
    if (me.data.tenant.staffRole !== 'owner' && me.data.tenant.staffRole !== 'admin') {
      throw new Error(`the staff account holds ${me.data.tenant.staffRole ?? 'no'} role; test checkout needs an owner or admin`);
    }
    return signedIn.token;
  });
  if (token === null) {
    run.skipRest('staff sign-in failed');
    return run.result();
  }

  const staffHeaders = { ...bypass, authorization: `Bearer ${token}`, [TENANT_HEADER]: SMOKE_TENANT_SLUG, origin };
  const api = createApiClient({ baseUrl: origin, fetchImpl: request, refuseRedirects: { label: 'purchase e2e' }, headers: () => staffHeaders });

  const listTestOrders = async (): Promise<{ total: number; orders: OrderView[] }> =>
    valueOf(await api.listOrders({ mode: 'test', pageSize: 100 }), 'test order list');

  const underCap = await run.step('test-order-cap', async () => {
    const { total } = await listTestOrders();
    if (total + RUN_ORDERS > options.testOrderCap) {
      throw new Error(`the workspace holds ${String(total)} test orders and this run adds ${String(RUN_ORDERS)}, above the cap of ${String(options.testOrderCap)}; reseed the fixture workspace before the next run`);
    }
    return true;
  });
  if (underCap === null) {
    run.skipRest('the test order cap is reached; nothing was written');
    return run.result();
  }

  const configured = await run.step('test-slot-configure', async () => {
    const result = valueOf(await api.configureStripe({ mode: 'test', restrictedKey: options.keys.restricted }), 'test slot configuration');
    if (result.mode !== 'test') throw new Error(`the configuration landed in the ${result.mode} slot`);
    const secrets = valueOf(await api.listTenantSecrets(), 'tenant secrets');
    if (secrets.stripeMode !== null || secrets.secrets.some((secret) => secret.key === 'stripe.restrictedKey')) {
      throw new Error('the live payment slot holds a key, so a checkout the server did not take as a test would reach it; the run stops before any checkout');
    }
    return true;
  });
  if (configured === null) {
    run.skipRest('the test payment slot is not configured');
    return run.result();
  }

  const fixtures = await run.step('fixtures', () => ensureFixtures(api, origin));
  if (fixtures === null) {
    run.skipRest('the fixtures are missing');
    return run.result();
  }
  const stockBefore = fixtures.stock;

  const enableTestCheckout = async (): Promise<string> => {
    const response = await request(new URL(API_PATHS.stripeTestSession, origin), {
      method: 'POST',
      headers: { ...staffHeaders, 'content-type': 'application/json' },
      body: JSON.stringify({ enabled: true }),
    });
    if (response.status !== 200) throw new Error(`the test checkout switch answered HTTP ${String(response.status)}`);
    return testSessionCookie(response);
  };

  const startCheckout = async (body: Record<string, unknown>): Promise<Response> =>
    request(new URL(API_PATHS.checkoutSession, origin), {
      method: 'POST',
      headers: { ...staffHeaders, cookie: await enableTestCheckout(), 'content-type': 'application/json' },
      body: JSON.stringify({ language: 'en', termsAccepted: true, termsOnPage: true, clientReference: `purchase-e2e:${options.runId}`, ...body }),
    });

  await run.step('coupon-refused-in-test-mode', async () => {
    const response = await startCheckout({ productId: FIXTURE.digitalProductId, couponCode: 'PURCHASE-E2E' });
    const payload: unknown = await response.json();
    const parsed = z.object({ ok: z.literal(false), error: z.object({ code: z.string(), message: z.string() }) }).safeParse(payload);
    if (!parsed.success || parsed.data.error.code !== 'validation' || parsed.data.error.message !== TEST_COUPON_REFUSAL) {
      throw new Error(`a coupon in test mode answered HTTP ${String(response.status)} instead of a validation refusal`);
    }
  });

  const waitForPaidOrder = async (sessionId: string): Promise<OrderView> => {
    const deadline = timing.now() + timing.webhookTimeoutMs;
    let latest = 'no order';
    while (true) {
      const order = (await listTestOrders()).orders.find((candidate) => candidate.providerObjectIds['checkoutSession'] === sessionId);
      latest = order === undefined ? 'no order' : `order ${order.id} ${order.status}`;
      if (order !== undefined && order.status !== 'pending') return order;
      if (timing.now() >= deadline) throw new Error(`no paid order for ${sessionId} after ${String(timing.webhookTimeoutMs / 1000)}s (${latest}); the webhook was not accepted`);
      await timing.wait(timing.pollIntervalMs);
    }
  };

  const purchase = async (
    body: Record<string, unknown>,
    expected: OrderExpectation,
    onPaid: (sessionId: string) => void = () => undefined,
  ): Promise<Purchase> => {
    const response = await startCheckout(body);
    const checkout = envelopeSchema(checkoutSessionOutputSchema).parse(await response.json());
    if (!checkout.ok) throw new Error(`checkout failed with ${checkout.error.code}: ${checkout.error.message}`);
    const sessionId = checkoutSessionIdFromUrl(checkout.data.url);
    const session = await completeTestCheckout(request, options.keys, sessionId, { ...TEST_BUYER_ADDRESS, email: options.staff.email }, expected.amountCents);
    onPaid(sessionId);
    const order = await waitForPaidOrder(sessionId);
    const amountCents = session.amount_total ?? -1;
    const problems = orderProblems(order, expected);
    if (problems.length > 0) throw new Error(`order ${order.id}: ${problems.join('; ')}`);
    const { parsed: paid } = await retrieveCheckoutSession(request, options.keys.restricted, sessionId);
    const paymentIntentId = paymentIntentOf(paid);
    if (paid.payment_status !== 'paid' || paymentIntentId === null) throw new Error(`session ${sessionId} is ${paid.payment_status} without a payment`);
    return { orderId: order.id, sessionId, paymentIntentId, amountCents };
  };

  const digital = await run.step('digital-purchase', () => purchase(
    { productId: FIXTURE.digitalProductId },
    { amountCents: FIXTURE.digitalPriceCents, productIds: [FIXTURE.digitalProductId], shippingCents: null, lockerCode: null, salesLinkId: null },
  ));

  const shipping = { rateId: FIXTURE.rateId, pickupPoint: { provider: 'inpost', code: options.lockerCode } };
  const lockerAmountCents = FIXTURE.parcelPriceCents + FIXTURE.rateCents;
  let lockerSessionId: string | null = null;
  const locker = await run.step('locker-purchase', () => purchase(
    { productId: fixtures.parcelId, shipping },
    { amountCents: lockerAmountCents, productIds: [fixtures.parcelId], shippingCents: FIXTURE.rateCents, lockerCode: options.lockerCode, salesLinkId: null },
    (sessionId) => { lockerSessionId = sessionId; },
  ));

  await run.step('sales-link-purchase', () => purchase(
    { productId: fixtures.parcelId, salesLinkId: fixtures.salesLinkId, shipping },
    {
      amountCents: FIXTURE.parcelPriceCents + FIXTURE.digitalPriceCents + FIXTURE.rateCents,
      productIds: [fixtures.parcelId, FIXTURE.digitalProductId],
      shippingCents: FIXTURE.rateCents,
      lockerCode: options.lockerCode,
      salesLinkId: fixtures.salesLinkId,
    },
  ));

  await run.step('webhook-signature-seen', async () => {
    const view = valueOf(await api.listTenantSecrets(), 'tenant secrets');
    const seenAt = view.stripeTestLastEventAt === null ? null : Date.parse(view.stripeTestLastEventAt);
    if (seenAt === null || seenAt < startedAt - CLOCK_SKEW_MS) {
      throw new Error(`the last signature-verified test event is ${view.stripeTestLastEventAt ?? 'absent'}, older than this run`);
    }
  });

  await run.step('stock-untouched', async () => {
    const after = valueOf(await api.getProductStock(fixtures.parcelId), 'stock read').stock;
    if (after?.onHand !== stockBefore?.onHand || after?.reserved !== stockBefore?.reserved) {
      throw new Error(`test purchases moved stock: on hand ${String(stockBefore?.onHand)} → ${String(after?.onHand)}, reserved ${String(stockBefore?.reserved)} → ${String(after?.reserved)}`);
    }
  });

  const paidLockerSession: string | null = lockerSessionId;
  if (paidLockerSession === null) {
    run.skip('payload-replay', 'the parcel-locker payment was not confirmed');
  } else {
    await run.step('payload-replay', async () => {
      const problems: string[] = [];
      for (const version of [LEGACY_ACCOUNT_API_VERSION, STRIPE_WEBHOOK_API_VERSION]) {
        const { raw } = await retrieveCheckoutSession(request, options.keys.restricted, paidLockerSession, version);
        problems.push(...await replayCheckoutSession(raw, version, {
          tenantId: SMOKE_TENANT_ID,
          amountTotalCents: lockerAmountCents,
          shippingCostCents: FIXTURE.rateCents,
          shippingCountry: TEST_BUYER_ADDRESS.country,
        }));
      }
      if (problems.length > 0) throw new Error(problems.join('; '));
    });
  }

  const refund = async (purchased: Purchase, amountCents: number | null, expectedStatus: 'refunded' | 'partially_refunded'): Promise<void> => {
    const preview = valueOf(await api.orderRefundPreview({ orderId: purchased.orderId }), 'refund preview');
    if (!preview.refundable) throw new Error(`order ${purchased.orderId} is not refundable: ${preview.blockedReason ?? 'no reason'}`);
    const created = valueOf(await api.createOrderRefund({
      orderId: purchased.orderId,
      requestKey: `purchase-e2e:${options.runId}:${purchased.orderId}`,
      ...(amountCents === null
        ? { expectedAmountCents: preview.remainderCents }
        : { amountCents }),
      expectedRemainderCents: preview.remainderCents,
      reason: 'Automated test-mode refund',
    }), 'staff refund');
    const refundAmount = amountCents ?? preview.remainderCents;
    const deadline = timing.now() + timing.refundTimeoutMs;
    while (true) {
      const detail = valueOf(await api.getOrder(purchased.orderId), 'order read');
      const staffRefund = detail.staffRefunds.find((candidate) => candidate.id === created.refund.id);
      const status = staffRefund?.status ?? 'unknown';
      if (staffRefund !== undefined && status !== 'succeeded' && ORDER_REFUND_TERMINAL.has(status)) {
        throw new Error(`staff refund ${staffRefund.id} ended ${status}: ${staffRefund.lastError ?? 'no error'}`);
      }
      const settled = status === 'succeeded'
        && detail.order.status === expectedStatus
        && detail.refundTotals?.refundedCents === refundAmount;
      if (settled) break;
      if (timing.now() >= deadline) {
        throw new Error(`after ${String(timing.refundTimeoutMs / 1000)}s staff refund ${created.refund.id} is ${status}, the order reads ${detail.order.status} with ${String(detail.refundTotals?.refundedCents)} refunded; expected ${expectedStatus} with ${String(refundAmount)}`);
      }
      await timing.wait(timing.pollIntervalMs);
    }
    const refunds = await listPaymentRefunds(request, options.keys.restricted, purchased.paymentIntentId);
    if (refunds.length !== 1) throw new Error(`payment ${purchased.paymentIntentId} lists ${String(refunds.length)} refunds, expected exactly one`);
    const [providerRefund] = refunds;
    if (providerRefund?.amount !== refundAmount) throw new Error(`the provider refunded ${String(providerRefund?.amount)}, expected ${String(refundAmount)}`);
    if (providerRefund.status !== 'succeeded') throw new Error(`the provider refund is ${String(providerRefund.status)}, expected succeeded`);
    if (providerRefund.metadata?.['refundJobId'] !== created.refund.id) throw new Error(`the provider refund names job ${String(providerRefund.metadata?.['refundJobId'])}, expected ${created.refund.id}`);
  };

  if (digital === null) run.skip('full-refund', 'the digital purchase did not complete');
  else await run.step('full-refund', () => refund(digital, null, 'refunded'));
  if (locker === null) run.skip('partial-refund', 'the parcel-locker purchase did not complete');
  else await run.step('partial-refund', () => refund(locker, FIXTURE.partialRefundCents, 'partially_refunded'));

  return run.result();
};

type ApiClient = ReturnType<typeof createApiClient>;

const ensureFixtures = async (
  api: ApiClient,
  origin: string,
): Promise<{ parcelId: string; salesLinkId: string; stock: { onHand: number; reserved: number } | null }> => {
  const settings = valueOf(await api.getTenantSettings(), 'settings read').settings;
  const rate = {
    id: FIXTURE.rateId,
    label: FIXTURE.rateLabel,
    amountCents: FIXTURE.rateCents,
    vatRatePercent: 23,
    carrier: 'inpost',
    pickupPoint: 'inpost_locker',
    active: true,
  } as const;
  const otherRates = (settings.shippingRates ?? []).filter((candidate) => candidate.id !== FIXTURE.rateId);
  valueOf(await api.updateTenantSettings({
    shippingRates: [...otherRates, rate],
    ...(settings.termsUrl === null ? { termsUrl: new URL('/terms', origin).toString() } : {}),
    ...(settings.privacyUrl === null ? { privacyUrl: new URL('/privacy', origin).toString() } : {}),
  }), 'settings update');

  const { products } = valueOf(await api.listProducts(), 'product list');
  const existing = products.find((product) => product.slug === FIXTURE.parcelSlug);
  const parcel = existing ?? valueOf(await api.createProduct({
    type: 'physical',
    deliveryMethod: 'shipping',
    slug: FIXTURE.parcelSlug,
    title: FIXTURE.parcelTitle,
    description: 'A test-mode product of the purchase end-to-end run.',
    priceCents: FIXTURE.parcelPriceCents,
    currency: 'PLN',
    vatRate: 23,
  }), 'product create').product;
  const { prices } = valueOf(await api.listProductPrices(parcel.id), 'price list');
  if (!prices.some((price) => price.active && price.kind === 'one_time')) {
    valueOf(await api.createProductPrice({ productId: parcel.id, kind: 'one_time', amountCents: FIXTURE.parcelPriceCents, currency: 'PLN' }), 'price create');
  }
  if (!parcel.published) valueOf(await api.publishProduct({ id: parcel.id }), 'product publish');
  const course = products.find((product) => product.id === FIXTURE.digitalProductId);
  if (course === undefined) throw new Error(`the seeded ${FIXTURE.digitalProductId} is missing`);
  if (course.vatRate == null) valueOf(await api.updateProduct({ id: course.id, vatRate: 23 }), 'course VAT rate');

  const stock = valueOf(await api.getProductStock(parcel.id), 'stock read').stock;
  if (stock === null) {
    valueOf(await api.enableProductStock({ productId: parcel.id, onHand: FIXTURE.stockRefill }), 'stock enable');
  } else if (stock.available < FIXTURE.stockFloor) {
    valueOf(await api.adjustProductStock({ productId: parcel.id, delta: FIXTURE.stockRefill, reason: 'purchase e2e refill' }), 'stock refill');
  }

  const { salesLinks } = valueOf(await api.listSalesLinks({}), 'sales link list');
  const link = salesLinks.find((candidate) => candidate.slug === FIXTURE.bundleSlug)
    ?? valueOf(await api.createSalesLink({
      slug: FIXTURE.bundleSlug,
      title: 'Purchase test bundle',
      heading: 'Purchase test bundle',
      productIds: [parcel.id, FIXTURE.digitalProductId],
      active: true,
    }), 'sales link create').salesLink;
  if (!link.active) throw new Error(`sales link ${link.slug} is inactive`);
  const tracked = valueOf(await api.getProductStock(parcel.id), 'stock read').stock;
  return { parcelId: parcel.id, salesLinkId: link.id, stock: tracked };
};

type Environment = Record<string, string | undefined>;

const provided = (env: Environment, name: string): string | null => {
  const value = env[name];
  return value === undefined || value === '' ? null : value;
};

const DEFAULT_LOCKER_CODE = 'WAW01M';
const DEFAULT_PLATFORM_DOMAIN = 'togethercommunity.app';

const fixtureOrigin = (baseUrl: string, platformDomain: string): boolean => {
  if (!URL.canParse(baseUrl)) return false;
  const url = new URL(baseUrl);
  return url.protocol === 'https:'
    && url.hostname.startsWith(`${SMOKE_TENANT_SLUG}.`)
    && url.hostname.endsWith(`.${platformDomain}`);
};
const DEFAULT_TEST_ORDER_CAP = 300;

const ENVIRONMENT_SUFFIX: Record<PurchaseE2eEnvironment, string> = { staging: 'STAGING', production: 'PRODUCTION' };

const OTHER_ENVIRONMENT: Record<PurchaseE2eEnvironment, PurchaseE2eEnvironment> = { staging: 'production', production: 'staging' };

interface EnvironmentValues {
  keys: { restricted: string; publishable: string };
  password: string;
  bypassSecret: string | null;
}

/**
 * Each environment reads only its own suffixed names, so an empty production
 * secret can never be filled with the staging sandbox's key or the reverse.
 */
export const environmentValues = (
  env: Environment,
  target: PurchaseE2eEnvironment,
): { values: EnvironmentValues | null; problems: string[] } => {
  const suffix = ENVIRONMENT_SUFFIX[target];
  const otherSuffix = ENVIRONMENT_SUFFIX[OTHER_ENVIRONMENT[target]];
  const problems: string[] = [];
  const keyOf = (kind: 'RESTRICTED' | 'PUBLISHABLE', problemKind: 'restricted' | 'publishable'): string | null => {
    const name = `STRIPE_TEST_${kind}_KEY_${suffix}`;
    const value = provided(env, name);
    const problem = testModeKeyProblem(name, problemKind, value);
    if (problem !== null) problems.push(problem);
    else if (value !== null && value === provided(env, `STRIPE_TEST_${kind}_KEY_${otherSuffix}`)) {
      problems.push(`${name} equals STRIPE_TEST_${kind}_KEY_${otherSuffix}; each environment needs its own sandbox`);
    }
    return problem === null ? value : null;
  };
  const restricted = keyOf('RESTRICTED', 'restricted');
  const publishable = keyOf('PUBLISHABLE', 'publishable');
  const passwordName = `PURCHASE_E2E_STAFF_PASSWORD_${suffix}`;
  const password = provided(env, passwordName) ?? (target === 'staging' ? DEMO_SEED_PASSWORD : null);
  if (password === null) problems.push(`${passwordName} is not configured`);
  const bypassSecret = target === 'staging' ? provided(env, 'VERCEL_AUTOMATION_BYPASS_SECRET') : null;
  if (target === 'staging' && bypassSecret === null) problems.push('VERCEL_AUTOMATION_BYPASS_SECRET is not configured');
  if (problems.length > 0 || restricted === null || publishable === null || password === null) return { values: null, problems };
  return { values: { keys: { restricted, publishable }, password, bypassSecret }, problems };
};

export const purchaseE2eOptionsFromEnv = (env: Environment): { options: PurchaseE2eOptions } | { problems: string[] } => {
  const problems: string[] = [];
  const baseUrl = provided(env, 'PURCHASE_E2E_BASE_URL');
  if (baseUrl === null) problems.push('PURCHASE_E2E_BASE_URL is not configured');
  else if (!fixtureOrigin(baseUrl, provided(env, 'PURCHASE_E2E_PLATFORM_DOMAIN') ?? DEFAULT_PLATFORM_DOMAIN)) {
    problems.push(`PURCHASE_E2E_BASE_URL must be the https origin of the ${SMOKE_TENANT_SLUG} fixture workspace on the platform domain`);
  }
  const environment = provided(env, 'PURCHASE_E2E_ENVIRONMENT');
  if (environment !== 'staging' && environment !== 'production') problems.push('PURCHASE_E2E_ENVIRONMENT must be staging or production');
  const target = environment === 'staging' || environment === 'production' ? environment : null;
  const own = target === null ? null : environmentValues(env, target);
  if (own !== null) problems.push(...own.problems);
  const productionFingerprint = provided(env, 'PRODUCTION_DATABASE_FINGERPRINT');
  if (productionFingerprint === null) problems.push('PRODUCTION_DATABASE_FINGERPRINT is not configured');
  const expectedFingerprint = environment === 'production'
    ? productionFingerprint
    : provided(env, 'PURCHASE_E2E_EXPECTED_DATABASE_FINGERPRINT');
  const cap = Number(provided(env, 'PURCHASE_E2E_TEST_ORDER_CAP') ?? DEFAULT_TEST_ORDER_CAP);
  if (!Number.isInteger(cap) || cap <= 0) problems.push('PURCHASE_E2E_TEST_ORDER_CAP must be a positive integer');
  const values = own?.values ?? null;
  if (problems.length > 0 || baseUrl === null || target === null || values === null) {
    return { problems };
  }
  return {
    options: {
      baseUrl,
      environment: target,
      bypassSecret: values.bypassSecret,
      staff: { email: provided(env, 'PURCHASE_E2E_STAFF_EMAIL') ?? SMOKE_TENANT_CREATOR_EMAIL, password: values.password },
      keys: values.keys,
      lockerCode: provided(env, 'PURCHASE_E2E_LOCKER_CODE') ?? DEFAULT_LOCKER_CODE,
      runId: provided(env, 'PURCHASE_E2E_RUN_ID') ?? String(Date.now()),
      testOrderCap: cap,
      databaseFingerprint: { expected: expectedFingerprint, production: productionFingerprint },
    },
  };
};

const main = async (): Promise<void> => {
  const parsed = purchaseE2eOptionsFromEnv(process.env);
  if ('problems' in parsed) {
    for (const problem of parsed.problems) process.stderr.write(`purchase-e2e: ${problem}\n`);
    process.exitCode = 2;
    return;
  }
  const startedAt = Date.now();
  const result = await runPurchaseE2e(parsed.options);
  for (const check of result.checks) {
    process.stdout.write(`  [${check.status}] ${check.name} (${String(check.ms)}ms)${check.detail === null ? '' : ` — ${check.detail}`}\n`);
  }
  const seconds = ((Date.now() - startedAt) / 1000).toFixed(1);
  if (result.ok) {
    process.stdout.write(`purchase-e2e: PASS (${seconds}s)\n`);
    return;
  }
  process.stderr.write(`purchase-e2e: FAIL failing=${result.failing.join(',')}\n`);
  process.exitCode = 1;
};

const invokedPath = process.argv[1];
if (invokedPath !== undefined && import.meta.url === pathToFileURL(invokedPath).href) {
  await main();
}
