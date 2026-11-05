import {
  adjustStockInputSchema,
  enableStockTrackingInputSchema,
  err,
  firstSoldOutProductId,
  lowStockAlertFor,
  notFound,
  ok,
  productStockView,
  soldOut,
  stockCheckoutExpiry,
  stockThresholdInputSchema,
  STOCK_SWEEP_BATCH_SIZE,
  validation,
  type AppError,
  type Product,
  type ProductStock,
  type Result,
  type StockLevel,
  type Tenant,
} from '#core/domain/index.js';

import { authorizeTenant } from '../authorize.js';
import type { Ctx } from '../context.js';
import type { Clock, EmailOutboxRepository, IdGenerator, ProductRepository, TenantAccessReader, TenantDomainRepository, TenantRepository } from '../ports.js';
import type { StockRepository } from '../stock-ports.js';
import { resolveTenantOrigin, type TenantUrlDeps } from '../tenant-url.js';
import { tenantStaffRecipients } from './tenant-staff-recipients.js';

export interface ProductStockDeps {
  products: ProductRepository;
  stock: StockRepository;
  clock: Clock;
}

const trackedProduct = async (tenantId: string, productId: string, deps: ProductStockDeps): Promise<Result<Product, AppError>> => {
  const product = await deps.products.findById(tenantId, productId);
  return product === null ? err(notFound(`No product "${productId}" in this tenant`)) : ok(product);
};

const actorUserId = (ctx: Ctx): string => ctx.impersonation?.actorUserId ?? ctx.identity.userId;

export const getProductStock = async (
  ctx: Ctx,
  productId: string,
  deps: ProductStockDeps,
): Promise<Result<ProductStock | null, AppError>> => {
  const tenant = authorizeTenant(ctx, 'product:read');
  if (!tenant.ok) return tenant;
  const product = await trackedProduct(tenant.value, productId, deps);
  if (!product.ok) return product;
  const level = await deps.stock.find(tenant.value, productId);
  return ok(level === null ? null : productStockView(level));
};

export const listProductStock = async (
  ctx: Ctx,
  productIds: readonly string[],
  deps: Pick<ProductStockDeps, 'stock'>,
): Promise<Result<ProductStock[], AppError>> => {
  const tenant = authorizeTenant(ctx, 'product:read');
  if (!tenant.ok) return tenant;
  return ok(productIds.length === 0 ? [] : (await deps.stock.listByProducts(tenant.value, productIds)).map(productStockView));
};

export const enableProductStock = async (
  ctx: Ctx,
  input: unknown,
  deps: ProductStockDeps,
): Promise<Result<ProductStock, AppError>> => {
  const tenant = authorizeTenant(ctx, 'product:write');
  if (!tenant.ok) return tenant;
  const parsed = enableStockTrackingInputSchema.safeParse(input);
  if (!parsed.success) return err(validation('Invalid stock tracking payload', parsed.error.flatten()));
  const product = await trackedProduct(tenant.value, parsed.data.productId, deps);
  if (!product.ok) return product;
  const enabled = await deps.stock.enableTracking(tenant.value, { ...parsed.data, actorUserId: actorUserId(ctx), now: deps.clock.nowIso() });
  return enabled.ok ? ok(productStockView(enabled.value)) : enabled;
};

export const adjustProductStock = async (
  ctx: Ctx,
  input: unknown,
  deps: ProductStockDeps,
): Promise<Result<ProductStock, AppError>> => {
  const tenant = authorizeTenant(ctx, 'product:write');
  if (!tenant.ok) return tenant;
  const parsed = adjustStockInputSchema.safeParse(input);
  if (!parsed.success) return err(validation('Invalid stock adjustment payload', parsed.error.flatten()));
  const product = await trackedProduct(tenant.value, parsed.data.productId, deps);
  if (!product.ok) return product;
  const adjusted = await deps.stock.adjust(tenant.value, { ...parsed.data, actorUserId: actorUserId(ctx), now: deps.clock.nowIso() });
  return adjusted.ok ? ok(productStockView(adjusted.value)) : adjusted;
};

export const setProductStockThreshold = async (
  ctx: Ctx,
  input: unknown,
  deps: ProductStockDeps,
): Promise<Result<ProductStock, AppError>> => {
  const tenant = authorizeTenant(ctx, 'product:write');
  if (!tenant.ok) return tenant;
  const parsed = stockThresholdInputSchema.safeParse(input);
  if (!parsed.success) return err(validation('Invalid low-stock threshold payload', parsed.error.flatten()));
  const product = await trackedProduct(tenant.value, parsed.data.productId, deps);
  if (!product.ok) return product;
  const updated = await deps.stock.setThreshold(tenant.value, { ...parsed.data, now: deps.clock.nowIso() });
  return updated.ok ? ok(productStockView(updated.value)) : updated;
};

export const ensureProductsInStock = async (
  tenantId: string,
  products: readonly Product[],
  deps: { stock?: StockRepository | undefined },
): Promise<Result<StockLevel[], AppError>> => {
  if (deps.stock === undefined) return ok([]);
  const productIds = products.map((product) => product.id);
  const levels = await deps.stock.listByProducts(tenantId, productIds);
  const soldOutId = firstSoldOutProductId(productIds, levels);
  const soldOutProduct = products.find((product) => product.id === soldOutId);
  return soldOutProduct === undefined ? ok(levels) : err(soldOut(soldOutProduct.title, soldOutProduct.id));
};

export interface CheckoutStockHold {
  checkoutSnapshotId: string;
  sessionExpiresAt: string;
}

