import {
  ACCESS_RETAINING_ORDER_STATUSES,
  appError,
  DEFAULT_LANGUAGE,
  emailBrandingFrom,
  err,
  graceExpiresAt,
  internal,
  nextPeriodEnd,
  normalizeEmail,
  ok,
  validation,
  type AppError,
  type ProcessedPaymentEvent,
  type Result,
  type Tenant,
  type Coupon,
  type CouponCheckoutSession,
  type Order,
  type ProductPrice,
  type MemberSubscription,
} from '#core/domain/index.js';

import type {
  PaymentRefundRepository,
  PaymentWebhookEvent,
  ProcessedPaymentEventRepository,
  CouponCheckoutSessionRepository,
  CouponRedemptionRepository,
  CouponRepository,
  ProductPriceHistoryRepository,
  CheckoutConsentCaptureRepository,
  EmailOutboxRepository,
  PaymentProvider,
  PaymentTransactionPort,
} from '../ports.js';
import { tenantUrl } from '../tenant-url.js';
import { fulfillEnrollment, type FulfillEnrollmentDeps } from './fulfill-enrollment.js';
import { validateCouponForCheckout } from './coupon-checkout.js';
import {
  appendOrder,
  failSubscriptionPayment,
  renewSubscriptionPeriod,
  startSubscription,
  syncGrantToSubscription,
  updateSubscriptionFromProvider,
  type SubscriptionLifecycleDeps,
} from './subscription-lifecycle.js';

export interface StripeWebhookDeps extends FulfillEnrollmentDeps, SubscriptionLifecycleDeps {
  emailOutbox: EmailOutboxRepository;
  processedPaymentEvents: ProcessedPaymentEventRepository;
  paymentRefunds: PaymentRefundRepository;
  coupons?: CouponRepository;
  couponRedemptions?: CouponRedemptionRepository;
  couponCheckoutSessions?: CouponCheckoutSessionRepository;
  priceHistory?: ProductPriceHistoryRepository;
  checkoutConsentCaptures?: CheckoutConsentCaptureRepository;
  payment: Pick<PaymentProvider, 'cancelSubscription'>;
  paymentTransaction: PaymentTransactionPort;
  logger: { warn(message: string): void };
}

const WEBHOOK_CLAIM_LEASE_MS = 5 * 60 * 1000;

export const CHECKOUT_SESSION_EVENT_TYPES = new Set<string>([
  'checkout.session.completed',
  'checkout.session.async_payment_succeeded',
  'checkout.session.async_payment_failed',
]);

interface EventApplication {
  processed: boolean;
  consumed?: boolean;
}

const enqueueAutoInvoice = async (
  tenantId: string,
  event: PaymentWebhookEvent,
  deps: StripeWebhookDeps,
  transactionDeps: Parameters<Parameters<PaymentTransactionPort['run']>[0]>[0],
): Promise<void> => {
  if (event.objectId === null) return;
  const providerObjectIds =
    event.type === 'invoice.paid'
      ? { invoice: event.objectId }
      : event.type === 'checkout.session.completed' ||
          event.type === 'checkout.session.async_payment_succeeded'
        ? { checkoutSession: event.objectId }
        : null;
  if (providerObjectIds === null) return;
  const order = await transactionDeps.paymentRefunds.findOrderByProviderObjectIds(
    tenantId,
    providerObjectIds,
  );
  if (order === null) return;
  const now = deps.clock.nowIso();
  await transactionDeps.autoInvoiceJobs.enqueue(tenantId, {
    id: deps.ids.nextId(),
    tenantId,
    webhookEventId: event.id,
    orderId: order.id,
    status: 'queued',
    attempts: 0,
    nextAttemptAt: now,
    lockedAt: null,
    lastError: null,
    createdAt: now,
  });
};

