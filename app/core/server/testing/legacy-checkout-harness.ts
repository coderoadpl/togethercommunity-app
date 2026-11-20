import {
  ok,
  tenantSettingsSchema,
  type CheckoutConsentCapture,
  type CheckoutSnapshot,
  type Member,
  type Order,
  type ProcessedPaymentEvent,
  type Product,
  type ProductGrant,
  type ProductPrice,
  type SalesLink,
  type Tenant,
  type TenantSecret,
  type TermsConsent,
} from '#core/domain/index.js';

import type { CheckoutSnapshotRepository } from '../checkout-snapshot-ports.js';
import type { AutoInvoiceJob, CheckoutConsentJob, PaymentProvider, TenantRepository } from '../ports.js';
import type { StockRepository } from '../stock-ports.js';
import type { CheckoutDeps } from '../usecases/checkout.js';
import type { StripeWebhookDeps } from '../usecases/stripe-webhook.js';
import { InMemoryConsentConfirmationTokenRepository, InMemoryMarketingConsentRepository } from './marketing-fakes.js';
import { createOrderRefundJobFake } from './order-refund-job-fake.js';
import { createStockRepositoryFake } from './stock-fake.js';
import { createInMemoryTenantDomainRepository } from './tenant-domain-fakes.js';
import { inMemoryChangeSettings } from './tenant-settings-fake.js';

export const legacyNow = '2026-11-15T10:00:00.000Z';
export const legacyBaseUrl = 'https://acme.togethercommunity.app';
export const legacyTenant: Tenant = { id: 'tenant-a', slug: 'acme', name: 'Acme', status: 'active', plan: 'hosted', contentVersion: 1 };

const productBase: Pick<Product, 'tenantId' | 'description' | 'coverUrl' | 'currency' | 'visibility' | 'salesChannel' | 'published' | 'accessItems' | 'legacyId' | 'createdAt'> = {
  tenantId: legacyTenant.id, description: '', coverUrl: null, currency: 'PLN', visibility: 'listed', salesChannel: 'any', published: true,
  accessItems: [], legacyId: null, createdAt: '2026-11-01T09:00:00.000Z',
};

const legacyCourse: Product = { ...productBase, id: 'course-1', type: 'course', slug: 'course-one', title: 'Course One', priceCents: 4900, deliveryMethod: 'pickup', vatRate: 23 };
const legacyPrinted: Product = { ...productBase, id: 'printed-1', type: 'physical', slug: 'printed-book', title: 'Printed book', priceCents: 2500, deliveryMethod: 'shipping', vatRate: 5 };
const legacyPoster: Product = { ...productBase, id: 'poster-1', type: 'physical', slug: 'poster', title: 'Poster', priceCents: 3500, deliveryMethod: 'pickup', vatRate: 8 };
export const legacyProducts: readonly Product[] = [legacyCourse, legacyPrinted, legacyPoster];

const priceFor = (product: Product, id: string, amountCents: number): ProductPrice => ({
  id, tenantId: legacyTenant.id, productId: product.id, kind: 'one_time', interval: null, amountCents,
  currency: 'PLN', active: true, createdAt: '2026-11-01T09:00:00.000Z',
});

const legacyPrices: readonly ProductPrice[] = [
  priceFor(legacyCourse, 'price-course-1', 4900),
  priceFor(legacyPrinted, 'price-printed-1', 2100),
  priceFor(legacyPoster, 'price-poster-1', 3500),
];

const legacySalesLink: SalesLink = {
  id: 'link-1', tenantId: legacyTenant.id, slug: 'collection', title: 'Collection', heading: 'Collection', description: '',
  productIds: [legacyCourse.id, legacyPoster.id], active: true, listed: false, validFrom: null, validTo: null,
  cancelReturnUrl: null, createdAt: '2026-11-01T09:00:00.000Z', updatedAt: '2026-11-01T09:00:00.000Z', revision: 1,
};

const legacySettings = tenantSettingsSchema.parse({
  name: 'Acme', billingPortalUrl: null, bunnyStreamLibraryId: null, defaultLanguage: 'pl',
  termsUrl: 'https://acme.togethercommunity.app/terms', privacyUrl: 'https://acme.togethercommunity.app/privacy',
  accentColor: '#112233',
  shippingRates: [
    { id: 'courier', label: 'Courier', amountCents: 1999, vatRatePercent: 8, carrier: 'other', pickupPoint: 'none', active: true, deliveryEstimateDays: { min: 1, max: 3 } },
  ],
});

