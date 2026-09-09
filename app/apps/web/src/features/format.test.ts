import { describe, expect, it } from 'vitest';

import { formatFileSize, formatOfferPrice, formatOfferPriceTerms, formatPrice } from '../lib/format.js';

describe('formatPrice', () => {
  it('formats prices from the app language rather than the browser locale', () => {
    expect(formatPrice(39_900, 'PLN', 'en')).toBe('PLN\u00a0399.00');
    expect(formatPrice(0, 'PLN', 'en')).toBe('PLN\u00a00.00');
  });
});

describe('formatOfferPrice', () => {
  it('labels a zero amount as free and formats every other amount', () => {
    expect(formatOfferPrice(0, 'EUR', 'en', 'Free')).toBe('Free');
    expect(formatOfferPrice(39_900, 'PLN', 'en', 'Free')).toBe('PLN\u00a0399.00');
  });
});

describe('formatOfferPriceTerms', () => {
  const labels = {
    free: 'Free',
    oneTime: ({ price }: { price: string }) => `${price} one-off`,
    monthly: ({ price }: { price: string }) => `${price} / month`,
    yearly: ({ price }: { price: string }) => `${price} / year`,
  };

  it('adds the billing cadence from the price row', () => {
    expect(
      formatOfferPriceTerms({ kind: 'one_time', interval: null, amountCents: 19_900, currency: 'PLN' }, 'en', labels),
    ).toBe('PLN\u00a0199.00 one-off');
    expect(
      formatOfferPriceTerms({ kind: 'recurring', interval: 'month', amountCents: 4_900, currency: 'PLN' }, 'en', labels),
    ).toBe('PLN\u00a049.00 / month');
    expect(
      formatOfferPriceTerms({ kind: 'recurring', interval: 'year', amountCents: 49_900, currency: 'PLN' }, 'en', labels),
    ).toBe('PLN\u00a0499.00 / year');
  });

  it('does not wrap free offers in cadence copy', () => {
    expect(
      formatOfferPriceTerms({ kind: 'recurring', interval: 'month', amountCents: 0, currency: 'PLN' }, 'en', labels),
    ).toBe('Free');
    expect(
      formatOfferPriceTerms({ kind: 'one_time', interval: null, amountCents: 0, currency: 'PLN' }, 'en', labels),
    ).toBe('Free');
  });
});

describe('formatFileSize', () => {
  it('promotes large files to localized MB and GB values', () => {
    expect(formatFileSize(2.4 * 1024 * 1024, 'en')).toBe('2.4 MB');
    expect(formatFileSize(1024 * 1024 * 1024, 'en')).toBe('1 GB');
  });
});
