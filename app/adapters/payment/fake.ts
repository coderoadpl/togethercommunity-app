import { createHmac, randomUUID, timingSafeEqual } from 'node:crypto';

import { err, ok, stripeWebhookPayloadSchema, validation } from '@core/domain/index.js';
import type { PaymentProvider, TenantSecretResolver } from '@core/server/index.js';

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
    return ok({
      id: event.data.id,
      type: event.data.type,
      objectId: object.id,
      checkoutSession:
        event.data.type === 'checkout.session.completed'
          ? {
              email: object.customer_details?.email ?? object.customer_email ?? null,
              metadata: {
                tenantId: object.metadata?.tenantId ?? null,
                productId: object.metadata?.productId ?? null,
                memberEmail: object.metadata?.memberEmail || null,
                language: object.metadata?.language || null,
              },
            }
          : null,
    });
  },
});
