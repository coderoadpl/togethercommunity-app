import { describe, expect, it, vi } from 'vitest';

import {
  FREE_ORDER_DELIVERY_UNAVAILABLE,
  ok,
  type CheckoutSnapshot,
  type Coupon,
  type CouponCheckoutSession,
  type Order,
  type Product,
  type ShippingRate,
  type Tenant,
  type TenantSecret,
  type TenantSettings,
} from '#core/domain/index.js';
import type { CheckoutDeps, PaymentProvider, PublicRateLimitRepository } from '#core/server/index.js';

import { createCheckoutSession, startCheckoutSession, validateCheckoutSelection } from './checkout.js';
import { validateCartSelection } from './checkout-cart.js';
import { createPickupPointDirectoryFake, TEST_PICKUP_POINTS } from '../testing/pickup-point-fake.js';
import { createStockRepositoryFake } from '../testing/stock-fake.js';
import { captureCheckoutSelection } from './checkout-lines.js';
import { createDirectSalesLinkCheckout } from './direct-sales-link-checkout.js';
import { PICKUP_POINT_LOOKUP_BUDGET_SCOPE, withPickupPointLookupBudget } from './pickup-points.js';

const now = '2026-11-05T12:00:00.000Z';
const tenant: Tenant = { id: 'tenant-a', slug: 'alpha', name: 'Alpha', status: 'active', plan: 'hosted', contentVersion: 1 };

const accessory: Product = {
  id: 'accessory', tenantId: tenant.id, type: 'physical', slug: 'accessory', title: 'Printed accessory', description: '',
  coverUrl: null, priceCents: 4900, currency: 'PLN', published: true, visibility: 'listed', salesChannel: 'any', deliveryMethod: 'shipping',
  accessItems: [], legacyId: null, vatRate: 23, createdAt: now,
};
const course: Product = { ...accessory, id: 'course', slug: 'course', title: 'Course', type: 'course', deliveryMethod: 'pickup' };

const rates: ShippingRate[] = [
  { id: 'locker', label: 'Parcel locker', amountCents: 1499, vatRatePercent: 23, carrier: 'inpost', pickupPoint: 'inpost_locker', active: true, deliveryEstimateDays: { min: 1, max: 2 } },
  { id: 'courier', label: 'Courier', amountCents: 1999, vatRatePercent: 8, carrier: 'other', pickupPoint: 'none', active: true },
  { id: 'inpost-courier', label: 'InPost courier', amountCents: 1999, vatRatePercent: 23, carrier: 'inpost', pickupPoint: 'none', active: true },
  { id: 'retired', label: 'Retired option', amountCents: 999, vatRatePercent: 23, carrier: 'other', pickupPoint: 'none', active: false },
];

const settings: TenantSettings = {
  name: 'Alpha', billingPortalUrl: null, bunnyStreamLibraryId: null, bunnyStreamCdnHostname: null, logoUrl: null,
  logoDarkUrl: null, accentColor: null, accentLight: null, faviconUrl: null, supportEmail: null, supportUrl: null,
  termsUrl: 'https://alpha.example.com/terms', privacyUrl: 'https://alpha.example.com/privacy', defaultHomeSpaceId: null,
  socialLinks: [], signInNotice: { enabled: false, text: '' }, ogTitle: null, ogDescription: null, ogImageUrl: null,
  shippingRates: rates, inpostGeowidgetToken: null,
};

const secret = (key: TenantSecret['key']): TenantSecret => ({
  id: key, tenantId: tenant.id, key, ciphertext: 'ciphertext', iv: 'iv', authTag: 'tag', maskedPreview: '••••test', updatedAt: now,
});

