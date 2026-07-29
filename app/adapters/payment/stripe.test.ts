import { describe, expect, it } from 'vitest';

import {
  stripeCancelAlreadySettled,
  stripeCheckoutSessionParams,
  stripeCouponParams,
} from './stripe.js';

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
