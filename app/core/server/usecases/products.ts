import {
  err,
  newProductSchema,
  notFound,
  ok,
  productSlugFromTitle,
  productSlugSchema,
  slugReserved,
  validation,
  type AppError,
  type NewProductInput,
  type Product,
  type Result,
} from '#core/domain/index.js';

import type { Ctx } from '../context.js';
import type { Clock, IdGenerator, ProductRepository } from '../ports.js';
import { authorizeTenant } from '../authorize.js';

export interface ProductDeps {
  products: ProductRepository;
  ids: IdGenerator;
  clock: Clock;
}

export const listProducts = async (
  ctx: Ctx,
  deps: ProductDeps,
): Promise<Result<Product[], AppError>> => {
  const tenant = authorizeTenant(ctx, 'product:read');
  if (!tenant.ok) return tenant;
  return ok(await deps.products.listByTenant(tenant.value));
};

export const createProduct = async (
  ctx: Ctx,
  input: NewProductInput,
  deps: ProductDeps,
): Promise<Result<Product, AppError>> => {
  const tenant = authorizeTenant(ctx, 'product:write');
  if (!tenant.ok) return tenant;

  const parsed = newProductSchema.safeParse(input);
  if (!parsed.success) return err(validation('Invalid product', parsed.error.flatten()));

  const slug = parsed.data.slug ?? productSlugFromTitle(parsed.data.title);
  if (!productSlugSchema.safeParse(slug).success) {
    return err(validation('Product slug must contain lowercase letters, numbers and hyphens only'));
  }
  const product: Product = {
    id: deps.ids.nextId(),
    tenantId: tenant.value,
    type: parsed.data.type,
    slug,
    title: parsed.data.title,
    description: parsed.data.description,
    coverUrl: parsed.data.coverUrl,
    priceCents: parsed.data.priceCents,
    currency: parsed.data.currency,
    published: false,
    accessItems: parsed.data.accessItems,
    checkoutConsentDefinitionIds: [],
    legacyId: null,
    createdAt: deps.clock.nowIso(),
  };
  const inserted = await deps.products.create(tenant.value, product);
  if (inserted === 'slug_taken') {
    return err(slugReserved(`A product with slug "${slug}" already exists`));
  }
  return ok(product);
};

export const publishProduct = async (
  ctx: Ctx,
  input: { id: string },
  deps: ProductDeps,
): Promise<Result<Product, AppError>> => {
  const tenant = authorizeTenant(ctx, 'product:publish');
  if (!tenant.ok) return tenant;

  const existing = await deps.products.findById(tenant.value, input.id);
  if (!existing) return err(notFound(`No product "${input.id}" in this tenant`));
  if (existing.published) return ok(existing);

  await deps.products.setPublished(tenant.value, input.id, true);
  await deps.products.bumpContentVersion(tenant.value);
  return ok({ ...existing, published: true });
};
