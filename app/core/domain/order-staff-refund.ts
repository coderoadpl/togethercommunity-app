import { z } from 'zod';

import { orderRefundJobStatusSchema, type Order, type OrderStatus } from './commerce.js';
import { appError, validation, type AppError } from './errors.js';
import { stripeModeSchema } from './integration.js';
import type { ClaimedOrderRefundJob, OrderRefundJob } from './order-refund-job.js';
import { currencySchema } from './product.js';
import type { ProviderRefund } from './refund.js';
import { err, ok, type Result } from './result.js';

export const STAFF_REFUND_KINDS = ['remainder', 'amount'] as const;
const staffRefundKindSchema = z.enum(STAFF_REFUND_KINDS);
export type StaffRefundKind = z.infer<typeof staffRefundKindSchema>;

const STAFF_REFUND_NOTE_MAX_LENGTH = 500;

const staffRefundRequestKeySchema = z.string().trim().min(1).max(200).regex(/^[A-Za-z0-9._:-]+$/, 'Request key may contain only letters, digits, dots, colons, underscores and hyphens');

const NOTE_CONTROL_CHARACTERS = /[\u0000-\u0008\u000B\u000C\u000E-\u001F]/;

const staffRefundNoteSchema = z.string().trim()
  .max(STAFF_REFUND_NOTE_MAX_LENGTH, `Reason must be at most ${String(STAFF_REFUND_NOTE_MAX_LENGTH)} characters`)
  .refine((note) => !NOTE_CONTROL_CHARACTERS.test(note), 'Reason may not contain control characters other than line breaks and tabs');

export const orderStaffRefundSchema = z.object({
  id: z.string().min(1),
  tenantId: z.string().min(1),
  orderId: z.string().min(1),
  paymentIntentId: z.string().min(1),
  amountCents: z.number().int().positive(),
  currency: currencySchema,
  kind: staffRefundKindSchema,
  requestKey: staffRefundRequestKeySchema,
  idempotencyKey: z.string().min(1),
  status: orderRefundJobStatusSchema,
  attempts: z.number().int().nonnegative(),
  nextAttemptAt: z.string().datetime().nullable(),
  lockedAt: z.string().datetime().nullable(),
  lastError: z.string().nullable(),
  providerRefundId: z.string().nullable(),
  providerRefundStatus: z.string().nullable(),
  submittedAt: z.string().datetime().nullable(),
  statusChecks: z.number().int().nonnegative(),
  keyGeneration: z.number().int().nonnegative(),
  permissionBlockedAt: z.string().datetime().nullable(),
  transientFailureStreak: z.number().int().nonnegative(),
  createOutcomeUnknown: z.boolean(),
  requestedByUserId: z.string().min(1),
  requestedByEmail: z.string().min(1),
  note: staffRefundNoteSchema.nullable(),
  restocked: z.boolean(),
  removedFromPackingList: z.boolean(),
  buyerNotifiedAt: z.string().datetime().nullable(),
  createdAt: z.string().datetime(),
  updatedAt: z.string().datetime(),
});

export type OrderStaffRefund = z.output<typeof orderStaffRefundSchema>;

const staffRefundIdempotencyKey = (refundId: string): string => `staff-refund-${refundId}`;

export const STAFF_REFUND_WAITING_STATUSES = ['pending', 'running', 'blocked_permission'] as const;

// Every status in which money left or may still leave the platform; failed and skipped refunds moved none.
export const PLATFORM_COMMITTED_REFUND_STATUSES = ['pending', 'running', 'submitted', 'succeeded', 'blocked_permission', 'unconfirmed'] as const;

const SETTLED_STAFF_REFUND_STATUSES = ['succeeded', 'skipped_refunded', 'resolved_externally'] as const;

export const isActiveStaffRefundStatus = (status: OrderStaffRefund['status']): boolean =>
  !SETTLED_STAFF_REFUND_STATUSES.some((settled) => settled === status);

const isPlatformCommittedRefundStatus = (status: OrderStaffRefund['status']): boolean =>
  PLATFORM_COMMITTED_REFUND_STATUSES.some((committed) => committed === status);

const isCommittedProviderRefund = (refund: Pick<ProviderRefund, 'status'>): boolean =>
  refund.status !== 'failed' && refund.status !== 'canceled';

export const committedProviderRefundCents = (refunds: readonly Pick<ProviderRefund, 'status' | 'amountCents'>[]): number =>
  refunds.filter(isCommittedProviderRefund).reduce((sum, refund) => sum + refund.amountCents, 0);

