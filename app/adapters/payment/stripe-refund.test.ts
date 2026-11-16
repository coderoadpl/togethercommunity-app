import { describe, expect, it } from 'vitest';
import Stripe from 'stripe';
import { err, ok, refundFailureOf, validation, type RefundFailureKind } from '#core/domain/index.js';
import { createFakePaymentProvider } from './fake.js';
import { createStripePaymentProvider } from './stripe.js';

const stripeJson = (body: unknown, status = 200): Response =>
  new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json', 'request-id': 'req_refund' } });

const stripeError = (status: number, error: { type?: string; code?: string; message: string }): Response =>
  stripeJson({ error: { type: 'invalid_request_error', ...error } }, status);

const refundObject = (overrides: Record<string, unknown> = {}) => ({
  id: 're_123', object: 'refund', amount: 4900, currency: 'pln', status: 'succeeded',
  payment_intent: 'pi_paid', failure_reason: null, metadata: { orderId: 'order-1', reason: 'out_of_stock', tenantId: 'tenant-1' },
  ...overrides,
});

const providerOverFetch = (respond: (request: Request) => Response) => {
  const requests: Request[] = [];
  const keys: string[] = [];
  const provider = createStripePaymentProvider({
    resolver: { resolve: async (_tenantId, key) => {
      keys.push(key);
      return ok(key === 'stripe.testRestrictedKey' ? 'rk_test_refund' : 'rk_live_refund');
    } },
    clientFactory: (key) => new Stripe(key, {
      maxNetworkRetries: 0,
      httpClient: Stripe.createFetchHttpClient(async (input: string | URL | Request, init?: RequestInit): Promise<Response> => {
        const request = new Request(input, init);
        requests.push(request.clone());
        return respond(request);
      }),
    }),
  });
  const { createRefund, getRefund, probeStripePermissions } = provider;
  if (createRefund === undefined || getRefund === undefined || probeStripePermissions === undefined) throw new Error('Refund methods missing');
  return { createRefund, getRefund, probeStripePermissions, requests, keys };
};

const refundInput = {
  mode: 'live' as const, tenantId: 'tenant-1', paymentIntentId: 'pi_paid', amountCents: 4900,
  idempotencyKey: 'oos-refund-order-1', metadata: { orderId: 'order-1', reason: 'out_of_stock' as const },
};

