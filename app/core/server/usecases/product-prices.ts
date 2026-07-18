import {
  err,
  forbidden,
  newProductPriceSchema,
  notFound,
  ok,
  tenantNotFound,
  validation,
  type AppError,
  type NewProductPriceInput,
  type ProductPrice,
  type Result,
} from '@core/domain/index.js';

import type { Ctx } from '../context.js';
import type { Clock, IdGenerator, ProductPriceRepository, ProductRepository } from '../ports.js';

export interface ProductPriceDeps {
  products: ProductRepository;
  prices: ProductPriceRepository;
  ids: IdGenerator;
  clock: Clock;
}

const requireStaffTenant = (ctx: Ctx): Result<string, AppError> => {
  if (!ctx.identity.tenantId) return err(tenantNotFound('Select a tenant to manage prices'));
  if (!ctx.identity.staffRole) return err(forbidden('Only tenant staff can manage prices'));
  return ok(ctx.identity.tenantId);
};

export const listProductPrices = async (
  ctx: Ctx,
  productId: string,
  deps: ProductPriceDeps,
): Promise<Result<ProductPrice[], AppError>> => {
  const tenant = requireStaffTenant(ctx);
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
  const tenant = requireStaffTenant(ctx);
  if (!tenant.ok) return tenant;

  const parsed = newProductPriceSchema.safeParse(input);
  if (!parsed.success) return err(validation('Invalid price', parsed.error.flatten()));

  const product = await deps.products.findById(tenant.value, parsed.data.productId);
  if (!product) return err(notFound(`No product "${parsed.data.productId}" in this tenant`));

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
  const tenant = requireStaffTenant(ctx);
  if (!tenant.ok) return tenant;
  const updated = await deps.prices.setActive(tenant.value, input.id, false);
  if (!updated) return err(notFound(`No price "${input.id}" in this tenant`));
  return ok(updated);
};