export const uncommittedProviderRefundCents = (refunds: readonly Pick<ProviderRefund, 'status' | 'amountCents'>[]): number =>
  refunds.filter((refund) => !isCommittedProviderRefund(refund)).reduce((sum, refund) => sum + refund.amountCents, 0);

export const refundableRemainderCents = (input: { paidCents: number; providerCommittedCents: number | null; platformCommittedCents: number }): number =>
  Math.max(0, input.paidCents - Math.max(input.providerCommittedCents ?? 0, input.platformCommittedCents));

type LatestStaffRefund = Pick<OrderStaffRefund, 'kind' | 'status' | 'providerRefundStatus' | 'amountCents'>;

const failedAfterSubmission = (refund: LatestStaffRefund): boolean =>
  refund.kind === 'remainder' && refund.status === 'failed' && (refund.providerRefundStatus === 'failed' || refund.providerRefundStatus === 'canceled');

// An order marked refunded is refunded again only when the platform itself saw why the money is still there: its latest
// staff refund was a full refund the provider failed or canceled after charge.refunded. A failed or canceled refund in
// the provider's list alone may predate what marked the order refunded, such as a dispute, so it only caps the amount.
export const staffRefundRemainderCents = (
  order: Pick<Order, 'status' | 'amountCents'>,
  input: { providerCommittedCents: number | null; providerUncommittedCents: number | null; platformCommittedCents: number; latestStaffRefund: LatestStaffRefund | null },
): number => {
  const remainder = refundableRemainderCents({ paidCents: order.amountCents, ...input });
  if (order.status !== 'refunded') return remainder;
  if (input.latestStaffRefund === null || !failedAfterSubmission(input.latestStaffRefund)) return 0;
  const offered = Math.min(remainder, input.latestStaffRefund.amountCents);
  return input.providerUncommittedCents === null ? offered : Math.min(offered, input.providerUncommittedCents);
};

export const staffRefundWaitingConflict = (): AppError =>
  appError('conflict', 'Another refund of this order is still waiting to reach the payment provider; try again once it is accepted or failed', { waitingRefund: true });

const STAFF_REFUNDABLE_STATUSES: readonly OrderStatus[] = ['paid', 'partially_refunded', 'refunded'];

type RefundableOrder = Pick<Order, 'status' | 'provider' | 'providerObjectIds' | 'amountCents' | 'cancelReason'>;

export const staffRefundOrderBlocker = (order: RefundableOrder): AppError | null => {
  if (order.cancelReason != null) return appError('conflict', 'The order was cancelled because its goods sold out and is refunded by its own refund job');
  if (!STAFF_REFUNDABLE_STATUSES.includes(order.status)) return appError('conflict', `The order is ${order.status}; only paid or refunded orders can be refunded`);
  if (order.provider !== 'stripe') return validation('The order was not paid through the payment provider and cannot be refunded here');
  if ((order.providerObjectIds['paymentIntent'] ?? '') === '') return validation('The order has no payment to refund');
  if (order.amountCents <= 0) return validation('The order was free; there is nothing to refund');
  return null;
};

const SHIP_ANYWAY_STATUSES: readonly OrderStatus[] = ['paid', 'refunded', 'partially_refunded'];

export const shipAnywayBlocker = (order: Pick<Order, 'status' | 'shipping' | 'fulfilmentStatus' | 'cancelReason'>): AppError | null => {
  if (order.shipping == null) return appError('conflict', 'The order has nothing to ship');
  if (order.cancelReason != null) return appError('conflict', 'A sold-out order cannot be put back on the packing list');
  if (order.fulfilmentStatus != null) return appError('conflict', 'The order is already on the packing list or shipped');
  if (!SHIP_ANYWAY_STATUSES.includes(order.status)) return appError('conflict', 'Only a paid or refunded order can be put back on the packing list');
  return null;
};

const fractionDigitsCache = new Map<string, number>();

export const currencyFractionDigits = (currency: string): number => {
  const cached = fractionDigitsCache.get(currency);
  if (cached !== undefined) return cached;
  let digits = 2;
  try {
    digits = new Intl.NumberFormat('en', { style: 'currency', currency }).resolvedOptions().maximumFractionDigits ?? 2;
  } catch {
    digits = 2;
  }
  fractionDigitsCache.set(currency, digits);
  return digits;
};

export const formatMinorUnits = (amountCents: number, currency: string): string => {
  const digits = currencyFractionDigits(currency);
  const sign = amountCents < 0 ? '-' : '';
  const absolute = Math.abs(amountCents);
  if (digits === 0) return `${sign}${String(absolute)} ${currency}`;
  const scale = 10 ** digits;
  return `${sign}${String(Math.floor(absolute / scale))}.${String(absolute % scale).padStart(digits, '0')} ${currency}`;
};

