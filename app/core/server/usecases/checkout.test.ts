import { describe, expect, it } from 'vitest';

import {
  err,
  integrationUnavailable,
  ok,
  type Coupon,
  type Product,
  type ProductPrice,
  type TenantSecret,
} from '#core/domain/index.js';
import type { CheckoutDeps, PaymentProvider } from '#core/server/index.js';

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

const freeCoupon: Coupon = {
  id: 'coupon-free',
  tenantId: 'tenant-a',
  code: 'FREE',
  kind: 'percent',
  value: 100,
  scope: { kind: 'all' },
  appliesTo: 'both',
  recurringDuration: 'first_invoice',
  startsAt: null,
  endsAt: null,
  maxRedemptions: null,
  maxRedemptionsPerMember: null,
  status: 'active',
  partnerLabel: null,
  stripeCouponId: null,
  stripePromotionCodeId: null,
  createdAt: '2026-07-01T00:00:00.000Z',
};

const recurringPrice: ProductPrice = {
  id: 'price-recurring',
  tenantId: 'tenant-a',
  productId: product.id,
  kind: 'recurring',
  interval: 'month',
  amountCents: 4900,
  currency: 'PLN',
  active: true,
  createdAt: '2026-07-01T00:00:00.000Z',
};

const checkoutDeps = (): CheckoutDeps => ({
  products: {
    listByTenant: async () => [],
    listPublishedByTenant: async () => [],
    findById: async () => product,
    create: async () => undefined,
    updateAccessItems: async () => null,
    setPublished: async () => undefined,
    bumpContentVersion: async () => undefined,
  },
  prices: {
    listByProduct: async () => [],
    listActiveByProducts: async () => [],
    findById: async () => null,
    create: async () => undefined,
    setActive: async () => null,
  },
  tenantSecrets: {
    listByTenant: async () => [],
    findByKey: async (_tenantId, key) => secret(key),
    upsert: async (_tenantId, value) => value,
    delete: async () => false,
  },
  payment: {
    test: async () => ok({ code: 'payment.available', message: 'Payment is available.' }),
    createCheckoutSession: async () =>
      ok({ url: 'https://checkout.stripe.test/default', sessionId: 'default' }),
    expireCheckoutSession: async () => ok({ expired: true }),
    cancelSubscription: async () => ok({ canceled: true, alreadySettled: false }),
    verifyWebhookEvent: async () =>
      ok({ id: 'evt-1', type: 'ignored', objectId: null, checkoutSession: null }),
  },
});