const secret = (key: TenantSecret['key']): TenantSecret => ({
  id: key, tenantId: legacyTenant.id, key, ciphertext: key, iv: 'iv', authTag: 'tag', maskedPreview: '••••', updatedAt: legacyNow,
});

export const createLegacyCheckoutHarness = (options: {
  stock?: StockRepository;
  checkoutSnapshots?: CheckoutSnapshotRepository;
} = {}) => {
  const stockFake = createStockRepositoryFake();
  const refundJobs = createOrderRefundJobFake();
  const stock = options.stock ?? stockFake.repository;
  const snapshotRows: CheckoutSnapshot[] = [];
  const checkoutSnapshots: CheckoutSnapshotRepository = options.checkoutSnapshots ?? {
    create: async (_tenantId, snapshot) => { snapshotRows.push(structuredClone(snapshot)); },
    attachProviderSession: async (tenantId, id, providerSessionId) => {
      const row = snapshotRows.find((item) => item.tenantId === tenantId && item.id === id);
      if (row !== undefined && row.providerSessionId == null) row.providerSessionId = providerSessionId;
    },
    findById: async (tenantId, id) => structuredClone(snapshotRows.find((item) => item.tenantId === tenantId && item.id === id) ?? null),
    findByProviderSession: async (tenantId, providerSessionId) => structuredClone(snapshotRows.find((item) => item.tenantId === tenantId && item.providerSessionId === providerSessionId) ?? null),
  };
  const paymentInputs: Parameters<PaymentProvider['createCheckoutSession']>[0][] = [];
  const captures = new Map<string, CheckoutConsentCapture>();
  const members = new Map<string, Member>();
  const grants = new Map<string, ProductGrant>();
  const orders: Order[] = [];
  const autoInvoiceJobs: AutoInvoiceJob[] = [];
  const consents: TermsConsent[] = [];
  const consentJobs: CheckoutConsentJob[] = [];
  const processed = new Map<string, { event: ProcessedPaymentEvent; workerId: string; done: boolean }>();
  const errors: string[] = [];
  const warnings: string[] = [];
  let checkoutSequence = 0;
  let sessionSequence = 0;
  let webhookSequence = 0;
  let clockNow = legacyNow;
  const clock = { nowIso: () => clockNow };

  const products: CheckoutDeps['products'] = {
    listByTenant: async () => [...legacyProducts],
    listPublishedByTenant: async () => [...legacyProducts],
    findById: async (tenantId, id) => legacyProducts.find((item) => item.tenantId === tenantId && item.id === id) ?? null,
    create: async () => 'created',
    updateAccessItems: async () => null,
    setPublished: async () => undefined,
    bumpContentVersion: async () => undefined,
  };
  const prices: CheckoutDeps['prices'] = {
    listByProduct: async (tenantId, productId) => legacyPrices.filter((item) => item.tenantId === tenantId && item.productId === productId),
    listActiveByProducts: async (tenantId, productIds) => legacyPrices.filter((item) => item.tenantId === tenantId && productIds.includes(item.productId)),
    findById: async (tenantId, id) => legacyPrices.find((item) => item.tenantId === tenantId && item.id === id) ?? null,
    create: async () => undefined,
    setActive: async () => null,
  };
  const tenants: TenantRepository = {
    findById: async () => legacyTenant,
    findBySlug: async () => legacyTenant,
    findSole: async () => legacyTenant,
    hasAny: async () => true,
    findSettings: async () => legacySettings,
    changeSettings: inMemoryChangeSettings(() => legacySettings),
    createTenantWithOwnerGrant: async () => legacyTenant,
  };

  const checkoutDeps: CheckoutDeps & { logger: { warn(message: string): void; error(message: string): void } } = {
    products,
    prices,
    tenants,
    tenantSecrets: {
      listByTenant: async () => [],
      findByKey: async (_tenantId, key) => secret(key),
      upsert: async (_tenantId, value) => value,
      upsertMany: async (_tenantId, values) => [...values],
      delete: async () => false,
    },
    secretCrypto: {
      encrypt: (plaintext) => ({ ciphertext: plaintext, iv: 'iv', authTag: 'tag' }),
      decrypt: (stored) => ok(stored.ciphertext.startsWith('stripe.test') ? 'rk_test_golden' : 'rk_live_golden'),
    },
    payment: {
      test: async () => ok({ code: 'payment.available', message: 'Payment is available.' }),
      createCheckoutSession: async (input) => {
        paymentInputs.push(structuredClone(input));
        sessionSequence += 1;
        const sessionId = `cs_live_golden${String(sessionSequence)}`;
        return ok({ url: `https://checkout.stripe.test/${sessionId}`, sessionId });
      },
      expireCheckoutSession: async () => ok({ expired: true }),
      cancelSubscription: async () => ok({ canceled: true, alreadySettled: false }),
      verifyWebhookEvent: async () => ok({ id: 'unused', type: 'ignored', objectId: null, checkoutSession: null }),
    },
    salesLinks: {
      list: async () => [legacySalesLink],
      findById: async (tenantId, id) => tenantId === legacyTenant.id && id === legacySalesLink.id ? legacySalesLink : null,
      findBySlug: async (tenantId, slug) => tenantId === legacyTenant.id && slug === legacySalesLink.slug ? legacySalesLink : null,
      save: async (_tenantId, link) => ok(link),
      delete: async () => ok(undefined),
    },
    checkoutSnapshots,
    stock,
    ids: { nextId: () => `checkout-id-${String(++checkoutSequence)}` },
    clock,
    logger: { warn: (message) => { warnings.push(message); }, error: (message) => { errors.push(message); } },
  };

  const checkoutConsentCaptures = {
    create: async (_tenantId: string, input: { id: string; capture: CheckoutConsentCapture }) => { captures.set(input.id, input.capture); },
    findById: async (_tenantId: string, id: string) => captures.get(id) ?? null,
  };
  const memberRepository: StripeWebhookDeps['members'] = {
    findById: async (tenantId, memberId) => members.get(`${tenantId}:${memberId}`) ?? null,
    findByEmail: async (tenantId, email) => [...members.values()].find((member) => member.tenantId === tenantId && member.email === email) ?? null,
    listWithProductIds: async () => [],
    create: async (tenantId, member) => { members.set(`${tenantId}:${member.id}`, member); },
    updateEmail: async () => null,
    updateLanguage: async () => null,
    updateVideoAutoplay: async () => null,
    updateDisplayName: async () => null,
    updateDmOptOut: async () => null,
    setBanned: async () => null,
  };
  const grantRepository: StripeWebhookDeps['grants'] = {
    findById: async (tenantId, grantId) => grants.get(`${tenantId}:${grantId}`) ?? null,
    findGrant: async (tenantId, memberId, productId, mode = 'live') =>
      [...grants.values()].find((grant) => grant.tenantId === tenantId && grant.memberId === memberId && grant.productId === productId && grant.mode === mode) ?? null,
    createGrant: async (tenantId, grant) => { grants.set(`${tenantId}:${grant.id}`, grant); return true; },
    setGrantWindow: async () => null,
    revokeGrant: async () => null,
    listForMemberWithProductNames: async () => [],
    listActiveForMember: async () => [],
    listGrantedProducts: async () => [],
  };
  const orderRepository: StripeWebhookDeps['orders'] = {
    completeTestCheckout: async () => null,
    create: async (_tenantId, order) => { orders.push(structuredClone(order)); },
    list: async () => ({ orders: [], total: 0 }),
    revenueSince: async () => [],
    countSince: async () => 0,
    listPaidWithoutGrant: async () => [],
  };
  const paymentRefunds: StripeWebhookDeps['paymentRefunds'] = {
    findOrderByProviderObjectIds: async (tenantId, ids, mode) => orders.find((order) => order.tenantId === tenantId &&
      (mode === undefined || order.mode === mode) &&
      Object.entries(ids).some(([key, value]) => order.providerObjectIds[key] === value)) ?? null,
    findLatestSubscriptionOrder: async () => null,
    listAccessRetainingOrdersForMemberProduct: async () => [],
    markOrderRefunded: async () => null,
    markOrderPartiallyRefunded: async () => null,
  };
  const emailOutbox: StripeWebhookDeps['emailOutbox'] = {
    enqueue: async (message) => ok({ id: message.id }),
    claimBatch: async () => ok([]),
    markSent: async () => ok(undefined),
    markFailed: async () => ok(undefined),
  };
  const processedPaymentEvents: StripeWebhookDeps['processedPaymentEvents'] = {
    claim: async (_tenantId, event, lease) => {
      const existing = processed.get(event.id);
      if (existing?.done === true) return 'processed';
      if (existing !== undefined) return 'in_progress';
      processed.set(event.id, { event, workerId: lease.workerId, done: false });
      return 'claimed';
    },
    finalize: async (_tenantId, eventId, workerId) => {
      const existing = processed.get(eventId);
      if (existing?.workerId === workerId) existing.done = true;
    },
    release: async (_tenantId, eventId, workerId) => {
      if (processed.get(eventId)?.workerId === workerId) processed.delete(eventId);
    },
  };
  const marketingConsents = new InMemoryMarketingConsentRepository();
  const confirmations = new InMemoryConsentConfirmationTokenRepository();
  const enrollmentTransaction: StripeWebhookDeps['enrollmentTransaction'] = {
    run: async (operation) => operation({ members: memberRepository, grants: grantRepository, emailOutbox }),
  };

  const webhookDeps: StripeWebhookDeps = {
    stripeWebhookOwnership: { hasForeignOwner: async () => false },
    authPort: {
      initialize: async () => undefined,
      getAuthenticatedUser: async () => null,
      listSessions: async () => [],
      revokeSessions: async () => undefined,
      findUserByEmail: async () => null,
      ensureUser: async (email) => ({ userId: `user-${email}`, created: true }),
      requestMagicLink: async () => undefined,
      createEnrollmentMagicLink: async (input) => ({ url: `${legacyBaseUrl}/magic/${input.email}` }),
    },
    tenants,
    members: memberRepository,
    products,
    prices,
    orders: orderRepository,
    paymentRefunds,
    payment: { cancelSubscription: async () => ok({ canceled: true, alreadySettled: false }) },
    subscriptions: {
      findById: async () => null,
      findByProviderSubscriptionId: async () => null,
      listKnownProviderSubscriptionIds: async () => [],
      listForMember: async () => [],
      create: async () => undefined,
      update: async (_tenantId, subscription) => subscription,
      countActive: async () => 0,
    },
    grants: grantRepository,
    processedPaymentEvents,
    paymentTransaction: {
      run: async (operation) => operation({
        members: memberRepository,
        grants: grantRepository,
        orders: orderRepository,
        subscriptions: webhookDeps.subscriptions,
        paymentRefunds,
        couponRedemptions: { counts: async () => ({ total: 0, member: 0 }), createOrderAndClaim: async () => false },
        emailOutbox,
        autoInvoiceJobs: {
          enqueue: async (_tenantId, job) => { autoInvoiceJobs.push(structuredClone(job)); return true; },
          claimDue: async () => null,
          reschedule: async () => undefined,
          complete: async () => undefined,
        },
        orderRefundJobs: refundJobs.repository,
        consents: {
          record: async (_tenantId, consent) => { consents.push(consent); },
          listByEmail: async (tenantId, email) => consents.filter((row) => row.tenantId === tenantId && row.email === email),
        },
        checkoutConsentCaptures,
        marketingConsents,
        confirmations,
        consentTransaction: { run: (nested) => webhookDeps.paymentTransaction.run(nested) },
        checkoutConsentJobs: {
          enqueue: async (_tenantId, job) => { consentJobs.push(job); },
          lockPending: async () => null,
          complete: async () => undefined,
        },
        processedPaymentEvents,
        enrollmentTransaction,
      }),
    },
    enrollmentTransaction,
    emailOutbox,
    checkoutSnapshots,
    checkoutConsentCaptures,
    stock,
    dispatchEmail: () => undefined,
    devMagicLinks: { findByEmail: async () => null },
    ids: { nextId: () => `webhook-id-${String(++webhookSequence)}` },
    consentTokens: { nextToken: () => `confirmation-${String(++webhookSequence)}` },
    clock,
    tenantDomains: createInMemoryTenantDomainRepository(),
    appBaseUrl: legacyBaseUrl,
    baseDomain: 'togethercommunity.app',
    singleTenantMode: false,
    exposeMagicLinks: false,
    logger: { warn: (message) => { warnings.push(message); }, error: (message) => { errors.push(message); } },
  };

  return {
    checkoutDeps,
    webhookDeps,
    paymentInputs,
    snapshotRows,
    stockFake,
    captures,
    orders,
    autoInvoiceJobs,
    refundJobs: refundJobs.jobs,
    errors,
    warnings,
    setNow: (iso: string) => { clockNow = iso; },
  };
};
