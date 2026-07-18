import {
  err,
  graceExpiresAt,
  nextPeriodEnd,
  ok,
  validation,
  type AppError,
  type ProcessedPaymentEvent,
  type Result,
  type Tenant,
} from '@core/domain/index.js';

import type { PaymentWebhookEvent, ProcessedPaymentEventRepository } from '../ports.js';
import { fulfillEnrollment, type FulfillEnrollmentDeps } from './fulfill-enrollment.js';
import {
  appendOrder,
  failSubscriptionPayment,
  renewSubscriptionPeriod,
  startSubscription,
  updateSubscriptionFromProvider,
  type SubscriptionLifecycleDeps,
} from './subscription-lifecycle.js';

export interface StripeWebhookDeps extends FulfillEnrollmentDeps, SubscriptionLifecycleDeps {
  processedPaymentEvents: ProcessedPaymentEventRepository;
}

const HANDLED_EVENT_TYPES = new Set([
  'checkout.session.completed',
  'invoice.paid',
  'invoice.payment_failed',
  'customer.subscription.updated',
  'customer.subscription.deleted',
]);

const applyCheckoutCompleted = async (
  tenant: Tenant,
  event: PaymentWebhookEvent,
  provider: 'stripe' | 'simulated',
  deps: StripeWebhookDeps,
): Promise<Result<{ processed: boolean }, AppError>> => {
  if (!event.objectId || !event.checkoutSession) {
    return err(validation('Stripe checkout event is missing session data'));
  }
  const metadata = event.checkoutSession.metadata;
  if (metadata.tenantId !== tenant.id) {
    return err(validation('Stripe checkout metadata does not match the webhook tenant'));
  }
  if (!metadata.productId) return err(validation('Stripe checkout metadata is missing productId'));
  const email = event.checkoutSession.email ?? metadata.memberEmail;
  if (!email) return err(validation('Stripe checkout session is missing the member email'));

  const price = metadata.priceId ? await deps.prices.findById(tenant.id, metadata.priceId) : null;
  if (metadata.priceId && (!price || price.productId !== metadata.productId)) {
    return err(validation('Stripe checkout metadata references an unknown price'));
  }
  const periodEnd =
    price?.kind === 'recurring'
      ? nextPeriodEnd(deps.clock.nowIso(), price.interval ?? 'month')
      : null;

  const fulfilled = await fulfillEnrollment(
    tenant,
    {
      email,
      productId: metadata.productId,
      expiresAt: periodEnd === null ? null : graceExpiresAt(periodEnd),
      language: metadata.language ?? 'pl',
      source: provider,
      sendEmail: true,
    },
    deps,
  );
  if (!fulfilled.ok) return fulfilled;

  if (price?.kind === 'recurring') {
    await startSubscription(
      tenant.id,
      {
        memberId: fulfilled.value.memberId,
        price,
        provider,
        providerSubscriptionId: event.checkoutSession.subscriptionId,
        providerObjectIds: {
          checkoutSession: event.objectId,
          ...(event.checkoutSession.subscriptionId === null
            ? {}
            : { subscription: event.checkoutSession.subscriptionId }),
        },
        ...(periodEnd === null ? {} : { currentPeriodEnd: periodEnd }),
      },
      deps,
    );
    return ok({ processed: true });
  }

  const product = await deps.products.findById(tenant.id, metadata.productId);
  await appendOrder(
    tenant.id,
    {
      memberId: fulfilled.value.memberId,
      productId: metadata.productId,
      priceId: price?.id ?? null,
      kind: 'one_time',
      status: 'paid',
      amountCents: price?.amountCents ?? product?.priceCents ?? 0,
      currency: price?.currency ?? product?.currency ?? 'PLN',
      provider,
      providerObjectIds: { checkoutSession: event.objectId },
    },
    deps,
  );
  return ok({ processed: true });
};

const applyInvoiceEvent = async (
  tenant: Tenant,
  event: PaymentWebhookEvent,
  deps: StripeWebhookDeps,
): Promise<Result<{ processed: boolean }, AppError>> => {
  const providerSubscriptionId = event.invoice?.subscriptionId ?? null;
  if (!providerSubscriptionId || !event.objectId) return ok({ processed: false });
  const subscription = await deps.subscriptions.findByProviderSubscriptionId(
    tenant.id,
    providerSubscriptionId,
  );
  if (!subscription) return ok({ processed: false });

  const cycle = {
    subscription,
    providerObjectIds: { invoice: event.objectId, subscription: providerSubscriptionId },
    ...(event.invoice?.amountCents == null ? {} : { amountCents: event.invoice.amountCents }),
    ...(event.invoice?.currency == null ? {} : { currency: event.invoice.currency.toUpperCase() }),
  };
  if (event.type === 'invoice.paid') {
    await renewSubscriptionPeriod(
      tenant.id,
      { ...cycle, ...(event.invoice?.periodEnd == null ? {} : { periodEnd: event.invoice.periodEnd }) },
      deps,
    );
  } else {
    await failSubscriptionPayment(tenant.id, cycle, deps);
  }
  return ok({ processed: true });
};

const applySubscriptionEvent = async (
  tenant: Tenant,
  event: PaymentWebhookEvent,
  deps: StripeWebhookDeps,
): Promise<Result<{ processed: boolean }, AppError>> => {
  if (!event.objectId) return ok({ processed: false });
  const subscription = await deps.subscriptions.findByProviderSubscriptionId(tenant.id, event.objectId);
  if (!subscription) return ok({ processed: false });

  const canceled =
    event.type === 'customer.subscription.deleted' || event.subscription?.status === 'canceled';
  await updateSubscriptionFromProvider(
    tenant.id,
    {
      subscription,
      cancelAtPeriodEnd: event.subscription?.cancelAtPeriodEnd ?? subscription.cancelAtPeriodEnd,
      currentPeriodEnd: event.subscription?.currentPeriodEnd ?? null,
      canceled,
    },
    deps,
  );
  return ok({ processed: true });
};

export const fulfillStripeWebhook = async (
  tenant: Tenant,
  event: PaymentWebhookEvent,
  deps: StripeWebhookDeps,
  provider: 'stripe' | 'simulated' = 'stripe',
): Promise<Result<{ processed: boolean }, AppError>> => {
  if (!HANDLED_EVENT_TYPES.has(event.type)) return ok({ processed: false });
  if (!event.objectId) return err(validation('Payment event is missing its object id'));

  const priorEvent = await deps.processedPaymentEvents.findByEventId(tenant.id, event.id);
  if (priorEvent) return ok({ processed: false });
  const priorObject = await deps.processedPaymentEvents.findByObjectAndType(
    tenant.id,
    event.objectId,
    event.type,
  );
  if (priorObject) return ok({ processed: false });

  const applied =
    event.type === 'checkout.session.completed'
      ? await applyCheckoutCompleted(tenant, event, provider, deps)
      : event.type === 'invoice.paid' || event.type === 'invoice.payment_failed'
        ? await applyInvoiceEvent(tenant, event, deps)
        : await applySubscriptionEvent(tenant, event, deps);
  if (!applied.ok) return applied;
  if (!applied.value.processed) return ok({ processed: false });

  const processedEvent: ProcessedPaymentEvent = {
    id: event.id,
    tenantId: tenant.id,
    type: event.type,
    objectId: event.objectId,
    processedAt: deps.clock.nowIso(),
  };
  const created = await deps.processedPaymentEvents.create(tenant.id, processedEvent);
  return ok({ processed: created });
};
