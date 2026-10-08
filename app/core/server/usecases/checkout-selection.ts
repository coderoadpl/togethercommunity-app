import { err, ok, validation, type AppError, type Product, type ProductPrice, type Result } from '#core/domain/index.js';

export interface CheckoutSelection {
  product: Product;
  price: ProductPrice | null;
  products?: Product[];
  productPrices?: ProductPrice[];
  salesLinkId?: string;
  salesLinkSlug?: string;
}


export const resolveSalesLinkPrices = (
  products: Product[],
  prices: ProductPrice[],
): Result<ProductPrice[], AppError> => {
  const resolved: ProductPrice[] = [];
  for (const product of products) {
    const matching = prices.filter((price) => price.productId === product.id && price.active && price.kind === 'one_time' && price.imported !== true);
    const price = matching[0];
    if (matching.length !== 1 || price === undefined) return err(validation('Every sales-link product requires exactly one active one-time price'));
    resolved.push(price);
  }
  if (new Set(resolved.map((price) => price.currency)).size !== 1) return err(validation('Sales-link products must use the same currency'));
  return ok(resolved);
};