export const minorUnitsFromDecimal = (value: string, currency: string): Result<number, AppError> => {
  const digits = currencyFractionDigits(currency);
  const pattern = digits === 0 ? /^\d+$/ : new RegExp(`^\\d+([.,]\\d{1,${String(digits)}})?$`);
  const trimmed = value.trim();
  if (!pattern.test(trimmed)) {
    return err(validation(digits === 0
      ? `Amount in ${currency} must be a whole number`
      : `Amount must be a positive number with at most ${String(digits)} decimals`));
  }
  const [whole = '0', fraction = ''] = trimmed.replace(',', '.').split('.');
  const amount = Number.parseInt(whole, 10) * 10 ** digits + (digits === 0 ? 0 : Number.parseInt(fraction.padEnd(digits, '0'), 10));
  if (!Number.isSafeInteger(amount)) return err(validation('Amount is too large'));
  return ok(amount);
};

export const resolveStaffRefundAmount = (input: {
  amountCents?: number | undefined;
  expectedAmountCents?: number | undefined;
  expectedRemainderCents?: number | undefined;
  remainderCents: number;
  currency: string;
}): Result<{ kind: StaffRefundKind; amountCents: number }, AppError> => {
  if (input.remainderCents <= 0) return err(appError('conflict', 'Nothing is left to refund on this order'));
  const remainder = formatMinorUnits(input.remainderCents, input.currency);
  const full = input.amountCents === undefined;
  if (full && input.expectedAmountCents === undefined) return err(validation('A full refund must name the remainder it was confirmed for in expectedAmountCents'));
  if (full && input.expectedRemainderCents !== undefined && input.expectedRemainderCents !== input.expectedAmountCents) {
    return err(validation('expectedRemainderCents must equal expectedAmountCents for a full refund'));
  }
  const seenRemainderCents = input.expectedRemainderCents ?? (full ? input.expectedAmountCents : undefined);
  if (seenRemainderCents === undefined) return err(validation('A refund must name the remainder it was confirmed for in expectedRemainderCents'));
  if (seenRemainderCents !== input.remainderCents) {
    return err(appError('conflict', `The refundable remainder is now ${remainder}; check the refund again before confirming it`, { remainderCents: input.remainderCents }));
  }
  if (input.amountCents === undefined) return ok({ kind: 'remainder', amountCents: input.remainderCents });
  if (!Number.isSafeInteger(input.amountCents) || input.amountCents <= 0) {
    return err(validation(`Refund amount must be a positive whole number of minor units, at most ${remainder}`, { remainderCents: input.remainderCents }));
  }
  if (input.expectedAmountCents !== undefined && input.expectedAmountCents !== input.amountCents) {
    return err(validation('expectedAmountCents must equal amountCents for a partial refund'));
  }
  if (input.amountCents > input.remainderCents) {
    return err(validation(`Refund amount is above the refundable remainder of ${remainder}`, { remainderCents: input.remainderCents }));
  }
  return ok({ kind: 'amount', amountCents: input.amountCents });
};

const staffRefundFulfilmentOptionsSchema = z.object({
  restockOffered: z.boolean(),
  restockDefault: z.boolean(),
  removeFromPackingListOffered: z.boolean(),
  removeFromPackingListDefault: z.boolean(),
});

export type StaffRefundFulfilmentOptions = z.output<typeof staffRefundFulfilmentOptionsSchema>;

export const staffRefundPreviewSchema = z.object({
  orderId: z.string().min(1),
  refundable: z.boolean(),
  blockedReason: z.string().nullable(),
  paidCents: z.number().int().nonnegative(),
  refundedCents: z.number().int().nonnegative(),
  remainderCents: z.number().int().nonnegative(),
  currency: currencySchema,
  mode: stripeModeSchema,
  remainderSource: z.enum(['provider', 'platform']),
  remainderWithheld: z.boolean(),
  returnableStock: z.array(z.object({ productId: z.string().min(1), quantity: z.number().int().nonnegative() })),
  onPackingList: z.boolean(),
  hasShipment: z.boolean(),
  hasInvoice: z.boolean(),
  cancelsSubscription: z.boolean(),
  fullRefundOptions: staffRefundFulfilmentOptionsSchema,
  waitingRefundId: z.string().nullable(),
});

export type StaffRefundPreview = z.output<typeof staffRefundPreviewSchema>;