const harness = (catalog: Product[] = [accessory, course], productIds: string[] = [accessory.id]) => {
  const snapshots: CheckoutSnapshot[] = [];
  const orders: Order[] = [];
  const calls: Parameters<PaymentProvider['createCheckoutSession']>[0][] = [];
  const pickupPoints = createPickupPointDirectoryFake();
  const link = {
    id: 'link-1', tenantId: tenant.id, slug: 'collection', title: 'Collection', heading: 'Collection', description: '',
    productIds, active: true, listed: false, validFrom: null, validTo: null, createdAt: now, updatedAt: now, revision: 1,
  };
  const deps: CheckoutDeps = {
    products: {
      listByTenant: async () => catalog, listPublishedByTenant: async () => catalog,
      findById: async (_tenantId, id) => catalog.find((item) => item.id === id) ?? null,
      create: async () => 'created', updateAccessItems: async () => null, setPublished: async () => undefined, bumpContentVersion: async () => undefined,
    },
    prices: {
      listByProduct: async () => [],
      listActiveByProducts: async (_tenantId, ids) => catalog.filter((item) => ids.includes(item.id)).map((item) => ({
        id: `price-${item.id}`, tenantId: tenant.id, productId: item.id, kind: 'one_time', interval: null, amountCents: item.priceCents, currency: 'PLN', active: true, createdAt: now,
      })),
      findById: async () => null, create: async () => undefined, setActive: async () => null,
    },
    tenantSecrets: {
      listByTenant: async () => [], findByKey: async (_tenantId, key) => secret(key), upsert: async (_tenantId, value) => value,
      upsertMany: async (_tenantId, values) => [...values], delete: async () => false,
    },
    tenants: {
      findById: async () => tenant, findBySlug: async () => tenant, findSole: async () => tenant,
      findSettings: async () => settings, changeSettings: async () => null,
      createTenantWithOwnerGrant: async () => tenant, hasAny: async () => true,
    },
    salesLinks: {
      list: async () => [link], findById: async () => link, findBySlug: async () => link,
      save: async (_tenantId, value) => ok(value), delete: async () => ok(undefined),
    },
    checkoutSnapshots: {
      findByProviderSession: async () => null,
      create: async (_tenantId, snapshot) => { snapshots.push(snapshot); },
      attachProviderSession: async () => undefined,
      findById: async () => snapshots[0] ?? null,
    },
    orders: {
      create: async (_tenantId, order) => { orders.push(order); }, completeTestCheckout: async () => null,
      list: async () => ({ orders: [], total: 0 }), revenueSince: async () => [], countSince: async () => 0, listPaidWithoutGrant: async () => [],
    },
    ids: { nextId: () => 'snapshot-1' },
    clock: { nowIso: () => now },
    pickupPoints,
    payment: {
      test: async () => ok({ code: 'payment.available', message: 'Payment is available.' }),
      createCheckoutSession: async (input) => { calls.push(input); return ok({ url: 'https://checkout.stripe.test/session', sessionId: 'cs_live_shipping' }); },
      expireCheckoutSession: async () => ok({ expired: true }),
      cancelSubscription: async () => ok({ canceled: true, alreadySettled: false }),
      verifyWebhookEvent: async () => ok({ id: 'evt-1', type: 'ignored', objectId: null, checkoutSession: null }),
    },
  };
  return { deps, calls, snapshots, orders, link, pickupPoints };
};

const fullCoupon: Coupon = {
  id: 'coupon-full', tenantId: tenant.id, code: 'GIFT', kind: 'percent', value: 100, scope: { kind: 'all' }, appliesTo: 'both',
  recurringDuration: 'first_invoice', startsAt: null, endsAt: null, maxRedemptions: null, maxRedemptionsPerMember: null,
  status: 'active', partnerLabel: null, stripeCouponId: null, stripePromotionCodeId: null, createdAt: now,
};

const freeRate: ShippingRate = { id: 'free', label: 'Free delivery', amountCents: 0, vatRatePercent: 23, carrier: 'other', pickupPoint: 'none', active: true };

const withCoupon = (h: ReturnType<typeof harness>) => {
  const couponSessions: CouponCheckoutSession[] = [];
  h.deps.coupons = { findByCode: async () => fullCoupon, findById: async () => fullCoupon, cacheStripeIds: async () => fullCoupon };
  h.deps.couponRedemptions = { counts: async () => ({ total: 0, member: 0 }), createOrderAndClaim: async () => true };
  h.deps.couponCheckoutSessions = {
    create: async (_tenantId, session) => { couponSessions.push(session); },
    attachProviderSession: async () => undefined,
    findById: async () => null,
  };
  h.deps.priceHistory = { lowestSince: async () => accessory.priceCents };
  h.deps.payment = { ...h.deps.payment, ensureCouponPromotion: async () => ok({ stripeCouponId: 'stripe-coupon', stripePromotionCodeId: 'promotion-gift' }) };
  return { ...h, couponSessions };
};