const enqueueSubscriptionNotice = async (
  tenant: Tenant,
  subscription: MemberSubscription | null,
  kind: 'subscription-payment-failed' | 'subscription-ended',
  accessEndsAt: string,
  deps: StripeWebhookDeps,
): Promise<Result<void, AppError>> => {
  if (subscription === null) return ok(undefined);
  const [member, product, settings] = await Promise.all([
    deps.members.findById(tenant.id, subscription.memberId),
    deps.products.findById(tenant.id, subscription.productId),
    deps.tenants.findSettings(tenant.id),
  ]);
  if (member === null || member.deletedAt !== null || product === null) return ok(undefined);
  const tenantBaseUrl = tenantUrl(tenant.slug, '/', deps);
  const branding = settings === null ? undefined : emailBrandingFrom(settings, tenantBaseUrl);
  const payload =
    kind === 'subscription-payment-failed'
      ? {
          kind,
          language: DEFAULT_LANGUAGE,
          tenantName: tenant.name,
          productTitle: product.title,
          accessEndsAt,
          billingPortalUrl: settings?.billingPortalUrl ?? null,
          ...(branding === undefined ? {} : { branding }),
        }
      : {
          kind,
          language: DEFAULT_LANGUAGE,
          tenantName: tenant.name,
          productTitle: product.title,
          accessEndsAt,
          offerUrl: tenantBaseUrl,
          ...(branding === undefined ? {} : { branding }),
        };
  const queued = await deps.emailOutbox.enqueue({
    id: deps.ids.nextId(),
    tenantId: tenant.id,
    to: member.email,
    payload,
    now: deps.clock.nowIso(),
  });
  if (!queued.ok) return queued;
  deps.dispatchEmail();
  return ok(undefined);
};

export const STRIPE_WEBHOOK_EVENT_TYPES = [
  'checkout.session.completed',
  'checkout.session.async_payment_succeeded',
  'checkout.session.async_payment_failed',
  'invoice.paid',
  'invoice.payment_failed',
  'customer.subscription.updated',
  'customer.subscription.deleted',
  'charge.refunded',
  'charge.dispute.created',
] as const;

export const HANDLED_EVENT_TYPES = new Set<string>(STRIPE_WEBHOOK_EVENT_TYPES);

interface CouponPaymentContext {
  coupon: Coupon;
  session: CouponCheckoutSession;
  price: ProductPrice | null;
}

const couponPaymentContext = async (
  tenant: Tenant,
  event: PaymentWebhookEvent,
  deps: StripeWebhookDeps,
): Promise<CouponPaymentContext | null> => {
  const sessionId = event.checkoutSession?.metadata.couponCheckoutSessionId;
  if (sessionId === undefined || sessionId === null) return null;
  if (
    deps.coupons === undefined ||
    deps.couponRedemptions === undefined ||
    deps.couponCheckoutSessions === undefined ||
    deps.priceHistory === undefined
  ) {
    return null;
  }
  const session = await deps.couponCheckoutSessions.findById(tenant.id, sessionId);
  if (
    session === null ||
    session.productId !== event.checkoutSession?.metadata.productId ||
    (session.providerSessionId !== null && session.providerSessionId !== event.objectId)
  ) {
    return null;
  }
  const coupon = await deps.coupons.findById(tenant.id, session.couponId);
  if (coupon === null) return null;
  const price = session.priceId === null ? null : await deps.prices.findById(tenant.id, session.priceId);
  return { coupon, session, price };
};

const couponStillAttributable = async (
  tenant: Tenant,
  context: CouponPaymentContext,
  deps: StripeWebhookDeps,
): Promise<boolean> => {
  if (
    deps.coupons === undefined ||
    deps.couponRedemptions === undefined ||
    deps.priceHistory === undefined
  ) {
    return false;
  }
  const validated = await validateCouponForCheckout(
    tenant.id,
    {
      code: context.coupon.code,
      email: context.session.memberEmail,
      productId: context.session.productId,
      priceId: context.session.priceId,
      priceKind: context.price?.kind ?? 'one_time',
      amountCents: context.session.originalCents,
      currency: context.session.currency,
      sessionStartedAt: context.session.startedAt,
    },
    {
      coupons: deps.coupons,
      redemptions: deps.couponRedemptions,
      priceHistory: deps.priceHistory,
      clock: deps.clock,
    },
  );
  return validated.ok;
};

const providerObjectIdsForCheckout = (
  event: PaymentWebhookEvent,
): Record<string, string> => ({
  checkoutSession: event.objectId ?? '',
  ...(event.checkoutSession?.paymentIntentId == null
    ? {}
    : { paymentIntent: event.checkoutSession.paymentIntentId }),
  ...(event.checkoutSession?.subscriptionId == null
    ? {}
    : { subscription: event.checkoutSession.subscriptionId }),
  ...(event.checkoutSession?.invoiceId == null
    ? {}
    : { invoice: event.checkoutSession.invoiceId }),
});

const billingForCheckout = async (
  tenantId: string,
  event: PaymentWebhookEvent,
  deps: StripeWebhookDeps,
) => {
  const captureId = event.checkoutSession?.metadata.checkoutConsentCaptureId;
  if (captureId === undefined || captureId === null || deps.checkoutConsentCaptures === undefined) {
    return null;
  }
  return (await deps.checkoutConsentCaptures.findById(tenantId, captureId))?.billing ?? null;
};

