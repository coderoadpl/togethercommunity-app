import {
  err,
  forbidden,
  newProductSchema,
  notFound,
  ok,
  tenantNotFound,
  validation,
  type AppError,
  type NewProductInput,
  type Product,
  type Result,
} from '@core/domain/index.js';

import type { Ctx } from '../context.js';
import type { Clock, IdGenerator, ProductRepository } from '../ports.js';

export interface ProductDeps {
  products: ProductRepository;
  ids: IdGenerator;
  clock: Clock;
}

const requireStaffTenant = (ctx: Ctx): Result<string, AppError> => {
  if (!ctx.identity.tenantId) return err(tenantNotFound('Select a tenant to manage products'));
  if (!ctx.identity.staffRole) return err(forbidden('Only tenant staff can manage products'));
  return ok(ctx.identity.tenantId);
};

export const listProducts = async (
  ctx: Ctx,
  deps: ProductDeps,
): Promise<Result<Product[], AppError>> => {
  const tenant = requireStaffTenant(ctx);
  if (!tenant.ok) return tenant;
  return ok(await deps.products.listByTenant(tenant.value));
};

export const createProduct = async (
  ctx: Ctx,
  input: NewProductInput,
  deps: ProductDeps,
): Promise<Result<Product, AppError>> => {
  const tenant = requireStaffTenant(ctx);
  if (!tenant.ok) return tenant;

  const parsed = newProductSchema.safeParse(input);
  if (!parsed.success) return err(validation('Invalid product', parsed.error.flatten()));

  const product: Product = {
    id: deps.ids.nextId(),
    tenantId: tenant.value,
    title: parsed.data.title,
    description: parsed.data.description,
    priceCents: parsed.data.priceCents,
    currency: parsed.data.currency,
    published: false,
    createdAt: deps.clock.nowIso(),
  };
  await deps.products.create(tenant.value, product);
  return ok(product);
};

export const publishProduct = async (
  ctx: Ctx,
  input: { id: string },
  deps: ProductDeps,
): Promise<Result<Product, AppError>> => {
  const tenant = requireStaffTenant(ctx);
  if (!tenant.ok) return tenant;

  const existing = await deps.products.findById(tenant.value, input.id);
  if (!existing) return err(notFound(`No product "${input.id}" in this tenant`));
  if (existing.published) return ok(existing);

  await deps.products.setPublished(tenant.value, input.id, true);
  await deps.products.bumpContentVersion(tenant.value);
  return ok({ ...existing, published: true });
};
