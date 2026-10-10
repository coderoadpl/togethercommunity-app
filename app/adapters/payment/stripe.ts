import { checkoutProductIdsMetadata } from './metadata.js';
import Stripe from 'stripe';
import { randomInt } from 'node:crypto';

import {
  adoptionRefusal,
  err,
  ok,
  refundCoverage,
  stripeCancelErrorSchema,
  stripeAdoptionObjectSchema,
  stripeSubscriptionSnapshotSchema,
  stripeChargeObjectSchema,
  stripeDisputeObjectSchema,
  stripeInvoiceObjectSchema,
  stripeSubscriptionObjectSchema,
  validation,
  stripeKeyModeConflicts,
  type AppError,
  type Result,
  type StripePermissionCheck,
} from '#core/domain/index.js';
import {
  STRIPE_WEBHOOK_EVENT_TYPES,
  type PaymentProvider,
  type PaymentWebhookEvent,
  type TenantSecretResolver,
} from '#core/server/index.js';

/**
 * Turns any thrown Stripe SDK error into a readable, non-leaky diagnostic (Z-3):
 * the owner sees "Stripe rejected the request: <reason>", never a raw stack.
 */
const asDiagnostic = (prefix: string, cause: unknown): AppError =>
  validation(`${prefix}: ${cause instanceof Error ? cause.message : String(cause)}`);

const alreadySettledCancelSchema = stripeCancelErrorSchema;

export const stripeCancelAlreadySettled = (cause: unknown): boolean => {
  const parsed = alreadySettledCancelSchema.safeParse(cause);
  if (!parsed.success) return false;
  return (
    parsed.data.code === 'resource_missing' ||
    parsed.data.statusCode === 404 ||
    /already canceled|canceled subscription/i.test(parsed.data.message ?? '')
  );
};

const localeFor = (language: string | undefined): Stripe.Checkout.SessionCreateParams.Locale | undefined =>
  language === 'pl' ? 'pl' : language === 'en' ? 'en' : undefined;

export interface StripePaymentProviderConfig {
  resolver: TenantSecretResolver;
  clientFactory?: (restrictedKey: string) => Stripe;
}

export const STRIPE_WEBHOOK_EVENTS = STRIPE_WEBHOOK_EVENT_TYPES satisfies readonly Stripe.WebhookEndpointCreateParams.EnabledEvent[];

type CreateCheckoutSessionRequest = Parameters<PaymentProvider['createCheckoutSession']>[0];
type EnsureCouponRequest = Parameters<NonNullable<PaymentProvider['ensureCouponPromotion']>>[0];

export const stripeCouponParams = (
  input: EnsureCouponRequest,
): Stripe.CouponCreateParams => ({
  duration: input.recurringDuration === 'forever' ? 'forever' : 'once',
  name: input.code,
  metadata: { tenantId: input.tenantId, couponId: input.couponId },
  ...(input.kind === 'percent'
    ? { percent_off: input.value }
    : { amount_off: input.value, currency: input.currency.toLowerCase() }),
});

