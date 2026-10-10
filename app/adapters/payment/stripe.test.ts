import { probeStripePermissions } from '#core/server/index.js';
import { tenantDomainRepositoryStub } from '#core/server/testing/tenant-domain-fakes.js';
import { ok } from '#core/domain/index.js';
import { describe, expect, it } from 'vitest';
import Stripe from 'stripe';

import {
  STRIPE_WEBHOOK_EVENTS,
  createStripePaymentProvider,
  stripeCancelAlreadySettled,
  stripeCheckoutSessionParams,
  stripeCouponParams,
} from './stripe.js';
import { HANDLED_EVENT_TYPES } from '#core/server/index.js';

const webhookSecret = 'whsec_test_secret';
const stripe = new Stripe('sk_test_unused');
const provider = createStripePaymentProvider({
  resolver: { resolve: async () => { throw new Error('unused'); } },
});

const webhookUrl = 'https://app.example.test/api/webhooks/stripe/tenant-1';

const providerOverHttp = (
  respond: (request: Request) => Response,
  registered: unknown[] = [],
) => {
  const requests: Request[] = [];
  const httpClient = Stripe.createFetchHttpClient(async (
    input: string | URL | Request,
    init?: RequestInit,
  ): Promise<Response> => {
    const request = new Request(input, init);
    requests.push(request);
    if (request.method === 'GET') {
      return stripeJson({
        object: 'list',
        data: registered,
        has_more: false,
        url: '/v1/webhook_endpoints',
      });
    }
    return respond(request);
  });
  const created = createStripePaymentProvider({
    resolver: { resolve: async () => { throw new Error('unused'); } },
    clientFactory: (key) => new Stripe(key, { httpClient, maxNetworkRetries: 0 }),
  });
  if (created.configureWebhook === undefined) throw new Error('configureWebhook missing');
  if (created.deleteWebhookEndpoint === undefined) throw new Error('deleteWebhookEndpoint missing');
  return {
    configureWebhook: created.configureWebhook,
    deleteWebhookEndpoint: created.deleteWebhookEndpoint,
    requests,
  };
};

const stripeJson = (body: unknown, status = 200): Response =>
  new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json', 'request-id': 'req_123' },
  });

