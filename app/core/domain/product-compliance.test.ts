import { describe, expect, it } from 'vitest';

import { productComplianceSchema, productVariants, publicProductVariantSchema, variantGroupSchema, variantLabelSchema } from './product-compliance.js';

const compliance = {
  manufacturerName: 'Example Workshop',
  manufacturerAddress: 'Example Street 1, 00-001 Warsaw, Poland',
  manufacturerEmail: 'safety@example.com',
  modelIdentifier: 'STAND-1',
};

describe('product safety information', () => {
  it('accepts the required manufacturer fields and defaults the optional ones', () => {
    expect(productComplianceSchema.parse(compliance)).toEqual({ ...compliance, safetyWarnings: '' });
  });

  it('accepts the optional batch, warnings and HTTPS instructions', () => {
    const parsed = productComplianceSchema.parse({
      ...compliance,
      batchIdentifier: ' B-2026-11 ',
      safetyWarnings: '**Keep away** from open flame.',
      instructionsUrl: 'https://example.com/manual.pdf',
    });
    expect(parsed.batchIdentifier).toBe('B-2026-11');
    expect(parsed.instructionsUrl).toBe('https://example.com/manual.pdf');
  });

  it.each([
    ['an empty manufacturer name', { manufacturerName: ' ' }],
    ['a manufacturer name over 200 characters', { manufacturerName: 'x'.repeat(201) }],
    ['an address over 300 characters', { manufacturerAddress: 'x'.repeat(301) }],
    ['an invalid e-mail', { manufacturerEmail: 'not-an-email' }],
    ['a model identifier over 100 characters', { modelIdentifier: 'x'.repeat(101) }],
    ['an empty batch identifier', { batchIdentifier: '' }],
    ['warnings over 5000 characters', { safetyWarnings: 'x'.repeat(5001) }],
    ['an HTTP instructions URL', { instructionsUrl: 'http://example.com/manual.pdf' }],
    ['an unknown field', { notes: 'x' }],
  ])('rejects %s', (_label, change) => {
    expect(productComplianceSchema.safeParse({ ...compliance, ...change }).success).toBe(false);
  });

  it('requires every manufacturer field', () => {
    for (const key of Object.keys(compliance)) {
      expect(productComplianceSchema.safeParse(Object.fromEntries(Object.entries(compliance).filter(([field]) => field !== key))).success).toBe(false);
    }
  });
});

describe('variant fields', () => {
  it('accepts a slug-like group and a free-text label of up to 60 characters', () => {
    expect(variantGroupSchema.parse(' printed-stand ')).toBe('printed-stand');
    expect(variantGroupSchema.safeParse('Printed Stand').success).toBe(false);
    expect(variantGroupSchema.safeParse('x'.repeat(61)).success).toBe(false);
    expect(variantLabelSchema.parse('Black · ASA')).toBe('Black · ASA');
    expect(variantLabelSchema.safeParse('').success).toBe(false);
    expect(variantLabelSchema.safeParse('x'.repeat(61)).success).toBe(false);
  });
});

describe('product variants', () => {
  const untracked = () => ({ soldOut: false, available: null });
  const product = (id: string, change: Partial<{ published: boolean; variantGroup: string | null; variantLabel: string | null }> = {}) => ({
    id, slug: `stand-${id}`, title: `Stand ${id}`, published: true, variantGroup: 'stand', variantLabel: `Label ${id}`, ...change,
  });

  it('lists the published siblings of a group including the product itself', () => {
    const candidates = [product('black'), product('white'), product('other', { variantGroup: 'other' })];
    expect(productVariants(product('black'), candidates, untracked)).toEqual([
      { productId: 'black', slug: 'stand-black', label: 'Label black', soldOut: false, available: null },
      { productId: 'white', slug: 'stand-white', label: 'Label white', soldOut: false, available: null },
    ]);
  });

  it('excludes unpublished siblings and needs at least two published variants', () => {
    const candidates = [product('black'), product('white', { published: false })];
    expect(productVariants(product('black'), candidates, untracked)).toEqual([]);
  });

  it('returns nothing for products without a group', () => {
    expect(productVariants(product('black', { variantGroup: null }), [product('white'), product('red')], untracked)).toEqual([]);
  });

  it('falls back to the title when a sibling has no label', () => {
    const candidates = [product('black'), product('white', { variantLabel: null })];
    expect(productVariants(product('black'), candidates, untracked).map((variant) => variant.label)).toEqual(['Label black', 'Stand white']);
  });

  it('takes the sold-out flag and the available count of each sibling from its own stock', () => {
    const candidates = [product('black'), product('white'), product('red')];
    const stock = new Map([['black', { soldOut: false, available: 4 }], ['white', { soldOut: true, available: 0 }]]);
    expect(productVariants(product('black'), candidates, (id) => stock.get(id) ?? untracked()).map(({ soldOut, available }) => ({ soldOut, available })))
      .toEqual([{ soldOut: false, available: 4 }, { soldOut: true, available: 0 }, { soldOut: false, available: null }]);
  });

  it('defaults the available count of a variant recorded without it and rejects negative counts', () => {
    expect(publicProductVariantSchema.parse({ productId: 'black', slug: 'stand-black', label: 'Black', soldOut: false }).available).toBeNull();
    expect(publicProductVariantSchema.safeParse({ productId: 'black', slug: 'stand-black', label: 'Black', soldOut: false, available: -1 }).success).toBe(false);
  });
});