const claimDiscountedOrder = async (
  tenant: Tenant,
  event: PaymentWebhookEvent,
  provider: 'stripe' | 'simulated',
  memberId: string,
  context: CouponPaymentContext,
  billing: Order['billing'],
  deps: StripeWebhookDeps,
): Promise<{ order: Order; coupon: Coupon } | null> => {
  if (deps.couponRedemptions === undefined) return null;
  const existing = await deps.paymentRefunds.findOrderByProviderObjectIds(tenant.id, {
    checkoutSession: event.objectId ?? '',
  });
  if (existing !== null) {
    return existing.couponId === context.coupon.id
      ? { order: existing, coupon: context.coupon }
      : null;
  }
  if (!(await couponStillAttributable(tenant, context, deps))) return null;
  const amountCents =
    event.checkoutSession?.amountTotalCents ?? context.session.finalCents;
  const discountCents =
    event.checkoutSession?.discountTotalCents ?? context.session.discountCents;
  const order: Order = {
    id: deps.ids.nextId(),
    tenantId: tenant.id,
    memberId,
    productId: context.session.productId,
    priceId: context.session.priceId,
    kind: context.price?.kind ?? 'one_time',
    status: 'paid',
    amountCents,
    currency: context.session.currency,
    provider,
    providerObjectIds: providerObjectIdsForCheckout(event),
    couponId: context.coupon.id,
    discountCents,
    billing: billing ?? null,
    createdAt: deps.clock.nowIso(),
  };
  const redemptionId = deps.ids.nextId();
  const claimed = await deps.couponRedemptions.createOrderAndClaim(tenant.id, {
    order,
    redemption: {
      id: redemptionId,
      tenantId: tenant.id,
      couponId: context.coupon.id,
      orderId: order.id,
      memberId,
      email: normalizeEmail(context.session.memberEmail),
      discountCents,
      createdAt: order.createdAt,
    },
    event: {
      id: deps.ids.nextId(),
      tenantId: tenant.id,
      redemptionId,
      couponId: context.coupon.id,
      orderId: order.id,
      type: 'redeemed',
      occurredAt: order.createdAt,
    },
    maxRedemptions: context.coupon.maxRedemptions,
    maxRedemptionsPerMember: context.coupon.maxRedemptionsPerMember,
  });
  return claimed ? { order, coupon: context.coupon } : null;
};

const applyCheckoutCompleted = async (
  tenant: Tenant,
  event: PaymentWebhookEvent,
  provider: 'stripe' | 'simulated',
  deps: StripeWebhookDeps,
): Promise<Result<EventApplication, AppError>> => {
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
  if (event.checkoutSession.paymentStatus === 'unpaid') {
    return ok({ processed: false, consumed: true });
  }
  const periodEnd =
    price?.kind === 'recurring'
      ? nextPeriodEnd(deps.clock.nowIso(), price.interval ?? 'month')
      : null;
  const couponContext = await couponPaymentContext(tenant, event, deps);
  const billing = await billingForCheckout(tenant.id, event, deps);
  const couponCoversFullPrice =
    couponContext !== null && (event.checkoutSession.amountTotalCents ?? 0) === 0;

  const fulfilled = await fulfillEnrollment(
    tenant,
    {
      email,
      productId: metadata.productId,
      expiresAt: periodEnd === null ? null : graceExpiresAt(periodEnd),
      language: metadata.language ?? 'pl',
      source: provider,
      sendEmail: true,
      allowUnpublished: true,
    },
    deps,
  );
  if (!fulfilled.ok) return fulfilled;
  const discounted =
    couponContext === null
      ? null
      : await claimDiscountedOrder(
          tenant,
          event,
          provider,
          fulfilled.value.memberId,
          couponContext,
          billing,
          deps,
        );
  if (couponCoversFullPrice && discounted === null) {
    return err(validation('Coupon redemption limit reached'));
  }
  const product = await deps.products.findById(tenant.id, metadata.productId);
  const paidOrder =
    discounted?.order ??
    (await appendOrder(
      tenant.id,
      {
        memberId: fulfilled.value.memberId,
        productId: metadata.productId,
        priceId: price?.id ?? null,
        kind: price?.kind ?? 'one_time',
        status: 'paid',
        amountCents:
          event.checkoutSession.amountTotalCents ??
          couponContext?.session.finalCents ??
          price?.amountCents ??
          product?.priceCents ??
          0,
        currency:
          couponContext?.session.currency ??
          price?.currency ??
          product?.currency ??
          'PLN',
        provider,
        providerObjectIds: providerObjectIdsForCheckout(event),
        discountCents:
          event.checkoutSession.discountTotalCents ??
          couponContext?.session.discountCents ??
          0,
        billing,
      },
      deps,
    ));

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
          ...(event.checkoutSession.paymentIntentId == null
            ? {}
            : { paymentIntent: event.checkoutSession.paymentIntentId }),
          ...(event.checkoutSession.subscriptionId === null
            ? {}
            : { subscription: event.checkoutSession.subscriptionId }),
        },
        ...(periodEnd === null ? {} : { currentPeriodEnd: periodEnd }),
        paidOrder,
        ...(discounted === null
          ? {}
          : {
              couponId: discounted.coupon.id,
              couponDiscountCents: discounted.order.discountCents,
              couponRecurringDuration: discounted.coupon.recurringDuration,
            }),
      },
      deps,
    );
    return ok({ processed: true });
  }

  return ok({ processed: true });
};

