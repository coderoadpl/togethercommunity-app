import { z } from 'zod';

import type { ProductType } from './product.js';

export const CART_MAX_LINES = 20;
export const CART_MAX_UNITS = 200;
export const CART_PHYSICAL_LINE_MAX_QUANTITY = 99;
// A 36-minute stock hold on 99 pieces would let one abandoned cart lock a whole stock; lifted when holds stop.
export const CART_LINE_MAX_QUANTITY_WITH_HOLD = 10;

const cartLineSchema = z.object({
  productId: z.string().uuid(),
  priceId: z.string().min(1).optional(),
  quantity: z.number().int().min(1).max(CART_PHYSICAL_LINE_MAX_QUANTITY),
}).strict();

export type CartLine = z.infer<typeof cartLineSchema>;

const cartUnitCount = (lines: readonly { quantity: number }[]): number =>
  lines.reduce((total, line) => total + line.quantity, 0);

export const cartLinesSchema = z.array(cartLineSchema).min(1).max(CART_MAX_LINES).superRefine((lines, context) => {
  if (new Set(lines.map((line) => line.productId)).size !== lines.length) {
    context.addIssue({ code: z.ZodIssueCode.custom, message: 'Each product may appear in one cart line only' });
  }
  if (cartUnitCount(lines) > CART_MAX_UNITS) {
    context.addIssue({ code: z.ZodIssueCode.custom, message: `A cart may hold at most ${String(CART_MAX_UNITS)} units` });
  }
});

export const cartLineMaxQuantity = (
  productType: ProductType,
  physicalMaxQuantity: number = CART_LINE_MAX_QUANTITY_WITH_HOLD,
): number => productType === 'physical' ? physicalMaxQuantity : 1;

export const cartLineQuantityError = (
  product: { title: string; type: ProductType },
  quantity: number,
  physicalMaxQuantity: number = CART_LINE_MAX_QUANTITY_WITH_HOLD,
): string | null => {
  const max = cartLineMaxQuantity(product.type, physicalMaxQuantity);
  return quantity <= max ? null : `"${product.title}" can be ordered in a quantity of at most ${String(max)}`;
};

// `/checkout/$productRef` matches a single segment, so no product id or slug can reach a deeper path.
export const HOSTED_CART_PATH = '/checkout/cart/pay';
export const CART_LINES_PARAM = 'lines';
const CART_LINE_SEPARATOR = '~';
const cartLineParamPattern = /^([0-9a-f-]{36})\.([1-9][0-9]?)$/iu;

export const formatCartLinesParam = (lines: readonly { productId: string; quantity: number }[]): string =>
  lines.map((line) => `${line.productId}.${String(line.quantity)}`).join(CART_LINE_SEPARATOR);

export const parseCartLinesParam = (value: string | null): CartLine[] | null => {
  if (value === null || value.length > 2000) return null;
  const entries = value.split(CART_LINE_SEPARATOR).map((entry) => cartLineParamPattern.exec(entry));
  const lines = entries.flatMap((match) => match?.[1] === undefined || match[2] === undefined
    ? [] : [{ productId: match[1], quantity: Number(match[2]) }]);
  if (lines.length !== entries.length) return null;
  const parsed = cartLinesSchema.safeParse(lines);
  return parsed.success ? parsed.data : null;
};
