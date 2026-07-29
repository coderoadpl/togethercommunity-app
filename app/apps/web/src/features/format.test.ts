import { describe, expect, it } from 'vitest';

import { formatPrice } from '../lib/format.js';

describe('formatPrice', () => {
  it('formats prices from the app language rather than the browser locale', () => {
    expect(formatPrice(39_900, 'PLN', 'pl')).toBe('399,00\u00a0zł');
    expect(formatPrice(39_900, 'PLN', 'en')).toBe('PLN\u00a0399.00');
  });
});