describe('configureWebhook', () => {
  it('creates the endpoint through the Stripe client using a mocked HTTP transport', async () => {
    const stripeApi = providerOverHttp(() => stripeJson({
      id: 'we_123',
      object: 'webhook_endpoint',
      secret: 'whsec_generated',
      status: 'enabled',
      url: webhookUrl,
      enabled_events: STRIPE_WEBHOOK_EVENTS,
    }));

    await expect(stripeApi.configureWebhook({
      tenantId: 'tenant-1',
      restrictedKey: 'rk_test_private',
      webhookUrl,
    })).resolves.toEqual({
      ok: true,
      value: { webhookEndpointId: 'we_123', webhookSecret: 'whsec_generated' },
    });

    expect(stripeApi.requests).toHaveLength(2);
    expect(stripeApi.requests[0]?.method).toBe('GET');
    const request = stripeApi.requests[1];
    if (request === undefined) throw new Error('Stripe request missing');
    expect(request.method).toBe('POST');
    expect(request.url).toBe('https://api.stripe.com/v1/webhook_endpoints');
    expect(request.headers.get('authorization')).toBe('Bearer rk_test_private');
    const body = new URLSearchParams(await request.text());
    expect(body.get('url')).toBe(webhookUrl);
    expect(body.get('metadata[tenantId]')).toBe('tenant-1');
    expect(STRIPE_WEBHOOK_EVENTS.every((event) => [...body.values()].includes(event))).toBe(true);
  });

  it('replaces the tenant endpoints of the same slot and preserves the other slot and other tenants', async () => {
    const stripeApi = providerOverHttp((request) => {
      if (request.method === 'DELETE') {
        const id = new URL(request.url).pathname.split('/').at(-1);
        return stripeJson({ id, object: 'webhook_endpoint', deleted: true });
      }
      return stripeJson({
        id: 'we_new',
        object: 'webhook_endpoint',
        secret: 'whsec_new',
        status: 'enabled',
        url: webhookUrl,
        enabled_events: STRIPE_WEBHOOK_EVENTS,
      });
    }, [
      {
        id: 'we_metadata',
        object: 'webhook_endpoint',
        metadata: { tenantId: 'tenant-1' },
        status: 'enabled',
        url: `${webhookUrl}?mode=test`,
      },
      {
        id: 'we_manual',
        object: 'webhook_endpoint',
        status: 'enabled',
        url: webhookUrl,
      },
      {
        id: 'we_renamed',
        object: 'webhook_endpoint',
        metadata: { tenantId: 'tenant-1' },
        status: 'enabled',
        url: 'https://old.example.test/api/webhooks/stripe/tenant-1',
      },
      {
        id: 'we_other',
        object: 'webhook_endpoint',
        metadata: { tenantId: 'tenant-2' },
        status: 'enabled',
        url: 'https://app.example.test/api/webhooks/stripe/tenant-2',
      },
    ]);

    await expect(stripeApi.configureWebhook({
      tenantId: 'tenant-1',
      restrictedKey: 'rk_live_private',
      webhookUrl,
    })).resolves.toEqual({
      ok: true,
      value: { webhookEndpointId: 'we_new', webhookSecret: 'whsec_new' },
    });
    expect(stripeApi.requests.map((request) => `${request.method} ${new URL(request.url).pathname}`))
      .toEqual([
        'GET /v1/webhook_endpoints',
        'DELETE /v1/webhook_endpoints/we_manual',
        'DELETE /v1/webhook_endpoints/we_renamed',
        'POST /v1/webhook_endpoints',
      ]);
  });

  it('keeps the registered event list equal to the fulfillment handler set', () => {
    expect([...HANDLED_EVENT_TYPES]).toEqual([...STRIPE_WEBHOOK_EVENTS]);
    expect(STRIPE_WEBHOOK_EVENTS).toContain('checkout.session.async_payment_succeeded');
    expect(STRIPE_WEBHOOK_EVENTS).toContain('checkout.session.async_payment_failed');
  });

  it('deletes a newly registered endpoint during persistence cleanup', async () => {
    const stripeApi = providerOverHttp(() => stripeJson({
      id: 'we_created',
      object: 'webhook_endpoint',
      deleted: true,
    }));

    await expect(stripeApi.deleteWebhookEndpoint({
      restrictedKey: 'rk_test_private',
      webhookEndpointId: 'we_created',
    })).resolves.toEqual({ ok: true, value: { deleted: true } });
    expect(stripeApi.requests).toHaveLength(1);
    expect(stripeApi.requests[0]?.method).toBe('DELETE');
    expect(new URL(stripeApi.requests[0]?.url ?? '').pathname)
      .toBe('/v1/webhook_endpoints/we_created');
  });

  it('turns a rejected registration into a readable diagnostic', async () => {
    const stripeApi = providerOverHttp(() => stripeJson({
      error: { type: 'invalid_request_error', message: 'The key lacks webhook_endpoint write access' },
    }, 403));

    await expect(stripeApi.configureWebhook({
      tenantId: 'tenant-1',
      restrictedKey: 'rk_live_private',
      webhookUrl,
    })).resolves.toMatchObject({
      ok: false,
      error: {
        code: 'validation',
        message: 'Stripe rejected webhook registration: The key lacks webhook_endpoint write access',
      },
    });
  });

  it('rejects a registration Stripe answers without a signing secret', async () => {
    const stripeApi = providerOverHttp(() => stripeJson({
      id: 'we_123',
      object: 'webhook_endpoint',
      status: 'enabled',
      url: webhookUrl,
      enabled_events: STRIPE_WEBHOOK_EVENTS,
    }));

    await expect(stripeApi.configureWebhook({
      tenantId: 'tenant-1',
      restrictedKey: 'rk_live_private',
      webhookUrl,
    })).resolves.toMatchObject({ ok: false, error: { code: 'validation' } });
  });
});

const verify = (
  payload: string,
  secret = webhookSecret,
  signedPayload = payload,
  timestamp?: number,
) => provider.verifyWebhookEvent({
  payloadRaw: payload,
  signatureHeader: stripe.webhooks.generateTestHeaderString({
    payload: signedPayload,
    secret: webhookSecret,
    ...(timestamp === undefined ? {} : { timestamp }),
  }),
  webhookSecret: secret,
});

describe('stripeCancelAlreadySettled', () => {
  it.each([
    [{ code: 'resource_missing', statusCode: 404 }, true],
    [
      {
        statusCode: 400,
        message: 'A canceled subscription can only update its cancellation_details.',
      },
      true,
    ],
    [{ statusCode: 500, message: 'Stripe is down' }, false],
    [undefined, false],
    ['resource_missing', false],
  ])('maps %j to %s', (cause, expected) => {
    expect(stripeCancelAlreadySettled(cause)).toBe(expected);
  });
});

