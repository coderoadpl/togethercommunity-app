import { createHmac } from 'node:crypto';

import { describe, expect, it } from 'vitest';

import { ok } from '#core/domain/index.js';

import { createFakePaymentProvider } from './fake.js';

const secret = 'whsec_known_test_secret';
const provider = createFakePaymentProvider({ resolve: async () => ok(secret) });
const payload = JSON.stringify({
  id: 'evt_123',
  livemode: false,
  type: 'checkout.session.completed',
  data: {
    object: {
      id: 'cs_123',
      customer_details: { email: 'buyer@example.com' },
      invoice: 'in_123',
      amount_total: 2449,
      total_details: { amount_discount: 2451 },
      metadata: {
        tenantId: 'tenant-a',
        productId: 'product-1',
        memberEmail: '',
        language: 'pl',
        checkoutConsentCaptureId: 'capture-opaque-1',
      },
    },
  },
});

const signature = (body: string, signingSecret = secret): string => {
  const timestamp = '1700000000';
  const digest = createHmac('sha256', signingSecret).update(`${timestamp}.${body}`).digest('hex');
  return `t=${timestamp},v1=${digest}`;
};

describe('fake Stripe webhook verification', () => {
  it('cancels without resolving the tenant secret', async () => {
    let resolutions = 0;
    const cancelProvider = createFakePaymentProvider({
      resolve: async () => {
        resolutions += 1;
        return ok(secret);
      },
    });

    const result = await cancelProvider.cancelSubscription({
      tenantId: 'tenant-a',
      providerSubscriptionId: 'sub_123',
      idempotencyKey: 'member-removal-subscription-1',
    });

    expect(result).toEqual({
      ok: true,
      value: { canceled: true, alreadySettled: false },
    });
    expect(resolutions).toBe(0);
  });

  it('accepts a valid Stripe-style HMAC and preserves checkout metadata', async () => {
    const result = await provider.verifyWebhookEvent({
      tenantId: 'tenant-a',
      mode: 'live',
      payloadRaw: payload,
      signatureHeader: signature(payload),
      webhookSecret: secret,
    });

    expect(result).toEqual({
      ok: true,
      value: {
        id: 'evt_123',
        livemode: false,
        type: 'checkout.session.completed',
        objectId: 'cs_123',
        createdAt: null,
        checkoutSession: {
          email: 'buyer@example.com',
          paymentStatus: 'paid',
          subscriptionId: null,
          paymentIntentId: null,
          invoiceId: 'in_123',
          amountTotalCents: 2449,
          discountTotalCents: 2451,
          shipping: null,
          shippingCostCents: null,
          metadata: {
            attribution: null,
            tenantId: 'tenant-a',
            productId: 'product-1',
            priceId: null,
            memberEmail: null,
            language: 'pl',
            checkoutConsentCaptureId: 'capture-opaque-1',
            couponCheckoutSessionId: null,
          },
        },
        invoice: null,
        adjustment: null,
        subscription: null,
      },
    });
  });

  it.each([
    ['basil and later', { collected_information: { shipping_details: { name: 'Jane Buyer', address: { line1: 'Garden Street 5', line2: null, postal_code: '00-950', city: 'Warsaw', state: null, country: 'PL' } } } }],
    ['pre-basil', { shipping_details: { name: 'Jane Buyer', address: { line1: 'Garden Street 5', line2: null, postal_code: '00-950', city: 'Warsaw', state: null, country: 'PL' } } }],
  ])('reads the delivery address from a %s checkout session payload', async (_shape, addressFields) => {
    const shippedPayload = JSON.stringify({
      id: 'evt_shipped', type: 'checkout.session.completed',
      data: { object: {
        id: 'cs_shipped', amount_total: 6399, customer_details: { email: 'buyer@example.com', phone: '+48600100200' },
        ...addressFields,
        shipping_cost: { amount_total: 1499 },
        metadata: { tenantId: 'tenant-a', productId: 'product-1' },
      } },
    });
    const result = await provider.verifyWebhookEvent({
      tenantId: 'tenant-a', mode: 'live', payloadRaw: shippedPayload, signatureHeader: signature(shippedPayload), webhookSecret: secret,
    });
    expect(result).toMatchObject({ ok: true, value: { checkoutSession: {
      shippingCostCents: 1499,
      shipping: { name: 'Jane Buyer', phone: '+48600100200', address: { line1: 'Garden Street 5', line2: null, postalCode: '00-950', city: 'Warsaw', country: 'PL', state: null } },
    } } });
  });

  it('maps refund and dispute provider identifiers', async () => {
    const refundPayload = JSON.stringify({
      id: 'evt_refund',
      type: 'charge.refunded',
      data: { object: { id: 'ch_123', payment_intent: 'pi_123', invoice: 'in_123' } },
    });
    const refund = await provider.verifyWebhookEvent({
      tenantId: 'tenant-a',
      mode: 'live',
      payloadRaw: refundPayload,
      signatureHeader: signature(refundPayload),
      webhookSecret: secret,
    });

    expect(refund).toMatchObject({
      ok: true,
      value: {
        type: 'charge.refunded',
        adjustment: { chargeId: 'ch_123', paymentIntentId: 'pi_123', invoiceId: 'in_123' },
      },
    });

    const disputePayload = JSON.stringify({
      id: 'evt_dispute',
      type: 'charge.dispute.created',
      data: { object: { id: 'dp_123', charge: 'ch_123', payment_intent: 'pi_123' } },
    });
    const dispute = await provider.verifyWebhookEvent({
      tenantId: 'tenant-a',
      mode: 'live',
      payloadRaw: disputePayload,
      signatureHeader: signature(disputePayload),
      webhookSecret: secret,
    });

    expect(dispute).toMatchObject({
      ok: true,
      value: {
        type: 'charge.dispute.created',
        adjustment: { chargeId: 'ch_123', paymentIntentId: 'pi_123', invoiceId: null },
      },
    });
  });

  it('maps invoice and subscription events onto the lifecycle event shape', async () => {
    const invoicePayload = JSON.stringify({
      id: 'evt_inv',
      type: 'invoice.paid',
      data: {
        object: {
          id: 'in_123',
          subscription: 'sub_123',
          amount_total: 2900,
          currency: 'pln',
          period_end: 1700000000,
        },
      },
    });
    const invoiceResult = await provider.verifyWebhookEvent({
      tenantId: 'tenant-a',
      mode: 'live',
      payloadRaw: invoicePayload,
      signatureHeader: signature(invoicePayload),
      webhookSecret: secret,
    });
    expect(invoiceResult).toMatchObject({
      ok: true,
      value: {
        type: 'invoice.paid',
        objectId: 'in_123',
        invoice: {
          subscriptionId: 'sub_123',
          amountCents: 2900,
          currency: 'PLN',
          periodEnd: '2023-11-14T22:13:20.000Z',
        },
      },
    });

    const subscriptionPayload = JSON.stringify({
      id: 'evt_sub',
      type: 'customer.subscription.updated',
      data: {
        object: {
          id: 'sub_123',
          status: 'active',
          cancel_at_period_end: true,
          current_period_end: 1700000000,
        },
      },
    });
    const subscriptionResult = await provider.verifyWebhookEvent({
      tenantId: 'tenant-a',
      mode: 'live',
      payloadRaw: subscriptionPayload,
      signatureHeader: signature(subscriptionPayload),
      webhookSecret: secret,
    });
    expect(subscriptionResult).toMatchObject({
      ok: true,
      value: {
        type: 'customer.subscription.updated',
        objectId: 'sub_123',
        subscription: {
          id: 'sub_123',
          status: 'active',
          cancelAtPeriodEnd: true,
          currentPeriodEnd: '2023-11-14T22:13:20.000Z',
        },
      },
    });
  });

  it('rejects changed payloads and signatures made with another secret', async () => {
    const changed = await provider.verifyWebhookEvent({
      tenantId: 'tenant-a',
      mode: 'live',
      payloadRaw: `${payload} `,
      signatureHeader: signature(payload),
      webhookSecret: secret,
    });
    const wrongSecret = await provider.verifyWebhookEvent({
      tenantId: 'tenant-a',
      mode: 'live',
      payloadRaw: payload,
      signatureHeader: signature(payload, 'whsec_wrong'),
      webhookSecret: secret,
    });

    expect(changed.ok).toBe(false);
    expect(wrongSecret.ok).toBe(false);
  });
});


