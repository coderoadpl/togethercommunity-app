import { describe, expect, it } from 'vitest';

import { renderFa3Invoice } from '@core/domain/index.js';

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
  vatRatePercent: 23,
});

describe('FA(3) XSD validator', () => {
  it('accepts the canonical renderer output', async () => {
    expect(await createFa3XsdValidator().validate(xml)).toEqual({
      ok: true,
      value: undefined,
    });
  });

  it('rejects a structurally plausible schema violation', async () => {
    const malformed = xml.replace('<P_12>23</P_12>', '<P_12>99</P_12>');

    expect(await createFa3XsdValidator().validate(malformed)).toMatchObject({
      ok: false,
      error: { code: 'validation' },
    });
  });
});
