import { describe, expect, it } from 'vitest';

import type { InvoicingPort } from '@core/server/index.js';

import { createFakturowniaInvoicing, fakturowniaInvoicePayload } from './fakturownia.js';

const input: Parameters<InvoicingPort['issueInvoice']>[0] = {
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
};

describe('fakturowniaInvoicePayload', () => {
  it('maps the fiscal buyer and coupon-discounted ledger amount', () => {
    const payload = fakturowniaInvoicePayload(input);

    expect(payload.invoice).toMatchObject({
      buyer_name: 'Acme sp. z o.o.',
      buyer_tax_no: '5555555555',
      positions: [{ name: 'Course (discount applied)', total_price_gross: 79 }],
    });
  });

  it.each([
    { status: 401, code: 'integration_auth' },
    { status: 422, code: 'validation' },
  ])('maps provider HTTP $status to $code', async ({ status, code }) => {
    const fetcher: typeof fetch = async () =>
      new Response('provider detail', { status });
    expect(await createFakturowniaInvoicing(fetcher).issueInvoice(input)).toMatchObject({
      ok: false,
      error: { code },
    });
  });

  it('maps network failures to integration_unavailable', async () => {
    const fetcher: typeof fetch = async () => {
      throw new Error('offline');
    };
    expect(await createFakturowniaInvoicing(fetcher).issueInvoice(input)).toMatchObject({
      ok: false,
      error: { code: 'integration_unavailable' },
    });
  });
});
