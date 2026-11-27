import {
  currencySchema,
  err,
  exportOrdersQuerySchema,
  listOrdersQuerySchema,
  notFound,
  orderPersonalizationSummary,
  ok,
  orderRefundJobView,
  validation,
  type AppError,
  type OrderListFilters,
  type OrderListItem,
  type OrderRefundJobView,
  type OrderRefundTotals,
  type OrderStaffRefundView,
  type OrderExportFile,
  type Result,
  type SalesSummary,
} from '#core/domain/index.js';

import type { Ctx } from '../context.js';
import { authorizeTenant } from '../authorize.js';
import type {
  Clock,
  MemberSubscriptionRepository,
  OrderDetailRepository,
  OrderRefundJobRepository,
  OrderListQuery,
  OrderRepository,
  OrderStaffRefundRepository,
  InvoiceRepository,
} from '../ports.js';
import { orderStaffRefundSummary } from './staff-refunds.js';

export interface OrdersDeps {
  orders: OrderRepository;
  subscriptions: MemberSubscriptionRepository;
  clock: Clock;
}

export interface OrdersPage {
  sources: string[];
  orders: OrderListItem[];
  total: number;
  page: number;
  pageSize: number;
}

const withStaffRefundStatus = async (
  tenantId: string,
  orders: OrderListItem[],
  staffRefunds: Pick<OrderStaffRefundRepository, 'activeRefundByOrder'>,
): Promise<OrderListItem[]> => {
  const active = await staffRefunds.activeRefundByOrder(tenantId, orders.flatMap((order) => (order.cancelReason == null ? [order.id] : [])));
  return orders.map((order) => {
    const refund = active.get(order.id);
    return refund === undefined ? order : { ...order, staffRefundStatus: refund.status, staffRefundAmountCents: refund.amountCents };
  });
};

const orderListFilters = (
  query: OrderListFilters,
): Omit<OrderListQuery, 'mode' | 'page' | 'pageSize'> => ({
  ...(query.status === undefined ? {} : { status: query.status }),
  ...(query.productId === undefined ? {} : { productId: query.productId }),
  ...(query.kind === undefined ? {} : { kind: query.kind }),
  ...(query.couponId === undefined ? {} : { couponId: query.couponId }),
  ...(query.fulfilmentStatus === undefined ? {} : { fulfilmentStatus: query.fulfilmentStatus }),
  ...(query.search === undefined ? {} : { search: query.search }),
  ...(query.source === undefined ? {} : { source: query.source }),
  ...(query.sourceMatch === undefined ? {} : { sourceMatch: query.sourceMatch }),
  ...(query.invoice === undefined ? {} : { invoice: query.invoice }),
  ...(query.billing === undefined ? {} : { billing: query.billing }),
  ...(query.sortBy === undefined ? {} : { sortBy: query.sortBy }),
  ...(query.sortDirection === undefined ? {} : { sortDirection: query.sortDirection }),
});

export const listOrders = async (
  ctx: Ctx,
  query: unknown,
  deps: Pick<OrdersDeps, 'orders'> & { staffRefunds?: Pick<OrderStaffRefundRepository, 'activeRefundByOrder'> },
): Promise<Result<OrdersPage, AppError>> => {
  const tenant = authorizeTenant(ctx, 'order:read');
  if (!tenant.ok) return tenant;

  const parsed = listOrdersQuerySchema.safeParse(query);
  if (!parsed.success) return err(validation('Invalid orders query', parsed.error.flatten()));

  const { orders, total, sources } = await deps.orders.list(tenant.value, {
    ...(parsed.data.mode === undefined ? {} : { mode: parsed.data.mode }),
    page: parsed.data.page,
    pageSize: parsed.data.pageSize,
    ...orderListFilters(parsed.data),
  });
  const listed = deps.staffRefunds === undefined || ctx.machineActor !== undefined ? orders : await withStaffRefundStatus(tenant.value, orders, deps.staffRefunds);
  return ok({ orders: listed, total, sources: sources ?? [], page: parsed.data.page, pageSize: parsed.data.pageSize });
};

export const getOrder = async (
  ctx: Ctx,
  id: string,
  deps: {
    orders: OrderDetailRepository;
    invoices?: InvoiceRepository;
    refundJobs?: Pick<OrderRefundJobRepository, 'findByOrderId'>;
    staffRefunds?: Pick<OrderStaffRefundRepository, 'listByOrder'>;
  },
): Promise<Result<{
  order: OrderListItem;
  invoice: Awaited<ReturnType<InvoiceRepository['findCurrentByOrder']>>;
  refundJob: OrderRefundJobView | null;
  staffRefunds?: OrderStaffRefundView[];
  refundTotals?: OrderRefundTotals;
}, AppError>> => {
  const tenant = authorizeTenant(ctx, 'order:read');
  if (!tenant.ok) return tenant;
  const order = await deps.orders.findById(tenant.value, id);
  if (order === null) return err(notFound('Order was not found'));
  const invoice = deps.invoices === undefined
    ? null
    : await deps.invoices.findCurrentByOrder(tenant.value, order.id);
  const refundJob = await deps.refundJobs?.findByOrderId(tenant.value, order.id) ?? null;
  const staff = deps.staffRefunds === undefined ? {} : await orderStaffRefundSummary(tenant.value, order, refundJob, deps.staffRefunds);
  return ok({ order, invoice, refundJob: refundJob === null ? null : orderRefundJobView(refundJob), ...staff });
};

const neutralizeFormula = (value: string): string =>
  /^[=+\-@]/.test(value) ? `'${value}` : value;

