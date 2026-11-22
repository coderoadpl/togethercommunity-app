import { afterEach, describe, expect, it, vi } from 'vitest';
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
  const { createRefund, getRefund, listRefunds, probeStripePermissions } = provider;
  if (createRefund === undefined || getRefund === undefined || listRefunds === undefined || probeStripePermissions === undefined) throw new Error('Refund methods missing');
  return { createRefund, getRefund, listRefunds, probeStripePermissions, requests, keys };
};

const refundInput = {
  mode: 'live' as const, tenantId: 'tenant-1', paymentIntentId: 'pi_paid', amountCents: 4900,
  idempotencyKey: 'oos-refund-order-1', metadata: { orderId: 'order-1', reason: 'out_of_stock' as const },
};

describe('Stripe createRefund', () => {
  it('posts the payment intent, amount, metadata and the idempotency key with the live key', async () => {
    const h = providerOverFetch(() => stripeJson(refundObject({ status: 'pending' })));
    expect(await h.createRefund(refundInput)).toEqual(ok({
      refundId: 're_123', paymentIntentId: 'pi_paid', amountCents: 4900, status: 'pending', failureReason: null, orderId: 'order-1', reason: 'out_of_stock',
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

  it('tags a staff refund with its refund id and reads it back from the refund metadata', async () => {
    const staffMetadata = { orderId: 'order-1', reason: 'staff', refundJobId: 'refund-7', tenantId: 'tenant-1' };
    const h = providerOverFetch(() => stripeJson(refundObject({ amount: 1500, metadata: staffMetadata })));
    expect(await h.createRefund({ ...refundInput, amountCents: 1500, idempotencyKey: 'staff-refund-refund-7', metadata: { orderId: 'order-1', reason: 'staff', refundJobId: 'refund-7' } })).toEqual(ok({
      refundId: 're_123', paymentIntentId: 'pi_paid', amountCents: 1500, status: 'succeeded', failureReason: null, orderId: 'order-1', reason: 'staff', refundJobId: 'refund-7',
    }));
    const request = h.requests[0];
    if (request === undefined) throw new Error('Refund request missing');
    expect(Object.fromEntries(new URLSearchParams(await request.text()))).toEqual({
      payment_intent: 'pi_paid', amount: '1500',
      'metadata[tenantId]': 'tenant-1', 'metadata[orderId]': 'order-1', 'metadata[reason]': 'staff', 'metadata[refundJobId]': 'refund-7',
    });
  });

  it('reads a refund without metadata, as an account on an old API version may return it', async () => {
    const h = providerOverFetch(() => stripeJson({ data: [refundObject({ metadata: null }), refundObject({ id: 're_2', metadata: {} })], has_more: false, object: 'list', url: '/v1/refunds' }));
    expect(await h.listRefunds({ mode: 'live', tenantId: 'tenant-1', paymentIntentId: 'pi_paid' })).toMatchObject({
      ok: true, value: [{ refundId: 're_123', orderId: null, reason: null }, { refundId: 're_2', orderId: null, reason: null }],
    });
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
    expect(refundFailureOf(result.error)).toEqual({ kind: 'refund_failed', providerCode: null, outcomeUnknown: false });
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
    ['idempotency parameter mismatch', 400, { type: 'idempotency_error', message: 'Keys for idempotent requests can only be used with the same parameters' }, 'idempotency_mismatch', 'conflict'],
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

  it('maps a network failure to transient with an unknown outcome', async () => {
    const h = providerOverFetch(() => { throw new TypeError('fetch failed'); });
    const result = await h.createRefund(refundInput);
    if (result.ok) throw new Error('Expected a refusal');
    expect(refundFailureOf(result.error)).toMatchObject({ kind: 'transient', outcomeUnknown: true });
  });

  it.each([
    ['a concurrent request with the same key', 409, { code: 'idempotency_key_in_use', message: 'In use' }, true],
    ['a server error', 500, { type: 'api_error', message: 'Something went wrong' }, false],
    ['a short balance', 400, { code: 'balance_insufficient', message: 'Insufficient available balance' }, false],
    ['a missing permission', 403, { message: 'The provided key does not have the required permissions for this endpoint' }, false],
    ['an idempotency parameter mismatch', 400, { type: 'idempotency_error', message: 'Keys for idempotent requests can only be used with the same parameters' }, false],
  ] as const)('reports whether the outcome of %s is unknown', async (_name, status, error, outcomeUnknown) => {
    const h = providerOverFetch(() => stripeError(status, error));
    const result = await h.createRefund(refundInput);
    if (result.ok) throw new Error('Expected a refusal');
    expect(refundFailureOf(result.error)?.outcomeUnknown).toBe(outcomeUnknown);
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

describe('refund request deadline', () => {
  afterEach(() => { vi.useRealTimers(); });

  const providerOverHangingFetch = () => {
    const requests: string[] = [];
    const provider = createStripePaymentProvider({
      resolver: { resolve: async () => ok('rk_live_refund') },
      clientFactory: (key) => new Stripe(key, {
        httpClient: Stripe.createFetchHttpClient(async (input: string | URL | Request, init?: RequestInit): Promise<Response> => {
          requests.push(new Request(input, init).method);
          return new Promise((_resolve, reject) => {
            init?.signal?.addEventListener('abort', () => { reject(init.signal?.reason); });
          });
        }),
      }),
    });
    const requestCount = async (count: number) => {
      const giveUpAt = Date.now() + 5_000;
      while (requests.length < count) {
        if (Date.now() > giveUpAt) throw new Error(`Expected ${String(count)} requests, saw ${String(requests.length)}`);
        await new Promise((resolve) => { setImmediate(resolve); });
      }
    };
    return { provider, requests, requestCount };
  };

  it.each([
    ['createRefund', 'POST', (provider: ReturnType<typeof createStripePaymentProvider>) => provider.createRefund?.(refundInput)],
    ['getRefund', 'GET', (provider: ReturnType<typeof createStripePaymentProvider>) => provider.getRefund?.({ mode: 'live', tenantId: 'tenant-1', refundId: 're_123' })],
    ['listRefunds', 'GET', (provider: ReturnType<typeof createStripePaymentProvider>) => provider.listRefunds?.({ mode: 'live', tenantId: 'tenant-1', paymentIntentId: 'pi_paid' })],
  ] as const)('%s gives up after five seconds without a network retry when Stripe does not answer', async (_name, method, call) => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
    const h = providerOverHangingFetch();
    let settled = false;
    const pending = Promise.resolve(call(h.provider)).finally(() => { settled = true; });
    await h.requestCount(1);
    await vi.advanceTimersByTimeAsync(4_999);
    expect(settled).toBe(false);
    await vi.advanceTimersByTimeAsync(1);
    const result = await pending;
    if (result === undefined || result.ok) throw new Error('Expected a timeout');
    expect(result.error.message).toContain('Request aborted due to timeout being reached (5000ms)');
    expect(refundFailureOf(result.error)).toMatchObject({ kind: 'transient', outcomeUnknown: true });
    expect(h.requests).toStrictEqual([method]);
  });
});

describe('Stripe getRefund', () => {
  it('reads the refund by id and maps its status', async () => {
    const h = providerOverFetch(() => stripeJson(refundObject({ status: 'failed', failure_reason: 'declined', payment_intent: { id: 'pi_paid' } })));
    expect(await h.getRefund({ mode: 'live', tenantId: 'tenant-1', refundId: 're_123' })).toEqual(ok({
      refundId: 're_123', paymentIntentId: 'pi_paid', amountCents: 4900, status: 'failed', failureReason: 'declined', orderId: 'order-1', reason: 'out_of_stock',
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

describe('Stripe listRefunds', () => {
  it('lists the refunds of the payment intent with the order and reason a refund was issued for', async () => {
    const h = providerOverFetch(() => stripeJson({ object: 'list', has_more: false, data: [
      refundObject({ id: 're_2', amount: 2000, status: 'pending' }),
      refundObject({ id: 're_1', amount: 1000, status: 'failed', failure_reason: 'declined', metadata: {} }),
    ] }));
    expect(await h.listRefunds({ mode: 'test', tenantId: 'tenant-1', paymentIntentId: 'pi_paid' })).toEqual(ok([
      { refundId: 're_2', paymentIntentId: 'pi_paid', amountCents: 2000, status: 'pending', failureReason: null, orderId: 'order-1', reason: 'out_of_stock' },
      { refundId: 're_1', paymentIntentId: 'pi_paid', amountCents: 1000, status: 'failed', failureReason: 'declined', orderId: null, reason: null },
    ]));
    const request = h.requests[0];
    expect(request?.method).toBe('GET');
    const url = new URL(request?.url ?? '');
    expect(url.pathname).toBe('/v1/refunds');
    expect(Object.fromEntries(url.searchParams)).toEqual({ payment_intent: 'pi_paid', limit: '100' });
    expect(h.keys).toEqual(['stripe.testRestrictedKey']);
  });

  it('refuses a payment with more refunds than one page', async () => {
    const h = providerOverFetch(() => stripeJson({ object: 'list', has_more: true, data: [refundObject()] }));
    const result = await h.listRefunds({ mode: 'live', tenantId: 'tenant-1', paymentIntentId: 'pi_paid' });
    if (result.ok) throw new Error('Expected a refusal');
    expect(refundFailureOf(result.error)?.kind).toBe('refund_failed');
  });

  it('maps a missing permission', async () => {
    const h = providerOverFetch(() => stripeError(403, { message: 'The provided key does not have the required permissions for this endpoint' }));
    const result = await h.listRefunds({ mode: 'live', tenantId: 'tenant-1', paymentIntentId: 'pi_paid' });
    if (result.ok) throw new Error('Expected a refusal');
    expect(refundFailureOf(result.error)?.kind).toBe('permission_missing');
  });
});

describe('refund permission probe', () => {
  const isRefundProbe = (request: Request): boolean => new URL(request.url).pathname.startsWith('/v1/refunds/');
  const probe = (refundAnswer: () => Response) => {
    const h = providerOverFetch((request) => {
      const path = new URL(request.url).pathname;
      if (isRefundProbe(request)) return refundAnswer();
      if (request.method === 'GET') return stripeJson({ object: 'list', data: [], has_more: false });
      if (path === '/v1/coupons') return stripeJson({ id: 'coupon_probe', object: 'coupon' });
      if (path === '/v1/promotion_codes') return stripeJson({ id: 'promo_probe', object: 'promotion_code' });
      if (path === '/v1/checkout/sessions') return stripeJson({ id: 'cs_probe', object: 'checkout.session' });
      return stripeJson({ id: 'probe_cleanup' });
    });
    return { h, run: () => h.probeStripePermissions({ tenantId: 'tenant-1', mode: 'live', origin: 'https://acme.example.test' }) };
  };
  const refundCheck = async (refundAnswer: () => Response) => {
    const { h, run } = probe(refundAnswer);
    const result = await run();
    if (!result.ok) throw new Error('Probe failed');
    return { check: result.value.find((check) => check.resource === 'Charges and Refunds'), h };
  };

  it('updates a nonexistent refund with probe metadata and reads resource_missing as the permission being present', async () => {
    const { check, h } = await refundCheck(() => stripeError(404, { code: 'resource_missing', message: "No such refund: 're_x'" }));
    expect(check).toEqual({ resource: 'Charges and Refunds', permission: 'write', status: 'ok' });
    const probes = h.requests.filter(isRefundProbe);
    expect(probes).toHaveLength(1);
    const request = probes[0];
    if (request === undefined) throw new Error('Refund probe request missing');
    expect(request.method).toBe('POST');
    expect(new URL(request.url).pathname).toMatch(/^\/v1\/refunds\/re_togetherprobe[A-Za-z0-9]{24}$/);
    expect(request.headers.get('authorization')).toBe('Bearer rk_live_refund');
    expect(Object.fromEntries(new URLSearchParams(await request.text()))).toEqual({ 'metadata[togetherProbe]': '1', 'metadata[tenantId]': 'tenant-1' });
    expect(h.requests.some((candidate) => candidate.method === 'POST' && new URL(candidate.url).pathname === '/v1/refunds')).toBe(false);
  });

  it('draws a fresh refund id for every probe run', async () => {
    const { h, run } = probe(() => stripeError(404, { code: 'resource_missing', message: 'No such refund' }));
    await run();
    await run();
    const paths = h.requests.filter(isRefundProbe).map((request) => new URL(request.url).pathname);
    expect(paths).toHaveLength(2);
    expect(new Set(paths).size).toBe(2);
  });

  it.each([
    ['more_permissions_required', { code: 'more_permissions_required', message: 'This key needs more permissions' }],
    ['the permission message', { message: "The provided key 'rk_live_x' does not have the required permissions for this endpoint" }],
    ['permission_denied', { code: 'permission_denied', message: 'Permission denied' }],
  ] as const)('reports a 403 with %s as missing', async (_label, error) => {
    const { check } = await refundCheck(() => stripeError(403, error));
    expect(check).toEqual({ resource: 'Charges and Refunds', permission: 'write', status: 'missing', detail: error.message });
  });

  it('reports a 403 that names no missing permission as an error', async () => {
    const { check } = await refundCheck(() => stripeError(403, { code: 'account_invalid', message: 'This account cannot make live charges' }));
    expect(check).toEqual({ resource: 'Charges and Refunds', permission: 'write', status: 'error', detail: 'This account cannot make live charges' });
  });

  it.each([
    [400, { code: 'parameter_invalid_empty', message: 'Invalid request' }],
    [404, { message: 'Unrecognized request URL' }],
    [500, { type: 'api_error', message: 'Something went wrong' }],
  ] as const)('reports a %s answer that is not resource_missing as an error', async (status, error) => {
    const { check } = await refundCheck(() => stripeError(status, error));
    expect(check).toEqual({ resource: 'Charges and Refunds', permission: 'write', status: 'error', detail: error.message });
  });

  it('reports a network failure as an error', async () => {
    const { check } = await refundCheck(() => { throw new TypeError('fetch failed'); });
    expect(check).toMatchObject({ resource: 'Charges and Refunds', permission: 'write', status: 'error' });
    expect(check?.detail).toEqual(expect.any(String));
  });

  it('reports an unexpected successful update as an error rather than as present', async () => {
    const { check } = await refundCheck(() => stripeJson(refundObject({ id: 're_togetherprobe' })));
    expect(check).toEqual({ resource: 'Charges and Refunds', permission: 'write', status: 'error', detail: 'Stripe updated a refund that should not exist' });
  });
});

describe('fake payment provider refunds', () => {
  const fake = (chargeAmountCents?: Record<string, number>) => {
    const provider = createFakePaymentProvider({ resolve: async () => ok('rk_test_fake') }, chargeAmountCents === undefined ? {} : { chargeAmountCents });
    const { createRefund, getRefund, listRefunds } = provider;
    if (createRefund === undefined || getRefund === undefined || listRefunds === undefined) throw new Error('Fake refund methods missing');
    return { createRefund, getRefund, listRefunds };
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

  it('never refunds a payment intent beyond its charge and saves that error under the key', async () => {
    const f = fake();
    const first = await f.createRefund(refundInput);
    if (!first.ok) throw new Error('Fake refund failed');
    const second = await f.createRefund({ ...refundInput, idempotencyKey: 'oos-refund-order-1-1' });
    if (second.ok) throw new Error('Expected a refusal');
    expect(refundFailureOf(second.error)).toMatchObject({ kind: 'already_refunded', providerCode: 'charge_already_refunded' });
    expect(await f.createRefund({ ...refundInput, idempotencyKey: 'oos-refund-order-1-1' })).toEqual(second);
    expect(await f.listRefunds({ mode: 'live', tenantId: 'tenant-1', paymentIntentId: 'pi_paid' })).toEqual(ok([first.value]));
  });

  it('refunds the rest of a partly refunded charge and refuses more than is left', async () => {
    const f = fake({ pi_paid: 4900 });
    const part = await f.createRefund({ ...refundInput, amountCents: 2000, idempotencyKey: 'by-hand' });
    if (!part.ok) throw new Error('Fake refund failed');
    const tooMuch = await f.createRefund({ ...refundInput, idempotencyKey: 'too-much' });
    if (tooMuch.ok) throw new Error('Expected a refusal');
    expect(refundFailureOf(tooMuch.error)?.kind).toBe('refund_failed');
    const rest = await f.createRefund({ ...refundInput, amountCents: 2900, idempotencyKey: 'rest' });
    expect(rest).toMatchObject({ ok: true, value: { amountCents: 2900, status: 'succeeded' } });
    const listed = await f.listRefunds({ mode: 'live', tenantId: 'tenant-1', paymentIntentId: 'pi_paid' });
    expect(listed.ok ? listed.value.map((refund) => refund.amountCents) : []).toEqual([2900, 2000]);
    expect(await f.listRefunds({ mode: 'live', tenantId: 'tenant-2', paymentIntentId: 'pi_paid' })).toEqual(ok([]));
  });

  it('lists a staff refund with the refund id it was tagged with', async () => {
    const f = fake({ pi_paid: 4900 });
    const staff = await f.createRefund({ ...refundInput, amountCents: 1500, idempotencyKey: 'staff-refund-refund-7', metadata: { orderId: 'order-1', reason: 'staff', refundJobId: 'refund-7' } });
    expect(staff).toMatchObject({ ok: true, value: { amountCents: 1500, reason: 'staff', refundJobId: 'refund-7' } });
    const tooMuch = await f.createRefund({ ...refundInput, amountCents: 3401, idempotencyKey: 'staff-refund-refund-8', metadata: { orderId: 'order-1', reason: 'staff', refundJobId: 'refund-8' } });
    expect(tooMuch.ok ? null : refundFailureOf(tooMuch.error)?.kind).toBe('refund_failed');
  });
});