export interface CheckoutStockDeps {
  stock?: StockRepository | undefined;
  clock?: Clock | undefined;
}

export const reserveCheckoutStock = async (
  tenantId: string,
  input: { checkoutSnapshotId: string | undefined; products: readonly Product[] },
  deps: CheckoutStockDeps,
): Promise<Result<CheckoutStockHold | null, AppError>> => {
  if (deps.stock === undefined || deps.clock === undefined || input.checkoutSnapshotId === undefined) return ok(null);
  const now = deps.clock.nowIso();
  const expiry = stockCheckoutExpiry(now);
  const reserved = await deps.stock.reserve(tenantId, {
    checkoutSnapshotId: input.checkoutSnapshotId,
    productIds: input.products.map((product) => product.id),
    expiresAt: expiry.reservationExpiresAt,
    quantity: 1,
    now,
  });
  if (!reserved.ok) {
    const product = input.products.find((candidate) => candidate.id === reserved.error.soldOutProductId);
    return err(soldOut(product?.title ?? reserved.error.soldOutProductId, reserved.error.soldOutProductId));
  }
  return reserved.value.reservationIds.length === 0
    ? ok(null)
    : ok({ checkoutSnapshotId: input.checkoutSnapshotId, sessionExpiresAt: expiry.sessionExpiresAt });
};

export const releaseCheckoutStock = async (
  tenantId: string,
  hold: CheckoutStockHold | null,
  reason: string,
  deps: CheckoutStockDeps,
): Promise<void> => {
  if (hold === null || deps.stock === undefined || deps.clock === undefined) return;
  await deps.stock.release(tenantId, { checkoutSnapshotId: hold.checkoutSnapshotId, reason, now: deps.clock.nowIso() });
};

export const withCheckoutStockHold = async <T>(
  tenantId: string,
  hold: CheckoutStockHold | null,
  deps: CheckoutStockDeps,
  operation: () => Promise<Result<T, AppError>>,
): Promise<Result<T, AppError>> => {
  let result: Result<T, AppError>;
  try {
    result = await operation();
  } catch (cause) {
    await releaseCheckoutStock(tenantId, hold, 'checkout_failed', deps);
    throw cause;
  }
  if (!result.ok) await releaseCheckoutStock(tenantId, hold, 'checkout_failed', deps);
  return result;
};

export interface CommitCheckoutStockDeps extends TenantUrlDeps {
  tenantDomains: Pick<TenantDomainRepository, 'listByTenant'>;
  stock?: StockRepository | undefined;
  tenantAccess?: Pick<TenantAccessReader, 'listStaffForTenant'> | undefined;
  tenants: Pick<TenantRepository, 'findSettings'>;
  products: Pick<ProductRepository, 'findById'>;
  emailOutbox: Pick<EmailOutboxRepository, 'enqueue'>;
  ids: IdGenerator;
  clock: Clock;
  logger: { warn(message: string): void };
}

export const commitCheckoutStock = async (
  tenant: Pick<Tenant, 'id' | 'name' | 'slug'>,
  input: { checkoutSnapshotId: string | null; orderId: string; productIds: readonly string[] },
  deps: CommitCheckoutStockDeps,
): Promise<{ alertsQueued: boolean }> => {
  if (deps.stock === undefined) return { alertsQueued: false };
  const now = deps.clock.nowIso();
  const effects = await deps.stock.commit(tenant.id, { ...input, now });
  let alertsQueued = false;
  for (const effect of effects) {
    if (effect.oversold) {
      deps.logger.warn(`[stock] oversold tenant=${tenant.id} product=${effect.productId} order=${input.orderId}`);
    }
    const alert = lowStockAlertFor(effect);
    if (alert === null) continue;
    const recipients = deps.tenantAccess === undefined ? [] : await tenantStaffRecipients(tenant.id, { tenants: deps.tenants, tenantAccess: deps.tenantAccess });
    const product = await deps.products.findById(tenant.id, effect.productId);
    const studioUrl = `${await resolveTenantOrigin(tenant, deps)}/panel/products/${encodeURIComponent(effect.productId)}`;
    let queuedAny = false;
    for (const recipient of recipients) {
      const queued = await deps.emailOutbox.enqueue({
        id: deps.ids.nextId(),
        tenantId: tenant.id,
        to: recipient.email,
        payload: {
          kind: 'stock-low',
          language: recipient.language,
          tenantName: tenant.name,
          productTitle: product?.title ?? effect.productId,
          available: alert.available,
          threshold: effect.lowStockThreshold,
          oversold: alert.oversold,
          studioUrl,
        },
        now,
      });
      if (queued.ok) {
        queuedAny = true;
      } else {
        deps.logger.warn(`[stock] low-stock alert not queued tenant=${tenant.id} product=${effect.productId}: ${queued.error.message}`);
      }
    }
    if (!queuedAny) continue;
    alertsQueued = true;
    await deps.stock.markLowStockNotified(tenant.id, { productId: effect.productId, now });
  }
  return { alertsQueued };
};

export const releaseExpiredStockReservations = async (deps: {
  stock: StockRepository;
  clock: Clock;
  logger: { warn(message: string): void };
}): Promise<Result<{ released: number }, AppError>> => {
  const released = await deps.stock.releaseExpired(deps.clock.nowIso(), STOCK_SWEEP_BATCH_SIZE);
  if (released > 0) deps.logger.warn(`[stock] released ${String(released)} expired checkout reservation(s)`);
  return ok({ released });
};
