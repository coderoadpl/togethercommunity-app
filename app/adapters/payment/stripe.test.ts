import { describe, expect, it } from 'vitest';

import { stripeCheckoutSessionParams } from './stripe.js';

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
});
