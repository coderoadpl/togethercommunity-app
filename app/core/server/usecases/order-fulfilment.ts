import {
  emailBrandingFrom,
  err,
  notFound,
  ok,
  orderDeliveryDetails,
  orderShipmentAllowed,
  packingListQuerySchema,
  productLines,
  resolveEmailLanguage,
  SALES_LINK_TIME_ZONE,
  shipmentTrackingUrl,
  shipOrderInputSchema,
  validation,
  type AppError,
  type OrderExportFile,
  type OrderListItem,
  type OrderShipment,
  type Result,
} from '#core/domain/index.js';
import { neutralizeFormula, quoteCsv } from '#core/domain/csv.js';

import { authorizeTenant } from '../authorize.js';
import type { Ctx } from '../context.js';
import type { OrderFulfilmentRepository, OrderShipmentEmail } from '../order-fulfilment-ports.js';
import type { Clock, IdGenerator, MemberRepository, OrderDetailRepository, OrderRepository, TenantRepository } from '../ports.js';
import { resolveTenantOrigin, type TenantOriginDeps } from '../tenant-url.js';

export interface ShipOrderDeps extends TenantOriginDeps {
  orderDetails: OrderDetailRepository;
  fulfilment: OrderFulfilmentRepository;
  members: Pick<MemberRepository, 'findById'>;
  tenants: Pick<TenantRepository, 'findSettings'>;
  ids: IdGenerator;
  clock: Clock;
  dispatchEmail(): void;
}

const orderItemNames = (order: OrderListItem): string[] => {
  const names = productLines(order.lines ?? []).map((line) => line.name);
  return names.length > 0 ? names : [order.productTitle];
};

const shipmentEmail = async (
  ctx: Ctx,
  tenantId: string,
  order: OrderListItem,
  shipment: OrderShipment,
  deps: ShipOrderDeps,
): Promise<Result<OrderShipmentEmail | null, AppError>> => {
  if (order.mode === 'test') return ok(null);
  if (order.shipping == null) return err(validation('Order has no delivery details'));
  const [member, settings] = await Promise.all([
    deps.members.findById(tenantId, order.memberId),
    deps.tenants.findSettings(tenantId),
  ]);
  const tenantBaseUrl = `${await resolveTenantOrigin({ id: tenantId, slug: ctx.identity.tenantSlug }, deps)}/`;
  return ok({
    id: deps.ids.nextId(),
    to: member?.email ?? order.memberEmail,
    payload: {
      kind: 'order-shipped',
      language: resolveEmailLanguage(member?.language, settings?.defaultLanguage),
      tenantName: ctx.identity.tenantName ?? '',
      shipment: {
        orderNumber: order.id,
        items: orderItemNames(order),
        delivery: orderDeliveryDetails(order.shipping),
        carrier: shipment.carrier,
        trackingNumber: shipment.trackingNumber,
        trackingUrl: shipmentTrackingUrl(shipment),
      },
      ...(settings === null ? {} : { branding: emailBrandingFrom(settings, tenantBaseUrl) }),
    },
  });
};

export const shipOrder = async (
  ctx: Ctx,
  input: unknown,
  deps: ShipOrderDeps,
): Promise<Result<{ order: OrderListItem }, AppError>> => {
  const tenant = authorizeTenant(ctx, 'order:write');
  if (!tenant.ok) return tenant;
  const parsed = shipOrderInputSchema.safeParse(input);
  if (!parsed.success) return err(validation('Invalid shipment', parsed.error.flatten()));
  const order = await deps.orderDetails.findById(tenant.value, parsed.data.orderId);
  if (order === null) return err(notFound('Order was not found'));
  const allowed = orderShipmentAllowed(order);
  if (!allowed.ok) return allowed;
  const shipment: OrderShipment = {
    carrier: parsed.data.carrier,
    trackingNumber: parsed.data.trackingNumber,
    shippedAt: deps.clock.nowIso(),
    shippedBy: ctx.identity.userId,
  };
  const email = await shipmentEmail(ctx, tenant.value, order, shipment, deps);
  if (!email.ok) return email;
  const shipped = await deps.fulfilment.ship(tenant.value, {
    orderId: order.id,
    eventId: deps.ids.nextId(),
    shipment,
    email: email.value,
  });
  if (!shipped.ok) return shipped;
  if (email.value !== null) deps.dispatchEmail();
  return ok({ order: shipped.value });
};

const PACKING_LIST_COLUMNS = [
  'order_number',
  'paid_at',
  'buyer_name',
  'email',
  'phone',
  'delivery',
  'pickup_point_code',
  'pickup_point_address',
  'shipping_name',
  'address_line1',
  'address_line2',
  'postal_code',
  'city',
  'country',
  'items',
  'notes',
];

const warsawDateTime = new Intl.DateTimeFormat('sv-SE', {
  timeZone: SALES_LINK_TIME_ZONE,
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
  hour: '2-digit',
  minute: '2-digit',
});

const paidAtOf = (order: OrderListItem): string => order.paidAt ?? order.createdAt;

const packingListRow = (order: OrderListItem): string[] => {
  const shipping = order.shipping ?? null;
  const address = shipping?.address ?? null;
  return [
    order.id,
    warsawDateTime.format(new Date(paidAtOf(order))),
    order.memberName ?? '',
    order.memberEmail,
    shipping?.phone ?? '',
    shipping?.label ?? '',
    shipping?.pickupPoint?.code ?? '',
    shipping?.pickupPoint?.address ?? '',
    address?.name ?? '',
    address?.line1 ?? '',
    address?.line2 ?? '',
    address?.postalCode ?? '',
    address?.city ?? '',
    address?.country ?? '',
    orderItemNames(order).map((name) => `${name} × 1`).join('; '),
    '',
  ];
};

const packingListCsv = (orders: readonly OrderListItem[]): string =>
  [
    PACKING_LIST_COLUMNS.join(','),
    ...orders
      .toSorted((left, right) => paidAtOf(left).localeCompare(paidAtOf(right)) || left.id.localeCompare(right.id))
      .map((order) => packingListRow(order).map((value) => quoteCsv(neutralizeFormula(value))).join(',')),
  ].join('\n');

const PACKING_LIST_PAGE_SIZE = 100;

export const exportPackingList = async (
  ctx: Ctx,
  query: unknown,
  deps: { orders: Pick<OrderRepository, 'list'> },
): Promise<Result<OrderExportFile, AppError>> => {
  const tenant = authorizeTenant(ctx, 'order:export');
  if (!tenant.ok) return tenant;
  const parsed = packingListQuerySchema.safeParse(query);
  if (!parsed.success) return err(validation('Invalid packing list query', parsed.error.flatten()));
  const page = (number: number) => deps.orders.list(tenant.value, {
    mode: 'live',
    fulfilmentStatus: parsed.data.fulfilmentStatus,
    page: number,
    pageSize: PACKING_LIST_PAGE_SIZE,
  });
  const first = await page(1);
  const pageCount = Math.ceil(first.total / PACKING_LIST_PAGE_SIZE);
  const remaining = await Promise.all(Array.from({ length: Math.max(0, pageCount - 1) }, (_value, index) => page(index + 2)));
  const orders = [...first.orders, ...remaining.flatMap((result) => result.orders)];
  return ok({
    filename: `packing-list-${ctx.identity.tenantSlug ?? tenant.value}.csv`,
    mimeType: 'text/csv; charset=utf-8',
    content: packingListCsv(orders),
  });
};
