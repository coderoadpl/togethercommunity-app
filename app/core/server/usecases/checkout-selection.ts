import { CART_CURRENCY_MISMATCH_MESSAGE, CART_PRICE_REQUIRED_MESSAGE, cartCurrencies, checkoutShippingInputSchema, err, isSellableOneTimePrice, singleSellableOneTimePrice, notFound, ok, resolveCheckoutShipping, validation, resolveProductVat, type AppError, type CartLine, type CheckoutSessionInput, type CheckoutShippingSelection, type Product, type ProductPrice, type Result, type SalesLinkVariantSelection, type TenantSettings } from '#core/domain/index.js';
import type { TenantRepository } from '../ports.js';

export interface CheckoutSelection {
  product: Product;
  price: ProductPrice | null;
  products?: Product[];
  productPrices?: ProductPrice[];
  salesLinkId?: string;
  salesLinkSlug?: string;
  variantSelections?: SalesLinkVariantSelection[];
  cartLines?: { productId: string; quantity: number }[];
  shipping?: CheckoutShippingSelection;
}

export const withCheckoutShipping = async (
  tenantId: string,
  selection: CheckoutSelection,
  shipping: CheckoutSessionInput['shipping'],
  deps: { tenants?: Pick<TenantRepository, 'findSettings'> | undefined },
): Promise<Result<CheckoutSelection, AppError>> => {
  const shippingInput = shipping === undefined ? undefined : checkoutShippingInputSchema.safeParse(shipping);
  if (shippingInput !== undefined && !shippingInput.success) return err(validation('Invalid delivery selection', shippingInput.error.flatten()));
  const products = selection.products ?? [selection.product];
  const settings = products.some((product) => product.deliveryMethod === 'shipping') ? await deps.tenants?.findSettings(tenantId) : null;
  const resolved = resolveCheckoutShipping(products, settings?.shippingRates, shippingInput?.data);
  if (!resolved.ok) return resolved;
  return ok(resolved.value === null ? selection : { ...selection, shipping: resolved.value });
};

export const selectionLineQuantity = (selection: Pick<CheckoutSelection, 'cartLines'>, productId: string): number =>
  selection.cartLines?.find((line) => line.productId === productId)?.quantity ?? 1;

const sellableOneTimePrice = (price: ProductPrice, productId: string): boolean =>
  price.productId === productId && isSellableOneTimePrice(price);

export const resolveSalesLinkPrices = (
  products: Product[],
  prices: ProductPrice[],
): Result<ProductPrice[], AppError> => {
  const resolved: ProductPrice[] = [];
  for (const product of products) {
    const matching = prices.filter((price) => sellableOneTimePrice(price, product.id));
    const price = matching[0];
    if (matching.length !== 1 || price === undefined) return err(validation('Every sales-link product requires exactly one active one-time price'));
    resolved.push(price);
  }
  if (new Set(resolved.map((price) => price.currency)).size !== 1) return err(validation('Sales-link products must use the same currency'));
  return ok(resolved);
};

export const resolveCartPrices = (
  lines: readonly Pick<CartLine, 'productId' | 'priceId'>[],
  prices: ProductPrice[],
): Result<ProductPrice[], AppError> => {
  const resolved: ProductPrice[] = [];
  for (const line of lines) {
    if (line.priceId === undefined) {
      const price = singleSellableOneTimePrice(prices.filter((candidate) => candidate.productId === line.productId));
      if (price === null) return err(validation(CART_PRICE_REQUIRED_MESSAGE));
      resolved.push(price);
      continue;
    }
    const price = prices.find((candidate) => candidate.id === line.priceId && candidate.productId === line.productId && candidate.active && candidate.imported !== true);
    if (price === undefined) return err(notFound(`No active price "${line.priceId}" for this product`));
    if (!sellableOneTimePrice(price, line.productId)) return err(validation('Cart products require a one-time price'));
    resolved.push(price);
  }
  if (cartCurrencies(resolved).length > 1) return err(validation(CART_CURRENCY_MISMATCH_MESSAGE));
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
