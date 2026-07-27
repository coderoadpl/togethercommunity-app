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
      checkoutConsent: {
        termsAccepted: true,
        selectedDefinitionIds: ['newsletter'],
        attachedDefinitionIds: ['newsletter'],
        collectedAt: '2026-07-27T12:00:00.000Z',
        confirmationBaseUrl: 'https://alpha.example.com/marketing/confirm',
        ip: '203.0.113.8',
        userAgent: 'Checkout Browser/1.0',
      },
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
        checkoutConsent: JSON.stringify({
          termsAccepted: true,
          selectedDefinitionIds: ['newsletter'],
          attachedDefinitionIds: ['newsletter'],
          collectedAt: '2026-07-27T12:00:00.000Z',
          confirmationBaseUrl: 'https://alpha.example.com/marketing/confirm',
          ip: '203.0.113.8',
          userAgent: 'Checkout Browser/1.0',
        }),
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
});