export const stripeCheckoutSessionParams = (
  input: CreateCheckoutSessionRequest,
): Stripe.Checkout.SessionCreateParams => {
  const locale = localeFor(input.language);
  const productList = input.lines === undefined ? undefined : JSON.stringify(input.lines.map((line) => line.productId));
  const productMetadata: Record<string, string> = {};
  if (productList !== undefined) {
    if (productList.length <= 500) productMetadata['productIds'] = productList;
    else for (let offset = 0; offset < productList.length; offset += 500) productMetadata[`productIds_${offset / 500}`] = productList.slice(offset, offset + 500);
  }
  return {
    mode: input.recurringInterval === undefined ? 'payment' : 'subscription',
    success_url: input.successUrl,
    cancel_url: input.cancelUrl,
    ...(input.customerEmail === undefined ? {} : { customer_email: input.customerEmail }),
    ...(locale === undefined ? {} : { locale }),
    line_items: (input.lines ?? [{ productId: input.productId, name: input.productName, grossCents: input.priceCents }]).map((line) => ({
      quantity: 1,
      price_data: {
        currency: input.currency.toLowerCase(),
        unit_amount: line.grossCents,
        product_data: { name: line.name },
        ...(input.recurringInterval === undefined ? {} : { recurring: { interval: input.recurringInterval } }),
      },
    })),
    metadata: {
      ...(input.salesLinkId === undefined ? {} : { salesLinkId: input.salesLinkId }),
      ...(input.checkoutSnapshotId === undefined ? {} : { checkoutSnapshotId: input.checkoutSnapshotId }),
      ...productMetadata,
      tenantId: input.tenantId,
      productId: input.productId,
      priceId: input.priceId ?? '',
      memberEmail: input.customerEmail ?? '',
      language: input.language ?? '',
      ...(input.checkoutConsentCaptureId === undefined
        ? {}
        : { checkoutConsentCaptureId: input.checkoutConsentCaptureId }),
      ...(input.couponCheckoutSessionId === undefined
        ? {}
        : { couponCheckoutSessionId: input.couponCheckoutSessionId }),
    },
    ...(input.promotionCodeId === undefined
      ? {}
      : { discounts: [{ promotion_code: input.promotionCodeId }] }),
  };
};

const epochToIso = (seconds: number | null | undefined): string | null =>
  seconds == null ? null : new Date(seconds * 1000).toISOString();

const idOrNull = (value: unknown): string | null => {
  if (typeof value === 'string') return value;
  if (value !== null && typeof value === 'object' && 'id' in value && typeof value.id === 'string') {
    return value.id;
  }
  return null;
};

const toCheckoutSessionEvent = (
  eventId: string,
  type: string,
  session: Stripe.Checkout.Session,
): PaymentWebhookEvent => ({
  id: eventId,
  type,
  objectId: session.id,
  checkoutSession: {
    email: session.customer_details?.email ?? session.customer_email ?? null,
    paymentStatus: session.payment_status,
    subscriptionId: idOrNull(session.subscription),
    paymentIntentId: idOrNull(session.payment_intent),
    invoiceId: idOrNull(session.invoice),
    amountTotalCents: session.amount_total,
    discountTotalCents: session.total_details?.amount_discount ?? null,
    metadata: {
      tenantId: session.metadata?.tenantId ?? null,
      productId: session.metadata?.productId ?? null,
      priceId: session.metadata?.priceId || null,
      memberEmail: session.metadata?.memberEmail || null,
      language: session.metadata?.language || null,
      checkoutConsentCaptureId: session.metadata?.checkoutConsentCaptureId || null,
      couponCheckoutSessionId: session.metadata?.couponCheckoutSessionId || null,
      ...(session.metadata?.checkoutSnapshotId ? { checkoutSnapshotId: session.metadata.checkoutSnapshotId } : {}),
      ...(session.metadata?.salesLinkId ? { salesLinkId: session.metadata.salesLinkId } : {}),
      ...checkoutProductIdsMetadata(session.metadata),
    },
  },
});

const toInvoiceEvent = (eventId: string, type: string, object: unknown): PaymentWebhookEvent | null => {
  const invoice = stripeInvoiceObjectSchema.safeParse(object);
  if (!invoice.success) return null;
  const subscriptionId =
    idOrNull(invoice.data.subscription) ??
    idOrNull(invoice.data.parent?.subscription_details?.subscription);
  const amount = type === 'invoice.paid' ? invoice.data.amount_paid : invoice.data.amount_due;
  const linePeriodEnd = invoice.data.lines?.data[0]?.period?.end;
  return {
    id: eventId,
    type,
    objectId: invoice.data.id,
    checkoutSession: null,
    invoice: {
      subscriptionId,
      chargeId: idOrNull(invoice.data.charge),
      paymentIntentId: idOrNull(invoice.data.payment_intent),
      amountCents: amount ?? null,
      currency: invoice.data.currency?.toUpperCase() ?? null,
      periodEnd: epochToIso(linePeriodEnd ?? invoice.data.period_end),
    },
  };
};