describe('Stripe createRefund', () => {
  it('posts the payment intent, amount, metadata and the idempotency key with the live key', async () => {
    const h = providerOverFetch(() => stripeJson(refundObject({ status: 'pending' })));
    expect(await h.createRefund(refundInput)).toEqual(ok({
      refundId: 're_123', paymentIntentId: 'pi_paid', amountCents: 4900, status: 'pending', failureReason: null,
    }));
    expect(h.requests).toHaveLength(1);
    const request = h.requests[0];
    if (request === undefined) throw new Error('Refund request missing');
    expect(request.method).toBe('POST');
    expect(new URL(request.url).pathname).toBe('/v1/refunds');
    expect(request.headers.get('idempotency-key')).toBe('oos-refund-order-1');
    expect(request.headers.get('authorization')).toBe('Bearer rk_live_refund');
    expect(Object.fromEntries(new URLSearchParams(await request.text()))).toEqual({
      payment_intent: 'pi_paid', amount: '4900',
      'metadata[tenantId]': 'tenant-1', 'metadata[orderId]': 'order-1', 'metadata[reason]': 'out_of_stock',
    });
    expect(h.keys).toEqual(['stripe.restrictedKey']);
  });

  it('uses the test-mode key for a test order', async () => {
    const h = providerOverFetch(() => stripeJson(refundObject()));
    expect(await h.createRefund({ ...refundInput, mode: 'test' })).toMatchObject({ ok: true, value: { status: 'succeeded' } });
    expect(h.keys).toEqual(['stripe.testRestrictedKey']);
    expect(h.requests[0]?.headers.get('authorization')).toBe('Bearer rk_test_refund');
  });

  it.each([0, -100, 49.5])('refuses amount %s without calling Stripe', async (amountCents) => {
    const h = providerOverFetch(() => stripeJson(refundObject()));
    const result = await h.createRefund({ ...refundInput, amountCents });
    expect(result.ok).toBe(false);
    if (result.ok) throw new Error('Expected a refusal');
    expect(refundFailureOf(result.error)).toEqual({ kind: 'refund_failed', providerCode: null });
    expect(h.requests).toHaveLength(0);
  });

  it('refuses an empty idempotency key without calling Stripe', async () => {
    const h = providerOverFetch(() => stripeJson(refundObject()));
    const result = await h.createRefund({ ...refundInput, idempotencyKey: ' ' });
    if (result.ok) throw new Error('Expected a refusal');
    expect(refundFailureOf(result.error)?.kind).toBe('refund_failed');
    expect(h.requests).toHaveLength(0);
  });

  it('reports missing credentials as credentials_unavailable', async () => {
    const provider = createStripePaymentProvider({
      resolver: { resolve: async () => err(validation('Stripe is not configured')) },
      clientFactory: () => { throw new Error('Must not construct a client'); },
    });
    const result = await provider.createRefund?.(refundInput);
    if (result === undefined || result.ok) throw new Error('Expected a refusal');
    expect(refundFailureOf(result.error)?.kind).toBe('credentials_unavailable');
  });

  it.each([
    ['permission missing (403)', 403, { type: 'invalid_request_error', message: 'The provided key does not have the required permissions for this endpoint' }, 'permission_missing', 'integration_auth'],
    ['permission missing (code)', 400, { code: 'permission_denied', message: 'Denied' }, 'permission_missing', 'integration_auth'],
    ['already refunded', 400, { code: 'charge_already_refunded', message: 'Charge ch_1 has already been refunded.' }, 'already_refunded', 'conflict'],
    ['insufficient balance', 400, { code: 'balance_insufficient', message: 'Insufficient available balance' }, 'insufficient_balance', 'integration_unavailable'],
    ['payment intent not found', 404, { code: 'resource_missing', message: "No such payment_intent: 'pi_paid'" }, 'not_found', 'not_found'],
    ['disputed payment', 400, { code: 'charge_disputed', message: 'Charge ch_1 has been charged back' }, 'refund_failed', 'validation'],
    ['idempotency parameter mismatch', 400, { type: 'idempotency_error', message: 'Keys for idempotent requests can only be used with the same parameters' }, 'refund_failed', 'validation'],
    ['concurrent request with the same key', 409, { code: 'idempotency_key_in_use', message: 'In use' }, 'transient', 'integration_unavailable'],
    ['lock timeout', 400, { code: 'lock_timeout', message: 'Locked' }, 'transient', 'integration_unavailable'],
    ['rate limit', 429, { code: 'rate_limit', message: 'Too many requests' }, 'transient', 'integration_unavailable'],
    ['server error', 500, { type: 'api_error', message: 'Something went wrong' }, 'transient', 'integration_unavailable'],
  ] as const)('maps %s', async (_name, status, error, kind: RefundFailureKind, code) => {
    const h = providerOverFetch(() => stripeError(status, error));
    const result = await h.createRefund(refundInput);
    if (result.ok) throw new Error('Expected a refusal');
    expect(result.error.code).toBe(code);
    expect(refundFailureOf(result.error)?.kind).toBe(kind);
    expect(result.error.message).toContain(error.message);
  });

  it('maps a network failure to transient', async () => {
    const h = providerOverFetch(() => { throw new TypeError('fetch failed'); });
    const result = await h.createRefund(refundInput);
    if (result.ok) throw new Error('Expected a refusal');
    expect(refundFailureOf(result.error)?.kind).toBe('transient');
  });

  it('maps an unparseable refund response to transient', async () => {
    const h = providerOverFetch(() => stripeJson({ object: 'refund', status: 'weird' }));
    const result = await h.createRefund(refundInput);
    if (result.ok) throw new Error('Expected a refusal');
    expect(refundFailureOf(result.error)?.kind).toBe('transient');
  });

  it('returns a refund that Stripe created as failed with its reason', async () => {
    const h = providerOverFetch(() => stripeJson(refundObject({ status: 'failed', failure_reason: 'insufficient_funds' })));
    expect(await h.createRefund(refundInput)).toMatchObject({ ok: true, value: { status: 'failed', failureReason: 'insufficient_funds' } });
  });
});

describe('Stripe getRefund', () => {
  it('reads the refund by id and maps its status', async () => {
    const h = providerOverFetch(() => stripeJson(refundObject({ status: 'failed', failure_reason: 'declined', payment_intent: { id: 'pi_paid' } })));
    expect(await h.getRefund({ mode: 'live', tenantId: 'tenant-1', refundId: 're_123' })).toEqual(ok({
      refundId: 're_123', paymentIntentId: 'pi_paid', amountCents: 4900, status: 'failed', failureReason: 'declined',
    }));
    const request = h.requests[0];
    expect(request?.method).toBe('GET');
    expect(new URL(request?.url ?? '').pathname).toBe('/v1/refunds/re_123');
  });

  it('maps a missing refund to not_found', async () => {
    const h = providerOverFetch(() => stripeError(404, { code: 'resource_missing', message: "No such refund: 're_123'" }));
    const result = await h.getRefund({ mode: 'live', tenantId: 'tenant-1', refundId: 're_123' });
    if (result.ok) throw new Error('Expected a refusal');
    expect(refundFailureOf(result.error)?.kind).toBe('not_found');
  });
});

