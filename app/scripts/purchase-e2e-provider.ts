import { createHmac, randomBytes } from 'node:crypto';

import { z } from 'zod';

import { createStripePaymentProvider } from '#adapters/payment/stripe.js';
import { err, internal } from '#core/domain/index.js';

type Fetch = typeof fetch;

export const PROVIDER_API_ORIGIN = 'https://api.stripe.com';

/** The account default version that broke shipped orders on 2026-11-22. */
export const LEGACY_ACCOUNT_API_VERSION = '2020-03-02';

const TEST_CARD_TOKEN = 'tok_visa';

const providerErrorSchema = z.object({
  error: z.object({ message: z.string().optional(), param: z.string().optional(), code: z.string().optional() }),
});

const livemodeSchema = z.object({ livemode: z.boolean().optional() });

export type ProviderKeyKind = 'restricted' | 'publishable';

const KEY_PREFIXES: Record<ProviderKeyKind, string> = { restricted: 'rk_test_', publishable: 'pk_test_' };

export const testModeKeyProblem = (name: string, kind: ProviderKeyKind, value: string | null): string | null => {
  if (value === null) return `${name} is not configured`;
  return value.startsWith(KEY_PREFIXES[kind]) ? null : `${name} must be a test-mode key starting with ${KEY_PREFIXES[kind]}`;
};

export const TEST_CHECKOUT_SESSION_PATTERN = /cs_test_[A-Za-z0-9]+/;

const HOSTED_CHECKOUT_ORIGIN = 'https://checkout.stripe.com';
const HOSTED_CHECKOUT_PATH = /^\/c\/pay\/(cs_test_[A-Za-z0-9]+)$/;

export const checkoutSessionIdFromUrl = (url: string): string => {
  const parsed = new URL(url);
  const match = parsed.origin === HOSTED_CHECKOUT_ORIGIN ? HOSTED_CHECKOUT_PATH.exec(parsed.pathname) : null;
  if (match?.[1] === undefined) {
    throw new Error(`checkout answered ${parsed.origin}${parsed.pathname}, which is not a test-mode payment page`);
  }
  return match[1];
};

interface ProviderRequest {
  key: string;
  method: 'GET' | 'POST';
  path: string;
  params?: Record<string, string>;
  version?: string;
}

const providerCall = async (request: Fetch, call: ProviderRequest): Promise<unknown> => {
  const url = new URL(call.path, PROVIDER_API_ORIGIN);
  if (call.method === 'GET') {
    for (const [name, value] of Object.entries(call.params ?? {})) url.searchParams.set(name, value);
  }
  const response = await request(url, {
    method: call.method,
    redirect: 'error',
    headers: {
      authorization: `Bearer ${call.key}`,
      ...(call.version === undefined ? {} : { 'stripe-version': call.version }),
      ...(call.method === 'POST' ? { 'content-type': 'application/x-www-form-urlencoded' } : {}),
    },
    body: call.method === 'POST' ? new URLSearchParams(call.params ?? {}).toString() : null,
  });
  let json: unknown = null;
  try {
    json = await response.json();
  } catch {
    json = null;
  }
  if (!response.ok) {
    const failure = providerErrorSchema.safeParse(json);
    const detail = failure.success
      ? `: ${failure.data.error.message ?? failure.data.error.code ?? 'no message'}${failure.data.error.param === undefined ? '' : ` (param ${failure.data.error.param})`}`
      : '';
    throw new Error(`provider ${call.method} ${call.path} answered HTTP ${String(response.status)}${detail}`);
  }
  if (livemodeSchema.safeParse(json).data?.livemode === true) {
    throw new Error(`provider ${call.method} ${call.path} answered a live-mode object; the run stops`);
  }
  return json;
};

const providerCheckoutSessionSchema = z.object({
  id: z.string().regex(TEST_CHECKOUT_SESSION_PATTERN),
  livemode: z.literal(false),
  amount_total: z.number().int().nullable(),
  payment_intent: z.union([z.string(), z.object({ id: z.string() })]).nullable().optional(),
  payment_status: z.string(),
  status: z.string().nullable().optional(),
  shipping_address_collection: z.object({ allowed_countries: z.array(z.string()) }).nullable().optional(),
  shipping_options: z.array(z.object({ shipping_rate: z.union([z.string(), z.object({ id: z.string() })]).nullable().optional() })).optional(),
  consent_collection: z.object({ terms_of_service: z.string().nullable().optional() }).nullable().optional(),
});

export type ProviderCheckoutSession = z.output<typeof providerCheckoutSessionSchema>;

