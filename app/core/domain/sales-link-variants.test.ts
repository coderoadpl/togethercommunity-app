import { expect, it } from 'vitest';
import { formatSalesLinkVariantParam, parseSalesLinkVariantParams, salesLinkVariantSelectionSchema } from './sales-link-variants.js';

it('parses and formats a selection, splitting only on the first dot', () => {
  const selection = { productId: 'black', variantProductId: 'white' };
  expect(parseSalesLinkVariantParams(['black.white'])).toEqual([selection]);
  expect(parseSalesLinkVariantParams([formatSalesLinkVariantParam(selection)])).toEqual([selection]);
  expect(parseSalesLinkVariantParams(['black.white.extra'])).toEqual([{ ...selection, variantProductId: 'white.extra' }]);
});

it('drops malformed and oversized values and only reads the first fifty', () => {
  expect(parseSalesLinkVariantParams(['', 'black', '.white', 'black.', `b.${'w'.repeat(199)}`])).toEqual([]);
  expect(parseSalesLinkVariantParams(Array.from({ length: 51 }, (_, index) => `base.${index}`))).toHaveLength(50);
  expect(parseSalesLinkVariantParams([`b.${'w'.repeat(198)}`])).toHaveLength(1);
  expect(salesLinkVariantSelectionSchema.safeParse({ productId: 'black', variantProductId: 'white', tenantId: 'foreign' }).success).toBe(false);
});