describe('refund permission probe', () => {
  const probe = (refundAnswer: Response) => {
    const h = providerOverFetch((request) => {
      const path = new URL(request.url).pathname;
      if (path === '/v1/refunds') return refundAnswer;
      if (request.method === 'GET') return stripeJson({ object: 'list', data: [], has_more: false });
      if (path === '/v1/coupons') return stripeJson({ id: 'coupon_probe', object: 'coupon' });
      if (path === '/v1/promotion_codes') return stripeJson({ id: 'promo_probe', object: 'promotion_code' });
      if (path === '/v1/checkout/sessions') return stripeJson({ id: 'cs_probe', object: 'checkout.session' });
      return stripeJson({ id: 'probe_cleanup' });
    });
    return { h, run: () => h.probeStripePermissions({ tenantId: 'tenant-1', mode: 'live', origin: 'https://acme.example.test' }) };
  };
  const refundCheck = async (refundAnswer: Response) => {
    const { h, run } = probe(refundAnswer);
    const result = await run();
    if (!result.ok) throw new Error('Probe failed');
    return { check: result.value.find((check) => check.resource === 'Charges and Refunds'), h };
  };

  it('classifies resource_missing on a nonexistent payment intent as present', async () => {
    const { check, h } = await refundCheck(stripeError(404, { code: 'resource_missing', message: "No such payment_intent: 'pi_x'" }));
    expect(check).toEqual({ resource: 'Charges and Refunds', permission: 'write', status: 'ok' });
    const request = h.requests.find((candidate) => new URL(candidate.url).pathname === '/v1/refunds');
    if (request === undefined) throw new Error('Refund probe request missing');
    const body = new URLSearchParams(await request.text());
    expect(body.get('payment_intent')).toMatch(/^pi_togetherprobe[A-Za-z0-9]{24}$/);
    expect(body.has('amount')).toBe(false);
    expect(body.get('metadata[togetherProbe]')).toBe('1');
    expect(body.get('metadata[tenantId]')).toBe('tenant-1');
  });

  it('classifies a 403 as missing', async () => {
    const { check } = await refundCheck(stripeError(403, { message: 'The provided key does not have the required permissions for this endpoint' }));
    expect(check).toMatchObject({ resource: 'Charges and Refunds', permission: 'write', status: 'missing' });
  });

  it('reports any other refusal as an error', async () => {
    const { check } = await refundCheck(stripeError(400, { message: 'Invalid request' }));
    expect(check).toMatchObject({ status: 'error', detail: 'Invalid request' });
  });

  it('reports an accepted refund as an error rather than as present', async () => {
    const { check } = await refundCheck(stripeJson(refundObject()));
    expect(check).toMatchObject({ status: 'error' });
  });
});

describe('fake payment provider refunds', () => {
  const fake = () => {
    const provider = createFakePaymentProvider({ resolve: async () => ok('rk_test_fake') });
    const { createRefund, getRefund } = provider;
    if (createRefund === undefined || getRefund === undefined) throw new Error('Fake refund methods missing');
    return { createRefund, getRefund };
  };

  it('replays the same refund for the same idempotency key and reads it back', async () => {
    const f = fake();
    const first = await f.createRefund(refundInput);
    const second = await f.createRefund(refundInput);
    if (!first.ok || !second.ok) throw new Error('Fake refund failed');
    expect(second.value).toEqual(first.value);
    expect(await f.getRefund({ mode: 'live', tenantId: 'tenant-1', refundId: first.value.refundId })).toEqual(ok(first.value));
    const foreign = await f.getRefund({ mode: 'live', tenantId: 'tenant-2', refundId: first.value.refundId });
    if (foreign.ok) throw new Error('Expected not found');
    expect(refundFailureOf(foreign.error)?.kind).toBe('not_found');
  });

  it('refuses a reused key with different parameters', async () => {
    const f = fake();
    await f.createRefund(refundInput);
    const result = await f.createRefund({ ...refundInput, amountCents: 100 });
    if (result.ok) throw new Error('Expected a refusal');
    expect(refundFailureOf(result.error)?.kind).toBe('refund_failed');
  });
});
