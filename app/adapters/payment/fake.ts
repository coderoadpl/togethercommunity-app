import { randomUUID } from 'node:crypto';

import { err, ok, validation } from '@core/domain/index.js';
import type { PaymentProvider, TenantSecretResolver } from '@core/server/index.js';

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
    if (input.signatureHeader.length === 0) {
      return err(validation('Missing webhook signature'));
    }
    let parsed: unknown;
    try {
      parsed = JSON.parse(input.payloadRaw);
    } catch {
      return err(validation('Webhook payload is not valid JSON'));
    }
    const event =
      typeof parsed === 'object' && parsed !== null && 'id' in parsed && 'type' in parsed
        ? parsed
        : null;
    if (!event || typeof event.id !== 'string' || typeof event.type !== 'string') {
      return err(validation('Webhook payload is missing id/type'));
    }
    return ok({ id: event.id, type: event.type });
  },
});