describe('stripeCheckoutSessionParams', () => {
  it('maps checkout intent into hosted payment fields and fulfillment metadata', () => {
    const params = stripeCheckoutSessionParams({
      tenantId: 'tenant-a',
      productId: 'product-1',
      productName: 'Course One',
      priceCents: 4900,
      currency: 'PLN',
      successUrl: 'https://alpha.example.com/checkout/product-1?status=success&session_id={CHECKOUT_SESSION_ID}',
      cancelUrl: 'https://alpha.example.com/checkout/product-1?status=cancelled',
      customerEmail: 'buyer@example.com',
      language: 'pl',
      checkoutConsentCaptureId: 'capture-opaque-1',
    });

    expect(params).toMatchObject({
      mode: 'payment',
      customer_email: 'buyer@example.com',
      locale: 'pl',
      metadata: {
        tenantId: 'tenant-a',
        productId: 'product-1',
        memberEmail: 'buyer@example.com',
        language: 'pl',
        checkoutConsentCaptureId: 'capture-opaque-1',
      },
      line_items: [
        {
          quantity: 1,
          price_data: {
            currency: 'pln',
            unit_amount: 4900,
            product_data: { name: 'Course One' },
          },
        },
      ],
    });
    expect(JSON.stringify(params.metadata)).not.toContain('Acme');
    expect(JSON.stringify(params.metadata)).not.toContain('5555555555');
  });

  it('keeps every metadata value inside the Stripe 500-character cap', () => {
    const params = stripeCheckoutSessionParams({
      tenantId: 'tenant-a',
      productId: 'product-1',
      productName: 'Course One',
      priceCents: 4900,
      currency: 'PLN',
      successUrl: 'https://alpha.example.com/checkout/product-1?status=success',
      cancelUrl: 'https://alpha.example.com/checkout/product-1?status=cancelled',
      customerEmail: 'buyer@example.com',
      language: 'pl',
      priceId: 'price-1',
      checkoutConsentCaptureId: 'capture-opaque-1',
    });

    const values = Object.values(params.metadata ?? {});
    expect(values).not.toHaveLength(0);
    for (const value of values) {
      expect(String(value).length).toBeLessThanOrEqual(500);
    }
  });

  it('applies the server-selected promotion code', () => {
    const params = stripeCheckoutSessionParams({
      tenantId: 'tenant-a',
      productId: 'product-1',
      productName: 'Course One',
      priceCents: 4900,
      currency: 'PLN',
      successUrl: 'https://alpha.example.com/success',
      cancelUrl: 'https://alpha.example.com/cancel',
      promotionCodeId: 'promo-1',
      couponCheckoutSessionId: 'coupon-session-1',
    });
    expect(params.discounts).toEqual([{ promotion_code: 'promo-1' }]);
    expect(params.metadata).toMatchObject({ couponCheckoutSessionId: 'coupon-session-1' });
  });
});

describe('stripeCouponParams', () => {
  const input = {
    tenantId: 'tenant-a',
    couponId: 'coupon-1',
    code: 'SAVE',
    kind: 'percent' as const,
    value: 25,
    currency: 'PLN',
    recurringDuration: 'first_invoice' as const,
    stripeCouponId: null,
    stripePromotionCodeId: null,
  };

  it('maps first invoice percentage discounts to once', () => {
    expect(stripeCouponParams(input)).toMatchObject({ duration: 'once', percent_off: 25 });
  });

  it('maps forever fixed discounts with minor-unit currency', () => {
    expect(
      stripeCouponParams({
        ...input,
        kind: 'amount',
        value: 1200,
        recurringDuration: 'forever',
      }),
    ).toMatchObject({ duration: 'forever', amount_off: 1200, currency: 'pln' });
  });
});

