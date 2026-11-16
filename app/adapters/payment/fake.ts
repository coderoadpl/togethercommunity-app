import { attributionFromMetadata } from '#core/domain/index.js';
import { checkoutProductIdsMetadata } from './metadata.js';
import { createHmac, randomUUID, timingSafeEqual } from 'node:crypto';

import {
  collectedShippingFromStripe,
  err,
  ok,
  refundCoverage,
  refundFailure,
  stripeWebhookPayloadSchema,
  validation,
  type AppError,
  type ProviderRefund,
  type Result,
} from '#core/domain/index.js';
import { CHECKOUT_SESSION_EVENT_TYPES } from '#core/server/index.js';
import type { PaymentProvider, TenantSecretResolver } from '#core/server/index.js';

const signatureIsValid = (payload: string, header: string, secret: string): boolean => {
  const fields = header.split(',').map((field) => field.split('='));
  const timestamp = fields.find((field) => field[0] === 't')?.[1];
  const signatures = fields.filter((field) => field[0] === 'v1').flatMap((field) => field[1] ?? []);
  if (!timestamp || signatures.length === 0) return false;
  const expected = createHmac('sha256', secret).update(`${timestamp}.${payload}`).digest('hex');
  const expectedBytes = Buffer.from(expected);
  return signatures.some((signature) => {
    const actualBytes = Buffer.from(signature);
    return actualBytes.length === expectedBytes.length && timingSafeEqual(actualBytes, expectedBytes);
  });
};

interface StoredFakeRefund {
  tenantId: string;
  refund: ProviderRefund;
}

interface SavedFakeRefundResponse {
  paymentIntentId: string;
  amountCents: number;
  response: Result<ProviderRefund, AppError>;
}

interface FakePaymentProviderOptions {
  chargeAmountCents?: Readonly<Record<string, number>>;
}

const refundsFor = (refunds: ReadonlyMap<string, StoredFakeRefund>, tenantId: string, paymentIntentId: string): ProviderRefund[] =>
  [...refunds.values()].filter((stored) => stored.tenantId === tenantId && stored.refund.paymentIntentId === paymentIntentId).map((stored) => stored.refund);

const fakeRefunds = (resolver: TenantSecretResolver, options: FakePaymentProviderOptions): Pick<PaymentProvider, 'createRefund' | 'getRefund' | 'listRefunds'> => {
  const refunds = new Map<string, StoredFakeRefund>();
  const responses = new Map<string, SavedFakeRefundResponse>();
  const charges = new Map<string, number>();
  const resolveKey = (tenantId: string, mode: 'live' | 'test') =>
    resolver.resolve(tenantId, mode === 'test' ? 'stripe.testRestrictedKey' : 'stripe.restrictedKey');
  const execute = (tenantId: string, paymentIntentId: string, amountCents: number): Result<ProviderRefund, AppError> => {
    const chargeKey = JSON.stringify([tenantId, paymentIntentId]);
    // Without a configured charge, the first refund asked of a payment intent stands for its whole amount.
    const chargeCents = charges.get(chargeKey) ?? options.chargeAmountCents?.[paymentIntentId] ?? amountCents;
    charges.set(chargeKey, chargeCents);
    const remainingCents = chargeCents - refundsFor(refunds, tenantId, paymentIntentId)
      .filter((refund) => refund.status !== 'failed' && refund.status !== 'canceled')
      .reduce((sum, refund) => sum + refund.amountCents, 0);
    if (remainingCents <= 0) return err(refundFailure('already_refunded', `Charge for ${paymentIntentId} has already been refunded.`, 'charge_already_refunded'));
    if (amountCents > remainingCents) return err(refundFailure('refund_failed', 'Refund amount is greater than the unrefunded amount on the charge'));
    const refund: ProviderRefund = { refundId: `re_fake_${randomUUID()}`, paymentIntentId, amountCents, status: 'succeeded', failureReason: null };
    refunds.set(refund.refundId, { tenantId, refund });
    return ok(refund);
  };
  return {
    createRefund: async (input) => {
      const key = await resolveKey(input.tenantId, input.mode);
      if (!key.ok) return err(refundFailure('credentials_unavailable', key.error.message));
      const responseKey = JSON.stringify([input.tenantId, input.idempotencyKey]);
      const saved = responses.get(responseKey);
      if (saved !== undefined) {
        if (saved.paymentIntentId !== input.paymentIntentId || saved.amountCents !== input.amountCents) {
          return err(refundFailure('refund_failed', 'Keys for idempotent requests can only be used with the same parameters', 'idempotency_error'));
        }
        return saved.response;
      }
      const response = execute(input.tenantId, input.paymentIntentId, input.amountCents);
      responses.set(responseKey, { paymentIntentId: input.paymentIntentId, amountCents: input.amountCents, response });
      return response;
    },
    getRefund: async (input) => {
      const key = await resolveKey(input.tenantId, input.mode);
      if (!key.ok) return err(refundFailure('credentials_unavailable', key.error.message));
      const stored = refunds.get(input.refundId);
      if (stored === undefined || stored.tenantId !== input.tenantId) {
        return err(refundFailure('not_found', `No such refund: '${input.refundId}'`, 'resource_missing'));
      }
      return ok(stored.refund);
    },
    listRefunds: async (input) => {
      const key = await resolveKey(input.tenantId, input.mode);
      if (!key.ok) return err(refundFailure('credentials_unavailable', key.error.message));
      return ok(refundsFor(refunds, input.tenantId, input.paymentIntentId).toReversed());
    },
  };
};

