import { err, ok, validation, resolveProductVat, type AppError, type CheckoutShippingSelection, type Product, type ProductPrice, type Result, type SalesLinkVariantSelection, type TenantSettings } from '#core/domain/index.js';

export interface CheckoutSelection {
  product: Product;
  price: ProductPrice | null;
  products?: Product[];
  productPrices?: ProductPrice[];
  salesLinkId?: string;
  salesLinkSlug?: string;
  variantSelections?: SalesLinkVariantSelection[];
  shipping?: CheckoutShippingSelection;
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

export const salesLinkVariantEligible = (
  base: Product,
  candidate: Product,
  prices: ProductPrice[],
  currency: string,
  settings: TenantSettings | null,
): boolean => {
  if (!candidate.published || base.variantGroup == null || candidate.variantGroup !== base.variantGroup ||
    candidate.type !== base.type || candidate.type === 'membership' ||
    (candidate.deliveryMethod ?? 'pickup') !== (base.deliveryMethod ?? 'pickup')) return false;
  const resolved = resolveSalesLinkPrices([candidate], prices);
  return resolved.ok && resolved.value[0]?.currency === currency && resolveProductVat(candidate, settings) !== null;
};

export const selectSalesLinkVariants = (
  bases: Product[],
  selections: readonly SalesLinkVariantSelection[],
  eligible: (base: Product, chosenId: string) => Product | undefined,
  strict: boolean,
): Result<Product[], AppError> => {
  const chosen = new Map<string, Product>();
  const seen = new Set<string>();
  for (const selection of selections) {
    const base = bases.find((product) => product.id === selection.productId);
    const duplicate = seen.has(selection.productId);
    seen.add(selection.productId);
    const product = base === undefined || duplicate ? undefined
      : selection.variantProductId === base.id ? base : eligible(base, selection.variantProductId);
    if (product === undefined) {
      if (strict) return err(validation('Invalid sales link selection'));
    } else chosen.set(selection.productId, product);
  }
  const products = bases.map((base) => chosen.get(base.id) ?? base);
  if (new Set(products.map((product) => product.id)).size !== products.length) {
    return strict ? err(validation('Invalid sales link selection')) : ok(bases);
  }
  return ok(products);
};
