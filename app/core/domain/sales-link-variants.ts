import { z } from 'zod';

export const SALES_LINK_VARIANT_PARAM = 'variant';
export const salesLinkVariantSelectionSchema = z.object({
  productId: z.string().min(1),
  variantProductId: z.string().min(1),
}).strict();
export type SalesLinkVariantSelection = z.infer<typeof salesLinkVariantSelectionSchema>;

export const formatSalesLinkVariantParam = (selection: SalesLinkVariantSelection): string =>
  `${selection.productId}.${selection.variantProductId}`;

export const parseSalesLinkVariantParams = (values: readonly string[]): SalesLinkVariantSelection[] =>
  values.slice(0, 50).flatMap((value) => {
    const separator = value.indexOf('.');
    return value.length > 200 || separator < 1 || separator === value.length - 1
      ? [] : [{ productId: value.slice(0, separator), variantProductId: value.slice(separator + 1) }];
  });
