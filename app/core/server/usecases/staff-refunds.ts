import {
  appError,
  committedProviderRefundCents,
  createStaffRefundInputSchema,
  err,
  forbidden,
  newOrderStaffRefund,
  notFound,
  ok,
  orderRefundTotals,
  orderStaffRefundView,
  productLines,
  refundableRemainderCents,
  refundedAmountUnknown,
  resolveStaffRefundAmount,
  resolveStaffRefundChoices,
  shipAnywayBlocker,
  staffRefundFulfilmentOptions,
  staffRefundMatchesRequest,
  staffRefundOrderBlocker,
  staffRefundShipmentConflict,
  staffRefundShipmentState,
  staffRefundWaitingConflict,
  validation,
  type AppError,
  type MemberSubscription,
  type Order,
  type OrderRefundJob,
  type OrderRefundTotals,
  type OrderListItem,
  type OrderStaffRefundView,
  type Result,
  type StaffRefundPreview,
} from '#core/domain/index.js';

import { authorizeTenant } from '../authorize.js';
import type { Ctx } from '../context.js';
import { safeLogMessage } from '../log-safety.js';
import type {
  Clock,
  IdGenerator,
  InvoiceRepository,
  MemberSubscriptionRepository,
  OrderDetailRepository,
  OrderStaffRefundRepository,
  PaymentProvider,
  PaymentRefundRepository,
  StaffRefundCreationState,
  StaffRefundDecision,
} from '../ports.js';

const machineKeyRefusal = (ctx: Ctx): Result<never, AppError> | null =>
  ctx.machineActor === undefined ? null : err(forbidden('order:refund is not permitted for a machine key'));

type ProviderCommitted =
  | { cents: number; source: 'provider' }
  | { cents: null; source: 'platform' };

const platformOnly: ProviderCommitted = { cents: null, source: 'platform' };

const providerCommittedCents = async (
  order: Pick<Order, 'tenantId' | 'mode' | 'provider' | 'providerObjectIds'>,
  payment: Pick<PaymentProvider, 'listRefunds'>,
): Promise<ProviderCommitted> => {
  const paymentIntentId = order.providerObjectIds['paymentIntent'];
  if (order.provider !== 'stripe' || paymentIntentId === undefined || payment.listRefunds === undefined) return platformOnly;
  const listed = await payment.listRefunds({ mode: order.mode, tenantId: order.tenantId, paymentIntentId });
  return listed.ok ? { cents: committedProviderRefundCents(listed.value), source: 'provider' } : platformOnly;
};

export interface StaffRefundDeps {
  orderDetails: OrderDetailRepository;
  staffRefunds: OrderStaffRefundRepository;
  payment: Pick<PaymentProvider, 'listRefunds'>;
  invoices?: Pick<InvoiceRepository, 'findCurrentByOrder'>;
  subscriptionOrders?: Pick<PaymentRefundRepository, 'findLatestSubscriptionOrder'>;
  subscriptions?: Pick<MemberSubscriptionRepository, 'findByProviderSubscriptionId'>;
  ids: IdGenerator;
  clock: Clock;
  logger: { warn(message: string): void };
  dispatchOrderRefunds?(): void;
  rateLimit?(input: { kind: StaffRefundRateLimitKind; tenantId: string; actorUserId: string }): Promise<Result<void, AppError>>;
}

export type StaffRefundRateLimitKind = 'preview' | 'write';

const withinRateLimit = async (
  ctx: Ctx,
  tenant: Result<string, AppError>,
  kind: StaffRefundRateLimitKind,
  deps: Pick<StaffRefundDeps, 'rateLimit'>,
): Promise<Result<string, AppError>> => {
  if (!tenant.ok || deps.rateLimit === undefined) return tenant;
  const limited = await deps.rateLimit({ kind, tenantId: tenant.value, actorUserId: ctx.identity.userId });
  return limited.ok ? tenant : limited;
};

const runningSubscription = (subscription: MemberSubscription | null, order: Pick<Order, 'mode'>): boolean =>
  subscription !== null && subscription.mode === order.mode && subscription.status !== 'canceled';

// A full refund of the subscription's latest invoice also cancels the subscription when its charge.refunded arrives.
const fullRefundCancelsSubscription = async (
  tenantId: string,
  order: Pick<Order, 'id' | 'kind' | 'mode' | 'providerObjectIds'>,
  deps: Pick<StaffRefundDeps, 'subscriptionOrders' | 'subscriptions'>,
): Promise<boolean> => {
  const providerSubscriptionId = order.providerObjectIds['subscription'];
  if (order.kind !== 'recurring' || providerSubscriptionId === undefined || order.providerObjectIds['invoice'] === undefined) return false;
  if (deps.subscriptionOrders === undefined || deps.subscriptions === undefined) return false;
  const [latest, subscription] = await Promise.all([
    deps.subscriptionOrders.findLatestSubscriptionOrder(tenantId, providerSubscriptionId),
    deps.subscriptions.findByProviderSubscriptionId(tenantId, providerSubscriptionId),
  ]);
  return latest?.id === order.id && runningSubscription(subscription, order);
};

