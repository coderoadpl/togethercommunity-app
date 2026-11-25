import { pathToFileURL } from 'node:url';

import { z } from 'zod';

import { createAuthE2eClient } from '#adapters/auth/e2e-http.js';
import { STRIPE_WEBHOOK_API_VERSION } from '#adapters/payment/stripe.js';
import { createApiClient, createShopManagementClient } from '#core/client/index.js';
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
  SMOKE_TENANT_MEMBER_EMAIL,
  SMOKE_TENANT_SLUG,
  purchaseSmokeScenarioSchema,
  purchaseSmokeStartSchema,
  type AppError,
  type PurchaseSmokeCheckout,
  type PurchaseSmokeReceipt,
  type PurchaseSmokeResult,
  type PurchaseSmokeScenario,
  type Result,
} from '#core/domain/index.js';

import {
  checkoutSessionIdFromUrl,
  completeTestCheckout,
  eventPaymentIntent,
  generateForwardingSecret,
  LEGACY_ACCOUNT_API_VERSION,
  listRecentEvents,
  listWebhookEndpoints,
  listPaymentRefunds,
  paymentIntentOf,
  refundTestCheckout,
  replayCheckoutSession,
  retrieveCheckoutSession,
  TEST_BUYER_ADDRESS,
  testModeKeyProblem,
  webhookSignatureHeader,
  type ProviderEvent,
} from './purchase-e2e-provider.js';

type Fetch = typeof fetch;

export type PurchaseE2eEnvironment = 'staging' | 'production';

interface PurchaseE2eTarget {
  baseUrl: string;
  keys: { restricted: string; publishable: string };
  runId: string;
  databaseFingerprint: { expected: string | null; production: string | null };
  platformDomain: string;
}

interface StagingPurchaseE2eOptions extends PurchaseE2eTarget {
  environment: 'staging';
  bypassSecret: string | null;
  staff: { email: string; password: string };
  lockerCode: string;
  testOrderCap: number;
}

interface ProductionPurchaseE2eOptions extends PurchaseE2eTarget {
  environment: 'production';
  shopKey: string;
}

export type PurchaseE2eOptions = StagingPurchaseE2eOptions | ProductionPurchaseE2eOptions;

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
  courierRateId: 'purchase-e2e-courier',
  courierRateLabel: 'Purchase test courier',
  courierRateCents: 1599,
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
  'courier-purchase',
  'sales-link-purchase',
  'webhook-signature-seen',
  'provider-delivery',
  'webhook-endpoint-version',
  'stock-untouched',
  'payload-replay',
  'full-refund',
  'partial-refund',
] as const;

const PRODUCTION_SCENARIOS = purchaseSmokeScenarioSchema.options;
const PRODUCTION_CHECKS = [
  'target',
  ...PRODUCTION_SCENARIOS.flatMap((scenario) => [`start ${scenario}`, `pay ${scenario}`, `paid ${scenario}`] as const),
  'delivery', 'api version', 'refund full', 'refund partial', 'replay',
] as const;

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

const RUN_ORDERS = 4;

const TEST_COUPON_REFUSAL = 'Test checkout requires a paid price without a coupon';

const TEST_SESSION_COOKIE = 'together_stripe_test';

const valueOf = <T>(result: Result<T, AppError>, name: string): T => {
  if (!result.ok) throw new Error(`${name} failed with ${result.error.code}: ${result.error.message}`);
  return result.value;
};

