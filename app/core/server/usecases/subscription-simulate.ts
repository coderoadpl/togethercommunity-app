import {
  err,
  notFound,
  ok,
  validation,
  type AppError,
  type MemberSubscription,
  type Result,
  type Tenant,
} from '#core/domain/index.js';

import type { PaymentWebhookEvent } from '../ports.js';
import { fulfillStripeWebhook, type StripeWebhookDeps } from './stripe-webhook.js';

export interface SimulatedCycleResult {
  subscription: MemberSubscription;
  processed: boolean;
}

const findSimulatedSubscription = async (
  tenantId: string,
  subscriptionId: string,
  deps: StripeWebhookDeps,
): Promise<Result<MemberSubscription & { providerSubscriptionId: string }, AppError>> => {
  const subscription = await deps.subscriptions.findById(tenantId, subscriptionId);
  if (!subscription) return err(notFound(`No subscription "${subscriptionId}" in this tenant`));
  const providerSubscriptionId = subscription.providerSubscriptionId;
  if (providerSubscriptionId === null) {
    return err(validation('This subscription has no provider subscription id'));
  }
  if (subscription.status === 'canceled') {
    return err(validation('This subscription is already canceled'));
  }
  return ok({ ...subscription, providerSubscriptionId });
};

/**
 * Dev-only invoice simulation: fabricates the SAME webhook events the payment
 * provider would send and routes them through `fulfillStripeWebhook`, so the
 * simulated lifecycle exercises the identical code path (idempotency included).
 */
export const simulateSubscriptionCycle = async (
  tenant: Tenant,
  subscriptionId: string,
  deps: StripeWebhookDeps,
): Promise<Result<SimulatedCycleResult, AppError>> => {
  const found = await findSimulatedSubscription(tenant.id, subscriptionId, deps);
  if (!found.ok) return found;

  const event: PaymentWebhookEvent = found.value.cancelAtPeriodEnd
    ? {
        id: `sim_evt_${deps.ids.nextId()}`,
        type: 'customer.subscription.deleted',
        objectId: found.value.providerSubscriptionId,
        checkoutSession: null,
        subscription: {
          id: found.value.providerSubscriptionId,
          status: 'canceled',
          cancelAtPeriodEnd: true,
          currentPeriodEnd: found.value.currentPeriodEnd,
          endedAt: found.value.currentPeriodEnd,
        },
      }
    : {
        id: `sim_evt_${deps.ids.nextId()}`,
        type: 'invoice.paid',
        objectId: `sim_in_${deps.ids.nextId()}`,
        checkoutSession: null,
        invoice: {
          subscriptionId: found.value.providerSubscriptionId,
          amountCents: null,
          currency: null,
          periodEnd: null,
        },
      };
  const fulfilled = await fulfillStripeWebhook(tenant, event, deps, found.value.provider);
  if (!fulfilled.ok) return fulfilled;

  const subscription = await deps.subscriptions.findById(tenant.id, subscriptionId);
  if (!subscription) return err(notFound(`No subscription "${subscriptionId}" in this tenant`));
  return ok({ subscription, processed: fulfilled.value.processed });
};

export const simulateSubscriptionFailure = async (
  tenant: Tenant,
  subscriptionId: string,
  deps: StripeWebhookDeps,
): Promise<Result<SimulatedCycleResult, AppError>> => {
  const found = await findSimulatedSubscription(tenant.id, subscriptionId, deps);
  if (!found.ok) return found;

  const event: PaymentWebhookEvent = {
    id: `sim_evt_${deps.ids.nextId()}`,
    type: 'invoice.payment_failed',
    objectId: `sim_in_${deps.ids.nextId()}`,
    checkoutSession: null,
    invoice: {
      subscriptionId: found.value.providerSubscriptionId,
      amountCents: null,
      currency: null,
      periodEnd: null,
    },
  };
  const fulfilled = await fulfillStripeWebhook(tenant, event, deps, found.value.provider);
  if (!fulfilled.ok) return fulfilled;

  const subscription = await deps.subscriptions.findById(tenant.id, subscriptionId);
  if (!subscription) return err(notFound(`No subscription "${subscriptionId}" in this tenant`));
  return ok({ subscription, processed: fulfilled.value.processed });
};