describe('verifyWebhookEvent', () => {
  it('accepts a valid signature and rejects payload or secret tampering', async () => {
    const payload = JSON.stringify({
      id: 'evt_checkout',
      type: 'checkout.session.completed',
      data: {
        object: {
          id: 'cs_1',
          customer_details: { email: 'buyer@example.test' },
          subscription: null,
          payment_intent: 'pi_1',
          invoice: 'in_1',
          amount_total: 4900,
          total_details: { amount_discount: 500 },
          metadata: { tenantId: 'tenant-a', productId: 'product-1' },
        },
      },
    });

    await expect(verify(payload)).resolves.toMatchObject({
      ok: true,
      value: {
        id: 'evt_checkout',
        type: 'checkout.session.completed',
        objectId: 'cs_1',
        checkoutSession: {
          email: 'buyer@example.test',
          paymentIntentId: 'pi_1',
          invoiceId: 'in_1',
        },
      },
    });
    await expect(verify(
      payload.replace('buyer@example.test', 'attacker@example.test'),
      webhookSecret,
      payload,
    )).resolves.toMatchObject({
      ok: false,
      error: { code: 'validation' },
    });
    await expect(verify(payload, 'whsec_wrong')).resolves.toMatchObject({
      ok: false,
      error: { code: 'validation' },
    });
  });

  it('rejects stale signatures and malformed signature headers', async () => {
    const payload = JSON.stringify({
      id: 'evt_ignored',
      type: 'ignored',
      data: { object: { id: 'object_1' } },
    });

    await expect(
      verify(payload, webhookSecret, payload, Math.floor(Date.now() / 1000) - 600),
    ).resolves.toMatchObject({
      ok: false,
      error: { code: 'validation' },
    });
    await expect(provider.verifyWebhookEvent({
      payloadRaw: payload,
      signatureHeader: 'garbage',
      webhookSecret,
    })).resolves.toMatchObject({
      ok: false,
      error: { code: 'validation' },
    });
  });

  it.each([
    ['invoice.paid', {
      id: 'in_1',
      amount_paid: 4900,
      currency: 'pln',
      subscription: 'sub_1',
      charge: 'ch_1',
      payment_intent: 'pi_1',
      period_end: 916_387_200,
    }, { invoice: { subscriptionId: 'sub_1', amountCents: 4900, currency: 'PLN' } }],
    ['invoice.payment_failed', {
      id: 'in_2',
      amount_due: 4900,
      currency: 'pln',
      subscription: 'sub_1',
    }, { invoice: { subscriptionId: 'sub_1', amountCents: 4900 } }],
    ['customer.subscription.updated', {
      id: 'sub_1',
      status: 'active',
      cancel_at_period_end: false,
      current_period_end: 916_387_200,
    }, { subscription: { id: 'sub_1', status: 'active', cancelAtPeriodEnd: false } }],
    ['customer.subscription.deleted', {
      id: 'sub_2',
      status: 'canceled',
      cancel_at_period_end: true,
      current_period_end: 916_387_200,
      ended_at: 916_387_200,
    }, {
      subscription: {
        id: 'sub_2',
        status: 'canceled',
        cancelAtPeriodEnd: true,
        currentPeriodEnd: '1999-01-15T08:00:00.000Z',
        endedAt: '1999-01-15T08:00:00.000Z',
      },
    }],
    ['charge.refunded', {
      id: 'ch_1',
      payment_intent: 'pi_1',
      invoice: 'in_1',
    }, { adjustment: { chargeId: 'ch_1', paymentIntentId: 'pi_1', invoiceId: 'in_1' } }],
    ['charge.dispute.created', {
      id: 'dp_1',
      charge: 'ch_1',
      payment_intent: 'pi_1',
    }, { adjustment: { chargeId: 'ch_1', paymentIntentId: 'pi_1', invoiceId: null } }],
  ] as const)('maps %s events', async (type, object, expected) => {
    const payload = JSON.stringify({ id: `evt_${type}`, type, data: { object } });
    await expect(verify(payload)).resolves.toMatchObject({
      ok: true,
      value: { type, objectId: object.id, checkoutSession: null, ...expected },
    });
  });

  it.each([
    ['checkout.session.completed', 'unpaid'],
    ['checkout.session.async_payment_succeeded', 'paid'],
    ['checkout.session.async_payment_failed', 'unpaid'],
  ] as const)('maps %s with payment status %s', async (type, paymentStatus) => {
    const payload = JSON.stringify({
      id: `evt_${type}`,
      type,
      data: {
        object: {
          id: 'cs_async',
          payment_status: paymentStatus,
          amount_total: 4900,
          metadata: { tenantId: 'tenant-a', productId: 'product-1' },
        },
      },
    });
    await expect(verify(payload)).resolves.toMatchObject({
      ok: true,
      value: { type, objectId: 'cs_async', checkoutSession: { paymentStatus } },
    });
  });

  it.each([
    [{ refunded: true, amount: 4900, amount_refunded: 4900 }, true],
    [{ refunded: false, amount: 4900, amount_refunded: 1000 }, false],
    [{ refunded: false, amount: 4900, amount_refunded: 4900 }, true],
    [{}, true],
  ])('maps refund coverage %j', async (refundFields, full) => {
    const payload = JSON.stringify({
      id: 'evt_refund_coverage',
      type: 'charge.refunded',
      data: { object: { id: 'ch_1', payment_intent: 'pi_1', invoice: 'in_1', ...refundFields } },
    });
    await expect(verify(payload)).resolves.toMatchObject({
      ok: true,
      value: { adjustment: { refund: { full } } },
    });
  });

  it('carries the event creation time on subscription events', async () => {
    const payload = JSON.stringify({
      id: 'evt_sub_created',
      type: 'customer.subscription.updated',
      created: 916_387_200,
      data: { object: { id: 'sub_1', status: 'active', cancel_at_period_end: false } },
    });
    await expect(verify(payload)).resolves.toMatchObject({
      ok: true,
      value: { createdAt: '1999-01-15T08:00:00.000Z' },
    });
  });

  it('preserves unknown event identity without a handled payload', async () => {
    const payload = JSON.stringify({
      id: 'evt_unknown',
      type: 'payment_intent.created',
      data: { object: { id: 'pi_unknown' } },
    });
    await expect(verify(payload)).resolves.toEqual({
      ok: true,
      value: {
        id: 'evt_unknown',
        type: 'payment_intent.created',
        objectId: 'pi_unknown',
        checkoutSession: null,
      },
    });
  });
});

