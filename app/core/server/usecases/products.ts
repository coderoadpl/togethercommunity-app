import {
  buildSnapshot,
  err,
  newProductSchema,
  notFound,
  ok,
  productSlugFromTitle,
  productSlugSchema,
  slugReserved,
  updateProductInputSchema,
  validation,
  type AppError,
  type NewProductInput,
  type Product,
  type Result,
  type UpdateProductInput,
} from '#core/domain/index.js';

import type { Ctx } from '../context.js';
import type {
  Clock,
  EntityVersionRecord,
  IdGenerator,
  ProductMetadataRepository,
  ProductPriceRepository,
  ProductRepository,
} from '../ports.js';
import { authorizeTenant } from '../authorize.js';

export interface ProductDeps {
  products: ProductRepository;
  ids: IdGenerator;
  clock: Clock;
}

export interface ProductPublicationDeps {
  products: ProductRepository;
  prices: Pick<ProductPriceRepository, 'listActiveByProducts'>;
}

export interface ProductUpdateDeps extends ProductDeps {
  products: ProductRepository & ProductMetadataRepository;
}

const snapshotOf = (
  ctx: Ctx,
  product: Product,
  deps: Pick<ProductUpdateDeps, 'ids' | 'clock'>,
): Result<EntityVersionRecord, AppError> => {
  const built = buildSnapshot('product', product);
  if (!built.ok) return built;
  return ok({
    id: deps.ids.nextId(),
    entityKind: 'product',
    entityId: product.id,
    schemaVersion: built.value.schemaVersion,
    payload: built.value.payload,
    createdAt: deps.clock.nowIso(),
    createdBy: ctx.identity.userId,
  });
};

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

export const updateProduct = async (
  ctx: Ctx,
  input: UpdateProductInput,
  deps: ProductUpdateDeps,
): Promise<Result<Product, AppError>> => {
  const tenant = authorizeTenant(ctx, 'product:write');
  if (!tenant.ok) return tenant;

  const parsed = updateProductInputSchema.safeParse(input);
  if (!parsed.success) return err(validation('Invalid product update', parsed.error.flatten()));

  const existing = await deps.products.findById(tenant.value, parsed.data.id);
  if (!existing) return err(notFound(`No product "${parsed.data.id}" in this tenant`));

  const snapshot = snapshotOf(ctx, existing, deps);
  if (!snapshot.ok) return snapshot;
  const updated: Product = {
    ...existing,
    title: parsed.data.title ?? existing.title,
    description: parsed.data.description ?? existing.description,
    coverUrl: parsed.data.coverUrl === undefined ? existing.coverUrl : parsed.data.coverUrl,
  };
  const saved = await deps.products.update(tenant.value, updated, snapshot.value);
  return saved ? ok(saved) : err(notFound(`No product "${parsed.data.id}" in this tenant`));
};

export const publishProduct = async (
  ctx: Ctx,
  input: { id: string },
  deps: ProductPublicationDeps,
): Promise<Result<Product, AppError>> => {
  const tenant = authorizeTenant(ctx, 'product:publish');
  if (!tenant.ok) return tenant;

  const existing = await deps.products.findById(tenant.value, input.id);
  if (!existing) return err(notFound(`No product "${input.id}" in this tenant`));
  if (existing.published) return ok(existing);
  if (existing.accessItems.length === 0) {
    return err(validation('Product requires at least one access grant before publishing'));
  }
  const activePrices = await deps.prices.listActiveByProducts(tenant.value, [existing.id]);
  if (activePrices.length === 0) {
    return err(validation('Product requires an active price before publishing'));
  }

  await deps.products.setPublished(tenant.value, input.id, true);
  await deps.products.bumpContentVersion(tenant.value);
  return ok({ ...existing, published: true });
};

export const unpublishProduct = async (
  ctx: Ctx,
  input: { id: string },
  deps: Pick<ProductDeps, 'products'>,
): Promise<Result<Product, AppError>> => {
  const tenant = authorizeTenant(ctx, 'product:publish');
  if (!tenant.ok) return tenant;

  const existing = await deps.products.findById(tenant.value, input.id);
  if (!existing) return err(notFound(`No product "${input.id}" in this tenant`));
  if (!existing.published) return ok(existing);

  await deps.products.setPublished(tenant.value, input.id, false);
  await deps.products.bumpContentVersion(tenant.value);
  return ok({ ...existing, published: false });
};