const idOf = (value: string | { id: string } | null | undefined): string | null =>
  value == null ? null : typeof value === 'string' ? value : value.id;

export const paymentIntentOf = (session: ProviderCheckoutSession): string | null => idOf(session.payment_intent);

export interface TestBuyerAddress {
  name: string;
  email: string;
  phone: string;
  line1: string;
  city: string;
  postalCode: string;
  country: string;
}

export const TEST_BUYER_ADDRESS: Omit<TestBuyerAddress, 'email'> = {
  name: 'Purchase Test Buyer',
  phone: '+48500100200',
  line1: 'Test Street 1',
  city: 'Warsaw',
  postalCode: '00-001',
  country: 'PL',
};

export const confirmParams = (
  session: ProviderCheckoutSession,
  paymentMethodId: string,
  buyer: TestBuyerAddress,
): Record<string, string> => {
  if (session.amount_total === null) throw new Error(`checkout session ${session.id} carries no amount_total`);
  const shippingRate = idOf(session.shipping_options?.[0]?.shipping_rate);
  return {
    payment_method: paymentMethodId,
    expected_amount: String(session.amount_total),
    ...(session.shipping_address_collection == null ? {} : {
      'shipping[name]': buyer.name,
      'shipping[address][line1]': buyer.line1,
      'shipping[address][city]': buyer.city,
      'shipping[address][postal_code]': buyer.postalCode,
      'shipping[address][country]': buyer.country,
      'shipping[phone]': buyer.phone,
    }),
    ...(shippingRate === null ? {} : { shipping_rate: shippingRate }),
    ...(session.consent_collection?.terms_of_service === 'required' ? { 'consent[terms_of_service]': 'accepted' } : {}),
  };
};

export const retrieveCheckoutSession = async (
  request: Fetch,
  key: string,
  sessionId: string,
  version?: string,
): Promise<{ parsed: ProviderCheckoutSession; raw: unknown }> => {
  const raw = await providerCall(request, {
    key,
    method: 'GET',
    path: `/v1/checkout/sessions/${encodeURIComponent(sessionId)}`,
    ...(version === undefined ? {} : { version }),
  });
  return { parsed: providerCheckoutSessionSchema.parse(raw), raw };
};

const paymentMethodSchema = z.object({ id: z.string().min(1) });

/**
 * The hosted payment page refuses browser automation, so the run completes the
 * session the way the provider's own CLI trigger fixture does: a test card
 * payment method confirmed on the session's payment page.
 */
export const completeTestCheckout = async (
  request: Fetch,
  keys: { restricted: string; publishable: string },
  sessionId: string,
  buyer: TestBuyerAddress,
  expectedAmountCents: number,
): Promise<ProviderCheckoutSession> => {
  const { parsed: session } = await retrieveCheckoutSession(request, keys.restricted, sessionId);
  if (session.amount_total !== expectedAmountCents) {
    throw new Error(`checkout session ${sessionId} charges ${String(session.amount_total)}, the fixture prices add up to ${String(expectedAmountCents)}`);
  }
  const paymentMethod = paymentMethodSchema.parse(await providerCall(request, {
    key: keys.publishable,
    method: 'POST',
    path: '/v1/payment_methods',
    params: {
      type: 'card',
      'card[token]': TEST_CARD_TOKEN,
      'billing_details[name]': buyer.name,
      'billing_details[email]': buyer.email,
    },
  }));
  await providerCall(request, { key: keys.publishable, method: 'GET', path: `/v1/payment_pages/${encodeURIComponent(sessionId)}` });
  await providerCall(request, {
    key: keys.publishable,
    method: 'POST',
    path: `/v1/payment_pages/${encodeURIComponent(sessionId)}/confirm`,
    params: confirmParams(session, paymentMethod.id, buyer),
  });
  return session;
};

const providerRefundListSchema = z.object({
  data: z.array(z.object({
    id: z.string(),
    amount: z.number().int(),
    status: z.string().nullable(),
    metadata: z.record(z.string()).nullable().optional(),
  })),
  has_more: z.boolean(),
});

export type ProviderRefund = z.output<typeof providerRefundListSchema>['data'][number];

export const listPaymentRefunds = async (request: Fetch, key: string, paymentIntentId: string): Promise<ProviderRefund[]> => {
  const list = providerRefundListSchema.parse(await providerCall(request, {
    key,
    method: 'GET',
    path: '/v1/refunds',
    params: { payment_intent: paymentIntentId, limit: '100' },
  }));
  if (list.has_more) throw new Error(`payment ${paymentIntentId} lists more than 100 refunds`);
  return list.data;
};

