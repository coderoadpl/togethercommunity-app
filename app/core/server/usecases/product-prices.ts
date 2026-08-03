import {
  err,
  newProductPriceSchema,
  notFound,
  ok,
  validation,
  type AppError,
  type NewProductPriceInput,
  type ProductPrice,
  type Result,
} from '#core/domain/index.js';

import type { Ctx } from '../context.js';
import type { Clock, IdGenerator, ProductPriceRepository, ProductRepository } from '../ports.js';
import { authorizeTenant } from '../authorize.js';

export interface ProductPriceDeps {
  products: ProductRepository;
  prices: ProductPriceRepository;
  ids: IdGenerator;
  clock: Clock;
}

export const listProductPrices = async (
  ctx: Ctx,
  productId: string,
  deps: ProductPriceDeps,
): Promise<Result<ProductPrice[], AppError>> => {
  const tenant = authorizeTenant(ctx, 'product:price:read');
  if (!tenant.ok) return tenant;
  const product = await deps.products.findById(tenant.value, productId);
  if (!product) return err(notFound(`No product "${productId}" in this tenant`));
  return ok(await deps.prices.listByProduct(tenant.value, productId));
};

export const createProductPrice = async (
  ctx: Ctx,
  input: NewProductPriceInput,
  deps: ProductPriceDeps,
): Promise<Result<ProductPrice, AppError>> => {
  const tenant = authorizeTenant(ctx, 'product:price:write');
  if (!tenant.ok) return tenant;

  const parsed = newProductPriceSchema.safeParse(input);
  if (!parsed.success) return err(validation('Invalid price', parsed.error.flatten()));

  const product = await deps.products.findById(tenant.value, parsed.data.productId);
  if (!product) return err(notFound(`No product "${parsed.data.productId}" in this tenant`));
  if (product.type === 'membership' && parsed.data.kind !== 'recurring') {
    return err(validation('Membership products require recurring prices'));
  }

  const price: ProductPrice = {
    id: deps.ids.nextId(),
    tenantId: tenant.value,
    productId: parsed.data.productId,
    kind: parsed.data.kind,
    interval: parsed.data.interval ?? null,
    amountCents: parsed.data.amountCents,
    currency: parsed.data.currency,
    active: true,
    createdAt: deps.clock.nowIso(),
  };
  await deps.prices.create(tenant.value, price);
  return ok(price);
};

export const deactivateProductPrice = async (
  ctx: Ctx,
  input: { id: string },
  deps: ProductPriceDeps,
): Promise<Result<ProductPrice, AppError>> => {
  const tenant = authorizeTenant(ctx, 'product:price:write');
  if (!tenant.ok) return tenant;
  const updated = await deps.prices.setActive(tenant.value, input.id, false);
  if (!updated) return err(notFound(`No price "${input.id}" in this tenant`));
  return ok(updated);
};