/**
 * Deterministic in-memory PaymentProvider for tests and local dev. It still
 * resolves the tenant's restricted key so the Integrations flow behaves
 * realistically (no key configured -> the test connection fails), but never
 * touches the network.
 */
export const createFakePaymentProvider = (resolver: TenantSecretResolver, options: FakePaymentProviderOptions = {}): PaymentProvider => ({
  ...fakeRefunds(resolver, options),
  configureWebhook: async () => ok({
    webhookEndpointId: `we_fake_${randomUUID()}`,
    webhookSecret: `whsec_fake_${randomUUID()}`,
  }),
  deleteWebhookEndpoint: async () => ok({ deleted: true }),
  test: async ({ tenantId }) => {
    const key = await resolver.resolve(tenantId, 'stripe.restrictedKey');
    return key.ok
      ? ok({ code: 'payment.available', message: 'Payment credentials are available.' })
      : key;
  },
  ensureCouponPromotion: async (input) =>
    ok({
      stripeCouponId: input.stripeCouponId ?? `fake_coupon_${input.couponId}`,
      stripePromotionCodeId:
        input.stripePromotionCodeId ?? `fake_promotion_${input.couponId}`,
    }),
  createCheckoutSession: async (input) => {
    const key = await resolver.resolve(input.tenantId, input.mode === 'test' ? 'stripe.testRestrictedKey' : 'stripe.restrictedKey');
    if (!key.ok) return key;
    const sessionId = `cs_fake_${randomUUID()}`;
    return ok({ url: `https://fake.checkout.local/${sessionId}`, sessionId });
  },
  expireCheckoutSession: async (input) => {
    const key = await resolver.resolve(input.tenantId, input.mode === 'test' ? 'stripe.testRestrictedKey' : 'stripe.restrictedKey');
    if (!key.ok) return key;
    return ok({ expired: true });
  },
  cancelSubscription: async () => ok({ canceled: true, alreadySettled: false }),
  verifyWebhookEvent: async (input) => {
    if (!signatureIsValid(input.payloadRaw, input.signatureHeader, input.webhookSecret))
      return err(validation('Stripe webhook signature verification failed'));
    let parsed: unknown;
    try {
      parsed = JSON.parse(input.payloadRaw);
    } catch {
      return err(validation('Webhook payload is not valid JSON'));
    }
    const event = stripeWebhookPayloadSchema.safeParse(parsed);
    if (!event.success) return err(validation('Webhook payload does not match the Stripe event shape'));
    const object = event.data.data.object;
    const type = event.data.type;
    const epochToIso = (seconds: number | null | undefined): string | null =>
      seconds == null ? null : new Date(seconds * 1000).toISOString();
    return ok({
      id: event.data.id,
      ...(event.data.livemode === undefined ? {} : { livemode: event.data.livemode }),
      type,
      objectId: object.id,
      createdAt: epochToIso(event.data.created),
      checkoutSession:
        CHECKOUT_SESSION_EVENT_TYPES.has(type)
          ? {
              email: object.customer_details?.email ?? object.customer_email ?? null,
              paymentStatus: object.payment_status ?? 'paid',
              subscriptionId: object.subscription ?? null,
              paymentIntentId: object.payment_intent ?? null,
              invoiceId: object.invoice ?? null,
              amountTotalCents: object.amount_total ?? null,
              discountTotalCents: object.total_details?.amount_discount ?? null,
              shipping: collectedShippingFromStripe(object, object.customer_details?.phone ?? null),
              shippingCostCents: object.shipping_cost?.amount_total ?? null,
              metadata: {
                attribution: attributionFromMetadata(object.metadata),
                tenantId: object.metadata?.tenantId ?? null,
                productId: object.metadata?.productId ?? null,
                priceId: object.metadata?.priceId || null,
                memberEmail: object.metadata?.memberEmail || null,
                language: object.metadata?.language || null,
                checkoutConsentCaptureId:
                  object.metadata?.checkoutConsentCaptureId || null,
                ...(object.metadata?.checkoutSnapshotId ? { checkoutSnapshotId: object.metadata.checkoutSnapshotId } : {}),
                ...(object.metadata?.salesLinkId ? { salesLinkId: object.metadata.salesLinkId } : {}),
                ...checkoutProductIdsMetadata(object.metadata),
                couponCheckoutSessionId:
                  object.metadata?.couponCheckoutSessionId || null,
              },
            }
          : null,
      invoice:
        type === 'invoice.paid' || type === 'invoice.payment_failed'
          ? {
              subscriptionId: object.subscription ?? null,
              chargeId: object.charge ?? null,
              paymentIntentId: object.payment_intent ?? null,
              amountCents: object.amount_total ?? null,
              currency: object.currency?.toUpperCase() ?? null,
              periodEnd: epochToIso(object.period_end),
            }
          : null,
      adjustment:
        type === 'charge.refunded' || type === 'charge.dispute.created'
          ? {
              chargeId: type === 'charge.refunded' ? object.id : (object.charge ?? null),
              paymentIntentId: object.payment_intent ?? null,
              invoiceId: object.invoice ?? null,
              refund:
                type === 'charge.refunded'
                  ? refundCoverage({
                      refunded: object.refunded ?? null,
                      amount: object.amount ?? null,
                      amountRefunded: object.amount_refunded ?? null,
                    })
                  : null,
            }
          : null,
      subscription:
        type === 'customer.subscription.updated' || type === 'customer.subscription.deleted'
          ? {
              id: object.id,
              status: object.status ?? null,
              cancelAtPeriodEnd: object.cancel_at_period_end ?? false,
              currentPeriodEnd: epochToIso(object.current_period_end),
              endedAt: epochToIso(object.ended_at),
            }
          : null,
    });
  },
});
