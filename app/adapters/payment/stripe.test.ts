import { describe, expect, it } from 'vitest';
import Stripe from 'stripe';

import {
  createStripePaymentProvider,
  stripeCancelAlreadySettled,
  stripeCheckoutSessionParams,
  stripeCouponParams,
} from './stripe.js';

const webhookSecret = 'whsec_test_secret';
const stripe = new Stripe('sk_test_unused');
const provider = createStripePaymentProvider({
  resolver: { resolve: async () => { throw new Error('unused'); } },
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
      canceled_at: 1_700_000_000,
    }, {
      subscription: {
        id: 'sub_2',
        status: 'canceled',
        cancelAtPeriodEnd: true,
        currentPeriodEnd: '1999-01-15T08:00:00.000Z',
        endedAt: '1999-01-15T08:00:00.000Z',
        canceledAt: '1995-11-14T22:13:20.000Z',
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
