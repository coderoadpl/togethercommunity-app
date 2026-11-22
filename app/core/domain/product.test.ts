import { describe, expect, it } from 'vitest';

import {
  newProductSchema,
  PRODUCT_IMAGES_MAX,
  productImagesSchema,
  updateProductInputSchema,
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

  it('accepts a comma as a decimal separator', () => {
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
    expect(productSlugFromTitle('  Together Course   101 ')).toBe('together-course-101');
  });

  it('strips diacritics that decompose to ASCII', () => {
    expect(productSlugFromTitle('Café résumé')).toBe('cafe-resume');
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
    for (const invalid of ['Course', 'course_101', '-course', 'course-', 'course--101', '']) {
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
      visibility: 'listed',
      published: false,
      accessItems: [],
      legacyId: null,
      createdAt: '2026-07-01T00:00:00.000Z',
    }).success).toBe(true);
  });
});


describe('product visibility', () => {
  it('defaults legacy reads and new products to listed', () => {
    expect(productSchema.shape.visibility.parse(undefined)).toBe('listed');
    expect(newProductSchema.parse({ title: 'Free course', priceCents: 0 }).visibility).toBe('listed');
    expect(updateProductInputSchema.parse({ id: 'p1' }).visibility).toBeUndefined();
  });

  it.each(['listed', 'unlisted'])('accepts %s on create and update', (visibility) => {
    expect(newProductSchema.parse({ title: 'Course', priceCents: 0, visibility }).visibility).toBe(visibility);
    expect(updateProductInputSchema.parse({ id: 'p1', visibility }).visibility).toBe(visibility);
  });

  it('rejects unknown visibility values', () => {
    expect(newProductSchema.safeParse({ title: 'Course', priceCents: 0, visibility: 'private' }).success).toBe(false);
    expect(updateProductInputSchema.safeParse({ id: 'p1', visibility: 'private' }).success).toBe(false);
  });
});

describe('product images', () => {
  const imageUrl = (index: number): string => `/api/public/assets/product-image/00000000-0000-4000-8000-${String(index).padStart(12, '0')}.webp`;

  it('defaults a new product to an empty gallery and leaves the gallery out of an update without it', () => {
    expect(newProductSchema.parse({ title: 'Course', priceCents: 0 }).images).toEqual([]);
    expect(updateProductInputSchema.parse({ id: 'p1' })).not.toHaveProperty('images');
    expect(updateProductInputSchema.parse({ id: 'p1', images: [] }).images).toEqual([]);
  });

  it('keeps the order, trims alt text and defaults it to empty', () => {
    expect(productImagesSchema.parse([
      { url: 'https://cdn.example.test/back.jpg', alt: '  Back view  ' },
      { url: imageUrl(1) },
    ])).toEqual([
      { url: 'https://cdn.example.test/back.jpg', alt: 'Back view' },
      { url: imageUrl(1), alt: '' },
    ]);
  });

  it('accepts the same URL forms as the cover and nothing else', () => {
    for (const url of ['javascript:alert(1)', 'data:image/png;base64,AA==', 'ftp://cdn.example.test/a.jpg', 'relative/a.jpg']) {
      expect(productImagesSchema.safeParse([{ url, alt: '' }]).success).toBe(false);
    }
  });

  it('limits alt text to 250 characters', () => {
    expect(productImagesSchema.safeParse([{ url: imageUrl(1), alt: 'a'.repeat(250) }]).success).toBe(true);
    expect(productImagesSchema.safeParse([{ url: imageUrl(1), alt: 'a'.repeat(251) }]).success).toBe(false);
  });

  it('holds at most twelve images', () => {
    const images = Array.from({ length: PRODUCT_IMAGES_MAX + 1 }, (_, index) => ({ url: imageUrl(index), alt: '' }));
    expect(productImagesSchema.safeParse(images.slice(0, PRODUCT_IMAGES_MAX)).success).toBe(true);
    expect(newProductSchema.safeParse({ title: 'Course', priceCents: 0, images }).success).toBe(false);
  });

  it('rejects a URL listed twice', () => {
    const result = updateProductInputSchema.safeParse({ id: 'p1', images: [{ url: imageUrl(1), alt: 'Front' }, { url: imageUrl(1), alt: 'Again' }] });
    expect(result.success).toBe(false);
    expect(result.error?.issues[0]?.path).toEqual(['images', 1, 'url']);
  });
});
