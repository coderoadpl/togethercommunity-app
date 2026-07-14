import { createHmac } from 'node:crypto';

import { describe, expect, it } from 'vitest';

import { ok } from '@core/domain/index.js';

import { createFakePaymentProvider } from './fake.js';

const secret = 'whsec_known_test_secret';
const provider = createFakePaymentProvider({ resolve: async () => ok(secret) });
const payload = JSON.stringify({
  id: 'evt_123',
  type: 'checkout.session.completed',
  data: {
    object: {
      id: 'cs_123',
      customer_details: { email: 'buyer@example.com' },
      metadata: { tenantId: 'tenant-a', productId: 'product-1', memberEmail: '', language: 'pl' },
    },
  },
});

const signature = (body: string, signingSecret = secret): string => {
  const timestamp = '1700000000';
  const digest = createHmac('sha256', signingSecret).update(`${timestamp}.${body}`).digest('hex');
  return `t=${timestamp},v1=${digest}`;
};

describe('fake Stripe webhook verification', () => {
  it('accepts a valid Stripe-style HMAC and preserves checkout metadata', async () => {
    const result = await provider.verifyWebhookEvent({
      payloadRaw: payload,
      signatureHeader: signature(payload),
      webhookSecret: secret,
    });

    expect(result).toEqual({
      ok: true,
      value: {
        id: 'evt_123',
        type: 'checkout.session.completed',
        objectId: 'cs_123',
        checkoutSession: {
          email: 'buyer@example.com',
          metadata: { tenantId: 'tenant-a', productId: 'product-1', memberEmail: null, language: 'pl' },
        },
      },
    });
  });

  it('rejects changed payloads and signatures made with another secret', async () => {
    const changed = await provider.verifyWebhookEvent({
      payloadRaw: `${payload} `,
      signatureHeader: signature(payload),
      webhookSecret: secret,
    });
    const wrongSecret = await provider.verifyWebhookEvent({
      payloadRaw: payload,
      signatureHeader: signature(payload, 'whsec_wrong'),
      webhookSecret: secret,
    });

    expect(changed.ok).toBe(false);
    expect(wrongSecret.ok).toBe(false);
  });
});