const toAdjustmentEvent = (
  eventId: string,
  type: 'charge.refunded' | 'charge.dispute.created',
  object: unknown,
): PaymentWebhookEvent | null => {
  if (type === 'charge.refunded') {
    const charge = stripeChargeObjectSchema.safeParse(object);
    if (!charge.success) return null;
    return {
      id: eventId,
      type,
      objectId: charge.data.id,
      checkoutSession: null,
      adjustment: {
        chargeId: charge.data.id,
        paymentIntentId: idOrNull(charge.data.payment_intent),
        invoiceId: idOrNull(charge.data.invoice),
        refund: refundCoverage({
          refunded: charge.data.refunded ?? null,
          amount: charge.data.amount ?? null,
          amountRefunded: charge.data.amount_refunded ?? null,
        }),
      },
    };
  }
  const dispute = stripeDisputeObjectSchema.safeParse(object);
  if (!dispute.success) return null;
  return {
    id: eventId,
    type,
    objectId: dispute.data.id,
    checkoutSession: null,
    adjustment: {
      chargeId: idOrNull(dispute.data.charge),
      paymentIntentId: idOrNull(dispute.data.payment_intent),
      invoiceId: null,
    },
  };
};

const toSubscriptionEvent = (
  eventId: string,
  type: string,
  object: unknown,
  createdAt: string | null,
): PaymentWebhookEvent | null => {
  const subscription = stripeSubscriptionObjectSchema.safeParse(object);
  if (!subscription.success) return null;
  const periodEnd =
    subscription.data.current_period_end ?? subscription.data.items?.data[0]?.current_period_end;
  return {
    id: eventId,
    type,
    objectId: subscription.data.id,
    createdAt,
    checkoutSession: null,
    subscription: {
      id: subscription.data.id,
      status: subscription.data.status ?? null,
      cancelAtPeriodEnd: subscription.data.cancel_at_period_end ?? false,
      currentPeriodEnd: epochToIso(periodEnd),
      endedAt: epochToIso(subscription.data.ended_at),
    },
  };
};

const webhookSlotOf = (webhookUrl: string): string | null => {
  try {
    return new URL(webhookUrl).searchParams.get('mode');
  } catch {
    return null;
  }
};

