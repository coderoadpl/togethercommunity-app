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
    ...(preview.remainderWithheld ? ['the order is marked refunded although its refunds do not cover the payment (for example after a dispute); nothing more can be refunded here, check the payment in the Stripe Dashboard'] : []),
    `mode: ${preview.mode}`,
    `on the packing list: ${yesNo(preview.onPackingList)}; shipment or label: ${yesNo(preview.hasShipment)}; invoice: ${yesNo(preview.hasInvoice)}`,
    `stock a full refund can return: ${stock}`,
    `full refund defaults: return stock ${yesNo(preview.fullRefundOptions.restockDefault)}, take off the packing list ${yesNo(preview.fullRefundOptions.removeFromPackingListDefault)}`,
    ...(preview.waitingRefundId === null ? [] : [`refund still waiting to reach the payment provider: ${preview.waitingRefundId}`]),
    ...(preview.hasShipment ? ['a refund does not cancel the shipping label'] : []),
    ...(preview.cancelsSubscription ? ['a full refund also cancels the subscription, so its future payments stop'] : []),
    ...(preview.hasInvoice ? ['the order has an invoice; issue a correcting invoice yourself'] : []),
  ].join('\n');
};

const refundLine = (refund: OrderStaffRefundView): string =>
  `refund ${refund.id}: ${formatMinorUnits(refund.amountCents, refund.currency)} (${refund.kind === 'remainder' ? 'full' : 'partial'}), ${refund.status}${refund.restocked ? ', stock returned' : ''}${refund.removedFromPackingList ? ', off the packing list' : ''}`;

const retryHint = (requestKey: string): string =>
  `request key: ${requestKey} (after a network error repeat with --request-key ${requestKey}; the same key never refunds twice)`;

const detailsSchema = z.record(z.string(), z.unknown());

const withRequestKey = (error: AppError, requestKey: string, preview: StaffRefundPreview | null): AppError => {
  const details = detailsSchema.safeParse(error.details);
  return appError(error.code, error.message, { ...(details.success ? details.data : {}), requestKey, ...(preview === null ? {} : { preview }) });
};

const changedStateSchema = z.union([z.object({ remainderCents: z.number() }), z.object({ shipmentState: z.unknown() })]);

const changedPreview = async (ctx: OrderRefundCliContext, orderId: string, error: AppError): Promise<StaffRefundPreview | null> => {
  if (error.code !== 'conflict' || !changedStateSchema.safeParse(error.details).success) return null;
  const fresh = await ctx.api.orderRefundPreview({ orderId });
  return fresh.ok ? fresh.value : null;
};

type RefundRequest = {
  requestKey: string;
  amountCents?: number;
  expectedAmountCents?: number;
  expectedRemainderCents?: number;
  reason?: string;
  restock?: boolean;
  removeFromPackingList?: boolean;
  expectedShipmentState: { onPackingList: boolean; hasShipmentOrLabel: boolean };
};

// Nothing left means the request can only replay a stored refund by its key, which needs no remainder.
const seenRemainder = (cents: number): { expectedRemainderCents?: number } => (cents > 0 ? { expectedRemainderCents: cents } : {});

const refundRequest = (
  options: z.output<typeof refundOptionsSchema>,
  preview: StaffRefundPreview,
  newRequestKey: () => string,
): Result<RefundRequest, AppError> => {
  if (options.amount !== undefined && options.remainder !== undefined) return err(validation('Use --remainder only for a full refund, without --amount'));
  if (options.keepOnPackingList === true && options.restock) {
    return err(validation('Use --keep-on-packing-list together with --no-restock: goods returned to stock cannot stay on the packing list'));
  }
  const amount = options.amount === undefined ? null : minorUnitsFromDecimal(options.amount, preview.currency);
  if (amount !== null && !amount.ok) return amount;
  const remainder = options.remainder === undefined ? null : minorUnitsFromDecimal(options.remainder, preview.currency);
  if (remainder !== null && !remainder.ok) return remainder;
  return ok({
    requestKey: options.requestKey ?? newRequestKey(),
    ...(amount !== null ? { amountCents: amount.value } : remainder !== null && remainder.value > 0 ? { expectedAmountCents: remainder.value } : {}),
    ...seenRemainder(amount === null && remainder !== null ? remainder.value : preview.remainderCents),
    ...(options.reason === undefined ? {} : { reason: options.reason }),
    ...(options.restock ? {} : { restock: false }),
    ...(options.keepOnPackingList === true ? { removeFromPackingList: false } : {}),
    expectedShipmentState: { onPackingList: preview.onPackingList, hasShipmentOrLabel: preview.hasShipment },
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
  if (ctx.json && options.data.requestKey === undefined) {
    emit(err(validation('With --json, pass your own --request-key and keep it, so a refund whose answer was lost can be repeated without a second refund')), ctx.json, () => '');
    return;
  }
  const preview = await ctx.api.orderRefundPreview({ orderId });
  if (!preview.ok) { emit(preview, ctx.json, () => ''); return; }
  const request = refundRequest(options.data, preview.value, newRequestKey);
  if (!request.ok) { emit(request, ctx.json, () => ''); return; }
  const fullWithoutRemainder = request.value.amountCents === undefined && options.data.remainder === undefined;
  if (options.data.yes !== true || fullWithoutRemainder) {
    const amount = formatMinorUnits(request.value.amountCents ?? request.value.expectedAmountCents ?? preview.value.remainderCents, preview.value.currency);
    const remainderFlag = `--remainder ${formatMinorUnits(preview.value.remainderCents, preview.value.currency).replace(/ \S+$/, '')}`;
    const confirm = [...(options.data.yes === true ? [] : ['--yes']), ...(fullWithoutRemainder ? [remainderFlag] : [])].join(' ');
    emit(err(validation(`Refunding ${amount} of order ${orderId} cannot be undone; repeat the command with ${confirm} to confirm`, { preview: preview.value })), ctx.json, () => '');
    if (!ctx.json) console.error(refundPreviewLines(preview.value));
    return;
  }
  const { requestKey } = request.value;
  if (options.data.requestKey === undefined && !ctx.json) console.error(retryHint(requestKey));
  const created = await ctx.api.createOrderRefund({ orderId, ...request.value });
  const fresh = created.ok ? null : await changedPreview(ctx, orderId, created.error);
  if (fresh !== null && !ctx.json) console.error(refundPreviewLines(fresh));
  emit(
    created.ok ? ok({ ...created.value, requestKey }) : err(withRequestKey(created.error, requestKey, fresh)),
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
    .option('--remainder <decimal>', 'required for a full refund: the remainder you confirm, as the preview shows it; the refund is refused when the remainder changed since')
    .option('--reason <text>', 'staff-only note kept with the refund, at most 500 characters; never sent to the buyer or the provider')
    .option('--no-restock', 'do not return the goods to stock with a full refund')
    .option('--keep-on-packing-list', 'keep the order on the packing list after a full refund; needs --no-restock')
    .option('--request-key <key>', 'repeat a refund request safely: the same key never refunds twice; required with --json')
    .option('--yes', 'confirm the refund; it cannot be undone')
    .action(withContext((ctx, orderId, raw) => runOrderRefund(ctx, orderId, raw)));
  orders
    .command('ship-anyway <orderId>')
    .description('Put a refunded order that was taken off the packing list back on it')
    .action(withContext(async (ctx, orderId) => {
      emit(await ctx.api.shipOrderAnyway({ orderId }), ctx.json, (data) => `back on the packing list: ${data.order.id}`);
    }));
};