it('reassembles bundle product metadata chunks in fake webhooks', async () => {
  const body = JSON.stringify({ id: 'evt_bundle_chunks', type: 'checkout.session.completed', data: { object: { id: 'cs_bundle_chunks', metadata: { productIds_1: ',"second"]', productIds_0: '["first"' } } } });
  expect(await provider.verifyWebhookEvent({ tenantId: 'tenant-a', mode: 'live', payloadRaw: body, signatureHeader: signature(body), webhookSecret: secret })).toMatchObject({ ok: true, value: { checkoutSession: { metadata: { productIds: '["first","second"]' } } } });
});

it('decodes captured attribution from a signed local webhook', async () => {
  const capturedAt = '2026-10-15T10:00:00.000Z';
  const body = JSON.stringify({ id: 'evt_attribution', type: 'checkout.session.completed', data: { object: {
    id: 'cs_attribution', metadata: { tenantId: 'tenant-a', productId: 'product-1', utm_source: 'meta', fbclid: 'X', attribution_at: capturedAt },
  } } });
  const result = await provider.verifyWebhookEvent({ tenantId: 'tenant-a', mode: 'live', payloadRaw: body, signatureHeader: signature(body), webhookSecret: secret });
  expect(result).toMatchObject({ ok: true, value: { checkoutSession: { metadata: { attribution: { utmSource: 'meta', fbclid: 'X', capturedAt } } } } });
});
