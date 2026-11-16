import {
  cartLineQuantityError,
  cartLinesSchema,
  err,
  notFound,
  ok,
  resolveProductVat,
  validation,
  type AppError,
  type CartLine,
  type CheckoutCartInput,
  type Product,
  type Result,
} from '#core/domain/index.js';

import type { Clock, CouponRedemptionRepository, CouponRepository, PaymentProvider, ProductPriceHistoryRepository, ProductPriceRepository, ProductRepository, TenantRepository } from '../ports.js';
import type { StockRepository } from '../stock-ports.js';
import { validateSelectionCoupon } from './checkout-coupon.js';
import { resolveCartPrices, resolveCheckoutReturnAddresses, selectionLineQuantity, withCheckoutShipping, type CheckoutSelection } from './checkout-selection.js';
import { ensureProductsInStock } from './stock.js';

interface CartSelectionDeps {
  products: Pick<ProductRepository, 'findById'>;
  prices: Pick<ProductPriceRepository, 'listActiveByProducts'>;
  tenants?: Pick<TenantRepository, 'findSettings'> | undefined;
  stock?: StockRepository | undefined;
}

const selectCartProducts = async (
  tenantId: string,
  lines: readonly CartLine[],
  deps: CartSelectionDeps,
): Promise<Result<CheckoutSelection, AppError>> => {
  const items: { product: Product; quantity: number }[] = [];
  for (const line of lines) {
    const product = await deps.products.findById(tenantId, line.productId);
    if (product === null || !product.published) return err(notFound(`No published product "${line.productId}" in this tenant`));
    if (product.type === 'membership') return err(validation('Subscriptions cannot be included in a cart'));
    const quantityError = cartLineQuantityError(product, line.quantity);
    if (quantityError !== null) return err(validation(quantityError));
    items.push({ product, quantity: line.quantity });
  }
  const products = items.map((item) => item.product);
  const prices = resolveCartPrices(lines, await deps.prices.listActiveByProducts(tenantId, products.map((product) => product.id)));
  if (!prices.ok) return prices;
  const settings = await deps.tenants?.findSettings(tenantId) ?? null;
  if (products.some((product) => resolveProductVat(product, settings) === null)) return err(validation('Configure a VAT rate for every cart product'));
  const inStock = await ensureProductsInStock(tenantId, items, deps);
  if (!inStock.ok) return inStock;
  const [product] = products;
  if (product === undefined) return err(validation('A cart needs at least one line'));
  return ok({
    product, price: null, products, productPrices: prices.value,
    cartLines: items.map((item) => ({ productId: item.product.id, quantity: item.quantity })),
  });
};

export const validateCartSelection = async (
  tenantId: string,
  input: Pick<CheckoutCartInput, 'lines' | 'shipping' | 'returnUrl' | 'cancelUrl'>,
  deps: CartSelectionDeps,
  options: { shipping: 'resolve' | 'ignore' } = { shipping: 'resolve' },
): Promise<Result<CheckoutSelection, AppError>> => {
  const lines = cartLinesSchema.safeParse(input.lines);
  if (!lines.success) return err(validation('Invalid cart', lines.error.flatten()));
  const returns = await resolveCheckoutReturnAddresses(tenantId, input, deps);
  if (!returns.ok) return returns;
  const selection = await selectCartProducts(tenantId, lines.data, deps);
  if (!selection.ok) return selection;
  const withReturns = { ...selection.value, ...returns.value };
  return options.shipping === 'ignore' ? ok(withReturns) : withCheckoutShipping(tenantId, withReturns, input.shipping, deps);
};

export const validateCartCoupon = async (
  tenantId: string,
  input: { code: string; email?: string | undefined },
  selection: CheckoutSelection,
  deps: {
    coupons: CouponRepository;
    couponRedemptions: CouponRedemptionRepository;
    priceHistory: ProductPriceHistoryRepository;
    clock: Clock;
    payment: PaymentProvider;
  },
) => {
  const prices = selection.productPrices ?? [];
  const [first] = prices;
  if (selection.cartLines === undefined || first === undefined) return err(validation('Invalid cart'));
  return validateSelectionCoupon(tenantId, {
    code: input.code,
    ...(input.email === undefined ? {} : { email: input.email }),
    amountCents: prices.reduce((total, price) => total + price.amountCents * selectionLineQuantity(selection, price.productId), 0),
    currency: first.currency,
  }, selection, deps);
};