export const staffRefundFulfilmentOptions = (
  order: Pick<Order, 'fulfilmentStatus' | 'shipment'>,
  input: { coversRemainder: boolean; hasLabel: boolean },
): StaffRefundFulfilmentOptions => {
  const full = input.coversRemainder;
  const toPack = order.fulfilmentStatus === 'to_pack';
  const untouched = toPack && order.shipment == null && !input.hasLabel;
  return {
    restockOffered: full,
    restockDefault: full && untouched,
    removeFromPackingListOffered: full && toPack,
    removeFromPackingListDefault: full && untouched,
  };
};

const staffRefundShipmentStateSchema = z.object({ onPackingList: z.boolean(), hasShipmentOrLabel: z.boolean() }).strict();

type StaffRefundShipmentState = z.output<typeof staffRefundShipmentStateSchema>;

export const staffRefundShipmentState = (order: Pick<Order, 'fulfilmentStatus' | 'shipment'>, hasLabel: boolean): StaffRefundShipmentState =>
  ({ onPackingList: order.fulfilmentStatus === 'to_pack', hasShipmentOrLabel: order.shipment != null || hasLabel });

export const staffRefundShipmentConflict = (expected: StaffRefundShipmentState | undefined, actual: StaffRefundShipmentState): AppError | null =>
  expected === undefined || (expected.onPackingList === actual.onPackingList && expected.hasShipmentOrLabel === actual.hasShipmentOrLabel)
    ? null
    : appError('conflict', 'The packing list or shipping label of the order changed since the refund was checked; check the refund again before confirming it', { shipmentState: actual });

export const createStaffRefundInputSchema = z.object({
  requestKey: staffRefundRequestKeySchema,
  amountCents: z.number().int().positive().optional(),
  expectedAmountCents: z.number().int().positive().optional(),
  expectedRemainderCents: z.number().int().positive().optional(),
  reason: staffRefundNoteSchema.optional(),
  restock: z.boolean().optional(),
  removeFromPackingList: z.boolean().optional(),
  expectedShipmentState: staffRefundShipmentStateSchema.optional(),
}).strict();

export const resolveStaffRefundChoices = (
  options: StaffRefundFulfilmentOptions,
  input: { restock?: boolean | undefined; removeFromPackingList?: boolean | undefined },
): Result<{ restock: boolean; removeFromPackingList: boolean }, AppError> => {
  if (input.restock === true && !options.restockOffered) return err(validation('Goods can be returned to stock only with a full refund'));
  if (input.removeFromPackingList === true && !options.removeFromPackingListOffered) {
    return err(validation('Only a full refund of an order waiting to be packed can take it off the packing list'));
  }
  const restock = input.restock ?? options.restockDefault;
  const removeFromPackingList = input.removeFromPackingList ?? options.removeFromPackingListDefault;
  if (restock && options.removeFromPackingListOffered && !removeFromPackingList) {
    return err(validation('Goods returned to stock cannot stay on the packing list: take the order off the packing list too, or keep the goods out of stock'));
  }
  return ok({ restock, removeFromPackingList });
};

export const staffRefundMatchesRequest = (
  refund: Pick<OrderStaffRefund, 'orderId' | 'kind' | 'amountCents' | 'restocked' | 'removedFromPackingList'>,
  request: {
    orderId: string;
    amountCents?: number | undefined;
    expectedAmountCents?: number | undefined;
    restock?: boolean | undefined;
    removeFromPackingList?: boolean | undefined;
  },
): boolean =>
  refund.orderId === request.orderId
  && (request.amountCents === undefined ? refund.kind === 'remainder' : refund.amountCents === request.amountCents)
  && (request.expectedAmountCents === undefined || refund.amountCents === request.expectedAmountCents)
  && (request.restock === undefined || request.restock === refund.restocked)
  && (request.removeFromPackingList === undefined || request.removeFromPackingList === refund.removedFromPackingList);

export const newOrderStaffRefund = (input: {
  id: string;
  tenantId: string;
  orderId: string;
  paymentIntentId: string;
  currency: string;
  kind: StaffRefundKind;
  amountCents: number;
  requestKey: string;
  requestedByUserId: string;
  requestedByEmail: string;
  note: string | null;
  restocked: boolean;
  removedFromPackingList: boolean;
  now: string;
}): OrderStaffRefund => orderStaffRefundSchema.parse({
  id: input.id,
  tenantId: input.tenantId,
  orderId: input.orderId,
  paymentIntentId: input.paymentIntentId,
  amountCents: input.amountCents,
  currency: input.currency,
  kind: input.kind,
  requestKey: input.requestKey,
  idempotencyKey: staffRefundIdempotencyKey(input.id),
  status: 'pending',
  attempts: 0,
  nextAttemptAt: input.now,
  lockedAt: null,
  lastError: null,
  providerRefundId: null,
  providerRefundStatus: null,
  submittedAt: null,
  statusChecks: 0,
  keyGeneration: 0,
  permissionBlockedAt: null,
  transientFailureStreak: 0,
  createOutcomeUnknown: false,
  requestedByUserId: input.requestedByUserId,
  requestedByEmail: input.requestedByEmail,
  note: input.note === null || input.note.trim() === '' ? null : input.note.trim(),
  restocked: input.restocked,
  removedFromPackingList: input.removedFromPackingList,
  buyerNotifiedAt: null,
  createdAt: input.now,
  updatedAt: input.now,
});

