import {
  currencySchema,
  err,
  exportOrdersQuerySchema,
  forbidden,
  listOrdersQuerySchema,
  ok,
  tenantNotFound,
  validation,
  type AppError,
  type OrderListItem,
  type OrderExportFile,
  type Result,
  type SalesSummary,
} from '@core/domain/index.js';

import type { Ctx } from '../context.js';
import type { Clock, MemberSubscriptionRepository, OrderRepository } from '../ports.js';

export interface OrdersDeps {
  orders: OrderRepository;
  subscriptions: MemberSubscriptionRepository;
  clock: Clock;
}

const requireStaffTenant = (ctx: Ctx): Result<string, AppError> => {
  if (!ctx.identity.tenantId) return err(tenantNotFound('Select a tenant to see sales'));
  if (!ctx.identity.staffRole) return err(forbidden('Only tenant staff can see sales'));
  return ok(ctx.identity.tenantId);
};

export interface OrdersPage {
  orders: OrderListItem[];
  total: number;
  page: number;
  pageSize: number;
}

export const listOrders = async (
  ctx: Ctx,
  query: unknown,
  deps: Pick<OrdersDeps, 'orders'>,
): Promise<Result<OrdersPage, AppError>> => {
  const tenant = requireStaffTenant(ctx);
  if (!tenant.ok) return tenant;

  const parsed = listOrdersQuerySchema.safeParse(query);
  if (!parsed.success) return err(validation('Invalid orders query', parsed.error.flatten()));

  const { orders, total } = await deps.orders.list(tenant.value, {
    page: parsed.data.page,
    pageSize: parsed.data.pageSize,
    ...(parsed.data.status === undefined ? {} : { status: parsed.data.status }),
    ...(parsed.data.productId === undefined ? {} : { productId: parsed.data.productId }),
    ...(parsed.data.kind === undefined ? {} : { kind: parsed.data.kind }),
    ...(parsed.data.search === undefined ? {} : { search: parsed.data.search }),
  });
  return ok({ orders, total, page: parsed.data.page, pageSize: parsed.data.pageSize });
};

const neutralizeFormula = (value: string): string =>
  /^[=+\-@]/.test(value) ? `'${value}` : value;

const quoteCsv = (value: string): string => `"${value.replaceAll('"', '""')}"`;

const ordersToCsv = (orders: OrderListItem[]): string =>
  [
    ['date', 'member', 'email', 'product', 'kind', 'amount_cents', 'currency', 'status'].join(','),
    ...orders.map((order) =>
      [
        order.createdAt,
        order.memberName ?? '',
        order.memberEmail,
        order.productTitle,
        order.kind,
        String(order.amountCents),
        order.currency,
        order.status,
      ]
        .map((value) => quoteCsv(neutralizeFormula(value)))
        .join(','),
    ),
  ].join('\n');

export const exportOrders = async (
  ctx: Ctx,
  query: unknown,
  deps: Pick<OrdersDeps, 'orders'>,
): Promise<Result<OrderExportFile, AppError>> => {
  const tenant = requireStaffTenant(ctx);
  if (!tenant.ok) return tenant;

  const parsed = exportOrdersQuerySchema.safeParse(query);
  if (!parsed.success) return err(validation('Invalid orders export query', parsed.error.flatten()));

  const pageSize = 100;
  const first = await deps.orders.list(tenant.value, {
    page: 1,
    pageSize,
    ...(parsed.data.status === undefined ? {} : { status: parsed.data.status }),
    ...(parsed.data.productId === undefined ? {} : { productId: parsed.data.productId }),
    ...(parsed.data.kind === undefined ? {} : { kind: parsed.data.kind }),
    ...(parsed.data.search === undefined ? {} : { search: parsed.data.search }),
  });
  const pageCount = Math.ceil(first.total / pageSize);
  const remaining = await Promise.all(
    Array.from({ length: Math.max(0, pageCount - 1) }, (_value, index) =>
      deps.orders.list(tenant.value, {
        page: index + 2,
        pageSize,
        ...(parsed.data.status === undefined ? {} : { status: parsed.data.status }),
        ...(parsed.data.productId === undefined ? {} : { productId: parsed.data.productId }),
        ...(parsed.data.kind === undefined ? {} : { kind: parsed.data.kind }),
        ...(parsed.data.search === undefined ? {} : { search: parsed.data.search }),
      }),
    ),
  );
  const orders = [...first.orders, ...remaining.flatMap((page) => page.orders)];
  const filename = `sales-${ctx.identity.tenantSlug ?? tenant.value}.${parsed.data.format}`;

  return ok(
    parsed.data.format === 'csv'
      ? { filename, mimeType: 'text/csv; charset=utf-8', content: ordersToCsv(orders) }
      : { filename, mimeType: 'application/json; charset=utf-8', content: JSON.stringify(orders) },
  );
};

const THIRTY_DAYS_MS = 30 * 24 * 60 * 60 * 1000;

export const getSalesSummary = async (
  ctx: Ctx,
  deps: OrdersDeps,
): Promise<Result<SalesSummary, AppError>> => {
  const tenant = requireStaffTenant(ctx);
  if (!tenant.ok) return tenant;

  const now = deps.clock.nowIso();
  const since = new Date(Date.parse(now) - THIRTY_DAYS_MS).toISOString();
  const [revenue, orderCount, activeSubscriptions] = await Promise.all([
    deps.orders.revenueSince(tenant.value, since),
    deps.orders.countSince(tenant.value, since),
    deps.subscriptions.countActive(tenant.value, now),
  ]);
  return ok({
    revenueLast30Days: revenue.map((entry) => ({
      currency: currencySchema.parse(entry.currency),
      amountCents: entry.amountCents,
    })),
    ordersLast30Days: orderCount,
    activeSubscriptions,
  });
};
