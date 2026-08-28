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

  it('deletes endpoints matching the tenant metadata or URL before creating one', async () => {
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
        url: 'https://old.example.test/stripe',
      },
      {
        id: 'we_manual',
        object: 'webhook_endpoint',
        status: 'enabled',
        url: webhookUrl,
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
        'DELETE /v1/webhook_endpoints/we_metadata',
        'DELETE /v1/webhook_endpoints/we_manual',
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