describe('createCheckoutSession', () => {
  it('rejects an unpublished product', async () => {
    const base = checkoutDeps();
    const result = await (await import('./checkout.js')).createCheckoutSession(
      { id: 'tenant-a', slug: 'alpha', name: 'Alpha', contentVersion: 1 },
      'https://alpha.example.com',
      { productId: product.id },
      {
        ...base,
        products: { ...base.products, findById: async () => ({ ...product, published: false }) },
      },
    );
    expect(result).toEqual({
      ok: false,
      error: {
        code: 'not_found',
        message: `No published product "${product.id}" in this tenant`,
      },
    });
  });

  it.each([
    ['missing', null],
    ['belonging to another product', { ...recurringPrice, productId: 'product-2' }],
    ['inactive', { ...recurringPrice, active: false }],
  ] as const)('rejects a %s price', async (_case, foundPrice) => {
    const base = checkoutDeps();
    const result = await (await import('./checkout.js')).createCheckoutSession(
      { id: 'tenant-a', slug: 'alpha', name: 'Alpha', contentVersion: 1 },
      'https://alpha.example.com',
      { productId: product.id, priceId: recurringPrice.id },
      {
        ...base,
        prices: {
          ...base.prices,
          findById: async () => foundPrice,
        },
      },
    );
    expect(result).toEqual({
      ok: false,
      error: {
        code: 'not_found',
        message: `No active price "${recurringPrice.id}" for this product`,
      },
    });
  });

  it('rejects checkout when tenant Stripe secrets are missing', async () => {
    const base = checkoutDeps();
    const result = await (await import('./checkout.js')).createCheckoutSession(
      { id: 'tenant-a', slug: 'alpha', name: 'Alpha', contentVersion: 1 },
      'https://alpha.example.com',
      { productId: product.id },
      {
        ...base,
        tenantSecrets: { ...base.tenantSecrets, findByKey: async () => null },
      },
    );
    expect(result).toMatchObject({ ok: false, error: { code: 'validation' } });
  });

  it('propagates provider failure with its error code', async () => {
    const base = checkoutDeps();
    const result = await (await import('./checkout.js')).createCheckoutSession(
      { id: 'tenant-a', slug: 'alpha', name: 'Alpha', contentVersion: 1 },
      'https://alpha.example.com',
      { productId: product.id },
      {
        ...base,
        payment: {
          ...base.payment,
          createCheckoutSession: async () => err(integrationUnavailable('Stripe unavailable')),
        },
      },
    );
    expect(result).toMatchObject({ ok: false, error: { code: 'integration_unavailable' } });
  });

  it('returns a free fulfillment handoff without creating a provider session', async () => {
    let providerSessions = 0;
    const base = checkoutDeps();
    const result = await (await import('./checkout.js')).createCheckoutSession(
      { id: 'tenant-a', slug: 'alpha', name: 'Alpha', contentVersion: 1 },
      'https://alpha.example.com',
      { productId: product.id, email: 'buyer@example.com', couponCode: 'FREE' },
      {
        ...base,
        payment: {
          ...base.payment,
          ensureCouponPromotion: async () =>
            ok({ stripeCouponId: 'stripe-coupon', stripePromotionCodeId: 'promotion-free' }),
          createCheckoutSession: async () => {
            providerSessions += 1;
            return ok({ url: 'https://unused.test', sessionId: 'unused' });
          },
        },
        coupons: {
          findByCode: async () => freeCoupon,
          findById: async () => freeCoupon,
          cacheStripeIds: async () => freeCoupon,
        },
        couponRedemptions: {
          counts: async () => ({ total: 0, member: 0 }),
          createOrderAndClaim: async () => true,
        },
        couponCheckoutSessions: {
          create: async () => undefined,
          attachProviderSession: async () => undefined,
          findById: async () => null,
        },
        priceHistory: { lowestSince: async () => product.priceCents },
        ids: { nextId: () => 'coupon-session-free' },
        clock: { nowIso: () => '2026-07-27T00:00:00.000Z' },
      },
    );

    expect(result).toMatchObject({
      ok: true,
      value: {
        free: true,
        couponCheckoutSessionId: 'coupon-session-free',
        coupon: { finalCents: 0, discountCents: 4900 },
      },
    });
    expect(providerSessions).toBe(0);
  });

  it('uses the provider for a fully discounted recurring checkout', async () => {
    const base = checkoutDeps();
    let providerSessions = 0;
    const result = await (await import('./checkout.js')).createCheckoutSession(
      { id: 'tenant-a', slug: 'alpha', name: 'Alpha', contentVersion: 1 },
      'https://alpha.example.com',
      {
        productId: product.id,
        priceId: recurringPrice.id,
        email: 'buyer@example.com',
        couponCode: 'FREE',
      },
      {
        ...base,
        prices: {
          ...base.prices,
          findById: async () => recurringPrice,
        },
        payment: {
          ...base.payment,
          ensureCouponPromotion: async () =>
            ok({ stripeCouponId: 'stripe-coupon', stripePromotionCodeId: 'promotion-free' }),
          createCheckoutSession: async (input) => {
            providerSessions += 1;
            expect(input.recurringInterval).toBe('month');
            return ok({ url: 'https://checkout.stripe.test/subscription', sessionId: 'cs-sub' });
          },
        },
        coupons: {
          findByCode: async () => freeCoupon,
          findById: async () => freeCoupon,
          cacheStripeIds: async () => freeCoupon,
        },
        couponRedemptions: {
          counts: async () => ({ total: 0, member: 0 }),
          createOrderAndClaim: async () => true,
        },
        couponCheckoutSessions: {
          create: async () => undefined,
          attachProviderSession: async () => undefined,
          findById: async () => null,
        },
        priceHistory: { lowestSince: async () => recurringPrice.amountCents },
        ids: { nextId: () => 'coupon-session-subscription' },
        clock: { nowIso: () => '2026-07-27T00:00:00.000Z' },
      },
    );

    expect(result).toMatchObject({
      ok: true,
      value: { free: false, url: 'https://checkout.stripe.test/subscription' },
    });
    expect(providerSessions).toBe(1);
  });

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
      prices: {
        listByProduct: async () => [],
        listActiveByProducts: async () => [],
        findById: async () => null,
        create: async () => undefined,
        setActive: async () => null,
      },
      tenantSecrets: {
        listByTenant: async () => [],
        findByKey: async (tenantId, key) => (tenantId === 'tenant-a' ? secret(key) : null),
        upsert: async (_tenantId, value) => value,
        delete: async () => false,
      },
      payment: {
        test: async () => ok({ code: 'payment.available', message: 'Payment is available.' }),
        createCheckoutSession: async (input) => {
          calls.push(input);
          return ok({ url: 'https://checkout.stripe.test/cs_1', sessionId: 'cs_1' });
        },
        expireCheckoutSession: async () => ok({ expired: true }),
        cancelSubscription: async () => ok({ canceled: true, alreadySettled: false }),
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

    expect(result).toEqual({
      ok: true,
      value: { url: 'https://checkout.stripe.test/cs_1', free: false },
    });
    expect(calls).toEqual([
      {
        tenantId: 'tenant-a',
        productId: 'product-1',
        productName: 'Course One',
        priceCents: 4900,
        currency: 'PLN',
        successUrl:
          'https://alpha.example.com/checkout/product-1?status=success&purchase_kind=one_time&session_id={CHECKOUT_SESSION_ID}',
        cancelUrl: 'https://alpha.example.com/checkout/product-1?status=cancelled',
        customerEmail: 'buyer@example.com',
        language: 'pl',
      },
    ]);
  });

  it('marks a recurring-price return as a subscription success', async () => {
    const calls: Parameters<PaymentProvider['createCheckoutSession']>[0][] = [];
    const deps: CheckoutDeps = {
      products: {
        listByTenant: async () => [],
        listPublishedByTenant: async () => [],
        findById: async () => product,
        create: async () => undefined,
        updateAccessItems: async () => null,
        setPublished: async () => undefined,
        bumpContentVersion: async () => undefined,
      },
      prices: {
        listByProduct: async () => [],
        listActiveByProducts: async () => [],
        findById: async () => ({
          id: 'price-monthly',
          tenantId: 'tenant-a',
          productId: product.id,
          kind: 'recurring',
          interval: 'month',
          amountCents: 3900,
          currency: 'PLN',
          active: true,
          createdAt: '2026-07-18T10:00:00.000Z',
        }),
        create: async () => undefined,
        setActive: async () => null,
      },
      tenantSecrets: {
        listByTenant: async () => [],
        findByKey: async (_tenantId, key) => secret(key),
        upsert: async (_tenantId, value) => value,
        delete: async () => false,
      },
      payment: {
        test: async () => ok({ code: 'payment.available', message: 'Payment is available.' }),
        createCheckoutSession: async (input) => {
          calls.push(input);
          return ok({ url: 'https://checkout.stripe.test/cs_sub', sessionId: 'cs_sub' });
        },
        expireCheckoutSession: async () => ok({ expired: true }),
        cancelSubscription: async () => ok({ canceled: true, alreadySettled: false }),
        verifyWebhookEvent: async () =>
          ok({ id: 'evt_1', type: 'ignored', objectId: null, checkoutSession: null }),
      },
    };
    const checkout = await import('./checkout.js');
    const result = await checkout.createCheckoutSession(
      { id: 'tenant-a', slug: 'alpha', name: 'Alpha', contentVersion: 1 },
      'https://alpha.example.com',
      { productId: product.id, priceId: 'price-monthly' },
      deps,
    );

    expect(result.ok).toBe(true);
    expect(calls[0]).toMatchObject({
      priceId: 'price-monthly',
      recurringInterval: 'month',
      successUrl:
        'https://alpha.example.com/checkout/product-1?status=success&purchase_kind=subscription&session_id={CHECKOUT_SESSION_ID}',
    });
  });
});