const applyInvoiceEvent = async (
  tenant: Tenant,
  event: PaymentWebhookEvent,
  deps: StripeWebhookDeps,
): Promise<Result<EventApplication, AppError>> => {
  const providerSubscriptionId = event.invoice?.subscriptionId ?? null;
  if (!providerSubscriptionId || !event.objectId) return ok({ processed: false });
  const subscription = await deps.subscriptions.findByProviderSubscriptionId(
    tenant.id,
    providerSubscriptionId,
  );
  if (!subscription) return ok({ processed: false });

  const cycle = {
    subscription,
    providerObjectIds: {
      invoice: event.objectId,
      subscription: providerSubscriptionId,
      ...(event.invoice?.chargeId == null ? {} : { charge: event.invoice.chargeId }),
      ...(event.invoice?.paymentIntentId == null
        ? {}
        : { paymentIntent: event.invoice.paymentIntentId }),
    },
    ...(event.invoice?.amountCents == null ? {} : { amountCents: event.invoice.amountCents }),
    ...(event.invoice?.currency == null ? {} : { currency: event.invoice.currency.toUpperCase() }),
  };
  if (event.type === 'invoice.paid') {
    if (subscription.status === 'canceled') return ok({ processed: true });
    const existingOrder = await deps.paymentRefunds.findOrderByProviderObjectIds(tenant.id, {
      invoice: event.objectId,
    });
    const previousOrder = existingOrder ?? await deps.paymentRefunds.findLatestSubscriptionOrder(
      tenant.id,
      providerSubscriptionId,
    );
    const renewed = await renewSubscriptionPeriod(
      tenant.id,
      {
        ...cycle,
        ...(existingOrder === null ? {} : { paidOrder: existingOrder }),
        billing: previousOrder?.billing ?? null,
        ...(event.invoice?.periodEnd == null ? {} : { periodEnd: event.invoice.periodEnd }),
      },
      deps,
    );
    if (
      existingOrder === null &&
      subscription.couponId !== null &&
      subscription.couponRecurringDuration === 'forever' &&
      deps.couponRedemptions !== undefined
    ) {
      const member = await deps.members.findById(tenant.id, subscription.memberId);
      if (member !== null) {
        const redemptionId = deps.ids.nextId();
        await deps.couponRedemptions.createOrderAndClaim(tenant.id, {
          order: renewed.order,
          redemption: {
            id: redemptionId,
            tenantId: tenant.id,
            couponId: subscription.couponId,
            orderId: renewed.order.id,
            memberId: subscription.memberId,
            email: member.email,
            discountCents: renewed.order.discountCents,
            createdAt: renewed.order.createdAt,
          },
          event: {
            id: deps.ids.nextId(),
            tenantId: tenant.id,
            redemptionId,
            couponId: subscription.couponId,
            orderId: renewed.order.id,
            type: 'redeemed',
            occurredAt: renewed.order.createdAt,
          },
          maxRedemptions: null,
          maxRedemptionsPerMember: null,
        });
      }
    }
  } else {
    if (subscription.status === 'canceled') return ok({ processed: true });
    await failSubscriptionPayment(tenant.id, cycle, deps);
    const notified = await enqueueSubscriptionNotice(
      tenant,
      subscription,
      'subscription-payment-failed',
      graceExpiresAt(subscription.currentPeriodEnd),
      deps,
    );
    if (!notified.ok) return notified;
  }
  return ok({ processed: true });
};