const quoteCsv = (value: string): string => `"${value.replaceAll('"', '""')}"`;

const attributionColumns = (order: OrderListItem) => ({
  utm_source: order.attribution?.utmSource ?? '',
  utm_medium: order.attribution?.utmMedium ?? '',
  utm_campaign: order.attribution?.utmCampaign ?? '',
  utm_content: order.attribution?.utmContent ?? '',
  utm_term: order.attribution?.utmTerm ?? '',
  fbclid: order.attribution?.fbclid ?? '',
  gclid: order.attribution?.gclid ?? '',
});

const shippingColumns = (order: OrderListItem) => {
  const point = order.shipping?.pickupPoint ?? null;
  const address = order.shipping?.address ?? null;
  return {
    shipping_rate: order.shipping?.label ?? '',
    shipping_point: point === null ? '' : [point.code, point.name, point.address].filter((value) => value !== null && value !== '').join(', '),
    shipping_name: address?.name ?? '',
    shipping_phone: order.shipping?.phone ?? '',
    shipping_address: address === null ? '' : [address.line1, address.line2].filter((value) => value !== null && value !== '').join(', '),
    shipping_postal_code: address?.postalCode ?? '',
    shipping_city: address?.city ?? '',
    shipping_country: address?.country ?? '',
    fulfilment_status: order.fulfilmentStatus ?? '',
  };
};

const SHIPPING_COLUMN_NAMES = [
  'shipping_rate',
  'shipping_point',
  'shipping_name',
  'shipping_phone',
  'shipping_address',
  'shipping_postal_code',
  'shipping_city',
  'shipping_country',
  'fulfilment_status',
];

const refundedCentsOf = (order: OrderListItem, refundedCents: ReadonlyMap<string, number>): number =>
  Math.min(refundedCents.get(order.id) ?? 0, order.amountCents);

const ordersToCsv = (orders: OrderListItem[], refundedCents: ReadonlyMap<string, number>): string =>
  [
    [
      'date',
      'member',
      'email',
      'product',
      'kind',
      'amount_cents',
      'currency',
      'status',
      'coupon',
      'discount_cents',
      'billing_nip',
      'billing_company',
      'billing_address',
      'billing_postal_code',
      'billing_city',
      'billing_country',
      'utm_source',
      'utm_medium',
      'utm_campaign',
      'utm_content',
      'utm_term',
      'fbclid',
      'gclid',
      ...SHIPPING_COLUMN_NAMES,
      'client_reference',
      'personalization',
      'cancel_reason',
      'refunded_amount',
    ].join(','),
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
        order.couponCode ?? '',
        String(order.discountCents),
        order.billing?.nip ?? '',
        order.billing?.companyName ?? '',
        order.billing?.address ?? '',
        order.billing?.postalCode ?? '',
        order.billing?.city ?? '',
        order.billing?.country ?? '',
        ...Object.values(attributionColumns(order)),
        ...Object.values(shippingColumns(order)),
        order.clientReference ?? '',
        orderPersonalizationSummary(order.lines ?? []),
        order.cancelReason ?? '',
        String(refundedCentsOf(order, refundedCents)),
      ]
        .map((value) => quoteCsv(neutralizeFormula(value)))
        .join(','),
    ),
  ].join('\n');

export const exportOrders = async (
  ctx: Ctx,
  query: unknown,
  deps: Pick<OrdersDeps, 'orders'> & { staffRefunds?: Pick<OrderStaffRefundRepository, 'refundedCentsByOrder'> },
): Promise<Result<OrderExportFile, AppError>> => {
  const tenant = authorizeTenant(ctx, 'order:export');
  if (!tenant.ok) return tenant;

  const parsed = exportOrdersQuerySchema.safeParse(query);
  if (!parsed.success) return err(validation('Invalid orders export query', parsed.error.flatten()));

  const pageSize = 100;
  const first = await deps.orders.list(tenant.value, {
    mode: 'live',
    page: 1,
    pageSize,
    ...orderListFilters(parsed.data),
  });
  const pageCount = Math.ceil(first.total / pageSize);
  const remaining = await Promise.all(
    Array.from({ length: Math.max(0, pageCount - 1) }, (_value, index) =>
      deps.orders.list(tenant.value, {
        mode: 'live',
        page: index + 2,
        pageSize,
        ...orderListFilters(parsed.data),
      }),
    ),
  );
  const orders = [...first.orders, ...remaining.flatMap((page) => page.orders)];
  const refundedCents = deps.staffRefunds === undefined
    ? new Map<string, number>()
    : await deps.staffRefunds.refundedCentsByOrder(tenant.value, orders.map((order) => order.id));
  const filename = `sales-${ctx.identity.tenantSlug ?? tenant.value}.${parsed.data.format}`;

  return ok(
    parsed.data.format === 'csv'
      ? { filename, mimeType: 'text/csv; charset=utf-8', content: ordersToCsv(orders, refundedCents) }
      : { filename, mimeType: 'application/json; charset=utf-8', content: JSON.stringify(orders.map((order) => ({ ...order, ...attributionColumns(order), ...shippingColumns(order), personalization: orderPersonalizationSummary(order.lines ?? []), refundedCents: refundedCentsOf(order, refundedCents) }))) },
  );
};

const THIRTY_DAYS_MS = 30 * 24 * 60 * 60 * 1000;

export const getSalesSummary = async (
  ctx: Ctx,
  deps: OrdersDeps,
): Promise<Result<SalesSummary, AppError>> => {
  const tenant = authorizeTenant(ctx, 'sales:read');
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