const createRun = <Name extends string>(names: readonly Name[]) => {
  const checks: PurchaseE2eCheck[] = [];
  return {
    step: async <T>(name: Name, probe: () => Promise<T>, describe?: (value: T) => string): Promise<T | null> => {
      const startedAt = Date.now();
      try {
        const value = await probe();
        checks.push({ name, status: 'ok', ms: Date.now() - startedAt, detail: describe === undefined ? null : describe(value) });
        return value;
      } catch (cause) {
        checks.push({ name, status: 'failed', ms: Date.now() - startedAt, detail: cause instanceof Error ? cause.message : String(cause) });
        return null;
      }
    },
    skip: (name: Name, reason: string): void => {
      checks.push({ name, status: 'skipped', ms: 0, detail: reason });
    },
    skipRest: (reason: string): void => {
      for (const name of names) {
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
    throw new Error(`health reports production=${String(health.production)} for a ${environment} run`);
  }
  const observed = health.databaseFingerprint;
  if (observed === null) throw new Error('health reported no database fingerprint');
  if (environment === 'staging' && observed === fingerprints.production) {
    throw new Error(`staging answers from the production database (fingerprint ${observed})`);
  }
  if (environment === 'production' && observed !== fingerprints.production) {
    throw new Error(`production answers from database ${observed}, not the pinned production database`);
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
  rateId: string | null;
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
    if (shippingLines.length !== 1 || shippingLines[0]?.productId !== `shipping:${String(expected.rateId)}` || shippingLines[0].grossCents !== expected.shippingCents) {
      problems.push(`shipping line ${JSON.stringify(shippingLines)}, expected one shipping:${String(expected.rateId)} line of ${String(expected.shippingCents)}`);
    }
    if ((order.shipping?.pickupPoint?.code ?? null) !== expected.lockerCode) {
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

const runStagingPurchaseE2e = async (
  options: StagingPurchaseE2eOptions,
  unguardedRequest: Fetch,
  timing: Timing,
): Promise<PurchaseE2eResult> => {
  const request: Fetch = (input, init) => unguardedRequest(input, { ...init, redirect: 'error' });
  const run = createRun(PURCHASE_CHECKS);
  const refused = purchaseTargetProblems(options);
  if (refused.length > 0) {
    await run.step('target-identity', () => Promise.reject(new Error(refused.join('; '))));
    run.skipRest('the run refuses this target before any request');
    return run.result();
  }
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

  const forwardingSecret = generateForwardingSecret();
  const forwardedEventIds = new Set<string>();
  const eventsSinceSeconds = Math.floor(startedAt / 1000) - Math.ceil(CLOCK_SKEW_MS / 1000);
  const webhookUrl = new URL(API_PATHS.stripeWebhook.replace(':tenantId', encodeURIComponent(SMOKE_TENANT_ID)), origin);
  webhookUrl.searchParams.set('mode', 'test');

  const forwardEvents = async (wanted: (event: ProviderEvent) => boolean): Promise<void> => {
    for (const { event, raw } of await listRecentEvents(request, options.keys.restricted, eventsSinceSeconds)) {
      if (forwardedEventIds.has(event.id) || !wanted(event)) continue;
      const payloadRaw = JSON.stringify(raw);
      const response = await request(webhookUrl, {
        method: 'POST',
        headers: {
          ...bypass,
          'content-type': 'application/json',
          'stripe-signature': webhookSignatureHeader(payloadRaw, forwardingSecret, Math.floor(timing.now() / 1000)),
        },
        body: payloadRaw,
      });
      const accepted = z.object({ ok: z.literal(true), data: z.object({ received: z.literal(true) }) }).safeParse(await response.json());
      if (response.status !== 200 || !accepted.success) {
        throw new Error(`the webhook refused forwarded ${event.type} ${event.id} with HTTP ${String(response.status)}`);
      }
      forwardedEventIds.add(event.id);
    }
  };

  const configured = await run.step('test-slot-configure', async () => {
    const secrets = valueOf(await api.listTenantSecrets(), 'tenant secrets');
    if (secrets.stripeMode !== null || secrets.secrets.some((secret) => secret.key === 'stripe.restrictedKey')) {
      throw new Error('the live payment slot holds a key, so a checkout the server did not take as a test would reach it; the run stops before configuring anything');
    }
    const result = valueOf(await api.configureStripe({ mode: 'test', restrictedKey: options.keys.restricted }), 'test slot configuration');
    if (result.mode !== 'test') throw new Error(`the configuration landed in the ${result.mode} slot`);
    valueOf(await api.setTenantSecret({ key: 'stripe.testWebhookSecret', value: forwardingSecret }), 'forwarding signing secret');
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
      await forwardEvents((event) => event.type === 'checkout.session.completed' && event.data.object.id === sessionId);
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
    { amountCents: FIXTURE.digitalPriceCents, productIds: [FIXTURE.digitalProductId], shippingCents: null, rateId: null, lockerCode: null, salesLinkId: null },
  ));

  const shipping = { rateId: FIXTURE.rateId, pickupPoint: { provider: 'inpost', code: options.lockerCode } };
  const lockerAmountCents = FIXTURE.parcelPriceCents + FIXTURE.rateCents;
  let lockerSessionId: string | null = null;
  const locker = await run.step('locker-purchase', () => purchase(
    { productId: fixtures.parcelId, shipping },
    { amountCents: lockerAmountCents, productIds: [fixtures.parcelId], shippingCents: FIXTURE.rateCents, rateId: FIXTURE.rateId, lockerCode: options.lockerCode, salesLinkId: null },
    (sessionId) => { lockerSessionId = sessionId; },
  ));

  await run.step('courier-purchase', () => purchase(
    { productId: fixtures.parcelId, shipping: { rateId: FIXTURE.courierRateId } },
    {
      amountCents: FIXTURE.parcelPriceCents + FIXTURE.courierRateCents,
      productIds: [fixtures.parcelId],
      shippingCents: FIXTURE.courierRateCents,
      rateId: FIXTURE.courierRateId,
      lockerCode: null,
      salesLinkId: null,
    },
  ));

  await run.step('sales-link-purchase', () => purchase(
    { productId: fixtures.parcelId, salesLinkId: fixtures.salesLinkId, shipping },
    {
      amountCents: FIXTURE.parcelPriceCents + FIXTURE.digitalPriceCents + FIXTURE.rateCents,
      productIds: [fixtures.parcelId, FIXTURE.digitalProductId],
      shippingCents: FIXTURE.rateCents,
      rateId: FIXTURE.rateId,
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

  run.skip('provider-delivery', 'the protected staging host receives forwarded events');

  await run.step('webhook-endpoint-version', async () => {
    const endpoint = (await listWebhookEndpoints(request, options.keys.restricted))
      .find((candidate) => candidate.url.startsWith(webhookUrl.origin + webhookUrl.pathname) && new URL(candidate.url).searchParams.get('mode') === 'test');
    if (endpoint === undefined) throw new Error('the provider lists no test-mode endpoint of the fixture workspace');
    if (endpoint.api_version !== STRIPE_WEBHOOK_API_VERSION) {
      throw new Error(`the test-mode endpoint receives API version ${String(endpoint.api_version)}, the app pins ${STRIPE_WEBHOOK_API_VERSION}`);
    }
    return endpoint.api_version;
  }, (version) => `endpoint API version ${version}`);

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
    await run.step('payload-replay', () => replayLockerCheckout(request, options.keys.restricted, paidLockerSession));
  }

  const refund = async (purchased: Purchase, amountCents: number | null, expectedStatus: 'refunded' | 'partially_refunded'): Promise<void> => {
    const preview = valueOf(await api.orderRefundPreview({ orderId: purchased.orderId }), 'refund preview');
    if (!preview.refundable) throw new Error(`order ${purchased.orderId} is not refundable: ${preview.blockedReason ?? 'no reason'}`);
    if (preview.mode !== 'test') throw new Error(`order ${purchased.orderId} is a ${preview.mode} order; the run refunds only test orders`);
    const before = valueOf(await api.getOrder(purchased.orderId), 'order read').order;
    if (before.mode !== 'test' || before.providerObjectIds['paymentIntent'] !== purchased.paymentIntentId) {
      throw new Error(`order ${purchased.orderId} is not the test payment ${purchased.paymentIntentId} this run made`);
    }
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
      await forwardEvents((event) => event.type === 'charge.refunded' && eventPaymentIntent(event) === purchased.paymentIntentId);
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
    if (refunds.some((candidate) => candidate.payment_intent !== purchased.paymentIntentId)) {
      throw new Error(`the provider listed a refund of another payment for ${purchased.paymentIntentId}`);
    }
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

const replayLockerCheckout = async (request: Fetch, key: string, sessionId: string): Promise<void> => {
  const problems: string[] = [];
  for (const version of [LEGACY_ACCOUNT_API_VERSION, STRIPE_WEBHOOK_API_VERSION]) {
    const { raw } = await retrieveCheckoutSession(request, key, sessionId, version);
    problems.push(...await replayCheckoutSession(raw, version, {
      tenantId: SMOKE_TENANT_ID,
      amountTotalCents: FIXTURE.parcelPriceCents + FIXTURE.rateCents,
      shippingCostCents: FIXTURE.rateCents,
      shippingCountry: TEST_BUYER_ADDRESS.country,
    }));
  }
  if (problems.length > 0) throw new Error(problems.join('; '));
};

const PRODUCTION_TOTALS: Record<PurchaseSmokeScenario, number> = {
  'digital-course': FIXTURE.digitalPriceCents,
  'parcel-courier': FIXTURE.parcelPriceCents + FIXTURE.courierRateCents,
  'parcel-locker': FIXTURE.parcelPriceCents + FIXTURE.rateCents,
  'bundle-locker': FIXTURE.parcelPriceCents + FIXTURE.digitalPriceCents + FIXTURE.rateCents,
};

interface AppliedPurchase {
  checkout: PurchaseSmokeCheckout;
  receipt: PurchaseSmokeReceipt;
  event: ProviderEvent;
}

const pollFor = async <T>(timing: Timing, timeoutMs: number, probe: () => Promise<T | null>, failure: () => string): Promise<T> => {
  const deadline = timing.now() + timeoutMs;
  while (true) {
    const found = await probe();
    if (found !== null) return found;
    const remaining = deadline - timing.now();
    if (remaining <= 0) throw new Error(failure());
    await timing.wait(Math.min(timing.pollIntervalMs, remaining));
  }
};

const checkResultIdentity = (result: PurchaseSmokeResult, checkout: PurchaseSmokeCheckout): PurchaseSmokeResult => {
  if (result.runId !== checkout.runId || result.scenario !== checkout.scenario
    || result.reference !== checkout.reference || result.sessionId !== checkout.sessionId) {
    throw new Error('the purchase smoke result does not belong to this checkout');
  }
  return result;
};

const runProductionPurchaseE2e = async (
  options: ProductionPurchaseE2eOptions,
  unguardedRequest: Fetch,
  timing: Timing,
): Promise<PurchaseE2eResult> => {
  const run = createRun(PRODUCTION_CHECKS);
  const refused = purchaseTargetProblems(options);
  if (refused.length > 0) {
    await run.step('target', () => Promise.reject(new Error(refused.join('; '))));
    run.skipRest('the run refuses this target before any request');
    return run.result();
  }
  const request: Fetch = (input, init) => {
    const timeout = AbortSignal.timeout(15_000);
    const signal = init?.signal == null ? timeout : AbortSignal.any([timeout, init.signal]);
    return unguardedRequest(input, { ...init, redirect: 'error', credentials: 'omit', signal });
  };
  const origin = new URL(options.baseUrl).origin;
  const identity = await run.step('target', async () => {
    const response = await request(new URL(API_PATHS.health, origin), { headers: { [TENANT_HEADER]: SMOKE_TENANT_SLUG } });
    const health = envelopeSchema(healthOutputSchema).parse(await response.json());
    if (!health.ok) throw new Error(`health failed with ${health.error.code}`);
    assertTargetIdentity(health.data, options.environment, options.databaseFingerprint);
    return true;
  });
  if (identity === null) {
    run.skipRest('the target is not the expected deployment');
    return run.result();
  }

  const api = createApiClient({ baseUrl: origin, fetchImpl: request, refuseRedirects: { label: 'purchase e2e' } });
  const shop = createShopManagementClient({ baseUrl: origin, apiKey: options.shopKey, fetchImpl: request });
  const eventsSinceSeconds = Math.floor((timing.now() - CLOCK_SKEW_MS) / 1000);
  const results = new Map<PurchaseSmokeScenario, AppliedPurchase>();
  const observedEvents = new Map<PurchaseSmokeScenario, ProviderEvent>();
  const startedSessions = new Set<string>();
  let paidLockerSession: string | null = null;
  const key = options.keys.restricted;
  const readResult = async (checkout: PurchaseSmokeCheckout): Promise<PurchaseSmokeResult> =>
    checkResultIdentity(valueOf(await shop.getPurchaseSmokeResult(checkout.reference), 'purchase smoke result'), checkout);

  for (const scenario of PRODUCTION_SCENARIOS) {
    const checkout = await run.step(`start ${scenario}`, async () => {
      const started = valueOf(await shop.startPurchaseSmokeCheckout({ runId: options.runId, scenario }), 'purchase smoke start');
      if (started.runId !== options.runId || started.scenario !== scenario || checkoutSessionIdFromUrl(started.url) !== started.sessionId
        || startedSessions.has(started.sessionId)) {
        throw new Error('the purchase smoke start did not return a distinct test session for this run and scenario');
      }
      startedSessions.add(started.sessionId);
      return started;
    });
    if (checkout === null) {
      run.skip(`pay ${scenario}`, 'checkout did not start');
      run.skip(`paid ${scenario}`, 'checkout did not start');
      continue;
    }
    const paid = await run.step(`pay ${scenario}`, () => completeTestCheckout(request, options.keys, checkout.sessionId,
      { ...TEST_BUYER_ADDRESS, email: SMOKE_TENANT_MEMBER_EMAIL }, PRODUCTION_TOTALS[scenario]));
    if (paid === null) {
      run.skip(`paid ${scenario}`, 'the provider did not confirm the test payment');
      continue;
    }
    if (scenario === 'parcel-locker') paidLockerSession = checkout.sessionId;
    let latest = '';
    const applied = await run.step(`paid ${scenario}`, () => pollFor(timing, timing.webhookTimeoutMs, async () => {
      const [publicResult, result, events] = await Promise.all([
        api.publicCheckoutSessionStatus(checkout.sessionId),
        readResult(checkout),
        listRecentEvents(request, key, eventsSinceSeconds),
      ]);
      const status = valueOf(publicResult, 'public checkout status').status;
      const checkoutEvents = events.map(({ event }) => event).filter((event) =>
        event.type === 'checkout.session.completed' && event.data.object.id === checkout.sessionId);
      const receipt = result.receipts.find((candidate) => candidate.type === 'checkout.session.completed'
        && checkoutEvents.some((event) => event.id === candidate.eventId));
      const event = checkoutEvents.find((candidate) => candidate.id === receipt?.eventId);
      const observed = event ?? checkoutEvents[0];
      if (observed !== undefined) observedEvents.set(scenario, observed);
      latest = `public status=${status}, own result paid=${String(result.paid)}, matching checkout receipt=${String(receipt !== undefined)}`;
      return status === 'paid' && result.paid && receipt !== undefined && event !== undefined ? { checkout, receipt, event } : null;
    }, () => `no paid proof for ${checkout.sessionId} (${latest})`), ({ receipt }) => `public status paid; applied ${receipt.eventId}`);
    if (applied !== null) results.set(scenario, applied);
  }

  await run.step('delivery', async () => PRODUCTION_SCENARIOS.map((scenario) => {
    const event = observedEvents.get(scenario);
    return `${scenario}: ${event?.id ?? 'no provider event'} pending_webhooks=${String(event?.pending_webhooks ?? 'unknown')}`;
  }).join('; '), (summary) => `${summary}. pending_webhooks = 0 means the provider stopped retrying, not that the platform applied the event; the applied state is proven only by the receipt, which the server writes in the same transaction that applies the event.`);

  await run.step('api version', async () => {
    const path = API_PATHS.stripeWebhook.replace(':tenantId', encodeURIComponent(SMOKE_TENANT_ID));
    const endpoints = (await listWebhookEndpoints(request, key)).filter((candidate) => {
      const url = new URL(candidate.url);
      return url.origin === origin && url.pathname === path && url.searchParams.get('mode') === 'test';
    });
    const endpoint = endpoints.length === 1 ? endpoints[0] : undefined;
    if (endpoint === undefined) throw new Error('the provider must list exactly one test-mode endpoint of the fixture workspace');
    const versions = [...results].map(([scenario, { receipt }]) => `${scenario}: ${receipt.apiVersion || 'missing'}`);
    const summary = `test endpoint: ${endpoint.api_version ?? 'account default'}; checkout receipts: ${versions.join(', ') || 'none matched'}`;
    if ([...results.values()].some(({ receipt }) => !receipt.apiVersion?.trim())) throw new Error(`a checkout receipt lacks an API version (${summary})`);
    return summary;
  }, (summary) => `${summary}. An event fetched from the Events API is the provider's stored object, not the body the endpoint received; the receipt's event id and API version are what the server recorded on application.`);

  const refund = async (scenario: PurchaseSmokeScenario, state: 'full' | 'partial', partialAmount: number | null): Promise<void> => {
    const name = `refund ${state}` as const;
    const purchase = results.get(scenario);
    if (purchase === undefined) {
      run.skip(name, 'the checkout has no paid proof');
      return;
    }
    await run.step(name, async () => {
      const intent = eventPaymentIntent(purchase.event);
      if (intent === null) throw new Error(`the checkout event for ${purchase.checkout.sessionId} names no payment intent`);
      const amount = await refundTestCheckout(request, key, purchase.checkout.sessionId, intent, PRODUCTION_TOTALS[scenario],
        partialAmount, `purchase-e2e:${options.runId}:${scenario}`);
      let latest = '';
      const receipt = await pollFor(timing, timing.refundTimeoutMs, async () => {
        const result = await readResult(purchase.checkout);
        const applied = result.receipts.find((candidate) => candidate.type === 'charge.refunded' && candidate.refundedAmountCents === amount);
        latest = `state=${result.refundState}, refunded=${String(result.refundedAmountCents)}, matching refund receipt=${String(applied !== undefined)}`;
        return result.refundState === state && result.refundedAmountCents === amount ? applied ?? null : null;
      }, () => `no applied ${state} refund of ${String(amount)} cents for ${purchase.checkout.sessionId} (${latest})`);
      return receipt.eventId;
    }, (eventId) => `applied ${eventId}. The production refund check proves inbound refund reconciliation (a provider-side refund reaches the order), NOT the staff refund flow.`);
  };
  await refund('digital-course', 'full', null);
  await refund('parcel-courier', 'partial', FIXTURE.partialRefundCents);

  const replaySession = paidLockerSession;
  if (replaySession === null) run.skip('replay', 'the parcel-locker payment was not confirmed');
  else await run.step('replay', () => replayLockerCheckout(request, key, replaySession));
  return run.result();
};

export const runPurchaseE2e = async (
  options: PurchaseE2eOptions,
  request: Fetch = fetch,
  timing: Timing = DEFAULT_TIMING,
): Promise<PurchaseE2eResult> => options.environment === 'production'
  ? runProductionPurchaseE2e(options, request, timing)
  : runStagingPurchaseE2e(options, request, timing);

type ApiClient = ReturnType<typeof createApiClient>;

type Fixtures = { parcelId: string; salesLinkId: string; stock: { onHand: number; reserved: number } | null };

const ensureFixtures = async (
  api: ApiClient,
  origin: string,
): Promise<Fixtures> => {
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
  const courier = {
    id: FIXTURE.courierRateId,
    label: FIXTURE.courierRateLabel,
    amountCents: FIXTURE.courierRateCents,
    vatRatePercent: 23,
    carrier: 'inpost',
    pickupPoint: 'none',
    active: true,
  } as const;
  const otherRates = (settings.shippingRates ?? []).filter((candidate) => candidate.id !== FIXTURE.rateId && candidate.id !== FIXTURE.courierRateId);
  valueOf(await api.updateTenantSettings({
    shippingRates: [...otherRates, rate, courier],
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

const fixtureOrigin = (baseUrl: string, platformDomain: string, environment: PurchaseE2eEnvironment): boolean => {
  if (!URL.canParse(baseUrl)) return false;
  const url = new URL(baseUrl);
  const productionHost = `${SMOKE_TENANT_SLUG}.${platformDomain}`;
  if (url.protocol !== 'https:' || url.port !== '' || url.pathname !== '/') return false;
  return environment === 'production'
    ? url.hostname === productionHost && url.username === '' && url.password === '' && url.search === '' && url.hash === ''
    : url.hostname.startsWith(`${SMOKE_TENANT_SLUG}.`) && url.hostname.endsWith(`.${platformDomain}`) && url.hostname !== productionHost;
};

const hostProblem = (environment: string): string => environment === 'production'
  ? `the base URL must be the https origin of the production ${SMOKE_TENANT_SLUG} fixture workspace`
  : `the base URL must be the https origin of the ${SMOKE_TENANT_SLUG} fixture workspace on a staging host of the platform domain`;

const SHOP_KEY_ENV = 'PURCHASE_E2E_PRODUCTION_SHOP_KEY';
const RUNNER_KEY_ENV = 'PURCHASE_E2E_PRODUCTION_STRIPE_KEY';
const PUBLISHABLE_KEY_ENV = 'PURCHASE_E2E_PRODUCTION_STRIPE_PUBLISHABLE_KEY';
const FINGERPRINT_ENV = 'PRODUCTION_DATABASE_FINGERPRINT';
const PRODUCTION_KEY_FORMAT = { restricted: /^rk_test_[A-Za-z0-9_]+$/, publishable: /^pk_test_[A-Za-z0-9_]+$/ };

const shopKeyProblem = (value: string | null): string | null => {
  if (value === null) return `${SHOP_KEY_ENV} is not configured`;
  return /^[A-Za-z0-9_-]{43}$/.test(value) ? null : `${SHOP_KEY_ENV} must be a shop management key`;
};

const productionKeyProblem = (name: string, kind: 'restricted' | 'publishable', value: string | null): string | null =>
  testModeKeyProblem(name, kind, value)
  ?? (value !== null && !PRODUCTION_KEY_FORMAT[kind].test(value) ? `${name} is not a valid test-mode key` : null);

const productionFingerprintProblem = (value: string | null): string | null => {
  if (value === null) return `${FINGERPRINT_ENV} is not configured`;
  return /^[0-9a-f]{12}$/.test(value) ? null : `${FINGERPRINT_ENV} must be a 12-digit hexadecimal fingerprint`;
};

const productionRunIdProblem = (runId: string): string | null =>
  purchaseSmokeStartSchema.shape.runId.safeParse(runId).success ? null : 'PURCHASE_E2E_RUN_ID must be a purchase smoke run identifier';

const nonNullProblems = (problems: ReadonlyArray<string | null>): string[] =>
  problems.filter((problem): problem is string => problem !== null);

const purchaseTargetProblems = (options: PurchaseE2eOptions): string[] => {
  const environment: string = options.environment;
  if (environment !== 'staging' && environment !== 'production') return ['the environment must be staging or production'];
  const host = fixtureOrigin(options.baseUrl, options.platformDomain, options.environment) ? null : hostProblem(environment);
  return nonNullProblems(options.environment === 'production' ? [
    host,
    shopKeyProblem(options.shopKey),
    productionKeyProblem(RUNNER_KEY_ENV, 'restricted', options.keys.restricted),
    productionKeyProblem(PUBLISHABLE_KEY_ENV, 'publishable', options.keys.publishable),
    productionFingerprintProblem(options.databaseFingerprint.production),
    productionRunIdProblem(options.runId),
  ] : [
    host,
    testModeKeyProblem('the restricted key', 'restricted', options.keys.restricted),
    testModeKeyProblem('the publishable key', 'publishable', options.keys.publishable),
    options.databaseFingerprint.production === null ? 'the production database fingerprint is missing' : null,
  ]);
};

const DEFAULT_TEST_ORDER_CAP = 300;

const productionOptionsFromEnv = (env: Environment, platformDomain: string): { options: ProductionPurchaseE2eOptions } | { problems: string[] } => {
  const baseUrl = provided(env, 'PURCHASE_E2E_BASE_URL');
  const shopKey = provided(env, SHOP_KEY_ENV);
  const restricted = provided(env, RUNNER_KEY_ENV);
  const publishable = provided(env, PUBLISHABLE_KEY_ENV);
  const production = provided(env, FINGERPRINT_ENV);
  const runId = provided(env, 'PURCHASE_E2E_RUN_ID') ?? String(Date.now());
  const problems = nonNullProblems([
    baseUrl === null ? 'PURCHASE_E2E_BASE_URL is not configured'
      : fixtureOrigin(baseUrl, platformDomain, 'production') ? null : `PURCHASE_E2E_BASE_URL: ${hostProblem('production')}`,
    shopKeyProblem(shopKey),
    productionKeyProblem(RUNNER_KEY_ENV, 'restricted', restricted),
    productionKeyProblem(PUBLISHABLE_KEY_ENV, 'publishable', publishable),
    productionFingerprintProblem(production),
    productionRunIdProblem(runId),
  ]);
  if (problems.length > 0 || baseUrl === null || shopKey === null || restricted === null || publishable === null || production === null) return { problems };
  return { options: {
    environment: 'production', baseUrl, shopKey, keys: { restricted, publishable }, runId, platformDomain,
    databaseFingerprint: { expected: production, production },
  } };
};

export const purchaseE2eOptionsFromEnv = (env: Environment): { options: PurchaseE2eOptions } | { problems: string[] } => {
  const platformDomain = provided(env, 'PURCHASE_E2E_PLATFORM_DOMAIN') ?? DEFAULT_PLATFORM_DOMAIN;
  const environment = provided(env, 'PURCHASE_E2E_ENVIRONMENT');
  if (environment === 'production') return productionOptionsFromEnv(env, platformDomain);
  const problems: string[] = [];
  if (environment !== 'staging') problems.push('PURCHASE_E2E_ENVIRONMENT must be staging or production');
  const baseUrl = provided(env, 'PURCHASE_E2E_BASE_URL');
  if (baseUrl === null) problems.push('PURCHASE_E2E_BASE_URL is not configured');
  else if (environment === 'staging' && !fixtureOrigin(baseUrl, platformDomain, environment)) problems.push(`PURCHASE_E2E_BASE_URL: ${hostProblem(environment)}`);
  const keyOf = (name: string, kind: 'restricted' | 'publishable'): string | null => {
    const value = provided(env, name);
    const problem = testModeKeyProblem(name, kind, value);
    if (problem !== null) problems.push(problem);
    return problem === null ? value : null;
  };
  const restricted = keyOf('STRIPE_TEST_RESTRICTED_KEY_STAGING', 'restricted');
  const publishable = keyOf('STRIPE_TEST_PUBLISHABLE_KEY_STAGING', 'publishable');
  const bypassSecret = provided(env, 'VERCEL_AUTOMATION_BYPASS_SECRET');
  if (environment === 'staging' && bypassSecret === null) problems.push('VERCEL_AUTOMATION_BYPASS_SECRET is not configured');
  const password = provided(env, 'PURCHASE_E2E_STAFF_PASSWORD_STAGING') ?? (environment === 'staging' ? DEMO_SEED_PASSWORD : null);
  if (password === null) problems.push('PURCHASE_E2E_STAFF_PASSWORD_STAGING is not configured');
  const productionFingerprint = provided(env, FINGERPRINT_ENV);
  if (productionFingerprint === null) problems.push(`${FINGERPRINT_ENV} is not configured`);
  const cap = Number(provided(env, 'PURCHASE_E2E_TEST_ORDER_CAP') ?? DEFAULT_TEST_ORDER_CAP);
  if (!Number.isInteger(cap) || cap <= 0) problems.push('PURCHASE_E2E_TEST_ORDER_CAP must be a positive integer');
  if (problems.length > 0 || environment !== 'staging' || baseUrl === null || restricted === null || publishable === null || password === null) {
    return { problems };
  }
  return {
    options: {
      baseUrl,
      environment,
      bypassSecret,
      staff: { email: provided(env, 'PURCHASE_E2E_STAFF_EMAIL') ?? SMOKE_TENANT_CREATOR_EMAIL, password },
      keys: { restricted, publishable },
      lockerCode: provided(env, 'PURCHASE_E2E_LOCKER_CODE') ?? DEFAULT_LOCKER_CODE,
      runId: provided(env, 'PURCHASE_E2E_RUN_ID') ?? String(Date.now()),
      testOrderCap: cap,
      databaseFingerprint: { expected: provided(env, 'PURCHASE_E2E_EXPECTED_DATABASE_FINGERPRINT'), production: productionFingerprint },
      platformDomain,
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
