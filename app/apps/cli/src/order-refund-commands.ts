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

const partialMayEndAccess = (preview: StaffRefundPreview): string | null => {
  const ends = [...(preview.grantsAccess ? ['access may end'] : []), ...(preview.cancelsSubscription ? ['the subscription stops'] : [])];
  return ends.length === 0
    ? null
    : `a partial refund keeps ${preview.grantsAccess && preview.cancelsSubscription ? 'access and the subscription' : preview.grantsAccess ? 'access' : 'the subscription'}, but if the payment ends fully refunded (for example through another refund, also one made in the Stripe Dashboard), ${ends.join(' and ')}, as for a full refund`;
};

export const refundPreviewLines = (preview: StaffRefundPreview): string => {
  const money = (cents: number) => formatMinorUnits(cents, preview.currency);
  const stock = preview.returnableStock.length === 0
    ? 'none'
    : preview.returnableStock.map((line) => `${line.productId} x${String(line.quantity)}`).join(', ');
  const qualifier = partialMayEndAccess(preview);
  return [
    `order ${preview.orderId}: ${preview.refundable ? 'refundable' : `not refundable: ${preview.blockedReason ?? 'unknown reason'}`}`,
    `paid ${money(preview.paidCents)}, refunded ${preview.refundedAmountUnknown ? 'not known here (refunded outside the platform or disputed)' : money(preview.refundedCents)}, remaining ${money(preview.remainderCents)} (${preview.remainderSource === 'provider' ? 'read from the payment provider' : 'platform records only; the payment provider list could not be read'})`,
    `mode: ${preview.mode}`,
    `on the packing list: ${yesNo(preview.onPackingList)}; shipment or label: ${yesNo(preview.hasShipment)}; invoice: ${yesNo(preview.hasInvoice)}`,
    `stock a full refund can return: ${stock}`,
    `full refund defaults: return stock ${yesNo(preview.fullRefundOptions.restockDefault)}, take off the packing list ${yesNo(preview.fullRefundOptions.removeFromPackingListDefault)}`,
    ...(preview.waitingRefundId === null ? [] : [`refund still waiting to reach the payment provider: ${preview.waitingRefundId}`]),
    ...(preview.hasShipment ? ['a refund does not cancel the shipping label'] : []),
    ...(preview.cancelsSubscription ? ['a full refund also cancels the subscription, so its future payments stop'] : []),
    ...(qualifier === null ? [] : [qualifier]),
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
  expectedRemainderCents: number;
  reason?: string;
  restock?: boolean;
  removeFromPackingList?: boolean;
  expectedShipmentState: { onPackingList: boolean; hasShipmentOrLabel: boolean };
};

const decimalOf = (cents: number, currency: string): string => formatMinorUnits(cents, currency).replace(/ \S+$/, '');

const shellQuote = (value: string): string => (/^[\w.,:/@+-]+$/.test(value) ? value : `'${value.replaceAll("'", "'\\''")}'`);

const confirmCommand = (orderId: string, options: z.output<typeof refundOptionsSchema>, remainder: string): string => [
  'order refund', shellQuote(orderId),
  ...(options.amount === undefined ? [] : ['--amount', shellQuote(options.amount)]),
  '--remainder', remainder,
  ...(options.reason === undefined ? [] : ['--reason', shellQuote(options.reason)]),
  ...(options.amount === undefined && !options.restock ? ['--no-restock'] : []),
  ...(options.amount === undefined && options.keepOnPackingList === true ? ['--keep-on-packing-list'] : []),
  ...(options.requestKey === undefined ? [] : ['--request-key', shellQuote(options.requestKey)]),
  '--yes',
].join(' ');

const refundRequest = (
  options: z.output<typeof refundOptionsSchema>,
  preview: StaffRefundPreview,
  newRequestKey: () => string,
): Result<{ request: RefundRequest | null; amountCents: number; confirmedRemainderCents: number | null }, AppError> => {
  if (options.amount === undefined && options.keepOnPackingList === true && options.restock) {
    return err(validation('Use --keep-on-packing-list together with --no-restock: goods returned to stock cannot stay on the packing list'));
  }
  const amount = options.amount === undefined ? null : minorUnitsFromDecimal(options.amount, preview.currency);
  if (amount !== null && !amount.ok) return amount;
  const remainder = options.remainder === undefined ? null : minorUnitsFromDecimal(options.remainder, preview.currency);
  if (remainder !== null && !remainder.ok) return remainder;
  const amountCents = amount?.value ?? preview.remainderCents;
  if (options.yes !== true || remainder === null) return ok({ request: null, amountCents, confirmedRemainderCents: remainder?.value ?? null });
  return ok({
    amountCents,
    confirmedRemainderCents: remainder.value,
    request: {
      requestKey: options.requestKey ?? newRequestKey(),
      ...(amount === null ? { expectedAmountCents: remainder.value } : { amountCents: amount.value }),
      expectedRemainderCents: remainder.value,
      ...(options.reason === undefined ? {} : { reason: options.reason }),
      ...(amount !== null
        ? { restock: false, removeFromPackingList: false }
        : { ...(options.restock ? {} : { restock: false }), ...(options.keepOnPackingList === true ? { removeFromPackingList: false } : {}) }),
      expectedShipmentState: { onPackingList: preview.onPackingList, hasShipmentOrLabel: preview.hasShipment },
    },
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
  const planned = refundRequest(options.data, preview.value, newRequestKey);
  if (!planned.ok) { emit(planned, ctx.json, () => ''); return; }
  const { request } = planned.value;
  if (request === null) {
    const money = (cents: number) => formatMinorUnits(cents, preview.value.currency);
    const command = confirmCommand(orderId, options.data, decimalOf(preview.value.remainderCents, preview.value.currency));
    const confirmed = planned.value.confirmedRemainderCents ?? preview.value.remainderCents;
    const changed = confirmed === preview.value.remainderCents ? '' : `The remainder changed from ${money(confirmed)} to ${money(preview.value.remainderCents)}. `;
    emit(err(validation(`${changed}Refunding ${money(planned.value.amountCents)} of order ${orderId} cannot be undone; to confirm, repeat it as: ${command}`, { preview: preview.value, command })), ctx.json, () => '');
    if (!ctx.json) console.error(refundPreviewLines(preview.value));
    return;
  }
  const { requestKey } = request;
  if (options.data.requestKey === undefined && !ctx.json) console.error(retryHint(requestKey));
  const created = await ctx.api.createOrderRefund({ orderId, ...request });
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
    .option('--remainder <decimal>', 'required with --yes: the remainder you confirm, as the preview shows it; the refund is refused when the remainder changed since')
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
