import {
  consumerSalesQuerySchema, err, ok, SALES_LINK_TIME_ZONE, splitProductGross, validation,
  type AppError, type ConsumerSalesRate, type ConsumerSalesSummary, type OrderLine, type Result,
} from '#core/domain/index.js';

import { authorizeTenant } from '../authorize.js';
import type { Ctx } from '../context.js';
import type { ConsumerSalesRepository } from '../consumer-sales-ports.js';

const VAT_RATES = [5, 8, 23, 'exempt'] as const;

const emptyRates = (): ConsumerSalesRate[] => VAT_RATES.map((rate) => ({
  rate,
  orderCount: 0, lineCount: 0, netCents: 0, vatCents: 0, grossCents: 0,
}));

const sumLines = (lines: OrderLine[]): ConsumerSalesRate[] => emptyRates().map((row) => {
  const matching = lines.filter((line) => line.vatRate === row.rate);
  return {
    ...row,
    orderCount: matching.length > 0 ? 1 : 0,
    lineCount: matching.length,
    netCents: matching.reduce((sum, line) => sum + line.netCents, 0),
    vatCents: matching.reduce((sum, line) => sum + line.vatCents, 0),
    grossCents: matching.reduce((sum, line) => sum + line.grossCents, 0),
  };
});

const allocateLines = (lines: OrderLine[], amountCents: number): OrderLine[] => {
  const total = lines.reduce((sum, line) => sum + line.grossCents, 0);
  let cumulative = 0;
  let allocated = 0;
  return lines.map((line) => {
    cumulative += line.grossCents;
    const next = total === 0 ? 0 : Math.round(cumulative * amountCents / total);
    const grossCents = next - allocated;
    allocated = next;
    return { ...line, ...splitProductGross(grossCents, line.vatRate ?? 'exempt') };
  });
};

export const summarizeUninvoicedConsumerSales = async (
  ctx: Ctx,
  query: unknown,
  deps: { consumerSales: ConsumerSalesRepository },
): Promise<Result<ConsumerSalesSummary, AppError>> => {
  const tenant = authorizeTenant(ctx, 'order:export');
  if (!tenant.ok) return tenant;
  const parsed = consumerSalesQuerySchema.safeParse(query);
  if (!parsed.success) return err(validation('Invalid consumer sales date range', parsed.error.flatten()));
  const selected = await deps.consumerSales.listUninvoicedConsumers(tenant.value, parsed.data);
  const incomplete = selected.filter((order) => !order.lines?.length || order.lines.some((line) => line.vatRate === null));
  if (incomplete.length > 0) return err(validation('Orders have missing stored VAT rates or lines', { orderIds: incomplete.map((order) => order.id) }));
  const unallocatable = selected.filter((order) => order.amountCents > 0 && order.lines?.every((line) => line.grossCents === 0));
  if (unallocatable.length > 0) return err(validation('Orders have no stored gross amount to allocate', { orderIds: unallocatable.map((order) => order.id) }));
  const currency = selected[0]?.currency ?? 'PLN';
  if (selected.some((order) => order.currency !== currency)) return err(validation('Consumer sales contain multiple currencies'));
  const dateFormat = new Intl.DateTimeFormat('en-CA', { timeZone: SALES_LINK_TIME_ZONE, year: 'numeric', month: '2-digit', day: '2-digit' });
  const orders = selected.map((order) => {
    const rates = sumLines(allocateLines(order.lines ?? [], order.amountCents));
    return { id: order.id, date: dateFormat.format(new Date(order.createdAt)), grossCents: rates.reduce((sum, row) => sum + row.grossCents, 0), rates };
  });
  const rates = emptyRates().map((row) => orders.reduce((sum, order) => {
    const value = order.rates.find((entry) => entry.rate === row.rate);
    return value === undefined ? sum : {
      rate: row.rate,
      orderCount: sum.orderCount + value.orderCount,
      lineCount: sum.lineCount + value.lineCount,
      netCents: sum.netCents + value.netCents,
      vatCents: sum.vatCents + value.vatCents,
      grossCents: sum.grossCents + value.grossCents,
    };
  }, row));
  const totals = rates.reduce((sum, row) => ({
    orderCount: orders.length,
    lineCount: sum.lineCount + row.lineCount,
    netCents: sum.netCents + row.netCents,
    vatCents: sum.vatCents + row.vatCents,
    grossCents: sum.grossCents + row.grossCents,
  }), { orderCount: orders.length, lineCount: 0, netCents: 0, vatCents: 0, grossCents: 0 });
  return ok({ ...parsed.data, timezone: SALES_LINK_TIME_ZONE, currency, rates, totals, orderIds: orders.map((order) => order.id), orders });
};

export const consumerSalesToCsv = (summary: ConsumerSalesSummary): string => {
  const quote = (value: string | number) => `"${String(value).replace(/^[=+\-@]/, "'$&").replaceAll('"', '""')}"`;
  const row = (values: Array<string | number>) => values.map(quote).join(',');
  return [
    row(['rate', 'order_count', 'line_count', 'net_cents', 'vat_cents', 'gross_cents', 'currency', 'from', 'to', 'timezone']),
    ...[...summary.rates, { rate: 'TOTAL', ...summary.totals }].map((value) => row([value.rate, value.orderCount, value.lineCount, value.netCents, value.vatCents, value.grossCents, summary.currency, summary.from, summary.to, summary.timezone])),
    '',
    row(['order_number', 'date', 'gross_cents', 'currency', 'rate_breakdown']),
    ...summary.orders.map((order) => row([order.id, order.date, order.grossCents, summary.currency, JSON.stringify(order.rates.filter((rate) => rate.lineCount > 0))])),
  ].join('\n');
};
