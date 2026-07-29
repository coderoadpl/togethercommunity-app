import { describe, expect, it } from 'vitest';

import { renderFa3Invoice } from '#core/domain/index.js';

import { createFa3XsdValidator } from './fa3-validator.js';

const xml = renderFa3Invoice({
  invoiceNumber: 'FV/2026/000001',
  issueDate: '2026-07-27',
  generatedAt: '2026-07-27T10:00:00Z',
  seller: {
    nip: '5555555555',
    name: 'Together sp. z o.o.',
    addressLine: 'Prosta 1, 00-001 Warszawa',
  },
  buyer: null,
  productName: 'Course',
  grossAmountCents: 7900,
  discountCents: 0,
  vat: { kind: 'rate', percent: 23 },
});

describe('FA(3) XSD validator', () => {
  it('accepts the canonical renderer output', async () => {
    expect(await createFa3XsdValidator().validate(xml)).toEqual({
      ok: true,
      value: undefined,
    });
  });

  it.each(['art_113_1', 'other'] as const)('accepts exempt XML for %s', async (basisKind) => {
    const exemptXml = renderFa3Invoice({
      ...{
        invoiceNumber: 'FV/2026/000002',
        issueDate: '2026-07-29',
        generatedAt: '2026-07-29T10:00:00Z',
        seller: { nip: '5555555555', name: 'Together', addressLine: 'Prosta 1' },
        buyer: null,
        productName: 'Course',
        grossAmountCents: 12345,
        discountCents: 0,
      },
      vat: { kind: 'exempt', basisKind, basis: 'art. 113 ust. 1' },
    });
    expect(await createFa3XsdValidator().validate(exemptXml)).toEqual({ ok: true, value: undefined });
  });

  it('rejects a structurally plausible schema violation', async () => {
    const malformed = xml.replace('<P_12>23</P_12>', '<P_12>99</P_12>');

    expect(await createFa3XsdValidator().validate(malformed)).toMatchObject({
      ok: false,
      error: { code: 'validation' },
    });
  });

  it('fails closed when the XSD validator executable is unavailable', async () => {
    expect(await createFa3XsdValidator({
      executable: 'missing-xmllint-for-ksef-test',
    }).validate(xml)).toMatchObject({
      ok: false,
      error: { code: 'integration_unavailable' },
    });
  });
});