it('selects the sandbox key for test checkout and cancellation', async () => {
  const slots: string[] = [];
  const keys: string[] = [];
  const payment = createStripePaymentProvider({
    resolver: { resolve: async (_tenantId, key) => {
      slots.push(key);
      return { ok: true, value: key === 'stripe.testRestrictedKey' ? 'rk_test_private' : 'rk_live_private' };
    } },
    clientFactory: (key) => {
      keys.push(key);
      return new Stripe(key, { maxNetworkRetries: 0, httpClient: Stripe.createFetchHttpClient(async () =>
        stripeJson({ id: 'cs_test', url: 'https://checkout.stripe.test/session' })) });
    },
  });
  expect(await payment.createCheckoutSession({ tenantId: 'tenant-1', mode: 'test', productId: 'product-1',
    productName: 'Course', priceCents: 1000, currency: 'PLN', successUrl: 'https://example.test/success', cancelUrl: 'https://example.test/cancel' }))
    .toMatchObject({ ok: true });
  expect(await payment.cancelSubscription({ tenantId: 'tenant-1', mode: 'test', providerSubscriptionId: 'sub_test', idempotencyKey: 'cancel-test' }))
    .toMatchObject({ ok: true });
  expect(slots).toEqual(['stripe.testRestrictedKey', 'stripe.testRestrictedKey']);
  expect(keys).toEqual(['rk_test_private', 'rk_test_private']);
});

it.each(['live', 'test'] as const)('refuses the wrong key mode before making a %s API request', async (mode) => {
  const payment = createStripePaymentProvider({
    resolver: { resolve: async () => ({ ok: true, value: mode === 'test' ? 'rk_live_wrong' : 'rk_test_wrong' }) },
    clientFactory: () => { throw new Error('Must not construct a client for the wrong mode'); },
  });
  expect(await payment.cancelSubscription({ tenantId: 'tenant-1', mode, providerSubscriptionId: 'sub', idempotencyKey: 'cancel' }))
    .toMatchObject({ ok: false, error: { code: 'validation' } });
});

it.each([true, false])('preserves the signed event livemode=%s', async (livemode) => {
  const payloadRaw = JSON.stringify({ id: 'evt_mode', object: 'event', type: 'customer.subscription.deleted', livemode,
    data: { object: { id: 'sub_mode', status: 'canceled' } } });
  const signatureHeader = stripe.webhooks.generateTestHeaderString({ payload: payloadRaw, secret: webhookSecret });
  expect(await provider.verifyWebhookEvent({ payloadRaw, signatureHeader, webhookSecret }))
    .toMatchObject({ ok: true, value: { livemode } });
});

