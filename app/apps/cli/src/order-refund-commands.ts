import type { Command } from 'commander';
import { z } from 'zod';

import type { ApiClient } from '#core/client/index.js';
import {
  appError,
  err,
  formatMinorUnits,
  minorUnitsFromDecimal,
  ok,
  validation,
  type AppError,
  type OrderStaffRefundView,
  type Result,
  type StaffRefundPreview,
} from '#core/domain/index.js';

import { emit } from './output.js';

type OrderRefundCliContext = {
  api: Pick<ApiClient, 'orderRefundPreview' | 'createOrderRefund' | 'shipOrderAnyway'>;
  json: boolean;
};

const orderIdSchema = z.string().min(1);

const refundOptionsSchema = z.object({
  amount: z.string().min(1).optional(),
  remainder: z.string().min(1).optional(),
  reason: z.string().optional(),
  restock: z.boolean().default(true),
  keepOnPackingList: z.boolean().optional(),
  requestKey: z.string().min(1).optional(),
  yes: z.boolean().optional(),
});

const yesNo = (value: boolean): string => (value ? 'yes' : 'no');

export const refundPreviewLines = (preview: StaffRefundPreview): string => {
  const money = (cents: number) => formatMinorUnits(cents, preview.currency);
  const stock = preview.returnableStock.length === 0
    ? 'none'
    : preview.returnableStock.map((line) => `${line.productId} x${String(line.quantity)}`).join(', ');
  return [
    `order ${preview.orderId}: ${preview.refundable ? 'refundable' : `not refundable: ${preview.blockedReason ?? 'unknown reason'}`}`,
    `paid ${money(preview.paidCents)}, refunded ${money(preview.refundedCents)}, remaining ${money(preview.remainderCents)} (${preview.remainderSource === 'provider' ? 'read from the payment provider' : 'platform records only; the payment provider list could not be read'})`,
    `mode: ${preview.mode}`,
    `on the packing list: ${yesNo(preview.onPackingList)}; shipment or label: ${yesNo(preview.hasShipment)}; invoice: ${yesNo(preview.hasInvoice)}`,
    `stock a full refund can return: ${stock}`,
    `full refund defaults: return stock ${yesNo(preview.fullRefundOptions.restockDefault)}, take off the packing list ${yesNo(preview.fullRefundOptions.removeFromPackingListDefault)}`,
    ...(preview.waitingRefundId === null ? [] : [`refund still waiting to reach the payment provider: ${preview.waitingRefundId}`]),
    ...(preview.hasShipment ? ['a refund does not cancel the shipping label'] : []),
    ...(preview.hasInvoice ? ['the order has an invoice; issue a correcting invoice yourself'] : []),
  ].join('\n');
};

const refundLine = (refund: OrderStaffRefundView): string =>
  `refund ${refund.id}: ${formatMinorUnits(refund.amountCents, refund.currency)} (${refund.kind === 'remainder' ? 'full' : 'partial'}), ${refund.status}${refund.restocked ? ', stock returned' : ''}${refund.removedFromPackingList ? ', off the packing list' : ''}`;

const retryHint = (requestKey: string): string =>
  `request key: ${requestKey} (after a network error repeat with --request-key ${requestKey}; the same key never refunds twice)`;

const detailsSchema = z.record(z.string(), z.unknown());

const withRequestKey = (error: AppError, requestKey: string): AppError => {
  const details = detailsSchema.safeParse(error.details);
  return appError(error.code, error.message, { ...(details.success ? details.data : {}), requestKey });
};

type RefundRequest = {
  requestKey: string;
  amountCents?: number;
  expectedAmountCents?: number;
  reason?: string;
  restock?: boolean;
  removeFromPackingList?: boolean;
};

const refundRequest = (
  options: z.output<typeof refundOptionsSchema>,
  preview: StaffRefundPreview,
  newRequestKey: () => string,
): Result<RefundRequest, AppError> => {
  if (options.amount !== undefined && options.remainder !== undefined) return err(validation('Use --remainder only for a full refund, without --amount'));
  const amount = options.amount === undefined ? null : minorUnitsFromDecimal(options.amount, preview.currency);
  if (amount !== null && !amount.ok) return amount;
  const remainder = options.remainder === undefined ? ok(preview.remainderCents) : minorUnitsFromDecimal(options.remainder, preview.currency);
  if (!remainder.ok) return remainder;
  return ok({
    requestKey: options.requestKey ?? newRequestKey(),
    ...(amount === null ? { expectedAmountCents: remainder.value } : { amountCents: amount.value }),
    ...(options.reason === undefined ? {} : { reason: options.reason }),
    ...(options.restock ? {} : { restock: false }),
    ...(options.keepOnPackingList === true ? { removeFromPackingList: false } : {}),
  });
};