const withFreeRate = (h: ReturnType<typeof harness>) => {
  if (h.deps.tenants !== undefined) h.deps.tenants.findSettings = async () => ({ ...settings, shippingRates: [...rates, freeRate] });
  return h;
};

describe('checkout delivery selection', () => {
  it.each([
    ['missing for a shipped product', accessory.id, undefined, 'shipping_required'],
    ['given for a product collected in person', course.id, { rateId: 'courier' }, 'validation'],
    ['an unknown rate', accessory.id, { rateId: 'drone' }, 'validation'],
    ['an inactive rate', accessory.id, { rateId: 'retired' }, 'validation'],
    ['a locker rate without a locker', accessory.id, { rateId: 'locker' }, 'validation'],
    ['a courier rate with a locker', accessory.id, { rateId: 'courier', pickupPoint: { provider: 'inpost' as const, code: 'WAW01M' } }, 'validation'],
    ['a malformed locker code', accessory.id, { rateId: 'locker', phone: '+48 500 000 000', pickupPoint: { provider: 'inpost' as const, code: 'WAW-01' } }, 'validation'],
    ['a too short locker code', accessory.id, { rateId: 'locker', phone: '+48 500 000 000', pickupPoint: { provider: 'inpost' as const, code: 'ab1' } }, 'validation'],
  ])('rejects a delivery selection that is %s', async (_case, productId, shipping, code) => {
    const h = harness();
    const result = await validateCheckoutSelection(tenant.id, { productId, ...(shipping === undefined ? {} : { shipping }) }, h.deps);
    expect(result).toMatchObject({ ok: false, error: { code } });
  });

  it('reports a sold-out shipped product as sold out before validating the delivery, and writes nothing', async () => {
    const h = harness();
    const stock = createStockRepositoryFake();
    stock.track(tenant.id, accessory.id, 0);
    h.deps.stock = stock.repository;
    expect(await createCheckoutSession(tenant, 'https://alpha.example.com', { productId: accessory.id }, h.deps))
      .toMatchObject({ ok: false, error: { code: 'sold_out' } });
    expect(h.snapshots).toEqual([]);
    expect(h.calls).toEqual([]);
    expect(stock.events).toEqual([]);
  });

  it('normalizes the locker code, freezes the rate and stores the carrier name and address over the ones the client sent', async () => {
    const h = harness();
    const result = await validateCheckoutSelection(tenant.id, {
      productId: accessory.id, shipping: { rateId: 'locker', phone: '+48 500 000 000', pickupPoint: { provider: 'inpost', code: ' waw01m ', name: 'Locker', address: 'Somewhere else 9' } },
    }, h.deps);
    expect(result).toMatchObject({ ok: true, value: { shipping: {
      rateId: 'locker', label: 'Parcel locker', amountCents: 1499, vatRatePercent: 23, carrier: 'inpost', allowedCountries: ['PL'],
    } } });
    expect(result.ok && result.value.shipping?.pickupPoint).toEqual({
      provider: 'inpost', code: 'WAW01M', name: 'Next to the main entrance', address: 'Main Street 1, 00-001 Warsaw',
    });
    expect(h.pickupPoints.lookups).toEqual(['WAW01M']);
  });

  it.each([
    ['a code the carrier does not know', TEST_PICKUP_POINTS.notFound, 'not_found', 'No InPost parcel locker has this code'],
    ['a point that cannot hold parcels for collection', TEST_PICKUP_POINTS.wrongType, 'not_usable', 'This InPost point cannot hold parcels for collection'],
    ['a locker that is not operating', TEST_PICKUP_POINTS.notOperating, 'not_operating', 'This InPost parcel locker is not operating'],
  ])('refuses %s with a translatable reason', async (_case, code, reason, message) => {
    const h = harness();
    const result = await validateCheckoutSelection(tenant.id, {
      productId: accessory.id, shipping: { rateId: 'locker', phone: '+48 500 000 000', pickupPoint: { provider: 'inpost', code } },
    }, h.deps);
    expect(result).toEqual({ ok: false, error: { code: 'validation', message, details: { pickupPointReason: reason } } });
  });

  it('accepts the typed code and marks it unverified when the carrier cannot answer', async () => {
    const h = harness();
    const result = await validateCheckoutSelection(tenant.id, {
      productId: accessory.id, shipping: { rateId: 'locker', phone: '+48 500 000 000', pickupPoint: { provider: 'inpost', code: TEST_PICKUP_POINTS.unavailable, name: 'Typed', address: 'Typed street 1' } },
    }, h.deps);
    expect(result.ok && result.value.shipping?.pickupPoint).toEqual({
      provider: 'inpost', code: TEST_PICKUP_POINTS.unavailable, name: 'Typed', address: 'Typed street 1', verified: false,
    });
  });

  it('accepts the typed code unverified when the carrier answers with a status it has not documented', async () => {
    const h = harness();
    const result = await createCheckoutSession(tenant, 'https://alpha.example.com', {
      productId: accessory.id, email: 'buyer@example.org', shipping: { rateId: 'locker', phone: '+48 500 000 000', pickupPoint: { provider: 'inpost', code: TEST_PICKUP_POINTS.unknownStatus } },
    }, h.deps);
    expect(result).toMatchObject({ ok: true });
    expect(h.pickupPoints.lookups).toEqual([TEST_PICKUP_POINTS.unknownStatus]);
    expect(h.snapshots[0]?.shipping?.pickupPoint).toEqual({ provider: 'inpost', code: TEST_PICKUP_POINTS.unknownStatus, name: null, address: null, verified: false });
  });

  it('marks the locker unverified when no carrier directory is configured', async () => {
    const h = harness();
    delete h.deps.pickupPoints;
    const result = await validateCheckoutSelection(tenant.id, {
      productId: accessory.id, shipping: { rateId: 'locker', phone: '+48 500 000 000', pickupPoint: { provider: 'inpost', code: 'WAW01M' } },
    }, h.deps);
    expect(result.ok && result.value.shipping?.pickupPoint).toEqual({ provider: 'inpost', code: 'WAW01M', name: null, address: null, verified: false });
  });

  it('does not ask the carrier for a courier rate or a coupon preview', async () => {
    const h = harness();
    expect(await validateCheckoutSelection(tenant.id, { productId: accessory.id, shipping: { rateId: 'courier' } }, h.deps)).toMatchObject({ ok: true });
    expect(await validateCheckoutSelection(tenant.id, {
      productId: accessory.id, shipping: { rateId: 'locker', phone: '+48 500 000 000', pickupPoint: { provider: 'inpost', code: TEST_PICKUP_POINTS.notFound } },
    }, h.deps, { shipping: 'ignore' })).toMatchObject({ ok: true });
    expect(h.pickupPoints.lookups).toEqual([]);
  });

  it('ignores delivery for coupon previews', async () => {
    const h = harness();
    expect(await validateCheckoutSelection(tenant.id, { productId: accessory.id }, h.deps, { shipping: 'ignore' })).toMatchObject({ ok: true });
  });
});