it('reads adoption state using the tenant key without mutating Stripe', async () => {
  const requests: Request[] = [];
  const resolved: string[] = [];
  const httpClient = Stripe.createFetchHttpClient(async (input: string | URL | Request, init?: RequestInit) => {
    const request = new Request(input, init); requests.push(request);
    return stripeJson({ id: 'sub_existing', status: 'past_due', cancel_at_period_end: true,
      customer: { id: 'cus_existing', email: 'buyer@example.com' },
      items: { data: [{ current_period_end: 904608000, price: { id: 'price_existing', unit_amount: 3500,
        currency: 'eur', recurring: { interval: 'week', interval_count: 2 } } }] } });
  });
  const adoptionProvider = createStripePaymentProvider({
    resolver: { resolve: async (tenantId) => { resolved.push(tenantId); return ok('rk_live_tenant'); } },
    clientFactory: (key) => new Stripe(key, { httpClient, maxNetworkRetries: 0 }),
  });
  const result = await adoptionProvider.retrieveStripeSubscription?.('tenant-1', 'sub_existing');
  expect(result).toMatchObject({ ok: true, value: { id: 'sub_existing', status: 'past_due', cancelAtPeriodEnd: true,
    price: { id: 'price_existing', amountCents: 3500, currency: 'EUR', interval: 'week', intervalCount: 2 } } });
  expect(resolved).toEqual(['tenant-1']);
  expect(requests.map((request) => request.method)).toEqual(['GET']);
  expect(requests[0]?.headers.get('authorization')).toBe('Bearer rk_live_tenant');
  expect(requests[0]?.url).toContain('/v1/subscriptions/sub_existing');
});

it('reports a permission failure as an integration diagnostic instead of throwing', async () => {
  const httpClient = Stripe.createFetchHttpClient(async () => stripeJson({ error: {
    type: 'invalid_request_error', code: 'api_key_expired',
    message: 'This key does not have the required permissions.',
  } }, 403));
  const restrictedProvider = createStripePaymentProvider({
    resolver: { resolve: async () => ok('rk_live_tenant') },
    clientFactory: (key) => new Stripe(key, { httpClient, maxNetworkRetries: 0 }),
  });
  expect(await restrictedProvider.listStripeSubscriptions?.('tenant-1', {}))
    .toMatchObject({ ok: false, error: { code: 'validation', message: expect.stringContaining('required permissions') } });
  expect(await restrictedProvider.retrieveStripeSubscription?.('tenant-1', 'sub_existing'))
    .toMatchObject({ ok: false, error: { code: 'validation', message: expect.stringContaining('required permissions') } });
});

it('maps a legacy invoice.paid without metadata by subscription id', async () => {
  const payload = JSON.stringify({ id: 'evt_legacy', type: 'invoice.paid', created: 904608000,
    data: { object: { id: 'in_legacy', subscription: 'sub_existing', amount_paid: 3500, currency: 'eur', lines: { data: [{ period: { end: 904608000 } }] } } } });
  const signatureHeader = stripe.webhooks.generateTestHeaderString({ payload, secret: webhookSecret });
  expect(await provider.verifyWebhookEvent({ payloadRaw: payload, signatureHeader, webhookSecret }))
    .toMatchObject({ ok: true, value: { checkoutSession: null, invoice: { subscriptionId: 'sub_existing', amountCents: 3500, currency: 'EUR' } } });
});

it('sends one quantity-one Stripe item per bundle product and references its snapshot', () => {
  const params = stripeCheckoutSessionParams({
    tenantId: 'tenant-1', productId: 'product-1', productName: 'Collection', priceCents: 3333,
    currency: 'PLN', successUrl: 'https://example.com/success', cancelUrl: 'https://example.com/cancel',
    salesLinkId: 'link-1', checkoutSnapshotId: 'snapshot-1',
    lines: [{ productId: 'product-1', name: 'Digital item', grossCents: 1233 }, { productId: 'product-2', name: 'Printed item', grossCents: 2100 }],
  });
  expect(params.line_items).toEqual([
    { quantity: 1, price_data: { currency: 'pln', unit_amount: 1233, product_data: { name: 'Digital item' } } },
    { quantity: 1, price_data: { currency: 'pln', unit_amount: 2100, product_data: { name: 'Printed item' } } },
  ]);
  expect(params.metadata).toMatchObject({ salesLinkId: 'link-1', checkoutSnapshotId: 'snapshot-1', productIds: '["product-1","product-2"]' });
});


it('reassembles numerically ordered bundle product metadata chunks in a signed webhook', async () => {
  const productIds = Array.from({ length: 60 }, (_, index) => `product-${index}-identifier`);
  const productList = JSON.stringify(productIds);
  const metadata: Record<string, string> = {};
  for (let offset = productList.length - 1; offset >= 0; offset -= 1) {
    if (offset % 100 === 0) metadata[`productIds_${offset / 100}`] = productList.slice(offset, offset + 100);
  }
  const payload = JSON.stringify({ id: 'evt_bundle_chunks', type: 'checkout.session.completed', data: { object: { id: 'cs_bundle_chunks', metadata } } });
  expect(await verify(payload)).toMatchObject({ ok: true, value: { checkoutSession: { metadata: { productIds: productList } } } });
});

