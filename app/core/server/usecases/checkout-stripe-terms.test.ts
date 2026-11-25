import { describe, expect, it } from 'vitest';

import { checkoutSessionInputSchema, ok, type CheckoutSessionInput, type Coupon, type CouponCheckoutSession, type Product, type ProductPrice, type Tenant } from '#core/domain/index.js';

import type { PaymentProvider } from '../ports.js';
import { startCheckoutSession, validateCheckoutSelection, type CheckoutDeps } from './checkout.js';
import { workspaceOnlyPaymentSource } from '../testing/payment-source-fake.js';

type PortInput = Parameters<PaymentProvider['createCheckoutSession']>[0];

const now = '2026-11-18T10:00:00.000Z';
const tenant: Tenant = { id: 'tenant-a', slug: 'acme', name: 'Acme', status: 'active', plan: 'hosted', contentVersion: 1 };
const stripeTerms = {
  termsUrl: 'https://acme.togethercommunity.app/terms',
  privacyUrl: 'https://acme.togethercommunity.app/privacy',
  termsAcceptanceMessage: 'I accept the [Terms](https://acme.togethercommunity.app/terms) and the [Privacy policy](https://acme.togethercommunity.app/privacy).',
};

const course: Product = {
  id: 'course-1', tenantId: tenant.id, type: 'course', slug: 'course-one', title: 'Course One', description: 'Learn.',
  coverUrl: null, priceCents: 4900, currency: 'PLN', visibility: 'listed', salesChannel: 'any', deliveryMethod: 'pickup',
  published: true, accessItems: [], legacyId: null, createdAt: now,
};

const monthly: ProductPrice = {
  id: 'price-monthly', tenantId: tenant.id, productId: course.id, kind: 'recurring', interval: 'month',
  amountCents: 4900, currency: 'PLN', active: true, createdAt: now,
};

const coupon = (patch: Partial<Coupon>): Coupon => ({
  id: 'coupon-1', tenantId: tenant.id, code: 'SAVE', kind: 'percent', value: 50, scope: { kind: 'all' }, appliesTo: 'both',
  recurringDuration: 'first_invoice', startsAt: null, endsAt: null, maxRedemptions: null, maxRedemptionsPerMember: null,
  status: 'active', partnerLabel: null, stripeCouponId: null, stripePromotionCodeId: null, createdAt: now, ...patch,
});

const harness = (options: { coupon?: Coupon; priceCents?: number } = {}) => {
  const calls: PortInput[] = [];
  const couponSessions: CouponCheckoutSession[] = [];
  let ids = 0;
  const deps: CheckoutDeps = {
    paymentSource: workspaceOnlyPaymentSource,
    products: {
      listByTenant: async () => [], listPublishedByTenant: async () => [],
      findById: async (_tenantId, id) => id === course.id ? { ...course, priceCents: options.priceCents ?? course.priceCents } : null,
      create: async () => 'created', updateAccessItems: async () => null, setPublished: async () => undefined, bumpContentVersion: async () => undefined,
    },
    prices: {
      listByProduct: async () => [], listActiveByProducts: async () => [], findById: async (_tenantId, id) => id === monthly.id ? monthly : null,
      create: async () => undefined, setActive: async () => null,
    },
    tenantSecrets: {
      listByTenant: async () => [], upsert: async (_tenantId, value) => value, upsertMany: async (_tenantId, secrets) => [...secrets], delete: async () => false,
      findByKey: async (tenantId, key) => ({ id: key, tenantId, key, ciphertext: 'c', iv: 'iv', authTag: 'tag', maskedPreview: 'masked', updatedAt: now }),
    },
    payment: {
      test: async () => ok({ code: 'payment.available', message: 'Payment is available.' }),
      createCheckoutSession: async (input) => { calls.push(input); return ok({ url: 'https://checkout.stripe.test/cs_live_1', sessionId: 'cs_live_1' }); },
      expireCheckoutSession: async () => ok({ expired: true }),
      cancelSubscription: async () => ok({ canceled: true, alreadySettled: false }),
      verifyWebhookEvent: async () => ok({ id: 'evt-1', type: 'ignored', objectId: null, checkoutSession: null }),
      ensureCouponPromotion: async () => ok({ stripeCouponId: 'stripe-coupon', stripePromotionCodeId: 'promo-1' }),
    },
    ids: { nextId: () => `id-${String(++ids)}` },
    clock: { nowIso: () => now },
    ...(options.coupon === undefined ? {} : {
      coupons: { findByCode: async () => options.coupon ?? null, findById: async () => options.coupon ?? null, cacheStripeIds: async () => options.coupon ?? null },
      couponRedemptions: { counts: async () => ({ total: 0, member: 0 }), createOrderAndClaim: async () => true },
      couponCheckoutSessions: { create: async (_tenantId, session) => { couponSessions.push(session); }, attachProviderSession: async () => undefined, findById: async () => null },
      priceHistory: { lowestSince: async (_tenantId, input) => input.currentAmountCents },
    }),
  };
  const start = async (input: CheckoutSessionInput, terms: typeof stripeTerms | null = stripeTerms) => {
    const parsed = checkoutSessionInputSchema.parse(input);
    const selection = await validateCheckoutSelection(tenant.id, parsed, deps);
    if (!selection.ok) return selection;
    return startCheckoutSession(tenant, 'https://acme.togethercommunity.app', parsed, selection.value, deps, 'capture-1', undefined, terms ?? undefined);
  };
  return { calls, couponSessions, start };
};