export const previewStaffRefund = async (
  ctx: Ctx,
  orderId: string,
  deps: Pick<StaffRefundDeps, 'orderDetails' | 'staffRefunds' | 'payment' | 'invoices' | 'subscriptionOrders' | 'subscriptions' | 'rateLimit'>,
): Promise<Result<StaffRefundPreview, AppError>> => {
  const refusal = machineKeyRefusal(ctx);
  if (refusal !== null) return refusal;
  const tenant = await withinRateLimit(ctx, authorizeTenant(ctx, 'order:refund'), 'preview', deps);
  if (!tenant.ok) return tenant;
  const order = await deps.orderDetails.findById(tenant.value, orderId);
  if (order === null) return err(notFound('Order was not found'));
  const [provider, platformCommittedCents, platformRefundedCents, hasLabel, returnableStock, invoice, refunds, cancelsSubscription] = await Promise.all([
    providerCommittedCents(order, deps.payment),
    deps.staffRefunds.platformCommittedCents(tenant.value, order.id),
    deps.staffRefunds.platformRefundedCents(tenant.value, order.id),
    deps.staffRefunds.hasLabel(tenant.value, order.id),
    deps.staffRefunds.returnableStock(tenant.value, order.id),
    deps.invoices?.findCurrentByOrder(tenant.value, order.id) ?? null,
    deps.staffRefunds.listByOrder(tenant.value, order.id),
    fullRefundCancelsSubscription(tenant.value, order, deps),
  ]);
  const shipmentState = staffRefundShipmentState(order, hasLabel);
  const orderBlocker = staffRefundOrderBlocker(order);
  const remainderCents = orderBlocker === null
    ? refundableRemainderCents({ paidCents: order.amountCents, providerCommittedCents: provider.cents, platformCommittedCents })
    : 0;
  const waiting = refunds.find((refund) => refund.status === 'pending' || refund.status === 'running' || refund.status === 'blocked_permission') ?? null;
  const refundedCents = Math.min(order.amountCents, provider.cents ?? platformRefundedCents);
  const blocker = orderBlocker
    ?? (waiting === null ? null : appError('conflict', 'Another refund of this order is still waiting to reach the payment provider'))
    ?? (remainderCents > 0 ? null : appError('conflict', 'Nothing is left to refund on this order'));
  return ok({
    orderId: order.id,
    refundable: blocker === null,
    blockedReason: blocker?.message ?? null,
    paidCents: order.amountCents,
    refundedCents,
    remainderCents,
    currency: order.currency,
    mode: order.mode,
    remainderSource: provider.source,
    refundedAmountUnknown: refundedAmountUnknown(order, refundedCents),
    grantsAccess: order.lines === undefined || productLines(order.lines).some((line) => line.productType !== 'physical'),
    returnableStock,
    onPackingList: shipmentState.onPackingList,
    hasShipment: shipmentState.hasShipmentOrLabel,
    hasInvoice: invoice !== null,
    cancelsSubscription,
    fullRefundOptions: staffRefundFulfilmentOptions(order, { coversRemainder: true, hasLabel }),
    waitingRefundId: waiting?.id ?? null,
  });
};

const decideStaffRefund = (
  state: StaffRefundCreationState,
  request: {
    tenantId: string;
    refundId: string;
    requestKey: string;
    amountCents?: number | undefined;
    expectedAmountCents?: number | undefined;
    expectedRemainderCents?: number | undefined;
    reason?: string | undefined;
    restock?: boolean | undefined;
    removeFromPackingList?: boolean | undefined;
    expectedShipmentState?: { onPackingList: boolean; hasShipmentOrLabel: boolean } | undefined;
    provider: ProviderCommitted;
    actor: { userId: string; email: string };
    now: string;
  },
): Result<StaffRefundDecision, AppError> => {
  if (state.sameRequest !== null) {
    return staffRefundMatchesRequest(state.sameRequest, { orderId: state.order.id, ...request })
      ? ok({ kind: 'existing', refund: state.sameRequest })
      : err(appError('conflict', 'This request key was already used for a different refund'));
  }
  const blocker = staffRefundOrderBlocker(state.order);
  if (blocker !== null) return err(blocker);
  if (state.waiting !== null) return err(staffRefundWaitingConflict());
  const shipmentConflict = staffRefundShipmentConflict(request.expectedShipmentState, staffRefundShipmentState(state.order, state.hasLabel));
  if (shipmentConflict !== null) return err(shipmentConflict);
  const remainderCents = refundableRemainderCents({
    paidCents: state.order.amountCents, providerCommittedCents: request.provider.cents, platformCommittedCents: state.platformCommittedCents,
  });
  const amount = resolveStaffRefundAmount({
    amountCents: request.amountCents,
    expectedAmountCents: request.expectedAmountCents,
    expectedRemainderCents: request.expectedRemainderCents,
    remainderCents,
    currency: state.order.currency,
  });
  if (!amount.ok) return amount;
  const choices = resolveStaffRefundChoices(
    staffRefundFulfilmentOptions(state.order, { coversRemainder: amount.value.amountCents === remainderCents, hasLabel: state.hasLabel }),
    request,
  );
  if (!choices.ok) return choices;
  const paymentIntentId = state.order.providerObjectIds['paymentIntent'];
  if (paymentIntentId === undefined) return err(validation('The order has no payment to refund'));
  return ok({
    kind: 'create',
    refund: newOrderStaffRefund({
      id: request.refundId,
      tenantId: request.tenantId,
      orderId: state.order.id,
      paymentIntentId,
      currency: state.order.currency,
      kind: amount.value.kind,
      amountCents: amount.value.amountCents,
      requestKey: request.requestKey,
      requestedByUserId: request.actor.userId,
      requestedByEmail: request.actor.email,
      note: request.reason ?? null,
      restocked: choices.value.restock,
      removedFromPackingList: choices.value.removeFromPackingList,
      now: request.now,
    }),
  });
};