describe('checkout with shipping', () => {
  it.each([undefined, '+44 7700 900000', '50000000'])('rejects the locker phone %s before creating a payment session', async (phone) => {
    const h = harness();
    const result = await createCheckoutSession(tenant, 'https://alpha.example.com', {
      productId: accessory.id, email: 'buyer@example.org', shipping: { rateId: 'locker', phone, pickupPoint: { provider: 'inpost', code: 'ABC01M' } },
    }, h.deps);
    expect(result).toMatchObject({ ok: false, error: { code: 'locker_phone_invalid' } });
    expect(h.calls).toEqual([]);
    expect(h.snapshots).toEqual([]);
    expect(h.pickupPoints.lookups).toEqual([]);
  });

  it.each([undefined, '+44 7700 900000'])('rejects the InPost courier phone %s before writing a snapshot or creating a payment session', async (phone) => {
    const h = harness();
    const result = await createCheckoutSession(tenant, 'https://alpha.example.com', {
      productId: accessory.id, email: 'buyer@example.org', shipping: { rateId: 'inpost-courier', phone },
    }, h.deps);
    expect(result).toMatchObject({ ok: false, error: {
      code: 'locker_phone_invalid', message: 'InPost deliveries need a Polish mobile number (9 digits, optional +48)',
    } });
    expect(h.calls).toEqual([]);
    expect(h.snapshots).toEqual([]);
  });

  it('keeps Stripe phone collection during the rollback window and freezes the canonical phone for an InPost courier', async () => {
    const h = harness();
    const result = await createCheckoutSession(tenant, 'https://alpha.example.com', {
      productId: accessory.id, email: 'buyer@example.org', shipping: { rateId: 'inpost-courier', phone: '+48 500 000 000' },
    }, h.deps);
    expect(result.ok).toBe(true);
    expect(h.calls[0]?.shipping?.phone).toBe(true);
    expect(h.snapshots[0]?.shipping).toMatchObject({ rateId: 'inpost-courier', pickupPoint: null, phone: '+48500000000' });
    expect(h.pickupPoints.lookups).toEqual([]);
  });

  it.each([undefined, '+44 7700 900000'])('keeps Stripe phone collection and ignores input phone %s for another carrier', async (phone) => {
    const h = harness();
    const result = await createCheckoutSession(tenant, 'https://alpha.example.com', {
      productId: accessory.id, email: 'buyer@example.org', shipping: { rateId: 'courier', phone },
    }, h.deps);
    expect(result.ok).toBe(true);
    expect(h.calls[0]?.shipping?.phone).toBe(true);
    expect(h.snapshots[0]?.shipping).not.toHaveProperty('phone');
  });

  it('sends the fee as one Stripe shipping option and appends a shipping line last to the snapshot', async () => {
    const h = harness();
    const result = await createCheckoutSession(tenant, 'https://alpha.example.com', {
      productId: accessory.id, email: 'buyer@example.org', shipping: { rateId: 'locker', phone: '+48 500 000 000', pickupPoint: { provider: 'inpost', code: 'WAW01M' } },
    }, h.deps);
    expect(result).toMatchObject({ ok: true, value: { free: false } });
    expect(h.calls).toHaveLength(1);
    expect(h.calls[0]).toMatchObject({
      priceCents: 4900,
      shipping: { allowedCountries: ['PL'], phone: true, option: { label: 'Parcel locker', amountCents: 1499, currency: 'PLN', deliveryEstimateDays: { min: 1, max: 2 } } },
    });
    expect(h.calls[0]).not.toHaveProperty('lines');
    expect(h.calls[0]).not.toHaveProperty('expiresAt');
    expect(h.snapshots[0]?.lines.at(-1)).toEqual({
      productId: 'shipping:locker', name: 'Parcel locker', productType: 'shipping', grossCents: 1499, netCents: 1219, vatCents: 280,
      vatRate: 23, vatExemptionBasis: null, vatExemptionBasisKind: null, issuedCount: null,
    });
    expect(h.snapshots[0]?.shipping).toEqual({
      rateId: 'locker', label: 'Parcel locker', amountCents: 1499, vatRatePercent: 23, carrier: 'inpost', phone: '+48500000000',
      pickupPoint: { provider: 'inpost', code: 'WAW01M', name: 'Next to the main entrance', address: 'Main Street 1, 00-001 Warsaw' }, allowedCountries: ['PL'],
    });
  });

  it('asks the carrier before writing any coupon session, stock reservation, snapshot or payment session', async () => {
    const h = withCoupon(harness());
    const stock = createStockRepositoryFake();
    stock.track(tenant.id, accessory.id, 5);
    h.deps.stock = stock.repository;
    const result = await createCheckoutSession(tenant, 'https://alpha.example.com', {
      productId: accessory.id, email: 'buyer@example.org', couponCode: 'GIFT',
      shipping: { rateId: 'locker', phone: '+48 500 000 000', pickupPoint: { provider: 'inpost', code: TEST_PICKUP_POINTS.notFound } },
    }, h.deps);
    expect(result).toMatchObject({ ok: false, error: { code: 'validation', details: { pickupPointReason: 'not_found' } } });
    expect(h.pickupPoints.lookups).toEqual([TEST_PICKUP_POINTS.notFound]);
    expect(h.snapshots).toEqual([]);
    expect(h.couponSessions).toEqual([]);
    expect(h.calls).toEqual([]);
    expect(stock.events).toEqual([]);
  });

  it('carries the unverified mark into the snapshot when the carrier is down', async () => {
    const h = harness();
    const result = await createCheckoutSession(tenant, 'https://alpha.example.com', {
      productId: accessory.id, email: 'buyer@example.org', shipping: { rateId: 'locker', phone: '+48 500 000 000', pickupPoint: { provider: 'inpost', code: TEST_PICKUP_POINTS.unavailable } },
    }, h.deps);
    expect(result).toMatchObject({ ok: true });
    expect(h.calls).toHaveLength(1);
    expect(h.snapshots[0]?.shipping?.pickupPoint).toEqual({ provider: 'inpost', code: TEST_PICKUP_POINTS.unavailable, name: null, address: null, verified: false });
  });

  it('keeps the shipping fee out of the bundle line items', async () => {
    const h = harness([accessory, course], [course.id, accessory.id]);
    const result = await createCheckoutSession(tenant, 'https://alpha.example.com', {
      productId: course.id, salesLinkId: h.link.id, shipping: { rateId: 'courier' },
    }, h.deps);
    expect(result).toMatchObject({ ok: true });
    expect(h.calls[0]?.lines?.map((line) => line.productId)).toEqual([course.id, accessory.id]);
    expect(h.calls[0]?.shipping?.option).toEqual({ label: 'Courier', amountCents: 1999, currency: 'PLN' });
    expect(h.snapshots[0]?.lines.map((line) => line.productType)).toEqual(['course', 'physical', 'shipping']);
    expect(h.snapshots[0]?.lines.at(-1)).toMatchObject({ grossCents: 1999, netCents: 1851, vatCents: 148, vatRate: 8 });
  });

  it('records a staff test order with the shipping line and the shipped total', async () => {
    const h = harness();
    const selection = await validateCheckoutSelection(tenant.id, { productId: accessory.id, shipping: { rateId: 'courier' } }, h.deps);
    if (!selection.ok) throw new Error('Expected a valid selection');
    const result = await startCheckoutSession(tenant, 'https://alpha.example.com', { productId: accessory.id, email: 'staff@example.org', shipping: { rateId: 'courier' } },
      selection.value, h.deps, undefined, { mode: 'test', memberId: 'staff-member' });
    expect(result).toMatchObject({ ok: true });
    expect(h.orders).toMatchObject([{ mode: 'test', status: 'pending', amountCents: 6899, lines: [{ productType: 'physical' }, { productType: 'shipping', grossCents: 1999 }] }]);
  });

  it('refuses a free product with a free delivery option before writing a snapshot', async () => {
    const h = withFreeRate(harness([{ ...accessory, priceCents: 0 }]));
    const result = await createCheckoutSession(tenant, 'https://alpha.example.com', { productId: accessory.id, email: 'buyer@example.org', shipping: { rateId: 'free' } }, h.deps);
    expect(result).toEqual({ ok: false, error: { code: 'validation', message: FREE_ORDER_DELIVERY_UNAVAILABLE } });
    expect(FREE_ORDER_DELIVERY_UNAVAILABLE).toBe('Delivery is not available for free orders');
    expect(h.calls).toHaveLength(0);
    expect(h.snapshots).toHaveLength(0);
  });

  it('refuses a fully discounted product with a free delivery option before writing any checkout rows', async () => {
    const h = withCoupon(withFreeRate(harness()));
    const result = await createCheckoutSession(tenant, 'https://alpha.example.com', {
      productId: accessory.id, email: 'buyer@example.org', couponCode: 'GIFT', shipping: { rateId: 'free' },
    }, h.deps);
    expect(result).toEqual({ ok: false, error: { code: 'validation', message: FREE_ORDER_DELIVERY_UNAVAILABLE } });
    expect(h.calls).toHaveLength(0);
    expect(h.snapshots).toHaveLength(0);
    expect(h.couponSessions).toHaveLength(0);
  });

  it('sends a fully discounted product with a paid delivery option to Stripe for the shipping fee', async () => {
    const h = withCoupon(harness());
    const result = await createCheckoutSession(tenant, 'https://alpha.example.com', {
      productId: accessory.id, email: 'buyer@example.org', couponCode: 'GIFT', shipping: { rateId: 'courier' },
    }, h.deps);
    expect(result).toMatchObject({ ok: true, value: { free: false, coupon: { finalCents: 0, discountCents: 4900 } } });
    expect(h.calls).toHaveLength(1);
    expect(h.calls[0]).toMatchObject({
      promotionCodeId: 'promotion-gift',
      priceCents: 4900,
      cancelUrl: expect.stringContaining('&code=GIFT'),
      shipping: { allowedCountries: ['PL'], phone: true, option: { label: 'Courier', amountCents: 1999, currency: 'PLN' } },
    });
    expect(h.snapshots).toHaveLength(1);
    expect(h.couponSessions).toHaveLength(1);
  });

  it.each([
    ['a physical product', accessory],
    ['a product of another type marked for shipping', { ...accessory, type: 'course' as const }],
  ])('refuses %s with a recurring price before any Stripe call or checkout row', async (_case, product) => {
    const h = harness([product, course]);
    h.deps.prices = { ...h.deps.prices, findById: async (_tenantId, id) => id === 'price-monthly' ? {
      id, tenantId: tenant.id, productId: accessory.id, kind: 'recurring', interval: 'month', amountCents: 4900, currency: 'PLN', active: true, createdAt: now,
    } : null };
    const result = await createCheckoutSession(tenant, 'https://alpha.example.com', {
      productId: accessory.id, priceId: 'price-monthly', email: 'buyer@example.org', shipping: { rateId: 'courier' },
    }, h.deps);
    expect(result).toEqual({ ok: false, error: { code: 'validation', message: 'Physical products require a one-time price' } });
    expect(h.calls).toHaveLength(0);
    expect(h.snapshots).toHaveLength(0);
    expect(h.orders).toHaveLength(0);
  });

  it('refuses the direct Stripe handoff when any sales-link product needs shipping', async () => {
    const h = harness([accessory, course], [course.id, accessory.id]);
    const result = await createDirectSalesLinkCheckout(tenant, 'https://alpha.example.com', {
      slug: h.link.slug, termsAcceptanceMessage: () => 'I accept the terms.', couponDisclosureMessage: () => 'Lowest price in the last 30 days.',
    }, { ...h.deps, logger: { warn: vi.fn(), error: vi.fn() } });
    expect(result).toMatchObject({ ok: false, error: { code: 'validation', message: 'This sales link requires the workspace checkout page' } });
    expect(h.calls).toHaveLength(0);
  });

  it('refuses the direct Stripe handoff when a collected sales-link product carries product safety information', async () => {
    const collected: Product = {
      ...accessory, deliveryMethod: 'pickup',
      compliance: { manufacturerName: 'Maker', manufacturerAddress: 'Main Street 1, Warsaw', manufacturerEmail: 'maker@example.com', manufacturerOutsideEu: false, modelIdentifier: 'M-1', safetyWarnings: '' },
    };
    const h = harness([collected, course], [course.id, collected.id]);
    const result = await createDirectSalesLinkCheckout(tenant, 'https://alpha.example.com', {
      slug: h.link.slug, termsAcceptanceMessage: () => 'I accept the terms.', couponDisclosureMessage: () => 'Lowest price in the last 30 days.',
    }, { ...h.deps, logger: { warn: vi.fn(), error: vi.fn() } });
    expect(result).toMatchObject({ ok: false, error: { code: 'validation', message: 'This sales link requires the workspace checkout page' } });
    expect(h.calls).toHaveLength(0);
  });
});