describe('a workspace checkout whose terms Stripe collects', () => {
  it('hands Stripe the terms and no email for an anonymous paid order', async () => {
    const h = harness();
    expect(await h.start({ productId: course.id })).toEqual(ok({ url: 'https://checkout.stripe.test/cs_live_1', free: false }));
    expect(h.calls).toHaveLength(1);
    expect(h.calls[0]).toMatchObject({ stripeTerms, checkoutConsentCaptureId: 'capture-1' });
    expect(h.calls[0]).not.toHaveProperty('customerEmail');
  });

  it('passes a known buyer email to Stripe', async () => {
    const h = harness();
    expect((await h.start({ productId: course.id, email: 'member@example.test' })).ok).toBe(true);
    expect(h.calls[0]).toMatchObject({ stripeTerms, customerEmail: 'member@example.test' });
  });

  it('starts a subscription with the terms collected by Stripe', async () => {
    const h = harness();
    expect((await h.start({ productId: course.id, priceId: monthly.id })).ok).toBe(true);
    expect(h.calls[0]).toMatchObject({ stripeTerms, recurringInterval: 'month' });
  });

  it('applies a coupon without a per-member limit without an email', async () => {
    const h = harness({ coupon: coupon({}) });
    expect(await h.start({ productId: course.id, couponCode: 'SAVE' })).toMatchObject({ ok: true, value: { free: false, coupon: { finalCents: 2450 } } });
    expect(h.calls[0]).toMatchObject({ stripeTerms, promotionCodeId: 'promo-1' });
    expect(h.calls[0]).not.toHaveProperty('customerEmail');
    expect(h.couponSessions).toMatchObject([{ memberEmail: null }]);
  });

  it('needs an email for a coupon with a per-member limit', async () => {
    const h = harness({ coupon: coupon({ maxRedemptionsPerMember: 1 }) });
    expect(await h.start({ productId: course.id, couponCode: 'SAVE' }))
      .toMatchObject({ ok: false, error: { code: 'validation', message: 'An email is required to validate this coupon' } });
    expect(h.calls).toHaveLength(0);
    expect(await h.start({ productId: course.id, couponCode: 'SAVE', email: 'buyer@example.test' })).toMatchObject({ ok: true });
    expect(h.calls[0]).toMatchObject({ customerEmail: 'buyer@example.test' });
    expect(h.couponSessions).toMatchObject([{ memberEmail: 'buyer@example.test' }]);
  });

  it.each([
    ['without an email', { termsAccepted: true }, 'An email is required to use a coupon'],
    ['without the terms', { email: 'buyer@example.test' }, 'Accepting the terms and privacy policy is required'],
  ] as const)('refuses an order a coupon makes free %s', async (_case, patch, message) => {
    const h = harness({ coupon: coupon({ value: 100 }) });
    expect(await h.start({ productId: course.id, couponCode: 'SAVE', ...patch })).toMatchObject({ ok: false, error: { code: 'validation', message } });
    expect(h.couponSessions).toHaveLength(0);
    expect(h.calls).toHaveLength(0);
  });

  it('completes an order a coupon makes free with the email and terms from the page and no Stripe session', async () => {
    const h = harness({ coupon: coupon({ value: 100 }) });
    expect(await h.start({ productId: course.id, couponCode: 'SAVE', email: 'buyer@example.test', termsAccepted: true }))
      .toMatchObject({ ok: true, value: { free: true } });
    expect(h.calls).toHaveLength(0);
  });

  it.each([
    ['without an email', { termsAccepted: true }, 'An email is required for free checkout'],
    ['without the terms', { email: 'buyer@example.test' }, 'Accepting the terms and privacy policy is required'],
  ] as const)('refuses a zero-price order %s', async (_case, patch, message) => {
    const h = harness({ priceCents: 0 });
    expect(await h.start({ productId: course.id, ...patch })).toMatchObject({ ok: false, error: { code: 'validation', message } });
    expect(h.calls).toHaveLength(0);
  });

  it('completes a zero-price order with the email and terms from the page and no Stripe session', async () => {
    const h = harness({ priceCents: 0 });
    expect(await h.start({ productId: course.id, email: 'buyer@example.test', termsAccepted: true })).toMatchObject({ ok: true, value: { free: true } });
    expect(h.calls).toHaveLength(0);
  });

  it('refuses terms text longer than Stripe accepts', async () => {
    const h = harness();
    expect(await h.start({ productId: course.id }, { ...stripeTerms, termsAcceptanceMessage: 'x'.repeat(1201) }))
      .toMatchObject({ ok: false, error: { code: 'validation', message: 'Checkout terms acceptance text exceeds 1200 characters' } });
    expect(h.calls).toHaveLength(0);
  });
});

describe('a checkout whose terms the page collects', () => {
  it('keeps requiring an email for every coupon and sends no Stripe terms', async () => {
    const h = harness({ coupon: coupon({}) });
    expect(await h.start({ productId: course.id, couponCode: 'SAVE' }, null))
      .toMatchObject({ ok: false, error: { code: 'validation', message: 'An email is required to use a coupon' } });
    expect((await h.start({ productId: course.id, couponCode: 'SAVE', email: 'buyer@example.test' }, null)).ok).toBe(true);
    expect(h.calls[0]).not.toHaveProperty('stripeTerms');
  });

  it('completes a zero-price order without terms on the page', async () => {
    const h = harness({ priceCents: 0 });
    expect(await h.start({ productId: course.id, email: 'buyer@example.test' }, null)).toMatchObject({ ok: true, value: { free: true } });
  });
});
