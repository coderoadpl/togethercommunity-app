import { describe, expect, it } from 'vitest';

import { formatFileSize, formatPrice } from '../lib/format.js';

describe('formatPrice', () => {
  it('formats prices from the app language rather than the browser locale', () => {
    expect(formatPrice(39_900, 'PLN', 'pl')).toBe('399,00\u00a0zł');
    expect(formatPrice(39_900, 'PLN', 'en')).toBe('PLN\u00a0399.00');
  });
});

describe('formatFileSize', () => {
  it('promotes large files to localized MB and GB values', () => {
    expect(formatFileSize(2.4 * 1024 * 1024, 'en')).toBe('2.4 MB');
    expect(formatFileSize(2.4 * 1024 * 1024, 'pl')).toBe('2,4 MB');
    expect(formatFileSize(1024 * 1024 * 1024, 'en')).toBe('1 GB');
  });
});