const applyPaymentAdjustment = async (
  tenant: Tenant,
  event: PaymentWebhookEvent,
  deps: StripeWebhookDeps,
): Promise<Result<EventApplication, AppError>> => {
  const adjustment = event.adjustment;
  if (!adjustment) return ok({ processed: false });
  const providerObjectIds = {
    ...(adjustment.invoiceId === null ? {} : { invoice: adjustment.invoiceId }),
    ...(adjustment.paymentIntentId === null ? {} : { paymentIntent: adjustment.paymentIntentId }),
    ...(adjustment.chargeId === null ? {} : { charge: adjustment.chargeId }),
  };
  const order = await deps.paymentRefunds.findOrderByProviderObjectIds(tenant.id, providerObjectIds);
  if (!order) return ok({ processed: false });

  if (adjustment.refund != null && !adjustment.refund.full) {
    if (order.status === 'paid') {
      await deps.paymentRefunds.markOrderPartiallyRefunded(tenant.id, order.id);
    }
    return ok({ processed: true });
  }

  const providerSubscriptionId = order.providerObjectIds['subscription'];
  const invoiceId = order.providerObjectIds['invoice'];
  let subscriptionToCancel: MemberSubscription | null = null;
  if (order.kind === 'recurring' && providerSubscriptionId && invoiceId) {
    const latest = await deps.paymentRefunds.findLatestSubscriptionOrder(
      tenant.id,
      providerSubscriptionId,
    );
    if (latest?.id === order.id) {
      subscriptionToCancel = await deps.subscriptions.findByProviderSubscriptionId(
        tenant.id,
        providerSubscriptionId,
      );
      if (subscriptionToCancel !== null && subscriptionToCancel.status !== 'canceled') {
        const canceled = await deps.payment.cancelSubscription({
          tenantId: tenant.id,
          providerSubscriptionId,
          idempotencyKey: `payment-adjustment-${event.id}-${subscriptionToCancel.id}`,
        });
        if (!canceled.ok) return canceled;
      }
    }
  }

  if (order.status !== 'refunded') {
    const refunded = await deps.paymentRefunds.markOrderRefunded(tenant.id, order.id);
    if (!refunded) return ok({ processed: false });
  }
  const remainingOrders = await deps.paymentRefunds.listAccessRetainingOrdersForMemberProduct(
    tenant.id,
    order.memberId,
    order.productId,
  );
  let remainingAccess = remainingOrders.some((candidate) => candidate.kind === 'one_time');
  if (!remainingAccess) {
    const providerSubscriptionIds = new Set(
      remainingOrders
        .map((candidate) => candidate.providerObjectIds['subscription'])
        .filter((id): id is string => id !== undefined),
    );
    for (const providerSubscriptionId of providerSubscriptionIds) {
      const [latest, subscription] = await Promise.all([
        deps.paymentRefunds.findLatestSubscriptionOrder(tenant.id, providerSubscriptionId),
        deps.subscriptions.findByProviderSubscriptionId(tenant.id, providerSubscriptionId),
      ]);
      if (
        latest !== null &&
        ACCESS_RETAINING_ORDER_STATUSES.includes(latest.status) &&
        subscription?.productId === order.productId &&
        subscription.currentPeriodEnd >= deps.clock.nowIso()
      ) {
        remainingAccess = true;
        break;
      }
    }
  }
  if (!remainingAccess) {
    const grant = await deps.grants.findGrant(tenant.id, order.memberId, order.productId);
    if (grant) await deps.grants.revokeGrant(tenant.id, grant.id, deps.clock.nowIso());
  }

  if (subscriptionToCancel !== null) {
    await updateSubscriptionFromProvider(
      tenant.id,
      { subscription: subscriptionToCancel, cancelAtPeriodEnd: false, canceled: true },
      deps,
    );
  }
  return ok({ processed: true });
};

const asyncPaymentFailed = (
  tenant: Tenant,
  event: PaymentWebhookEvent,
  deps: StripeWebhookDeps,
): Result<EventApplication, AppError> => {
  deps.logger.warn(
    `[stripe-webhook] tenant=${tenant.id} event=${event.id} checkout=${event.objectId ?? 'unknown'} async payment failed`,
  );
  return ok({ processed: true });
};

