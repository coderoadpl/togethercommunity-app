import { describe, expect, it } from 'vitest';

import type { InvoicingPort } from '@core/server/index.js';

import {
  createIfirmaInvoicing,
  ifirmaAuthenticationHeader,
  ifirmaInvoicePayload,
} from './ifirma.js';

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
  config: {
    invoiceApiKey: 'EAB0D8ACF3308F3B',
    username: 'owner@example.com',
  },
};

describe('ifirmaAuthenticationHeader', () => {
  it('signs the exact URL, username, named key and body with HMAC-SHA1', () => {
    expect(
      ifirmaAuthenticationHeader(
        'https://www.ifirma.pl/iapi/fakturakraj.json',
        input.config,
        '{}',
      ),
    ).toBe(
      'IAPIS user=owner@example.com, hmac-sha1=070eb461129a0f137d5558326e8e566eccb7405b',
    );
  });

  it('decodes the displayed hexadecimal key into bytes before signing', () => {
    expect(
      ifirmaAuthenticationHeader('222222', {
        invoiceApiKey: '111111',
        username: '',
      }).split('hmac-sha1=')[1],
    ).toBe('c25ce929c09581cfbd1324f54a16a6190b49cdd0');
  });

  it('excludes query parameters from the signed URL', () => {
    expect(
      ifirmaAuthenticationHeader(
        'https://www.ifirma.pl/iapi/faktury.json?dataOd=2026-07-27&dataDo=2026-07-27',
        input.config,
      ),
    ).toBe(
      ifirmaAuthenticationHeader(
        'https://www.ifirma.pl/iapi/faktury.json',
        input.config,
      ),
    );
  });
});

describe('ifirmaInvoicePayload', () => {
  it('maps the fiscal buyer and coupon-discounted ledger amount', () => {
    expect(ifirmaInvoicePayload(input, '2026-07-27')).toMatchObject({
      Zaplacono: 79,
      ZaplaconoNaDokumencie: 79,
      LiczOd: 'BRT',
      DataWystawienia: '2026-07-27',
      DataSprzedazy: '2026-07-27',
      Pozycje: [
        {
          NazwaPelna: 'Course (coupon discount applied)',
          CenaJednostkowa: 79,
          StawkaVat: 0.23,
        },
      ],
      Kontrahent: {
        Nazwa: 'Acme sp. z o.o.',
        NIP: '5555555555',
        Ulica: 'Prosta 1',
        KodPocztowy: '00-001',
        Miejscowosc: 'Warszawa',
        KodKraju: 'PL',
        OsobaFizyczna: false,
      },
    });
  });

  it('creates an individual retail buyer without a NIP for automatic B2C issuance', () => {
    expect(ifirmaInvoicePayload({ ...input, billing: null }, '2026-07-27')).toMatchObject({
      Kontrahent: {
        Nazwa: 'Klient detaliczny',
        NIP: null,
        OsobaFizyczna: true,
      },
    });
  });
});

describe('createIfirmaInvoicing', () => {
  it('issues an invoice, resolves its number and verifies authenticated PDF retrieval', async () => {
    const calls: { url: string; init: RequestInit | undefined }[] = [];
    const fetcher: typeof fetch = async (url, init) => {
      calls.push({ url: String(url), init });
      if (calls.length === 1) {
        return Response.json({
          response: { Kod: 0, Informacja: 'Faktura została pomyślnie dodana.', Identyfikator: '1244512' },
        });
      }
      if (calls.length === 2) {
        return Response.json({
          response: {
            Kod: 0,
            Informacja: '',
            Wynik: [{ FakturaId: 1244512, PelnyNumer: 'FV/12/2026', CzyWyslano: false }],
          },
        });
      }
      return new Response('%PDF-1.7', {
        status: 200,
        headers: { 'content-type': 'application/pdf' },
      });
    };

    expect(await createIfirmaInvoicing(fetcher, () => '2026-07-27').issueInvoice(input)).toEqual({
      ok: true,
      value: {
        providerInvoiceId: '1244512',
        invoiceNumber: 'FV/12/2026',
        pdfUrl: 'https://www.ifirma.pl/iapi/fakturakraj/1244512.pdf',
        status: 'issued',
      },
    });
    expect(calls.map(({ url }) => url)).toEqual([
      'https://www.ifirma.pl/iapi/fakturakraj.json',
      'https://www.ifirma.pl/iapi/faktury.json?dataOd=2026-07-27&dataDo=2026-07-27',
      'https://www.ifirma.pl/iapi/fakturakraj/1244512.pdf',
    ]);
    expect(calls.every(({ init }) => {
      const headers = new Headers(init?.headers);
      return headers.get('Authentication')?.startsWith('IAPIS user=owner@example.com, hmac-sha1=');
    })).toBe(true);
  });

  it.each([
    { code: 403, expected: 'integration_auth' },
    { code: 201, expected: 'validation' },
    { code: 100, expected: 'integration_unavailable' },
  ])('maps iFirma response code $code to $expected', async ({ code, expected }) => {
    const fetcher: typeof fetch = async () =>
      Response.json({ response: { Kod: code, Informacja: 'provider detail' } });

    expect(await createIfirmaInvoicing(fetcher, () => '2026-07-27').issueInvoice(input)).toMatchObject({
      ok: false,
      error: { code: expected },
    });
  });

  it('maps network failures to integration_unavailable', async () => {
    const fetcher: typeof fetch = async () => {
      throw new Error('offline');
    };
    expect(await createIfirmaInvoicing(fetcher, () => '2026-07-27').issueInvoice(input)).toMatchObject({
      ok: false,
      error: { code: 'integration_unavailable' },
    });
  });

  it('rejects malformed API keys as credentials without making a request', async () => {
    let calls = 0;
    const fetcher: typeof fetch = async () => {
      calls += 1;
      return Response.json({ response: { Kod: 0, Informacja: '', Wynik: [] } });
    };

    expect(await createIfirmaInvoicing(fetcher).testConnection({
      config: { ...input.config, invoiceApiKey: 'not-hex' },
    })).toMatchObject({
      ok: false,
      error: { code: 'integration_auth' },
    });
    expect(calls).toBe(0);
  });

  it('rejects non-PLN orders before creating a domestic invoice', async () => {
    let calls = 0;
    const fetcher: typeof fetch = async () => {
      calls += 1;
      return Response.json({});
    };

    expect(await createIfirmaInvoicing(fetcher).issueInvoice({
      ...input,
      order: { ...input.order, currency: 'EUR' },
    })).toMatchObject({
      ok: false,
      error: { code: 'validation' },
    });
    expect(calls).toBe(0);
  });

  it('tests credentials with an authenticated read-only invoice-list request', async () => {
    const fetcher: typeof fetch = async () =>
      Response.json({ response: { Kod: 0, Informacja: '', Wynik: [] } });

    expect(await createIfirmaInvoicing(fetcher, () => '2026-07-27').testConnection({
      config: input.config,
    })).toEqual({
      ok: true,
      value: { diagnostic: 'iFirma accepted the username and faktura API key.' },
    });
  });
});