describe('checkout selection capture', () => {
  it('returns a validation error instead of throwing for a shipping selection the snapshot cannot store', async () => {
    const create = vi.fn(async () => undefined);
    const result = await captureCheckoutSelection(tenant.id, {
      product: accessory, price: null,
      shipping: { rateId: 'locker', label: 'Parcel locker', amountCents: 1499, vatRatePercent: 23, carrier: 'inpost', pickupPoint: null, allowedCountries: [] },
    }, {
      checkoutSnapshots: { create, attachProviderSession: async () => undefined, findById: async () => null, findByProviderSession: async () => null },
      ids: { nextId: () => 'snapshot-1' }, clock: { nowIso: () => now },
    });
    expect(result).toEqual({ ok: false, error: { code: 'validation', message: 'Checkout shipping selection is invalid' } });
    expect(create).not.toHaveBeenCalled();
  });
});

describe('parcel locker lookup on every checkout path', () => {
  const cartAccessory: Product = { ...accessory, id: '8d0f6c7e-2b1a-4c3d-9e8f-0a1b2c3d4e5f' };
  const locker = (code: string) => ({ rateId: 'locker', phone: '+48 500 000 000', pickupPoint: { provider: 'inpost' as const, code } });
  const paths = {
    'single product': async (h: ReturnType<typeof harness>, code: string) =>
      validateCheckoutSelection(tenant.id, { productId: accessory.id, shipping: locker(code) }, h.deps),
    'sales link': async (h: ReturnType<typeof harness>, code: string) =>
      validateCheckoutSelection(tenant.id, { productId: course.id, salesLinkId: h.link.id, shipping: locker(code) }, h.deps),
    cart: async (h: ReturnType<typeof harness>, code: string) =>
      validateCartSelection(tenant.id, { lines: [{ productId: cartAccessory.id, quantity: 1 }], shipping: locker(code) }, h.deps),
  };

  it.each(Object.entries(paths))('%s rejects an unknown code and stores the canonical point for a known one', async (_path, select) => {
    const h = harness([accessory, course, cartAccessory], [course.id, accessory.id]);
    expect(await select(h, 'missing1')).toMatchObject({ ok: false, error: { code: 'validation', details: { pickupPointReason: 'not_found' } } });
    const accepted = await select(h, 'waw01m');
    expect(accepted.ok && accepted.value.shipping?.pickupPoint).toEqual({
      provider: 'inpost', code: 'WAW01M', name: 'Next to the main entrance', address: 'Main Street 1, 00-001 Warsaw',
    });
    expect(h.pickupPoints.lookups).toEqual(['MISSING1', 'WAW01M']);
  });

  const budgeted = (h: ReturnType<typeof harness>, limit: number) => {
    const claims: string[] = [];
    const buckets: PublicRateLimitRepository = {
      claim: async (input) => { claims.push(input.scope); return claims.length <= input.limit; },
      purgeExpired: async () => 0,
    };
    h.deps.pickupPoints = withPickupPointLookupBudget(h.pickupPoints, { buckets, clock: { nowIso: () => now }, window: { limit, windowMs: 60_000 } });
    return claims;
  };

  it.each(Object.entries(paths))('%s draws on the platform-wide lookup budget and accepts the code unverified once it is spent', async (_path, select) => {
    const h = harness([accessory, course, cartAccessory], [course.id, accessory.id]);
    const claims = budgeted(h, 1);
    const verified = await select(h, 'WAW01M');
    expect(verified.ok && verified.value.shipping?.pickupPoint).toEqual({
      provider: 'inpost', code: 'WAW01M', name: 'Next to the main entrance', address: 'Main Street 1, 00-001 Warsaw',
    });
    const unverified = await select(h, 'WAW01M');
    expect(unverified.ok && unverified.value.shipping?.pickupPoint).toEqual({ provider: 'inpost', code: 'WAW01M', name: null, address: null, verified: false });
    expect(claims).toEqual([PICKUP_POINT_LOOKUP_BUDGET_SCOPE, PICKUP_POINT_LOOKUP_BUDGET_SCOPE]);
    expect(h.pickupPoints.lookups).toEqual(['WAW01M']);
  });

  it('does not draw on the lookup budget for a selection refused before the carrier is asked', async () => {
    const h = harness();
    const claims = budgeted(h, 1);
    expect(await validateCheckoutSelection(tenant.id, { productId: accessory.id, shipping: locker('WAW-01') }, h.deps)).toMatchObject({ ok: false });
    expect(await validateCheckoutSelection(tenant.id, { productId: accessory.id, shipping: { rateId: 'courier' } }, h.deps)).toMatchObject({ ok: true });
    expect(claims).toEqual([]);
  });
});
