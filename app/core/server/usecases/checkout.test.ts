import { describe, expect, it } from 'vitest';

import { ok, type Product, type TenantSecret } from '@core/domain/index.js';
import type { CheckoutDeps, PaymentProvider } from '@core/server/index.js';

const product: Product = {
  id: 'product-1',
  tenantId: 'tenant-a',
  title: 'Course One',
  description: 'Learn.',
  priceCents: 4900,
  currency: 'PLN',
  published: true,
  accessItems: [],
  legacyId: null,
  createdAt: '2026-07-14T10:00:00.000Z',
};

const secret = (key: TenantSecret['key']): TenantSecret => ({
  id: key,
  tenantId: 'tenant-a',
  key,
  ciphertext: 'ciphertext',
  iv: 'iv',
  authTag: 'tag',
  maskedPreview: '••••test',
  updatedAt: '2026-07-14T10:00:00.000Z',
});

describe('createCheckoutSession', () => {
  it('roundtrips product, email, language, metadata inputs and tenant-host return URLs', async () => {
    const calls: Parameters<PaymentProvider['createCheckoutSession']>[0][] = [];
    const deps: CheckoutDeps = {
      products: {
        listByTenant: async () => [],
        listPublishedByTenant: async () => [],
        findById: async (tenantId) => (tenantId === 'tenant-a' ? product : null),
        create: async () => undefined,
        updateAccessItems: async () => null,
        setPublished: async () => undefined,
        bumpContentVersion: async () => undefined,
      },
      tenantSecrets: {
        listByTenant: async () => [],
        findByKey: async (tenantId, key) => (tenantId === 'tenant-a' ? secret(key) : null),
        upsert: async (_tenantId, value) => value,
        delete: async () => false,
      },
      payment: {
        createCheckoutSession: async (input) => {
          calls.push(input);
          return ok({ url: 'https://checkout.stripe.test/cs_1', sessionId: 'cs_1' });
        },
        expireCheckoutSession: async () => ok({ expired: true }),
        verifyWebhookEvent: async () =>
          ok({ id: 'evt_1', type: 'ignored', objectId: null, checkoutSession: null }),
      },
    };
    const checkout = await import('./checkout.js');
    const result = await checkout.createCheckoutSession(
      { id: 'tenant-a', slug: 'alpha', name: 'Alpha', contentVersion: 1 },
      'https://alpha.example.com',
      { productId: 'product-1', email: 'buyer@example.com', language: 'pl' },
      deps,
    );

    expect(result).toEqual({ ok: true, value: { url: 'https://checkout.stripe.test/cs_1' } });
    expect(calls).toEqual([
      {
        tenantId: 'tenant-a',
        productId: 'product-1',
        productName: 'Course One',
        priceCents: 4900,
        currency: 'PLN',
        successUrl:
          'https://alpha.example.com/checkout/product-1?status=success&session_id={CHECKOUT_SESSION_ID}',
        cancelUrl: 'https://alpha.example.com/checkout/product-1?status=cancelled',
        customerEmail: 'buyer@example.com',
        language: 'pl',
      },
    ]);
  });
});
