import { createHmac, randomUUID, timingSafeEqual } from 'node:crypto';

import {
  err,
  ok,
  stripeWebhookPayloadSchema,
  validation,
} from '#core/domain/index.js';
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

/**
 * Deterministic in-memory PaymentProvider for tests and local dev. It still
 * resolves the tenant's restricted key so the Integrations flow behaves
 * realistically (no key configured -> the test connection fails), but never
 * touches the network.
 */
export const createFakePaymentProvider = (resolver: TenantSecretResolver): PaymentProvider => ({
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
    const key = await resolver.resolve(input.tenantId, 'stripe.restrictedKey');
    if (!key.ok) return key;
    const sessionId = `cs_fake_${randomUUID()}`;
    return ok({ url: `https://fake.checkout.local/${sessionId}`, sessionId });
  },
  expireCheckoutSession: async (input) => {
    const key = await resolver.resolve(input.tenantId, 'stripe.restrictedKey');
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
      type,
      objectId: object.id,
      checkoutSession:
        type === 'checkout.session.completed'
          ? {
              email: object.customer_details?.email ?? object.customer_email ?? null,
              subscriptionId: object.subscription ?? null,
              paymentIntentId: object.payment_intent ?? null,
              invoiceId: object.invoice ?? null,
              amountTotalCents: object.amount_total ?? null,
              discountTotalCents: object.total_details?.amount_discount ?? null,
              metadata: {
                tenantId: object.metadata?.tenantId ?? null,
                productId: object.metadata?.productId ?? null,
                priceId: object.metadata?.priceId || null,
                memberEmail: object.metadata?.memberEmail || null,
                language: object.metadata?.language || null,
                checkoutConsentCaptureId:
                  object.metadata?.checkoutConsentCaptureId || null,
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
            }
          : null,
      subscription:
        type === 'customer.subscription.updated' || type === 'customer.subscription.deleted'
          ? {
              id: object.id,
              status: object.status ?? null,
              cancelAtPeriodEnd: object.cancel_at_period_end ?? false,
              currentPeriodEnd: epochToIso(object.current_period_end),
            }
          : null,
    });
  },
});
