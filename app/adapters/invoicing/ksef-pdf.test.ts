import { describe, expect, it } from 'vitest';

import { renderFa3Invoice, type Invoice } from '#core/domain/index.js';

import { createKsefInvoicePdf } from './ksef-pdf.js';

const invoice: Invoice = {
  id: 'invoice-1',
  tenantId: 'tenant-1',
  orderId: 'order-1',
  status: 'issued',
  provider: 'ksef',
  providerInvoiceId: 'reference-1',
  invoiceNumber: 'FV/2026/000001',
  pdfUrl: null,
  error: null,
  issuedAt: '2026-07-28T10:00:00.000Z',
  createdAt: '2026-07-28T09:00:00.000Z',
  ksef: {
    environment: 'test',
    schemaSystemCode: 'FA (3)',
    schemaVersion: '1-0E',
    contextNip: '5555555555',
    sellerName: 'Żółta Łódź sp. z o.o.',
    sellerAddress: 'Prosta 1, 00-001 Warszawa',
    p2: 'FV/2026/000001',
    invoiceType: 'VAT',
    issueDate: '2026-07-28',
    xmlArtifactKey: 'invoice/invoice-1/fa3.xml',
    xmlByteSize: 1,
    xmlSha256: 'a'.repeat(64),
    state: 'succeeded',
    authConfigVersion: 1,
    sessionReference: 'session-1',
    invoiceReference: 'reference-1',
    ksefNumber: '5555555555-20260728-ABCDEF-01',
    lastStatusCode: 200,
    lastStatusDescription: 'Sukces',
    lastStatusDetails: [],
    lastStatusExtensions: {},
    lastPolledAt: '2026-07-28T10:00:00.000Z',
    acquisitionAt: '2026-07-28T10:00:00.000Z',
    invoicingAt: '2026-07-28T10:00:00.000Z',
    permanentStorageAt: '2026-07-28T10:00:00.000Z',
    upoArtifactKey: 'invoice/invoice-1/upo.xml',
    upoSha256: 'b'.repeat(64),
    upoRetrievedAt: '2026-07-28T10:00:00.000Z',
    originalSessionReference: null,
    originalKsefNumber: null,
    lastTransportError: null,
    retryAt: null,
    attempt: 1,
    correlationChecks: 0,
    version: 5,
  },
};

const xml = renderFa3Invoice({
  invoiceNumber: 'FV/2026/000001',
  issueDate: '2026-07-28',
  generatedAt: '2026-07-28T09:00:00.000Z',
  seller: {
    nip: '5555555555',
    name: 'Żółta Łódź sp. z o.o.',
    addressLine: 'Prosta 1, 00-001 Warszawa',
  },
  buyer: {
    nip: '1111111111',
    name: 'Nabywca sp. z o.o.',
    addressLine: 'Długa 2, 30-001 Kraków',
  },
  productName: 'Kurs specjalistyczny',
  grossAmountCents: 12300,
  discountCents: 0,
  vat: { kind: 'rate', percent: 23 },
});

describe('KSeF invoice PDF', () => {
  it('renders deterministic A4 bytes with FA(3) parties, positions, VAT and verification note', () => {
    const renderer = createKsefInvoicePdf();
    const first = renderer.render({ invoice, xml });
    const second = renderer.render({ invoice, xml });
    const source = Buffer.from(first).toString('latin1');

    expect(first).toEqual(second);
    expect(source.startsWith('%PDF-1.')).toBe(true);
    expect(source).toContain('FV/2026/000001');
    expect(source).toContain('5555555555-20260728-ABCDEF-01');
    expect(source).toContain('Kurs specjalistyczny');
    expect(source).toContain('23%');
    expect(source).toContain('Wizualizacja');
  });

  it('renders the exempt rate, summary, and legal basis', () => {
    const exemptXml = renderFa3Invoice({
      invoiceNumber: 'FV/2026/000002',
      issueDate: '2026-07-29',
      generatedAt: '2026-07-29T09:00:00.000Z',
      seller: { nip: '5555555555', name: 'Seller', addressLine: 'Prosta 1' },
      buyer: null,
      productName: 'Kurs',
      grossAmountCents: 12345,
      discountCents: 0,
      vat: { kind: 'exempt', basisKind: 'art_113_1', basis: 'art. 113 ust. 1 ustawy' },
    });
    const source = Buffer.from(createKsefInvoicePdf().render({ invoice, xml: exemptXml })).toString('latin1');
    expect(source).toContain('(zw)');
    expect(source).toContain('Wartosc sprzedazy zwolnionej: 123.45 PLN');
    expect(source).toContain('VAT: 0.00 PLN');
    expect(source).toContain('Zwolnienie z VAT: art. 113 ust. 1 ustawy');
    expect(source).not.toContain('VAT zw%');
  });
});