const permissionProbeHarness = (failures: Record<string, { status: number; message: string; code?: string }> = {}) => {
  const requests: Request[] = [];
  const payment = createStripePaymentProvider({
    resolver: { resolve: async (_tenantId, key) => ok(key === 'stripe.testRestrictedKey' ? 'rk_test_probe' : 'rk_live_probe') },
    clientFactory: (key) => new Stripe(key, {
      maxNetworkRetries: 0,
      httpClient: Stripe.createFetchHttpClient(async (input: string | URL | Request, init?: RequestInit): Promise<Response> => {
        const request = new Request(input, init);
        requests.push(request);
        const path = new URL(request.url).pathname;
        const failed = failures[`${request.method} ${path}`];
        if (failed !== undefined) return stripeJson({ error: { type: 'invalid_request_error', message: failed.message, code: failed.code } }, failed.status);
        if (request.method === 'GET') return stripeJson({ object: 'list', data: [], has_more: false });
        if (path === '/v1/coupons') return stripeJson({ id: 'coupon_probe', object: 'coupon' });
        if (path === '/v1/promotion_codes') return stripeJson({ id: 'promo_probe', object: 'promotion_code' });
        if (path === '/v1/checkout/sessions') return stripeJson({ id: 'cs_probe', object: 'checkout.session' });
        return stripeJson({ id: 'probe_cleanup' });
      }),
    }),
  });
  const run = (mode: 'live' | 'test' = 'live') => probeStripePermissions({ identity: {
    userId: 'owner-1', email: 'owner@example.test', name: 'Owner', emailVerified: true,
    tenantAccess: 'staff', tenantId: 'tenant-1', tenantSlug: 'acme', tenantName: 'Acme', staffRole: 'owner',
    memberId: null, image: null, memberDisplayName: null, memberBannedAt: null, memberDmOptOutAt: null,
    memberLanguage: null, memberVideoAutoplay: false,
  } }, { mode }, {
    payment, clock: { nowIso: () => '2026-10-10T12:00:00.000Z' },
    appBaseUrl: 'https://app.example.test', baseDomain: 'example.test', singleTenantMode: false,
    tenantDomains: tenantDomainRepositoryStub({}),
  });
  return { run, requests, operations: () => requests.map((request) => `${request.method} ${new URL(request.url).pathname}`) };
};

