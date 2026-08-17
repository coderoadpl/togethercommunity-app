import { describe, expect, it } from 'vitest';

import {
  newProductSchema,
  priceMajorSchema,
  productSchema,
  productSlugFromTitle,
  productSlugSchema,
} from './product.js';

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

describe('productSlugFromTitle', () => {
  it('lowercases and joins words with single hyphens', () => {
    expect(productSlugFromTitle('  Kurs Together   101 ')).toBe('kurs-together-101');
  });

  it('strips Polish diacritics that decompose to ASCII', () => {
    expect(productSlugFromTitle('Wstęp do programowania')).toBe('wstep-do-programowania');
  });

  it('produces a slug the schema accepts even when truncated', () => {
    const slug = productSlugFromTitle(`${'a'.repeat(99)} b`);
    expect(slug).toHaveLength(99);
    expect(productSlugSchema.safeParse(slug).success).toBe(true);
  });

  it('returns an empty slug when the title has no slug-able characters', () => {
    expect(productSlugFromTitle('!!!')).toBe('');
  });
});

describe('productSlugSchema', () => {
  it('rejects uppercase, underscores and edge hyphens', () => {
    for (const invalid of ['Kurs', 'kurs_101', '-kurs', 'kurs-', 'kurs--101', '']) {
      expect(productSlugSchema.safeParse(invalid).success).toBe(false);
    }
  });
});

describe('newProductSchema', () => {
  it('defaults to a course with no slug, cover or description', () => {
    expect(newProductSchema.parse({ title: 'Course', priceCents: 0 })).toMatchObject({
      type: 'course',
      description: '',
      coverUrl: null,
      currency: 'PLN',
    });
  });

  it('accepts every product type', () => {
    for (const type of ['course', 'digital_download', 'membership'] as const) {
      expect(newProductSchema.parse({ type, title: 'Product', priceCents: 0 }).type).toBe(type);
    }
  });

  it('accepts a root-relative cover URL', () => {
    expect(
      newProductSchema.safeParse({ title: 'Course', priceCents: 0, coverUrl: '/cover.jpg' }).success,
    ).toBe(true);
  });

  it('rejects non-HTTP cover URL schemes', () => {
    for (const coverUrl of ['javascript:alert(1)', 'data:image/svg+xml,<svg/>', 'ftp://cdn.test/cover.jpg']) {
      expect(newProductSchema.safeParse({ title: 'Course', priceCents: 0, coverUrl }).success).toBe(false);
    }
    expect(newProductSchema.safeParse({
      title: 'Course',
      priceCents: 0,
      coverUrl: 'https://cdn.test/cover.jpg',
    }).success).toBe(true);
  });

  it('limits new descriptions without rejecting longer stored descriptions on read', () => {
    const description = 'a'.repeat(50_001);
    expect(newProductSchema.safeParse({ title: 'Course', priceCents: 0, description }).success).toBe(false);
    expect(productSchema.safeParse({
      id: 'p1',
      tenantId: 't1',
      type: 'course',
      slug: 'course',
      title: 'Course',
      description,
      coverUrl: null,
      priceCents: 0,
      currency: 'PLN',
      published: false,
      accessItems: [],
      legacyId: null,
      createdAt: '2026-07-01T00:00:00.000Z',
    }).success).toBe(true);
  });
});
