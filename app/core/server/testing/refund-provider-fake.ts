import { err, ok, refundFailure, type AppError, type ProviderRefund, type Result } from '#core/domain/index.js';

import type { PaymentProvider } from '../ports.js';

type CreateRefundInput = Parameters<NonNullable<PaymentProvider['createRefund']>>[0];

export type RefundProviderStep =
  | { outcome: 'refund'; status?: ProviderRefund['status'] }
  | { outcome: 'error'; error: AppError; createsRefund?: boolean }
  | { outcome: 'no_response'; createsRefund: boolean };

interface SavedResponse {
  paymentIntentId: string;
  amountCents: number;
  response: Result<ProviderRefund, AppError>;
}

const noResponse = refundFailure('transient', 'Request aborted due to timeout being reached (80000ms)', null, true);

export const createRefundProviderFake = (input: {
  chargeAmountCents: number;
  steps?: RefundProviderStep[];
  refundedByHand?: ProviderRefund[];
}) => {
  const steps = [...(input.steps ?? [])];
  const listFailures: AppError[] = [];
  const refunds: ProviderRefund[] = [...(input.refundedByHand ?? [])];
  const responses = new Map<string, SavedResponse>();
  const calls: CreateRefundInput[] = [];
  const listCalls: string[] = [];
  const created: ProviderRefund[] = [];

  const execute = (call: CreateRefundInput, status: ProviderRefund['status']): Result<ProviderRefund, AppError> => {
    const committedCents = refunds
      .filter((refund) => refund.paymentIntentId === call.paymentIntentId && refund.status !== 'failed' && refund.status !== 'canceled')
      .reduce((sum, refund) => sum + refund.amountCents, 0);
    const remainingCents = input.chargeAmountCents - committedCents;
    if (remainingCents <= 0) return err(refundFailure('already_refunded', 'Charge has already been refunded.', 'charge_already_refunded'));
    if (call.amountCents > remainingCents) return err(refundFailure('refund_failed', 'Refund amount is greater than the unrefunded amount on the charge'));
    const refund: ProviderRefund = {
      refundId: `re_${String(created.length + 1)}`, paymentIntentId: call.paymentIntentId, amountCents: call.amountCents,
      status, failureReason: status === 'failed' ? 'expired_or_canceled_card' : null, orderId: call.metadata.orderId, reason: call.metadata.reason,
    };
    refunds.push(refund);
    created.push(refund);
    return ok(refund);
  };

  const save = (call: CreateRefundInput, response: Result<ProviderRefund, AppError>) =>
    responses.set(call.idempotencyKey, { paymentIntentId: call.paymentIntentId, amountCents: call.amountCents, response });

  const payment: Pick<PaymentProvider, 'createRefund' | 'listRefunds'> = {
    createRefund: async (call) => {
      calls.push(call);
      const saved = responses.get(call.idempotencyKey);
      if (saved !== undefined) {
        if (saved.paymentIntentId !== call.paymentIntentId || saved.amountCents !== call.amountCents) {
          return err(refundFailure('refund_failed', 'Keys for idempotent requests can only be used with the same parameters', 'idempotency_error'));
        }
        return saved.response;
      }
      const step = steps.shift() ?? { outcome: 'refund' };
      if (step.outcome === 'refund') {
        const response = execute(call, step.status ?? 'succeeded');
        save(call, response);
        return response;
      }
      if (step.outcome === 'error') {
        if (step.createsRefund === true) execute(call, 'pending');
        save(call, err(step.error));
        return err(step.error);
      }
      if (step.createsRefund) save(call, execute(call, 'pending'));
      return err(noResponse);
    },
    listRefunds: async (call) => {
      listCalls.push(call.paymentIntentId);
      const failure = listFailures.shift();
      if (failure !== undefined) return err(failure);
      return ok(refunds.filter((refund) => refund.paymentIntentId === call.paymentIntentId).toReversed());
    },
  };

  const refundByHand = (refund: ProviderRefund) => { refunds.push(refund); };

  const setRefundStatus = (refundId: string, status: ProviderRefund['status'], failureReason: string | null = null) => {
    const index = refunds.findIndex((refund) => refund.refundId === refundId);
    const refund = refunds[index];
    if (refund === undefined) throw new Error(`No refund ${refundId}`);
    refunds[index] = { ...refund, status, failureReason };
  };

  const failRefund = (refundId: string, failureReason: string) => { setRefundStatus(refundId, 'failed', failureReason); };

  const failLists = (...failures: AppError[]) => { listFailures.push(...failures); };

  return { payment, calls, listCalls, created, refundByHand, failRefund, setRefundStatus, failLists };
};