export const STAFF_REFUND_REASONS = [
  'not_refunded',
  'permission_expired',
  'failed_after_submission',
  'create_outcome_unknown',
  'awaiting_provider',
  'refunded_outside',
  'not_confirmed',
] as const;

export type StaffRefundReason = (typeof STAFF_REFUND_REASONS)[number];

export const staffRefundReason = (
  refund: Pick<OrderStaffRefund, 'status' | 'createOutcomeUnknown' | 'providerRefundStatus' | 'permissionBlockedAt'>,
): StaffRefundReason | null => {
  if (refund.status === 'failed') {
    if (refund.providerRefundStatus === 'failed' || refund.providerRefundStatus === 'canceled') return 'failed_after_submission';
    return refund.permissionBlockedAt === null ? 'not_refunded' : 'permission_expired';
  }
  if (refund.status !== 'unconfirmed') return null;
  if (refund.createOutcomeUnknown) return 'create_outcome_unknown';
  if (refund.providerRefundStatus === 'pending' || refund.providerRefundStatus === 'requires_action') return 'awaiting_provider';
  return refund.permissionBlockedAt === null ? 'not_confirmed' : 'refunded_outside';
};

export const orderStaffRefundViewSchema = orderStaffRefundSchema.pick({
  id: true,
  kind: true,
  status: true,
  amountCents: true,
  currency: true,
  attempts: true,
  nextAttemptAt: true,
  lastError: true,
  providerRefundStatus: true,
  submittedAt: true,
  permissionBlockedAt: true,
  createOutcomeUnknown: true,
  requestedByUserId: true,
  requestedByEmail: true,
  note: true,
  restocked: true,
  removedFromPackingList: true,
  createdAt: true,
  updatedAt: true,
});

export type OrderStaffRefundView = z.output<typeof orderStaffRefundViewSchema>;

export const orderStaffRefundView = (refund: OrderStaffRefund): OrderStaffRefundView => orderStaffRefundViewSchema.parse(refund);

export const orderRefundTotalsSchema = z.object({
  paidCents: z.number().int().nonnegative(),
  refundedCents: z.number().int().nonnegative(),
  remainingCents: z.number().int().nonnegative(),
  currency: currencySchema,
});

export type OrderRefundTotals = z.output<typeof orderRefundTotalsSchema>;

const platformRefundedCents = (
  order: Pick<Order, 'status' | 'amountCents'>,
  refunds: readonly Pick<OrderStaffRefund, 'status' | 'amountCents'>[],
): number => {
  if (order.status === 'refunded') return order.amountCents;
  const committed = refunds.filter((refund) => isPlatformCommittedRefundStatus(refund.status)).reduce((sum, refund) => sum + refund.amountCents, 0);
  return Math.min(committed, order.amountCents);
};

export const orderRefundTotals = (
  order: Pick<Order, 'status' | 'amountCents' | 'currency'>,
  refunds: readonly Pick<OrderStaffRefund, 'status' | 'amountCents'>[],
): OrderRefundTotals => {
  const refundedCents = platformRefundedCents(order, refunds);
  return orderRefundTotalsSchema.parse({ paidCents: order.amountCents, refundedCents, remainingCents: order.amountCents - refundedCents, currency: order.currency });
};

export type RefundJob =
  | (OrderRefundJob & { source: 'out_of_stock' })
  | (OrderStaffRefund & { source: 'staff' });

type ClaimedStaffRefund = {
  job: OrderStaffRefund;
  phase: ClaimedOrderRefundJob['phase'];
  lease: ClaimedOrderRefundJob['lease'] & { source: 'staff' };
};

export type ClaimedRefundJob = ClaimedOrderRefundJob | ClaimedStaffRefund;

export const refundJobOfClaim = (claim: ClaimedRefundJob): RefundJob => {
  const { job } = claim;
  return 'kind' in job ? { ...job, source: 'staff' } : { ...job, source: 'out_of_stock' };
};
