import { describe, expect, it } from 'vitest';

import { publicOfferOutputSchema } from './routes.js';

const recordedProduct = {
  id: 'p1', type: 'physical', slug: 'paperback', title: 'Paperback', description: '', coverUrl: null, priceCents: 4900, currency: 'PLN', prices: [],
  stock: { tracked: true, soldOut: false, low: false },
  variants: [{ productId: 'p1', slug: 'paperback', label: 'Paperback', soldOut: false }, { productId: 'p2', slug: 'hardcover', label: 'Hardcover', soldOut: true }],
};
const offer = (product: Record<string, unknown>) => ({ tenant: { slug: 'acme', name: 'Acme' }, contentVersion: 1, products: [product] });

describe('public offer stock counts', () => {
  it('parses the available count and the line bound of a product and its variants', () => {
    const parsed = publicOfferOutputSchema.parse(offer({
      ...recordedProduct,
      stock: { tracked: true, soldOut: false, low: true, available: 3 },
      variants: [{ ...recordedProduct.variants[0], available: 3 }, { ...recordedProduct.variants[1], available: 0 }],
      maxQuantity: 3,
    })).products[0];
    expect(parsed).toMatchObject({ stock: { available: 3 }, maxQuantity: 3, variants: [{ available: 3 }, { available: 0 }] });
  });

  it('defaults the counts of an offer recorded before they existed', () => {
    const parsed = publicOfferOutputSchema.parse(offer(recordedProduct)).products[0];
    expect(parsed).toMatchObject({ stock: { tracked: true, available: null }, maxQuantity: 1, variants: [{ available: null }, { available: null }] });
    const withoutStock = Object.fromEntries(Object.entries(recordedProduct).filter(([key]) => key !== 'stock'));
    expect(publicOfferOutputSchema.parse(offer(withoutStock)).products[0]?.stock).toEqual({ tracked: false, soldOut: false, low: false, available: null });
  });

  it('rejects negative and fractional counts', () => {
    expect(publicOfferOutputSchema.safeParse(offer({ ...recordedProduct, maxQuantity: -1 })).success).toBe(false);
    expect(publicOfferOutputSchema.safeParse(offer({ ...recordedProduct, maxQuantity: 1.5 })).success).toBe(false);
    expect(publicOfferOutputSchema.safeParse(offer({ ...recordedProduct, stock: { ...recordedProduct.stock, available: -1 } })).success).toBe(false);
    expect(publicOfferOutputSchema.safeParse(offer({ ...recordedProduct, variants: [{ ...recordedProduct.variants[0], available: -2 }] })).success).toBe(false);
  });
});

describe('public offer gallery', () => {
  it('parses an ordered gallery with workspace-relative and absolute URLs', () => {
    const images = [
      { url: '/api/public/assets/product-image/00000000-0000-4000-8000-000000000001.webp', alt: 'Front view' },
      { url: 'https://cdn.example.test/side.jpg', alt: '' },
    ];
    expect(publicOfferOutputSchema.parse(offer({ ...recordedProduct, images })).products[0]?.images).toEqual(images);
  });

  it('defaults the gallery of an offer recorded before it existed to an empty list', () => {
    expect(publicOfferOutputSchema.parse(offer(recordedProduct)).products[0]?.images).toEqual([]);
  });

  it('rejects a gallery URL the cover would not accept', () => {
    expect(publicOfferOutputSchema.safeParse(offer({ ...recordedProduct, images: [{ url: 'javascript:alert(1)', alt: '' }] })).success).toBe(false);
  });
});