export const runOrderRefund = async (
  ctx: OrderRefundCliContext,
  orderId: string,
  raw: unknown,
  newRequestKey: () => string = () => `cli-${crypto.randomUUID()}`,
): Promise<void> => {
  const options = refundOptionsSchema.safeParse(raw);
  if (!options.success) { emit(err(validation('Invalid order refund options', options.error.flatten())), ctx.json, () => ''); return; }
  const preview = await ctx.api.orderRefundPreview({ orderId });
  if (!preview.ok) { emit(preview, ctx.json, () => ''); return; }
  const request = refundRequest(options.data, preview.value, newRequestKey);
  if (!request.ok) { emit(request, ctx.json, () => ''); return; }
  if (options.data.yes !== true) {
    const amount = formatMinorUnits(request.value.amountCents ?? preview.value.remainderCents, preview.value.currency);
    const confirm = request.value.amountCents === undefined ? `--yes --remainder ${amount.replace(/ \S+$/, '')}` : '--yes';
    emit(err(validation(`Refunding ${amount} of order ${orderId} cannot be undone; repeat the command with ${confirm} to confirm`, { preview: preview.value })), ctx.json, () => '');
    if (!ctx.json) console.error(refundPreviewLines(preview.value));
    return;
  }
  const { requestKey } = request.value;
  if (options.data.requestKey === undefined && !ctx.json) console.error(retryHint(requestKey));
  const created = await ctx.api.createOrderRefund({ orderId, ...request.value });
  emit(
    created.ok ? ok({ ...created.value, requestKey }) : err(withRequestKey(created.error, requestKey)),
    ctx.json,
    (data) => [
      data.created ? refundLine(data.refund) : `${refundLine(data.refund)} (already requested with this request key)`,
      `request key: ${data.requestKey} (repeat with --request-key ${data.requestKey} to retry without a second refund)`,
    ].join('\n'),
  );
};

export const registerOrderRefundCommands = (
  orders: Command,
  context: () => Result<OrderRefundCliContext, AppError>,
): void => {
  const withContext = (action: (ctx: OrderRefundCliContext, orderId: string, raw: unknown) => Promise<void>) =>
    async (rawOrderId: unknown, raw: unknown) => {
      const ctx = context();
      if (!ctx.ok) { emit(ctx, orders.parent?.opts()['json'] === true, () => ''); return; }
      const orderId = orderIdSchema.safeParse(rawOrderId);
      if (!orderId.success) { emit(err(validation('Provide the order id')), ctx.value.json, () => ''); return; }
      await action(ctx.value, orderId.data, raw);
    };

  orders
    .command('refund-preview <orderId>')
    .description('Show what a staff refund of a paid order would refund and what it changes')
    .action(withContext(async (ctx, orderId) => {
      emit(await ctx.api.orderRefundPreview({ orderId }), ctx.json, refundPreviewLines);
    }));
  orders
    .command('refund <orderId>')
    .description('Refund a paid order through the payment provider: the whole remainder, or part of it with --amount')
    .option('--amount <decimal>', 'refund only this amount in the order currency, e.g. 12.50; omit to refund the whole remainder')
    .option('--remainder <decimal>', 'with --yes, the remainder a full refund was confirmed for; the refund is refused when the remainder changed since')
    .option('--reason <text>', 'staff-only note kept with the refund, at most 500 characters; never sent to the buyer or the provider')
    .option('--no-restock', 'do not return the goods to stock with a full refund')
    .option('--keep-on-packing-list', 'keep the order on the packing list after a full refund')
    .option('--request-key <key>', 'repeat a refund request safely: the same key never refunds twice')
    .option('--yes', 'confirm the refund; it cannot be undone')
    .action(withContext((ctx, orderId, raw) => runOrderRefund(ctx, orderId, raw)));
  orders
    .command('ship-anyway <orderId>')
    .description('Put a refunded order that was taken off the packing list back on it')
    .action(withContext(async (ctx, orderId) => {
      emit(await ctx.api.shipOrderAnyway({ orderId }), ctx.json, (data) => `back on the packing list: ${data.order.id}`);
    }));
};
