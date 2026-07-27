import { describe, expect, it } from 'vitest';

import { fakturowniaInvoicePayload } from './fakturownia.js';

describe('fakturowniaInvoicePayload', () => {
  it('maps the fiscal buyer and coupon-discounted ledger amount', () => {
    const payload = fakturowniaInvoicePayload({
      order: {
        id: 'order-1',
        tenantId: 'tenant-1',
        memberId: 'member-1',
        productId: 'product-1',
        priceId: null,
        kind: 'one_time',
        status: 'paid',
        amountCents: 7900,
        currency: 'PLN',
        provider: 'stripe',
        providerObjectIds: {},
        couponId: 'coupon-1',
        discountCents: 2000,
        billing: {
          nip: '5555555555',
          companyName: 'Acme sp. z o.o.',
          address: 'Prosta 1',
          postalCode: '00-001',
          city: 'Warszawa',
          country: 'PL',
        },
        createdAt: '2026-07-27T10:00:00.000Z',
      },
      billing: {
        nip: '5555555555',
        companyName: 'Acme sp. z o.o.',
        address: 'Prosta 1',
        postalCode: '00-001',
        city: 'Warszawa',
        country: 'PL',
      },
      productName: 'Course',
      config: { apiKey: 'secret', subdomain: 'acme' },
    });

    expect(payload.invoice).toMatchObject({
      buyer_name: 'Acme sp. z o.o.',
      buyer_tax_no: '5555555555',
      positions: [{ name: 'Course (discount applied)', total_price_gross: 79 }],
    });
  });
});