describe('probeStripePermissions with an injected Stripe client', () => {
  it.each(['live', 'test'] as const)('checks every resource, cleans up and selects the %s key', async (mode) => {
    const h = permissionProbeHarness();
    const earliestExpiry = Math.floor(Date.now() / 1000) + 30 * 60;
    const result = await h.run(mode);
    expect(result).toMatchObject({ ok: true, value: { mode, allOk: true, checkedAt: '2026-10-10T12:00:00.000Z', checks: [
      { resource: 'Webhook Endpoints', permission: 'write', status: 'ok' },
      { resource: 'Subscriptions', permission: 'read', status: 'ok' },
      { resource: 'Coupons', permission: 'write', status: 'ok' },
      { resource: 'Promotion Codes', permission: 'write', status: 'ok' },
      { resource: 'Checkout Sessions', permission: 'write', status: 'ok' },
    ] } });
    expect(h.operations()).toEqual([
      'GET /v1/webhook_endpoints', 'GET /v1/subscriptions', 'POST /v1/coupons',
      'POST /v1/promotion_codes', 'POST /v1/promotion_codes/promo_probe',
      'DELETE /v1/coupons/coupon_probe', 'POST /v1/checkout/sessions', 'POST /v1/checkout/sessions/cs_probe/expire',
    ]);
    expect(h.requests.every((request) => request.headers.get('authorization') === `Bearer rk_${mode}_probe`)).toBe(true);
    expect(new URL(h.requests[0]?.url ?? '').searchParams.get('limit')).toBe('1');
    expect(new URL(h.requests[1]?.url ?? '').searchParams.get('limit')).toBe('1');
    const bodies = await Promise.all(h.requests.map(async (request) => new URLSearchParams(await request.text())));
    expect(Object.fromEntries(bodies[2] ?? [])).toMatchObject({
      percent_off: '1', duration: 'once', max_redemptions: '1', name: 'Together permission probe',
      'metadata[togetherProbe]': '1', 'metadata[tenantId]': 'tenant-1',
    });
    expect(bodies[3]?.get('coupon')).toBe('coupon_probe');
    expect(bodies[3]?.get('code')).toMatch(/^TOGETHER-PROBE-[A-Z0-9]{8}$/);
    expect(bodies[3]?.get('max_redemptions')).toBe('1');
    expect(bodies[3]?.get('active')).toBe('true');
    expect(bodies[4]?.get('active')).toBe('false');
    const expiresAt = Number(bodies[6]?.get('expires_at'));
    expect(expiresAt).toBeGreaterThanOrEqual(earliestExpiry);
    expect(expiresAt).toBeLessThanOrEqual(Math.floor(Date.now() / 1000) + 30 * 60);
    expect(Object.fromEntries(bodies[6] ?? [])).toMatchObject({
      mode: 'payment', success_url: 'https://acme.example.test/', cancel_url: 'https://acme.example.test/',
      'line_items[0][price_data][currency]': 'pln', 'line_items[0][price_data][unit_amount]': '100',
      'line_items[0][price_data][product_data][name]': 'Together permission probe', 'line_items[0][quantity]': '1',
      'metadata[togetherProbe]': '1', 'metadata[tenantId]': 'tenant-1',
    });
  });

  it('reports a coupon 403, skips promotion codes and still probes checkout', async () => {
    const h = permissionProbeHarness({ 'POST /v1/coupons': { status: 403, message: 'Coupon write denied' } });
    const result = await h.run();
    expect(result).toMatchObject({ ok: true, value: { allOk: false, checks: [
      { status: 'ok' }, { status: 'ok' }, { resource: 'Coupons', status: 'missing', detail: 'Coupon write denied' },
      { resource: 'Promotion Codes', status: 'error', reason: 'coupon-probe-failed' }, { status: 'ok' },
    ] } });
    if (!result.ok) throw new Error('Probe failed');
    expect(result.value.checks.find((check) => check.resource === 'Promotion Codes')).not.toHaveProperty('detail');
    expect(h.operations()).toContain('POST /v1/checkout/sessions/cs_probe/expire');
    expect(h.operations()).not.toContain('POST /v1/promotion_codes');
  });

  it.each([
    [403, 'Checkout write denied', undefined, 'missing'],
    [400, 'Denied by code', 'permission_denied', 'missing'],
    [400, 'The key does not have the required permissions', undefined, 'missing'],
    [400, 'Invalid request', undefined, 'error'],
  ] as const)('classifies checkout failure %s %s', async (status, message, code, expected) => {
    const h = permissionProbeHarness({ 'POST /v1/checkout/sessions': { status, message, ...(code === undefined ? {} : { code }) } });
    expect(await h.run()).toMatchObject({ ok: true, value: { allOk: false, checks: [
      { status: 'ok' }, { status: 'ok' }, { status: 'ok' }, { status: 'ok' },
      { resource: 'Checkout Sessions', status: expected, detail: message },
    ] } });
    expect(h.operations()).toContain('DELETE /v1/coupons/coupon_probe');
    expect(h.operations()).not.toContain('POST /v1/checkout/sessions/cs_probe/expire');
  });

  it.each(['POST /v1/promotion_codes', 'POST /v1/promotion_codes/promo_probe'])('deletes the coupon when %s throws', async (operation) => {
    const h = permissionProbeHarness({ [operation]: { status: 400, message: 'Promotion failed' } });
    expect(await h.run()).toMatchObject({ ok: true, value: { allOk: false, checks: [
      { status: 'ok' }, { status: 'ok' }, { status: 'ok' },
      { status: 'error', detail: 'Promotion failed' }, { status: 'ok' },
    ] } });
    expect(h.operations()).toContain('DELETE /v1/coupons/coupon_probe');
    expect(h.operations()).toContain('POST /v1/checkout/sessions/cs_probe/expire');
  });

  it.each(['DELETE /v1/coupons/coupon_probe', 'POST /v1/checkout/sessions/cs_probe/expire'])('reports cleanup failure in %s', async (operation) => {
    const h = permissionProbeHarness({ [operation]: { status: 403, message: 'Cleanup denied' } });
    const result = await h.run();
    expect(result).toMatchObject({ ok: true, value: { allOk: false } });
    if (!result.ok) throw new Error('Probe failed');
    expect(result.value.checks.find((check) => check.resource === (operation.startsWith('DELETE') ? 'Coupons' : 'Checkout Sessions')))
      .toMatchObject({ status: 'missing', detail: 'Cleanup denied' });
  });
});