export const createStripePaymentProvider = (config: StripePaymentProviderConfig): PaymentProvider => {
  const createClient = config.clientFactory ?? ((restrictedKey: string) => new Stripe(restrictedKey));
  const clientFor = async (tenantId: string, mode: 'live' | 'test' = 'live'): Promise<Result<Stripe, AppError>> => {
    const key = await config.resolver.resolve(tenantId, mode === 'test' ? 'stripe.testRestrictedKey' : 'stripe.restrictedKey');
    if (!key.ok) return key;
    if (stripeKeyModeConflicts(key.value, mode)) return err(validation('Stripe key mode does not match the requested mode'));
    return ok(createClient(key.value));
  };

  return {
    probeStripePermissions: async (input) => {
      const resolved = await clientFor(input.tenantId, input.mode);
      if (!resolved.ok) return resolved;
      const client = resolved.value;
      const checks: StripePermissionCheck[] = [];
      const failure = (resource: StripePermissionCheck['resource'], permission: StripePermissionCheck['permission'], cause: unknown): StripePermissionCheck => {
        const parsed = stripeCancelErrorSchema.safeParse(cause);
        const detail = parsed.success && parsed.data.message !== undefined
          ? parsed.data.message : cause instanceof Error ? cause.message : String(cause);
        const missing = parsed.success && (parsed.data.statusCode === 403 || parsed.data.code === 'permission_denied')
          || detail.toLowerCase().includes('does not have the required permissions');
        return { resource, permission, status: missing ? 'missing' : 'error', detail };
      };
      const probe = async (resource: StripePermissionCheck['resource'], permission: StripePermissionCheck['permission'], operation: () => Promise<void>): Promise<void> => {
        try {
          await operation();
          checks.push({ resource, permission, status: 'ok' });
        } catch (cause) {
          checks.push(failure(resource, permission, cause));
        }
      };
      await probe('Webhook Endpoints', 'write', async () => { await client.webhookEndpoints.list({ limit: 1 }); });
      await probe('Subscriptions', 'read', async () => { await client.subscriptions.list({ limit: 1 }); });
      let couponId: string | undefined;
      try {
        await probe('Coupons', 'write', async () => {
          const coupon = await client.coupons.create({
            percent_off: 1, duration: 'once', max_redemptions: 1, name: 'Together permission probe',
            metadata: { togetherProbe: '1', tenantId: input.tenantId },
          });
          couponId = coupon.id;
        });
        if (couponId === undefined) {
          checks.push({ resource: 'Promotion Codes', permission: 'write', status: 'error', detail: 'coupon probe failed' });
        } else {
          const coupon = couponId;
          await probe('Promotion Codes', 'write', async () => {
            const alphabet = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789';
            const suffix = Array.from({ length: 8 }, () => alphabet[randomInt(alphabet.length)]).join('');
            const promotion = await client.promotionCodes.create({
              coupon, code: `TOGETHER-PROBE-${suffix}`, max_redemptions: 1, active: true,
              metadata: { togetherProbe: '1', tenantId: input.tenantId },
            });
            await client.promotionCodes.update(promotion.id, { active: false });
          });
        }
      } finally {
        if (couponId !== undefined) {
          try {
            await client.coupons.del(couponId);
          } catch (cause) {
            const index = checks.findIndex((check) => check.resource === 'Coupons');
            checks[index] = failure('Coupons', 'write', cause);
          }
        }
      }
      await probe('Checkout Sessions', 'write', async () => {
        let sessionId: string | undefined;
        try {
          const session = await client.checkout.sessions.create({
            mode: 'payment',
            line_items: [{ price_data: { currency: 'pln', unit_amount: 100, product_data: { name: 'Together permission probe' } }, quantity: 1 }],
            success_url: `${input.origin}/`, cancel_url: `${input.origin}/`,
            expires_at: Math.floor(Date.now() / 1000) + 30 * 60,
            metadata: { togetherProbe: '1', tenantId: input.tenantId },
          });
          sessionId = session.id;
        } finally {
          if (sessionId !== undefined) await client.checkout.sessions.expire(sessionId);
        }
      });
      return ok(checks);
    },
    retrieveStripeSubscription: async (tenantId, subscriptionId) => {
      const client = await clientFor(tenantId);
      if (!client.ok) return client;
      let raw: unknown;
      try {
        raw = await client.value.subscriptions.retrieve(subscriptionId, { expand: ['customer'] });
      } catch (cause) {
        const failure = stripeCancelErrorSchema.safeParse(cause);
        if (failure.success && failure.data.code === 'resource_missing') {
          return err(adoptionRefusal('validation', 'not-found', 'Stripe subscription was not found in this account'));
        }
        return err(asDiagnostic('Stripe rejected the subscription lookup', cause));
      }
      const parsed = stripeAdoptionObjectSchema.safeParse(raw);
      if (!parsed.success) return err(adoptionRefusal('validation', 'unsupported', 'Stripe subscription requires one fixed recurring price and an accessible customer'));
      const item = parsed.data.items.data[0];
      const periodEnd = parsed.data.current_period_end ?? item?.current_period_end;
      if (item === undefined || periodEnd === undefined || parsed.data.customer.deleted === true) {
        return err(adoptionRefusal('validation', 'unsupported', 'Stripe subscription has no current period or customer'));
      }
      return ok(stripeSubscriptionSnapshotSchema.parse({
        id: parsed.data.id, status: parsed.data.status,
        currentPeriodEnd: epochToIso(periodEnd), cancelAtPeriodEnd: parsed.data.cancel_at_period_end,
        customerEmail: parsed.data.customer.email ?? null,
        price: { id: item.price.id, amountCents: item.price.unit_amount,
          currency: item.price.currency.toUpperCase(), interval: item.price.recurring.interval,
          intervalCount: item.price.recurring.interval_count },
      }));
    },
    listStripeSubscriptions: async (tenantId, input) => {
      const client = await clientFor(tenantId);
      if (!client.ok) return client;
      try {
        const page = await client.value.subscriptions.list({
          status: input.status ?? 'all', limit: 100,
          ...(input.startingAfter === undefined ? {} : { starting_after: input.startingAfter }),
        });
        return ok({ subscriptions: page.data.map((subscription) => ({
          id: subscription.id, status: subscription.status,
          providerPriceId: subscription.items.data[0]?.price.id ?? null,
        })), nextCursor: page.has_more ? page.data.at(-1)?.id ?? null : null });
      } catch (cause) {
        return err(asDiagnostic('Stripe rejected the subscription listing', cause));
      }
    },
    configureWebhook: async (input) => {
      try {
        const webhookEndpoints = createClient(input.restrictedKey).webhookEndpoints;
        const registered = await webhookEndpoints.list({ limit: 100 });
        const slot = webhookSlotOf(input.webhookUrl);
        const stale = registered.data.filter(
          (endpoint) =>
            endpoint.url === input.webhookUrl ||
            (endpoint.metadata?.tenantId === input.tenantId && webhookSlotOf(endpoint.url) === slot),
        );
        for (const endpoint of stale) await webhookEndpoints.del(endpoint.id);
        const endpoint = await webhookEndpoints.create({
          url: input.webhookUrl,
          enabled_events: [...STRIPE_WEBHOOK_EVENTS],
          description: 'Together payment fulfillment',
          metadata: { tenantId: input.tenantId },
        });
        if (endpoint.secret === undefined || endpoint.secret === '') {
          await webhookEndpoints.del(endpoint.id);
          return err(validation('Stripe did not return a webhook signing secret'));
        }
        return ok({ webhookEndpointId: endpoint.id, webhookSecret: endpoint.secret });
      } catch (cause) {
        return err(asDiagnostic('Stripe rejected webhook registration', cause));
      }
    },
    deleteWebhookEndpoint: async (input) => {
      try {
        await createClient(input.restrictedKey).webhookEndpoints.del(input.webhookEndpointId);
        return ok({ deleted: true });
      } catch (cause) {
        return err(asDiagnostic('Stripe rejected webhook cleanup', cause));
      }
    },
    test: async (input) => {
      const client = await clientFor(input.tenantId);
      if (!client.ok) return client;
      try {
        const session = await client.value.checkout.sessions.create(
          stripeCheckoutSessionParams({
            tenantId: input.tenantId,
            productId: 'connection-test',
            productName: 'Stripe connection test',
            priceCents: 100,
            currency: 'USD',
            successUrl: `${input.appBaseUrl}/integrations/stripe/test/success`,
            cancelUrl: `${input.appBaseUrl}/integrations/stripe/test/cancel`,
          }),
        );
        await client.value.checkout.sessions.expire(session.id);
        return ok({
          code: 'payment.available',
          message: 'Stripe accepted the credentials and the test session was expired.',
        });
      } catch (cause) {
        return err(asDiagnostic('Stripe rejected the connection test', cause));
      }
    },
    ensureCouponPromotion: async (input) => {
      const client = await clientFor(input.tenantId);
      if (!client.ok) return client;
      try {
        let stripeCouponId = input.stripeCouponId;
        if (stripeCouponId === null) {
          const created = await client.value.coupons.create(stripeCouponParams(input));
          stripeCouponId = created.id;
        }
        let stripePromotionCodeId = input.stripePromotionCodeId;
        if (stripePromotionCodeId === null) {
          const created = await client.value.promotionCodes.create({
            coupon: stripeCouponId,
            code: input.code,
            metadata: { tenantId: input.tenantId, couponId: input.couponId },
          });
          stripePromotionCodeId = created.id;
        }
        return ok({ stripeCouponId, stripePromotionCodeId });
      } catch (cause) {
        return err(asDiagnostic('Stripe rejected the coupon request', cause));
      }
    },
    createCheckoutSession: async (input) => {
      const client = await clientFor(input.tenantId, input.mode);
      if (!client.ok) return client;
      try {
        const session = await client.value.checkout.sessions.create(stripeCheckoutSessionParams(input));
        if (session.url === null) {
          return err(validation('Stripe did not return a checkout URL'));
        }
        return ok({ url: session.url, sessionId: session.id });
      } catch (cause) {
        return err(asDiagnostic('Stripe rejected the checkout request', cause));
      }
    },
    expireCheckoutSession: async (input) => {
      const client = await clientFor(input.tenantId, input.mode);
      if (!client.ok) return client;
      try {
        await client.value.checkout.sessions.expire(input.sessionId);
        return ok({ expired: true });
      } catch (cause) {
        return err(asDiagnostic('Stripe could not expire the session', cause));
      }
    },
    cancelSubscription: async (input) => {
      const client = await clientFor(input.tenantId, input.mode);
      if (!client.ok) return client;
      try {
        await client.value.subscriptions.cancel(
          input.providerSubscriptionId,
          {},
          { idempotencyKey: input.idempotencyKey },
        );
        return ok({ canceled: true, alreadySettled: false });
      } catch (cause) {
        if (stripeCancelAlreadySettled(cause)) {
          return ok({ canceled: true, alreadySettled: true });
        }
        return err(asDiagnostic('Stripe could not cancel the subscription', cause));
      }
    },
    verifyWebhookEvent: async (input): Promise<Result<PaymentWebhookEvent, AppError>> => {
      // constructEvent verifies the HMAC locally and never calls the API, so a
      // throwaway key is enough to build the instance for signature checking.
      const client = new Stripe('sk_webhook_verifier_unused');
      try {
        const event = await client.webhooks.constructEventAsync(
          input.payloadRaw,
          input.signatureHeader,
          input.webhookSecret,
        );
        if (
          event.type === 'checkout.session.completed' ||
          event.type === 'checkout.session.async_payment_succeeded' ||
          event.type === 'checkout.session.async_payment_failed'
        ) {
          return ok({ ...toCheckoutSessionEvent(event.id, event.type, event.data.object), livemode: event.livemode });
        }
        if (event.type === 'invoice.paid' || event.type === 'invoice.payment_failed') {
          const mapped = toInvoiceEvent(event.id, event.type, event.data.object);
          if (mapped) return ok({ ...mapped, livemode: event.livemode });
        }
        if (event.type === 'customer.subscription.updated' || event.type === 'customer.subscription.deleted') {
          const mapped = toSubscriptionEvent(
            event.id,
            event.type,
            event.data.object,
            epochToIso(event.created),
          );
          if (mapped) return ok({ ...mapped, livemode: event.livemode });
        }
        if (event.type === 'charge.refunded' || event.type === 'charge.dispute.created') {
          const mapped = toAdjustmentEvent(event.id, event.type, event.data.object);
          if (mapped) return ok({ ...mapped, livemode: event.livemode });
        }
        const object = event.data.object;
        return ok({
          livemode: event.livemode,
          id: event.id,
          type: event.type,
          objectId: 'id' in object && typeof object.id === 'string' ? object.id : null,
          checkoutSession: null,
        });
      } catch (cause) {
        return err(asDiagnostic('Stripe webhook signature verification failed', cause));
      }
    },
  };
};
