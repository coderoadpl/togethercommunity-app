import Stripe from 'stripe';

import { err, ok, validation, type AppError, type Result } from '@core/domain/index.js';
import type { PaymentProvider, PaymentWebhookEvent, TenantSecretResolver } from '@core/server/index.js';

/**
 * Turns any thrown Stripe SDK error into a readable, non-leaky diagnostic (Z-3):
 * the owner sees "Stripe rejected the request: <reason>", never a raw stack.
 */
const asDiagnostic = (prefix: string, cause: unknown): AppError =>
  validation(`${prefix}: ${cause instanceof Error ? cause.message : String(cause)}`);

const localeFor = (language: string | undefined): Stripe.Checkout.SessionCreateParams.Locale | undefined =>
  language === 'pl' ? 'pl' : language === 'en' ? 'en' : undefined;

export interface StripePaymentProviderConfig {
  resolver: TenantSecretResolver;
}

type CreateCheckoutSessionRequest = Parameters<PaymentProvider['createCheckoutSession']>[0];

export const stripeCheckoutSessionParams = (
  input: CreateCheckoutSessionRequest,
): Stripe.Checkout.SessionCreateParams => {
  const locale = localeFor(input.language);
  return {
    mode: 'payment',
    success_url: input.successUrl,
    cancel_url: input.cancelUrl,
    ...(input.customerEmail === undefined ? {} : { customer_email: input.customerEmail }),
    ...(locale === undefined ? {} : { locale }),
    line_items: [
      {
        quantity: 1,
        price_data: {
          currency: input.currency.toLowerCase(),
          unit_amount: input.priceCents,
          product_data: { name: input.productName },
        },
      },
    ],
    metadata: {
      tenantId: input.tenantId,
      productId: input.productId,
      memberEmail: input.customerEmail ?? '',
      language: input.language ?? '',
    },
  };
};

export const createStripePaymentProvider = (config: StripePaymentProviderConfig): PaymentProvider => {
  const clientFor = async (tenantId: string): Promise<Result<Stripe, AppError>> => {
    const key = await config.resolver.resolve(tenantId, 'stripe.restrictedKey');
    if (!key.ok) return key;
    return ok(new Stripe(key.value));
  };

  return {
    createCheckoutSession: async (input) => {
      const client = await clientFor(input.tenantId);
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
      const client = await clientFor(input.tenantId);
      if (!client.ok) return client;
      try {
        await client.value.checkout.sessions.expire(input.sessionId);
        return ok({ expired: true });
      } catch (cause) {
        return err(asDiagnostic('Stripe could not expire the session', cause));
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
        if (event.type === 'checkout.session.completed') {
          const session = event.data.object;
          return ok({
            id: event.id,
            type: event.type,
            objectId: session.id,
            checkoutSession: {
              email: session.customer_details?.email ?? session.customer_email ?? null,
              metadata: {
                tenantId: session.metadata?.tenantId ?? null,
                productId: session.metadata?.productId ?? null,
                memberEmail: session.metadata?.memberEmail || null,
                language: session.metadata?.language || null,
              },
            },
          });
        }
        const object = event.data.object;
        return ok({
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
