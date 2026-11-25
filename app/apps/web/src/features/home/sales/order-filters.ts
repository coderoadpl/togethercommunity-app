import { z } from 'zod';

import {
  fulfilmentStatusSchema,
  orderBillingFilterSchema,
  orderInvoiceFilterSchema,
  priceKindSchema,
  stripeModeSchema,
  type OrderListFilters,
  type OrderSortDirection,
  type OrderSortField,
} from '#core/domain/index.js';

const ORDER_STATUSES = ['paid', 'pending', 'failed', 'refunded', 'partially_refunded'] as const;
const orderStatusFilterSchema = z.enum(ORDER_STATUSES);
const identifierSchema = z.string().min(1).max(200);
const sourceFilterSchema = z.union([z.literal('none'), z.string().regex(/^value:.{1,200}$/su)]);

const ORDER_FILTER_SCHEMAS = {
  mode: stripeModeSchema,
  status: orderStatusFilterSchema,
  productId: identifierSchema,
  kind: priceKindSchema,
  couponId: identifierSchema,
  source: sourceFilterSchema,
  fulfilmentStatus: fulfilmentStatusSchema,
  invoice: orderInvoiceFilterSchema,
  billing: orderBillingFilterSchema,
} as const;

export type OrderFilterKey = keyof typeof ORDER_FILTER_SCHEMAS;
export type OrderFilters = Partial<Record<OrderFilterKey, string>>;
export type OrderSearch = OrderFilters & { search?: string };

export const ORDER_FILTER_KEYS = Object.keys(ORDER_FILTER_SCHEMAS).filter((key): key is OrderFilterKey => Object.hasOwn(ORDER_FILTER_SCHEMAS, key));

const isOrderFilterValue = (key: OrderFilterKey, value: string): boolean => ORDER_FILTER_SCHEMAS[key].safeParse(value).success;

export const ORDER_FILTER_VALIDATORS: Readonly<Record<string, (value: string) => boolean>> = Object.fromEntries(
  ORDER_FILTER_KEYS.map((key) => [key, (value: string) => isOrderFilterValue(key, value)]),
);

const searchValue = (value: unknown): string | undefined =>
  typeof value === 'string' ? value : typeof value === 'number' || typeof value === 'boolean' ? String(value) : undefined;

export const validateOrdersSearch = (search: Record<string, unknown>): OrderSearch => {
  const result: OrderSearch = {};
  for (const key of ORDER_FILTER_KEYS) {
    const value = searchValue(search[key]);
    if (value !== undefined && isOrderFilterValue(key, value)) result[key] = value;
  }
  const text = searchValue(search['search'])?.trim();
  if (text !== undefined && text.length > 0) result.search = text.slice(0, 200);
  return result;
};

export const hasOrderFilters = (search: OrderSearch): boolean =>
  ORDER_FILTER_KEYS.some((key) => search[key] !== undefined);

export interface OrderSort { field: OrderSortField; direction: OrderSortDirection }

export const orderListFilters = (filters: OrderFilters, search: string, sort: OrderSort | null): OrderListFilters => {
  const mode = ORDER_FILTER_SCHEMAS.mode.safeParse(filters.mode).data;
  const status = ORDER_FILTER_SCHEMAS.status.safeParse(filters.status).data;
  const productId = ORDER_FILTER_SCHEMAS.productId.safeParse(filters.productId).data;
  const kind = ORDER_FILTER_SCHEMAS.kind.safeParse(filters.kind).data;
  const couponId = ORDER_FILTER_SCHEMAS.couponId.safeParse(filters.couponId).data;
  const source = ORDER_FILTER_SCHEMAS.source.safeParse(filters.source).data;
  const fulfilmentStatus = ORDER_FILTER_SCHEMAS.fulfilmentStatus.safeParse(filters.fulfilmentStatus).data;
  const invoice = ORDER_FILTER_SCHEMAS.invoice.safeParse(filters.invoice).data;
  const billing = ORDER_FILTER_SCHEMAS.billing.safeParse(filters.billing).data;
  return {
    ...(mode === undefined ? {} : { mode }),
    ...(status === undefined ? {} : { status }),
    ...(productId === undefined ? {} : { productId }),
    ...(kind === undefined ? {} : { kind }),
    ...(couponId === undefined ? {} : { couponId }),
    ...(source === undefined ? {} : source === 'none' ? { source } : { source: source.slice(6), sourceMatch: 'exact' as const }),
    ...(fulfilmentStatus === undefined ? {} : { fulfilmentStatus }),
    ...(invoice === undefined ? {} : { invoice }),
    ...(billing === undefined ? {} : { billing }),
    ...(search.length === 0 ? {} : { search }),
    ...(sort === null ? {} : { sortBy: sort.field, sortDirection: sort.direction }),
  };
};
