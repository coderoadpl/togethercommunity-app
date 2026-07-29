import { describe, expect, it } from 'vitest';

import { priceMajorSchema } from './product.js';

describe('priceMajorSchema', () => {
  it('converts whole units to cents', () => {
    expect(priceMajorSchema.parse('199')).toBe(19900);
  });

  it('converts two-decimal amounts to cents without float drift', () => {
    expect(priceMajorSchema.parse('199.99')).toBe(19999);
    expect(priceMajorSchema.parse('0.05')).toBe(5);
    expect(priceMajorSchema.parse('1.10')).toBe(110);
  });

  it('accepts the Polish comma as a decimal separator', () => {
    expect(priceMajorSchema.parse('199,99')).toBe(19999);
    expect(priceMajorSchema.parse('49,90')).toBe(4990);
    expect(priceMajorSchema.parse('0,05')).toBe(5);
  });

  it('accepts zero', () => {
    expect(priceMajorSchema.parse('0')).toBe(0);
  });

  it('trims surrounding whitespace', () => {
    expect(priceMajorSchema.parse('  49.90  ')).toBe(4990);
  });

  it('rejects more than two decimals', () => {
    expect(priceMajorSchema.safeParse('1.999').success).toBe(false);
  });

  it('rejects non-numeric and negative input', () => {
    expect(priceMajorSchema.safeParse('').success).toBe(false);
    expect(priceMajorSchema.safeParse('abc').success).toBe(false);
    expect(priceMajorSchema.safeParse('-5').success).toBe(false);
    expect(priceMajorSchema.safeParse('1.').success).toBe(false);
    expect(priceMajorSchema.safeParse('1,').success).toBe(false);
    expect(priceMajorSchema.safeParse('1,999').success).toBe(false);
    expect(priceMajorSchema.safeParse('1.2.3').success).toBe(false);
  });
});