export const createStaffRefund = async (
  ctx: Ctx,
  orderId: string,
  input: unknown,
  deps: Pick<StaffRefundDeps, 'orderDetails' | 'staffRefunds' | 'payment' | 'ids' | 'clock' | 'logger' | 'dispatchOrderRefunds' | 'rateLimit'>,
): Promise<Result<{ refund: OrderStaffRefundView; created: boolean }, AppError>> => {
  const refusal = machineKeyRefusal(ctx);
  if (refusal !== null) return refusal;
  const tenant = await withinRateLimit(ctx, authorizeTenant(ctx, 'order:refund'), 'write', deps);
  if (!tenant.ok) return tenant;
  const parsed = createStaffRefundInputSchema.safeParse(input);
  if (!parsed.success) return err(validation('Invalid refund request', parsed.error.flatten()));
  const order = await deps.orderDetails.findById(tenant.value, orderId);
  if (order === null) return err(notFound('Order was not found'));
  const provider = await providerCommittedCents(order, deps.payment);
  const now = deps.clock.nowIso();
  const created = await deps.staffRefunds.create(tenant.value, {
    orderId: order.id,
    requestKey: parsed.data.requestKey,
    actorUserId: ctx.identity.userId,
    now,
    decide: (state) => decideStaffRefund(state, {
      ...parsed.data,
      tenantId: tenant.value,
      refundId: deps.ids.nextId(),
      provider,
      actor: { userId: ctx.identity.userId, email: ctx.identity.email },
      now,
    }),
  });
  if (!created.ok) return created;
  const { refund } = created.value;
  if (created.value.created) {
    deps.logger.warn(safeLogMessage(`[order-refund] staff refund requested tenant=${tenant.value} order=${order.id} refund=${refund.id} actor=${ctx.identity.userId} amount=${String(refund.amountCents)} currency=${refund.currency} kind=${refund.kind}`));
    deps.dispatchOrderRefunds?.();
  }
  return ok({ refund: orderStaffRefundView(refund), created: created.value.created });
};

export const shipRefundedOrderAnyway = async (
  ctx: Ctx,
  orderId: string,
  deps: Pick<StaffRefundDeps, 'orderDetails' | 'staffRefunds' | 'clock' | 'rateLimit'>,
): Promise<Result<OrderListItem, AppError>> => {
  const refusal = machineKeyRefusal(ctx);
  if (refusal !== null) return refusal;
  const tenant = await withinRateLimit(ctx, authorizeTenant(ctx, 'order:refund'), 'write', deps);
  if (!tenant.ok) return tenant;
  const order = await deps.orderDetails.findById(tenant.value, orderId);
  if (order === null) return err(notFound('Order was not found'));
  const blocker = shipAnywayBlocker(order);
  if (blocker !== null) return err(blocker);
  const shipped = await deps.staffRefunds.shipAnyway(tenant.value, order.id, { actorUserId: ctx.identity.userId, now: deps.clock.nowIso() });
  return shipped.ok ? ok({ ...order, fulfilmentStatus: shipped.value.fulfilmentStatus ?? null }) : shipped;
};

export const orderStaffRefundSummary = async (
  tenantId: string,
  order: Pick<Order, 'id' | 'status' | 'amountCents' | 'currency'>,
  soldOutRefund: Pick<OrderRefundJob, 'status' | 'amountCents'> | null,
  staffRefunds: Pick<OrderStaffRefundRepository, 'listByOrder'>,
): Promise<{ staffRefunds: OrderStaffRefundView[]; refundTotals: OrderRefundTotals }> => {
  const refunds = await staffRefunds.listByOrder(tenantId, order.id);
  return {
    staffRefunds: refunds.map(orderStaffRefundView),
    refundTotals: orderRefundTotals(order, soldOutRefund === null ? refunds : [...refunds, soldOutRefund]),
  };
};