const REPLAY_SECRET = 'whsec_purchase_e2e_replay';

export const webhookSignatureHeader = (payloadRaw: string, secret: string, timestamp: number): string => {
  const signature = createHmac('sha256', secret).update(`${String(timestamp)}.${payloadRaw}`).digest('hex');
  return `t=${String(timestamp)},v1=${signature}`;
};

export const generateForwardingSecret = (): string => `whsec_${randomBytes(32).toString('base64url')}`;

export const FORWARDED_EVENT_TYPES = ['checkout.session.completed', 'charge.refunded'] as const;

const providerEventSchema = z.object({
  id: z.string().regex(/^evt_/),
  type: z.string(),
  livemode: z.literal(false),
  data: z.object({
    object: z.object({
      id: z.string(),
      payment_intent: z.union([z.string(), z.object({ id: z.string() })]).nullable().optional(),
    }).passthrough(),
  }),
}).passthrough();

export type ProviderEvent = z.output<typeof providerEventSchema>;

const providerEventListSchema = z.object({ data: z.array(z.unknown()), has_more: z.boolean() });

/**
 * The webhook body the provider sends is the Event object, frozen at creation,
 * so the event read back here is byte-for-byte what an endpoint on the account
 * default version would receive, minus the provider's own signature.
 */
export const listRecentEvents = async (
  request: Fetch,
  key: string,
  createdSinceSeconds: number,
): Promise<Array<{ event: ProviderEvent; raw: unknown }>> => {
  const params: Record<string, string> = { limit: '100', 'created[gte]': String(createdSinceSeconds) };
  FORWARDED_EVENT_TYPES.forEach((type, index) => { params[`types[${String(index)}]`] = type; });
  const list = providerEventListSchema.parse(await providerCall(request, { key, method: 'GET', path: '/v1/events', params }));
  return list.data.map((raw) => ({ event: providerEventSchema.parse(raw), raw }));
};

export const eventPaymentIntent = (event: ProviderEvent): string | null => idOf(event.data.object.payment_intent);

export interface ReplayExpectation {
  tenantId: string;
  amountTotalCents: number;
  shippingCostCents: number | null;
  shippingCountry: string | null;
}

/** A delivery the webhook parse cannot read is what refused every shipped order on 2026-11-22. */
export const replayCheckoutSession = async (
  session: unknown,
  apiVersion: string,
  expectation: ReplayExpectation,
  now: () => number = Date.now,
): Promise<string[]> => {
  const provider = createStripePaymentProvider({
    resolver: { resolve: async () => err(internal('the replay never reads tenant credentials')) },
  });
  const sessionId = z.object({ id: z.string() }).parse(session).id;
  const timestamp = Math.floor(now() / 1000);
  const payloadRaw = JSON.stringify({
    id: `evt_replay_${sessionId}`,
    object: 'event',
    api_version: apiVersion,
    created: timestamp,
    livemode: false,
    type: 'checkout.session.completed',
    data: { object: session },
  });
  const verified = await provider.verifyWebhookEvent({
    tenantId: expectation.tenantId,
    mode: 'test',
    payloadRaw,
    signatureHeader: webhookSignatureHeader(payloadRaw, REPLAY_SECRET, timestamp),
    webhookSecret: REPLAY_SECRET,
  });
  if (!verified.ok) return [`${apiVersion}: the adapter refused the session: ${verified.error.message}`];
  const checkout = verified.value.checkoutSession;
  if (checkout == null) return [`${apiVersion}: the adapter read no checkout session`];
  const problems: string[] = [];
  if (checkout.metadata.tenantId !== expectation.tenantId) {
    problems.push(`${apiVersion}: tenant ${String(checkout.metadata.tenantId)} instead of ${expectation.tenantId}`);
  }
  if (checkout.amountTotalCents !== expectation.amountTotalCents) {
    problems.push(`${apiVersion}: amount ${String(checkout.amountTotalCents)} instead of ${String(expectation.amountTotalCents)}`);
  }
  if (expectation.shippingCostCents !== null && checkout.shippingCostCents !== expectation.shippingCostCents) {
    problems.push(`${apiVersion}: shipping cost ${String(checkout.shippingCostCents ?? null)} instead of ${String(expectation.shippingCostCents)}`);
  }
  if (expectation.shippingCountry !== null && checkout.shipping?.address.country !== expectation.shippingCountry) {
    problems.push(`${apiVersion}: delivery country ${String(checkout.shipping?.address.country ?? null)} instead of ${expectation.shippingCountry}`);
  }
  return problems;
};