const applySubscriptionEvent = async (
  tenant: Tenant,
  event: PaymentWebhookEvent,
  deps: StripeWebhookDeps,
): Promise<Result<EventApplication, AppError>> => {
  if (!event.objectId) return ok({ processed: false });
  const subscription = await deps.subscriptions.findByProviderSubscriptionId(tenant.id, event.objectId);
  if (!subscription) return ok({ processed: false });
  const deleted = event.type === 'customer.subscription.deleted';
  const providerEventAt = event.createdAt ?? null;
  if (!deleted && providerEventAt !== null && providerEventAt < subscription.updatedAt) {
    return ok({ processed: false, consumed: true });
  }

  const canceled = deleted || event.subscription?.status === 'canceled';
  const periodEnd = event.subscription?.currentPeriodEnd ?? subscription.currentPeriodEnd;
  const endedAt = event.subscription?.endedAt ?? null;
  const paidThrough = canceled && endedAt !== null && endedAt < periodEnd ? endedAt : periodEnd;
  const grantBefore = deleted
    ? await deps.grants.findGrant(tenant.id, subscription.memberId, subscription.productId)
    : null;
  const updated = await updateSubscriptionFromProvider(
    tenant.id,
    {
      subscription,
      cancelAtPeriodEnd: event.subscription?.cancelAtPeriodEnd ?? subscription.cancelAtPeriodEnd,
      currentPeriodEnd: canceled ? paidThrough : periodEnd,
      canceled,
      ...(providerEventAt !== null && providerEventAt > subscription.updatedAt
        ? { updatedAt: providerEventAt }
        : {}),
    },
    deps,
  );
  const accessEndsAt = await syncGrantToSubscription(tenant.id, updated, paidThrough, deps);
  if (deleted && (grantBefore === null || grantBefore.expiresAt !== null)) {
    const notified = await enqueueSubscriptionNotice(
      tenant,
      updated,
      'subscription-ended',
      accessEndsAt ?? grantBefore?.expiresAt ?? paidThrough,
      deps,
    );
    if (!notified.ok) return notified;
  }
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

  const processedEvent: ProcessedPaymentEvent = {
    id: event.id,
    tenantId: tenant.id,
    type: event.type,
    objectId: event.objectId,
    processedAt: deps.clock.nowIso(),
  };
  const workerId = deps.ids.nextId();
  const claimedAt = deps.clock.nowIso();
  const claimed = await deps.processedPaymentEvents.claim(tenant.id, processedEvent, {
    workerId,
    now: claimedAt,
    leaseExpiresAt: new Date(Date.parse(claimedAt) + WEBHOOK_CLAIM_LEASE_MS).toISOString(),
  });
  if (claimed === 'processed') return ok({ processed: false });
  if (claimed === 'in_progress') {
    return err(appError('conflict', 'Payment event is being processed'));
  }

  let applied: Result<EventApplication, AppError>;
  try {
    applied = await deps.paymentTransaction.run(async (transactionDeps) => {
      const branchDeps = { ...deps, ...transactionDeps };
      const result: Result<EventApplication, AppError> =
        event.type === 'checkout.session.async_payment_failed'
          ? asyncPaymentFailed(tenant, event, deps)
          : CHECKOUT_SESSION_EVENT_TYPES.has(event.type)
            ? await applyCheckoutCompleted(tenant, event, provider, branchDeps)
            : event.type === 'invoice.paid' || event.type === 'invoice.payment_failed'
              ? await applyInvoiceEvent(tenant, event, branchDeps)
              : event.type === 'charge.refunded' || event.type === 'charge.dispute.created'
                ? await applyPaymentAdjustment(tenant, event, branchDeps)
                : await applySubscriptionEvent(tenant, event, branchDeps);
      if (result.ok && (result.value.processed || result.value.consumed === true)) {
        if (result.value.processed) await enqueueAutoInvoice(tenant.id, event, deps, transactionDeps);
        await transactionDeps.processedPaymentEvents.finalize(
          tenant.id,
          event.id,
          workerId,
          deps.clock.nowIso(),
        );
      }
      return result;
    });
  } catch {
    await deps.processedPaymentEvents.release(tenant.id, event.id, workerId);
    return err(internal('Payment fulfillment failed'));
  }

  if (!applied.ok) {
    await deps.processedPaymentEvents.release(tenant.id, event.id, workerId);
    return applied;
  }
  if (!applied.value.processed && applied.value.consumed !== true) {
    await deps.processedPaymentEvents.release(tenant.id, event.id, workerId);
  }
  return ok({ processed: applied.value.processed });
};
