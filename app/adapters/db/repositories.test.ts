import { and, eq, sql } from 'drizzle-orm';
import { drizzle } from 'drizzle-orm/node-postgres';
import { migrate } from 'drizzle-orm/node-postgres/migrator';
import pg from 'pg';
import { beforeAll, describe, expect, it } from 'vitest';

import { DELETED_MEMBER_DISPLAY, memberTombstone } from '@core/domain/index.js';
import type {
  CourseLesson,
  CourseModule,
  Course,
  Member,
  MemberSubscription,
  Order,
  ProcessedPaymentEvent,
  Product,
  ProductGrant,
  ProductPrice,
  TenantApiKey,
  TenantSecret,
} from '@core/domain/index.js';

import { createDb, type Db } from './client.js';
import {
  createCourseLessonRepository,
  createCourseModuleRepository,
  createCourseRepository,
  createCheckoutConsentCaptureRepository,
  createHealthPort,
  createMemberErasureRepository,
  createMemberRepository,
  createMemberSubscriptionRepository,
  createOrderRepository,
  createProcessedPaymentEventRepository,
  createProductGrantRepository,
  createProductPriceRepository,
  createProductRepository,
  createTenantAccessReader,
  createTenantApiKeyRepository,
  createTenantRepository,
  createTenantSecretRepository,
} from './repositories.js';
import {
  createCouponRedemptionRepository,
  createCouponStatsRepository,
  createProductPriceHistoryRepository,
} from './coupon-repositories.js';
import { createInvoiceRepository } from './invoice-repositories.js';
import {
  consents,
  couponRedemptions,
  couponCheckoutSessions,
  coupons,
  emailEvents,
  invoices,
  erasedMemberImports,
  memberCourseProgress,
  members,
  orders,
  posts,
  productPriceHistory,
  productPrices,
  suppressions,
  user,
} from './schema.js';

const TEST_DB = 'together_repositories_test';
const baseDatabaseUrl = process.env['DATABASE_URL'] ?? 'postgres://together:together@localhost:48912/together';
const testUrl = (() => {
  const url = new URL(baseDatabaseUrl);
  url.pathname = `/${TEST_DB}`;
  return url.toString();
})();

const NOW = '1998-07-14T10:00:00.000Z';
const PAST = '1998-01-01T00:00:00.000Z';
const FUTURE = '1998-12-01T00:00:00.000Z';

const ACME = 'tenant-acme';
const GLOBEX = 'tenant-globex';

let db: Db;
const emailHmac = { compute: (tenantId: string, email: string) => `${tenantId}:${email.trim().toLowerCase()}` };

const product = (over: Partial<Product> & { id: string; tenantId: string }): Product => ({
  title: 'Course',
  description: 'desc',
  priceCents: 4900,
  currency: 'PLN',
  published: true,
  accessItems: [],
  legacyId: null,
  createdAt: NOW,
  ...over,
});

const price = (over: Partial<ProductPrice> & { id: string; tenantId: string; productId: string }): ProductPrice => ({
  kind: 'recurring',
  interval: 'month',
  amountCents: 2900,
  currency: 'PLN',
  active: true,
  createdAt: NOW,
  ...over,
});

const grant = (over: Partial<ProductGrant> & { id: string; tenantId: string; memberId: string; productId: string }): ProductGrant => ({
  source: 'stripe',
  startsAt: PAST,
  expiresAt: FUTURE,
  legacyId: null,
  createdAt: NOW,
  ...over,
});

const order = (over: Partial<Order> & { id: string; tenantId: string; memberId: string; productId: string }): Order => ({
  priceId: null,
  kind: 'one_time',
  status: 'paid',
  amountCents: 4900,
  currency: 'PLN',
  provider: 'stripe',
  providerObjectIds: {},
  couponId: null,
  discountCents: 0,
  createdAt: NOW,
  ...over,
});

const subscription = (
  over: Partial<MemberSubscription> & { id: string; tenantId: string; memberId: string; productId: string; priceId: string },
): MemberSubscription => ({
  provider: 'stripe',
  providerSubscriptionId: 'psub-1',
  status: 'active',
  currentPeriodEnd: FUTURE,
  cancelAtPeriodEnd: false,
  couponId: null,
  couponDiscountCents: 0,
  couponRecurringDuration: null,
  createdAt: NOW,
  updatedAt: NOW,
  ...over,
});

const member = (over: Partial<Member> & { id: string; tenantId: string; userId: string }): Member => ({
  email: 'member@together.dev',
  displayName: null,
  tags: [],
  marketingConsents: {},
  externalCustomerIds: {},
  createdAt: NOW,
  deletedAt: null,
  ...over,
});

beforeAll(async () => {
  const admin = new pg.Client({ connectionString: baseDatabaseUrl });
  await admin.connect();
  await admin.query(`DROP DATABASE IF EXISTS ${TEST_DB} WITH (FORCE)`);
  await admin.query(`CREATE DATABASE ${TEST_DB}`);
  await admin.end();

  const migrationPool = new pg.Pool({ connectionString: testUrl });
  await migrate(drizzle(migrationPool), { migrationsFolder: 'drizzle' });
  await migrationPool.end();

  db = createDb('node-postgres', testUrl);

  await db.insert(user).values([
    { id: 'user-acme-owner', name: 'Acme Owner', email: 'owner-acme@together.dev' },
    { id: 'user-globex-owner', name: 'Globex Owner', email: 'owner-globex@together.dev' },
    { id: 'user-acme-member', name: 'Acme Member', email: 'buyer-acme@together.dev' },
    { id: 'user-globex-member', name: 'Globex Member', email: 'buyer-globex@together.dev' },
  ]);

  const tenants = createTenantRepository(db);
  await tenants.createTenantWithOwnerGrant({
    tenant: { id: ACME, slug: 'acme', name: 'Acme', createdAt: NOW },
    ownerGrant: { id: 'admin-acme', userId: 'user-acme-owner', staffRole: 'owner' },
  });
  await tenants.createTenantWithOwnerGrant({
    tenant: { id: GLOBEX, slug: 'globex', name: 'Globex', createdAt: NOW },
    ownerGrant: { id: 'admin-globex', userId: 'user-globex-owner', staffRole: 'owner' },
  });

  const members = createMemberRepository(db);
  await members.create(ACME, member({ id: 'mem-acme', tenantId: ACME, userId: 'user-acme-member', email: 'buyer-acme@together.dev' }));
  await members.create(GLOBEX, member({ id: 'mem-globex', tenantId: GLOBEX, userId: 'user-globex-member', email: 'buyer-globex@together.dev' }));

  const products = createProductRepository(db);
  await products.create(ACME, product({ id: 'prod-acme', tenantId: ACME, title: 'Acme Course' }));
  await products.create(ACME, product({ id: 'prod-acme-draft', tenantId: ACME, title: 'Draft', published: false }));
  await products.create(GLOBEX, product({ id: 'prod-globex', tenantId: GLOBEX, title: 'Globex Course' }));

  const prices = createProductPriceRepository(db);
  await prices.create(ACME, price({ id: 'price-acme', tenantId: ACME, productId: 'prod-acme' }));

  const grants = createProductGrantRepository(db);
  await grants.createGrant(ACME, grant({ id: 'grant-acme', tenantId: ACME, memberId: 'mem-acme', productId: 'prod-acme' }));
  await grants.createGrant(GLOBEX, grant({ id: 'grant-globex', tenantId: GLOBEX, memberId: 'mem-globex', productId: 'prod-globex' }));

  const orders = createOrderRepository(db);
  await orders.create(ACME, order({ id: 'order-acme-1', tenantId: ACME, memberId: 'mem-acme', productId: 'prod-acme', createdAt: NOW }));
  await orders.create(ACME, order({ id: 'order-acme-2', tenantId: ACME, memberId: 'mem-acme', productId: 'prod-acme', status: 'failed', createdAt: NOW }));
  await orders.create(GLOBEX, order({ id: 'order-globex', tenantId: GLOBEX, memberId: 'mem-globex', productId: 'prod-globex', createdAt: NOW }));

  const subs = createMemberSubscriptionRepository(db);
  await subs.create(ACME, subscription({ id: 'sub-acme', tenantId: ACME, memberId: 'mem-acme', productId: 'prod-acme', priceId: 'price-acme', providerSubscriptionId: 'psub-acme' }));
});

describe('product repository', () => {
  it('lists only the calling tenant products and honours the published filter', async () => {
    const repo = createProductRepository(db);
    const all = await repo.listByTenant(ACME);
    expect(all.map((p) => p.id).sort()).toEqual(['prod-acme', 'prod-acme-draft']);
    const published = await repo.listPublishedByTenant(ACME);
    expect(published.map((p) => p.id)).toEqual(['prod-acme']);
  });

  it('does not resolve a product across tenants', async () => {
    const repo = createProductRepository(db);
    expect(await repo.findById(ACME, 'prod-acme')).toMatchObject({ id: 'prod-acme', title: 'Acme Course' });
    expect(await repo.findById(GLOBEX, 'prod-acme')).toBeNull();
  });
});

describe('member repository', () => {
  it('finds members by id and email within a tenant only', async () => {
    const repo = createMemberRepository(db);
    expect(await repo.findById(ACME, 'mem-acme')).toMatchObject({ id: 'mem-acme' });
    expect(await repo.findById(GLOBEX, 'mem-acme')).toBeNull();
    expect(await repo.findByEmail(ACME, 'buyer-acme@together.dev')).toMatchObject({ id: 'mem-acme' });
    expect(await repo.findByEmail(GLOBEX, 'buyer-acme@together.dev')).toBeNull();
  });

  it('lists members with their active product ids', async () => {
    const repo = createMemberRepository(db);
    const rows = await repo.listWithProductIds(ACME, NOW);
    const acmeMember = rows.find((r) => r.id === 'mem-acme');
    expect(acmeMember?.activeProductIds).toContain('prod-acme');
  });
});

describe('product grant repository', () => {
  it('finds and lists grants scoped to the tenant, and filters active by window', async () => {
    const repo = createProductGrantRepository(db);
    expect(await repo.findGrant(ACME, 'mem-acme', 'prod-acme')).toMatchObject({ id: 'grant-acme' });
    expect(await repo.findGrant(GLOBEX, 'mem-acme', 'prod-acme')).toBeNull();

    const active = await repo.listActiveForMember(ACME, 'mem-acme', NOW);
    expect(active.map((g) => g.id)).toEqual(['grant-acme']);
    const afterExpiry = await repo.listActiveForMember(ACME, 'mem-acme', '1999-01-01T00:00:00.000Z');
    expect(afterExpiry).toEqual([]);

    const named = await repo.listForMemberWithProductNames(ACME, 'mem-acme', NOW);
    expect(named[0]).toMatchObject({ productName: 'Acme Course', active: true });
  });

  it('revokes a grant by setting its expiry', async () => {
    const repo = createProductGrantRepository(db);
    const revoked = await repo.revokeGrant(ACME, 'grant-acme', NOW);
    expect(revoked?.expiresAt).toBe(NOW);
    await repo.setGrantWindow(ACME, 'grant-acme', { startsAt: PAST, expiresAt: FUTURE });
  });
});

describe('order repository', () => {
  it('paginates, filters by status, and isolates by tenant', async () => {
    const repo = createOrderRepository(db);
    const paid = await repo.list(ACME, { page: 1, pageSize: 20, status: 'paid' });
    expect(paid.total).toBe(1);
    expect(paid.orders[0]).toMatchObject({ id: 'order-acme-1', memberEmail: 'buyer-acme@together.dev', productTitle: 'Acme Course' });

    const all = await repo.list(ACME, { page: 1, pageSize: 20 });
    expect(all.total).toBe(2);

    const globex = await repo.list(GLOBEX, { page: 1, pageSize: 20 });
    expect(globex.total).toBe(1);
  });

  it('sums paid revenue and counts every order since a cutoff', async () => {
    const repo = createOrderRepository(db);
    const revenue = await repo.revenueSince(ACME, PAST);
    expect(revenue).toEqual([{ currency: 'PLN', amountCents: 4900 }]);
    expect(await repo.countSince(ACME, PAST)).toBe(2);
  });

  it.each([
    ['checkoutSession', 'cs-idempotent'],
    ['invoice', 'in-idempotent'],
  ])('deduplicates paid orders by provider %s', async (key, value) => {
    const repo = createOrderRepository(db);
    await Promise.all([
      repo.create(ACME, order({
        id: `order-${key}-one`,
        tenantId: ACME,
        memberId: 'mem-acme',
        productId: 'prod-acme',
        providerObjectIds: { [key]: value },
      })),
      repo.create(ACME, order({
        id: `order-${key}-two`,
        tenantId: ACME,
        memberId: 'mem-acme',
        productId: 'prod-acme',
        providerObjectIds: { [key]: value },
      })),
    ]);

    const rows = await db
      .select()
      .from(orders)
      .where(sql`${orders.providerObjectIds}->>${key} = ${value}`);
    expect(rows).toHaveLength(1);
  });
});

describe('coupon redemption repository', () => {
  it('serializes concurrent limit claims with their order inserts', async () => {
    await db.insert(coupons).values({
      id: 'coupon-race',
      tenantId: ACME,
      code: 'RACE',
      kind: 'percent',
      value: 50,
      scope: { kind: 'all' },
      appliesTo: 'both',
      recurringDuration: 'first_invoice',
      startsAt: null,
      endsAt: null,
      maxRedemptions: 1,
      maxRedemptionsPerMember: null,
      status: 'active',
      partnerLabel: null,
      stripeCouponId: null,
      stripePromotionCodeId: null,
      createdAt: NOW,
    });
    const repo = createCouponRedemptionRepository(db);
    const claim = (id: string) =>
      repo.createOrderAndClaim(ACME, {
        order: order({
          id: `coupon-order-${id}`,
          tenantId: ACME,
          memberId: 'mem-acme',
          productId: 'prod-acme',
          amountCents: 2450,
          couponId: 'coupon-race',
          discountCents: 2450,
          providerObjectIds: { checkoutSession: 'provider-race' },
        }),
        redemption: {
          id: `coupon-redemption-${id}`,
          tenantId: ACME,
          couponId: 'coupon-race',
          orderId: `coupon-order-${id}`,
          memberId: 'mem-acme',
          email: 'buyer-acme@together.dev',
          discountCents: 2450,
          createdAt: NOW,
        },
        event: {
          id: `coupon-redemption-event-${id}`,
          tenantId: ACME,
          redemptionId: `coupon-redemption-${id}`,
          couponId: 'coupon-race',
          orderId: `coupon-order-${id}`,
          type: 'redeemed',
          occurredAt: NOW,
        },
        maxRedemptions: 1,
        maxRedemptionsPerMember: null,
      });
    const results = await Promise.all([claim('one'), claim('two')]);

    expect(results.sort()).toEqual([false, true]);
    expect(
      await db
        .select()
        .from(couponRedemptions)
        .where(eq(couponRedemptions.couponId, 'coupon-race')),
    ).toHaveLength(1);
    await db.insert(couponCheckoutSessions).values({
      id: 'coupon-race-session',
      tenantId: ACME,
      couponId: 'coupon-race',
      providerSessionId: 'provider-race',
      memberEmail: 'buyer-acme@together.dev',
      productId: 'prod-acme',
      priceId: null,
      originalCents: 4900,
      discountCents: 2450,
      finalCents: 2450,
      currency: 'PLN',
      startedAt: NOW,
    });
    await db.insert(couponCheckoutSessions).values({
      id: 'coupon-race-free-session',
      tenantId: ACME,
      couponId: 'coupon-race',
      providerSessionId: null,
      memberEmail: 'buyer-acme@together.dev',
      productId: 'prod-acme',
      priceId: null,
      originalCents: 4900,
      discountCents: 4900,
      finalCents: 0,
      currency: 'PLN',
      startedAt: NOW,
    });
    await db.insert(orders).values(order({
      id: 'coupon-order-free',
      tenantId: ACME,
      memberId: 'mem-acme',
      productId: 'prod-acme',
      amountCents: 0,
      couponId: 'coupon-race',
      discountCents: 4900,
      provider: 'simulated',
      providerObjectIds: { checkoutSession: 'free_coupon-race-free-session' },
    }));
    await db.insert(couponRedemptions).values({
      id: 'coupon-redemption-free',
      tenantId: ACME,
      couponId: 'coupon-race',
      orderId: 'coupon-order-free',
      memberId: 'mem-acme',
      email: 'buyer-acme@together.dev',
      discountCents: 4900,
      createdAt: NOW,
    });
    const statsRepo = createCouponStatsRepository(db);
    const stats = await statsRepo.list(ACME, {
      limit: 10,
      since: '1998-07-01T00:00:00.000Z',
      through: '1998-07-31T23:59:59.999Z',
    });
    expect(stats.items).toMatchObject([
      {
        redemptions: 2,
        sessionsWithCode: 2,
        conversionRate: 1,
        grossAttributed: [{ currency: 'PLN', amountCents: 2450 }],
        discountGiven: [{ currency: 'PLN', amountCents: 7350 }],
      },
    ]);
    expect(await statsRepo.listOptions(ACME)).toContainEqual({
      id: 'coupon-race',
      code: 'RACE',
    });
  });
});

describe('product price history repository', () => {
  it('derives the lowest product price across replaced price rows', async () => {
    const products = createProductRepository(db);
    await products.create(ACME, product({
      id: 'prod-omnibus',
      tenantId: ACME,
      priceCents: 9900,
      createdAt: '1998-07-01T00:00:00.000Z',
    }));
    const prices = createProductPriceRepository(db);
    await prices.create(ACME, price({
      id: 'price-omnibus-old',
      tenantId: ACME,
      productId: 'prod-omnibus',
      kind: 'one_time',
      interval: null,
      amountCents: 9900,
      active: false,
      createdAt: '1998-07-01T00:00:00.000Z',
    }));
    await prices.create(ACME, price({
      id: 'price-omnibus-new',
      tenantId: ACME,
      productId: 'prod-omnibus',
      kind: 'one_time',
      interval: null,
      amountCents: 14900,
      createdAt: '1998-07-17T00:00:00.000Z',
    }));

    const lowest = await createProductPriceHistoryRepository(db).lowestSince(ACME, {
      productId: 'prod-omnibus',
      priceId: 'price-omnibus-new',
      since: '1998-06-27T00:00:00.000Z',
      through: '1998-07-27T23:59:59.999Z',
      currentAmountCents: 14900,
    });

    expect(lowest).toBe(9900);
  });

  it('timestamps a price update when the change becomes effective', async () => {
    await db.insert(productPrices).values({
      id: 'price-omnibus-update',
      tenantId: ACME,
      productId: 'prod-omnibus',
      kind: 'one_time',
      interval: null,
      amountCents: 17900,
      currency: 'PLN',
      active: true,
      createdAt: '1997-01-01T00:00:00.000Z',
    });
    await db
      .update(productPrices)
      .set({ amountCents: 18900 })
      .where(eq(productPrices.id, 'price-omnibus-update'));

    const rows = await db
      .select()
      .from(productPriceHistory)
      .where(eq(productPriceHistory.priceId, 'price-omnibus-update'));
    const updated = rows.find((row) => row.amountCents === 18900);

    expect(updated?.effectiveFrom).not.toBe('1997-01-01T00:00:00.000Z');
    expect(Date.parse(updated?.effectiveFrom ?? '')).toBeGreaterThan(
      Date.parse('1998-07-01T00:00:00.000Z'),
    );
  });
});

describe('member subscription repository', () => {
  it('finds by provider id, lists for a member, and counts active within the tenant', async () => {
    const repo = createMemberSubscriptionRepository(db);
    expect(await repo.findByProviderSubscriptionId(ACME, 'psub-acme')).toMatchObject({ id: 'sub-acme' });
    expect(await repo.findByProviderSubscriptionId(GLOBEX, 'psub-acme')).toBeNull();
    expect((await repo.listForMember(ACME, 'mem-acme')).map((s) => s.id)).toEqual(['sub-acme']);
    expect(await repo.countActive(ACME, NOW)).toBe(1);
    expect(await repo.countActive(GLOBEX, NOW)).toBe(0);
  });

  it('updates a subscription row in place', async () => {
    const repo = createMemberSubscriptionRepository(db);
    const current = await repo.findById(ACME, 'sub-acme');
    expect(current).not.toBeNull();
    if (!current) return;
    const updated = await repo.update(ACME, { ...current, status: 'past_due' });
    expect(updated?.status).toBe('past_due');
    await repo.update(ACME, { ...current, status: 'active' });
  });
});

describe('tenant, api-key, secret and processed-event repositories', () => {
  it('reads tenants by id and slug and round-trips settings', async () => {
    const repo = createTenantRepository(db);
    expect(await repo.findBySlug('acme')).toMatchObject({ id: ACME, slug: 'acme' });
    expect(await repo.findById(GLOBEX)).toMatchObject({ slug: 'globex' });
    const updated = await repo.updateSettings(ACME, {
      billingPortalUrl: 'https://billing.acme.test',
      bunnyStreamLibraryId: 'lib-1',
      logoUrl: null,
      accentColor: null,
      faviconUrl: null,
      termsUrl: null,
      privacyUrl: null,
    });
    expect(updated).toMatchObject({ billingPortalUrl: 'https://billing.acme.test', bunnyStreamLibraryId: 'lib-1' });
    expect(await repo.findSettings(ACME)).toMatchObject({ bunnyStreamLibraryId: 'lib-1' });
  });

  it('exposes staff memberships and members through the access reader', async () => {
    const reader = createTenantAccessReader(db);
    const tenants = await reader.listTenantsForStaff('user-acme-owner');
    expect(tenants.map((t) => t.tenant.slug)).toEqual(['acme']);
    expect(await reader.listStaffForTenant(ACME)).toEqual([
      { userId: 'user-acme-owner', email: 'owner-acme@together.dev' },
    ]);
    expect(await reader.findStaffGrant('user-acme-owner', { tenantSlug: 'globex' })).toBeNull();
    expect(await reader.findMember('user-acme-member', ACME)).toMatchObject({ id: 'mem-acme' });
  });

  it('stores and revokes API keys by hash within the tenant', async () => {
    const repo = createTenantApiKeyRepository(db);
    const apiKey: TenantApiKey = {
      id: 'key-acme',
      tenantId: ACME,
      name: 'CI',
      keyHash: 'hash-abc',
      createdAt: NOW,
      revokedAt: null,
    };
    await repo.create(ACME, apiKey);
    expect(await repo.findActiveByHash(ACME, 'hash-abc')).toMatchObject({ id: 'key-acme' });
    expect(await repo.findActiveByHash(GLOBEX, 'hash-abc')).toBeNull();
    await repo.revoke(ACME, 'key-acme', NOW);
    expect(await repo.findActiveByHash(ACME, 'hash-abc')).toBeNull();
  });

  it('upserts and deletes tenant secrets by key', async () => {
    const repo = createTenantSecretRepository(db);
    const secret: TenantSecret = {
      id: 'sec-acme',
      tenantId: ACME,
      key: 'stripe.restrictedKey',
      ciphertext: 'ct',
      iv: 'iv',
      authTag: 'tag',
      maskedPreview: 'rk_***',
      updatedAt: NOW,
    };
    await repo.upsert(ACME, secret);
    expect(await repo.findByKey(ACME, 'stripe.restrictedKey')).toMatchObject({ maskedPreview: 'rk_***' });
    expect(await repo.findByKey(GLOBEX, 'stripe.restrictedKey')).toBeNull();
    expect(await repo.delete(ACME, 'stripe.restrictedKey')).toBe(true);
    expect(await repo.findByKey(ACME, 'stripe.restrictedKey')).toBeNull();
  });

  it('claims a payment event once and rejects duplicate deliveries', async () => {
    const repo = createProcessedPaymentEventRepository(db);
    const event: ProcessedPaymentEvent = {
      id: 'evt-1',
      tenantId: ACME,
      type: 'invoice.paid',
      objectId: 'in-1',
      processedAt: NOW,
    };
    expect(await repo.claim(ACME, event)).toBe(true);
    expect(await repo.claim(ACME, event)).toBe(false);
    expect(await repo.claim(ACME, { ...event, id: 'evt-2' })).toBe(false);
    await repo.release(ACME, 'evt-1');
    expect(await repo.claim(ACME, { ...event, id: 'evt-3' })).toBe(true);
  });
});

describe('order billing snapshots', () => {
  it('rejects billing changes after payment', async () => {
    await expect(
      db
        .update(orders)
        .set({
          billing: {
            nip: '5555555555',
            companyName: 'Acme sp. z o.o.',
            address: 'Prosta 1',
            postalCode: '00-001',
            city: 'Warszawa',
            country: 'PL',
          },
        })
        .where(eq(orders.id, 'order-acme-1')),
    ).rejects.toThrow();
  });
});

describe('course/module/lesson repositories', () => {
  it('creates and reads course content scoped to the tenant', async () => {
    const courses = createCourseRepository(db);
    const modules = createCourseModuleRepository(db);
    const lessons = createCourseLessonRepository(db);

    const course: Course = { id: 'course-acme', tenantId: ACME, name: 'C', description: '', imageUrl: null, moduleOrder: [], legacyId: null, createdAt: NOW };
    const module: CourseModule = { id: 'module-acme', tenantId: ACME, courseIds: ['course-acme'], title: 'M', prefix: null, name: 'M', chapters: [], legacyId: null, createdAt: NOW };
    const lesson: CourseLesson = { id: 'lesson-acme', tenantId: ACME, name: 'L', contents: [], legacyId: null, createdAt: NOW };
    await courses.create(ACME, course);
    await modules.create(ACME, module);
    await lessons.create(ACME, lesson);

    expect((await courses.list(ACME)).map((c) => c.id)).toEqual(['course-acme']);
    expect(await courses.list(GLOBEX)).toEqual([]);
    expect(await modules.findById(ACME, 'module-acme')).toMatchObject({ courseIds: ['course-acme'] });
    expect(await lessons.findById(GLOBEX, 'lesson-acme')).toBeNull();
  });
});

describe('health port', () => {
  it('pings the database successfully', async () => {
    expect(await createHealthPort(db).pingDatabase()).toBe(true);
  });
});

describe('member erasure repository', () => {
  const RODO = 'tenant-rodo';
  const OTHER = 'tenant-rodo-other';
  const REMOVAL_AT = '1998-07-20T12:00:00.000Z';

  const pseudonymizationInput = (memberId: string) => ({
    memberId,
    deletedAt: REMOVAL_AT,
    tombstoneEmail: memberTombstone(memberId).email,
    severedUserId: memberTombstone(memberId).userId,
    postAuthorDisplay: DELETED_MEMBER_DISPLAY,
  });

  beforeAll(async () => {
    await db.insert(user).values([
      { id: 'user-rodo-owner', name: 'Rodo Owner', email: 'owner-rodo@together.dev' },
      { id: 'user-rodo-buyer', name: 'Jan Kowalski', email: 'jan.kowalski@together.dev' },
      { id: 'user-rodo-shared', name: 'Anna Shared', email: 'anna.shared@together.dev' },
      { id: 'user-rodo-dollar', name: 'Dollar Test', email: 'dollar@together.dev' },
    ]);

    const tenants = createTenantRepository(db);
    await tenants.createTenantWithOwnerGrant({
      tenant: { id: RODO, slug: 'rodo', name: 'Rodo', createdAt: NOW },
      ownerGrant: { id: 'admin-rodo', userId: 'user-rodo-owner', staffRole: 'owner' },
    });
    await tenants.createTenantWithOwnerGrant({
      tenant: { id: OTHER, slug: 'rodo-other', name: 'Rodo Other', createdAt: NOW },
      ownerGrant: { id: 'admin-rodo-other', userId: 'user-rodo-owner', staffRole: 'owner' },
    });

    const membersRepo = createMemberRepository(db);
    await membersRepo.create(RODO, member({
      id: 'mem-rodo',
      tenantId: RODO,
      userId: 'user-rodo-buyer',
      email: 'jan.kowalski@together.dev',
      displayName: 'Jan Kowalski',
      tags: ['vip'],
      marketingConsents: { newsletter: true },
      externalCustomerIds: { stripe: 'cus_jan' },
    }));
    await db
      .update(members)
      .set({ legacyId: 'legacy-mem-rodo' })
      .where(eq(members.id, 'mem-rodo'));
    await membersRepo.create(RODO, member({ id: 'mem-rodo-shared', tenantId: RODO, userId: 'user-rodo-shared', email: 'anna.shared@together.dev' }));
    await membersRepo.create(OTHER, member({ id: 'mem-other-shared', tenantId: OTHER, userId: 'user-rodo-shared', email: 'anna.shared@together.dev' }));
    await membersRepo.create(
      RODO,
      member({
        id: 'mem-rodo-dollar',
        tenantId: RODO,
        userId: 'user-rodo-dollar',
        email: 'dollar@together.dev',
      }),
    );

    const products = createProductRepository(db);
    await products.create(RODO, product({ id: 'prod-rodo', tenantId: RODO, title: 'Kurs' }));
    const prices = createProductPriceRepository(db);
    await prices.create(RODO, price({ id: 'price-rodo', tenantId: RODO, productId: 'prod-rodo' }));

    const orderRepo = createOrderRepository(db);
    await orderRepo.create(RODO, order({ id: 'order-rodo-1', tenantId: RODO, memberId: 'mem-rodo', productId: 'prod-rodo', amountCents: 10000, createdAt: NOW }));
    await orderRepo.create(RODO, order({ id: 'order-rodo-2', tenantId: RODO, memberId: 'mem-rodo', productId: 'prod-rodo', amountCents: 10000, createdAt: NOW }));
    await createInvoiceRepository(db).create(
      RODO,
      {
        id: 'invoice-rodo',
        tenantId: RODO,
        orderId: 'order-rodo-1',
        status: 'issued',
        provider: 'ifirma',
        providerInvoiceId: 'provider-rodo',
        invoiceNumber: 'FV/RODO/1',
        pdfUrl: 'https://example.com/invoice-rodo.pdf',
        error: null,
        issuedAt: NOW,
        createdAt: NOW,
      },
      {
        id: 'invoice-event-rodo',
        tenantId: RODO,
        invoiceId: 'invoice-rodo',
        orderId: 'order-rodo-1',
        type: 'issued',
        error: null,
        meta: {},
        occurredAt: NOW,
      },
    );
    await db.insert(coupons).values({
      id: 'coupon-rodo',
      tenantId: RODO,
      code: 'RODO20',
      kind: 'percent',
      value: 20,
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
      createdAt: NOW,
    });
    await db
      .update(orders)
      .set({ couponId: 'coupon-rodo', discountCents: 2500 })
      .where(eq(orders.id, 'order-rodo-1'));
    await db.insert(couponRedemptions).values({
      id: 'redemption-rodo',
      tenantId: RODO,
      couponId: 'coupon-rodo',
      orderId: 'order-rodo-1',
      memberId: 'mem-rodo',
      email: 'jan.kowalski@together.dev',
      discountCents: 2500,
      createdAt: NOW,
    });
    await db.insert(couponCheckoutSessions).values({
      id: 'coupon-session-rodo',
      tenantId: RODO,
      couponId: 'coupon-rodo',
      providerSessionId: 'cs-rodo',
      memberEmail: 'jan.kowalski@together.dev',
      productId: 'prod-rodo',
      priceId: null,
      originalCents: 12500,
      discountCents: 2500,
      finalCents: 10000,
      currency: 'PLN',
      startedAt: NOW,
    });

    const grants = createProductGrantRepository(db);
    await grants.createGrant(RODO, grant({ id: 'grant-rodo', tenantId: RODO, memberId: 'mem-rodo', productId: 'prod-rodo', expiresAt: null, legacyId: 'legacy-grant-rodo' }));

    const subs = createMemberSubscriptionRepository(db);
    await subs.create(RODO, subscription({ id: 'sub-rodo', tenantId: RODO, memberId: 'mem-rodo', productId: 'prod-rodo', priceId: 'price-rodo', providerSubscriptionId: 'psub-rodo' }));

    await db.insert(posts).values({
      id: 'post-rodo',
      tenantId: RODO,
      contextKind: 'space',
      contextId: 'space-rodo',
      parentPostId: null,
      rootPostId: 'post-rodo',
      authorUserId: 'user-rodo-buyer',
      authorDisplay: 'Jan Kowalski',
      authorIsStaff: false,
      body: 'Świetny kurs!',
      createdAt: NOW,
    });
    await createCourseRepository(db).create(RODO, {
      id: 'course-rodo',
      tenantId: RODO,
      name: 'Kurs RODO',
      description: '',
      imageUrl: null,
      moduleOrder: [],
      legacyId: null,
      createdAt: NOW,
    });
    await db.insert(memberCourseProgress).values({
      id: 'progress-rodo',
      tenantId: RODO,
      memberId: 'mem-rodo',
      courseId: 'course-rodo',
      lastViewedLessonId: null,
      completedLessonIds: ['l1', 'l2'],
      updatedAt: NOW,
    });
    await db.insert(consents).values({
      id: 'consent-rodo',
      tenantId: RODO,
      userId: 'user-rodo-buyer',
      email: 'jan.kowalski@together.dev',
      source: 'register',
      termsUrl: 'https://rodo.example/terms',
      privacyUrl: null,
      acceptedAt: NOW,
    });
    await db.insert(emailEvents).values([
      {
        id: 'event-rodo-delivered',
        tenantId: RODO,
        mailKind: 'marketing',
        refId: 'send-rodo',
        type: 'delivered',
        occurredAt: NOW,
        meta: {
          rawProviderPayload: {
            mail: { destination: ['jan.kowalski@together.dev'] },
            delivery: { recipients: ['JAN.KOWALSKI@TOGETHER.DEV'] },
            recipientByAddress: { 'jan.kowalski@together.dev': true },
          },
        },
        createdAt: NOW,
      },
      {
        id: 'event-rodo-bounced',
        tenantId: RODO,
        mailKind: 'transactional',
        refId: 'outbox-rodo',
        type: 'bounced',
        occurredAt: NOW,
        meta: { recipient: 'mailto:jan.kowalski@together.dev', classification: 'hard' },
        createdAt: NOW,
      },
      {
        id: 'event-other-delivered',
        tenantId: OTHER,
        mailKind: 'marketing',
        refId: 'send-other',
        type: 'delivered',
        occurredAt: NOW,
        meta: { recipient: 'jan.kowalski@together.dev' },
        createdAt: NOW,
      },
      {
        id: 'event-rodo-dollar',
        tenantId: RODO,
        mailKind: 'transactional',
        refId: 'outbox-rodo-dollar',
        type: 'delivered',
        occurredAt: NOW,
        meta: { recipient: 'dollar@together.dev' },
        createdAt: NOW,
      },
    ]);
  });

  it('stores checkout consent evidence locally with tenant-scoped lookup', async () => {
    const repo = createCheckoutConsentCaptureRepository(db);
    const capture = {
      termsAccepted: true,
      selectedDefinitionIds: ['newsletter'],
      attachedDefinitionIds: ['newsletter'],
      collectedAt: NOW,
      confirmationBaseUrl: 'https://rodo.example/marketing/confirm',
      ip: '203.0.113.44',
      userAgent: 'A'.repeat(1200),
    };
    await repo.create(RODO, {
      id: 'capture-rodo',
      capture,
      createdAt: NOW,
    });
    expect(await repo.findById(RODO, 'capture-rodo')).toEqual(capture);
    expect(await repo.findById(OTHER, 'capture-rodo')).toBeNull();
  });

  it('erases PII, revokes access, and deletes the orphaned auth user in one pass', async () => {
    const result = await createMemberErasureRepository(db, emailHmac).pseudonymize(RODO, pseudonymizationInput('mem-rodo'));
    expect(result).toEqual({ alreadyDeleted: false, authUserErased: true });

    const rows = await db.select().from(members).where(eq(members.id, 'mem-rodo'));
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      email: memberTombstone('mem-rodo').email,
      userId: memberTombstone('mem-rodo').userId,
      displayName: null,
      tags: [],
      marketingConsents: {},
      externalCustomerIds: {},
      legacyId: null,
      deletedAt: REMOVAL_AT,
    });

    const authRows = await db.select().from(user).where(eq(user.id, 'user-rodo-buyer'));
    expect(authRows).toEqual([]);

    const grants = createProductGrantRepository(db);
    expect(await grants.listActiveForMember(RODO, 'mem-rodo', '1998-07-21T00:00:00.000Z')).toEqual([]);
    expect(await grants.findGrant(RODO, 'mem-rodo', 'prod-rodo')).toMatchObject({ expiresAt: REMOVAL_AT, legacyId: null });

    const subs = createMemberSubscriptionRepository(db);
    expect(await subs.findById(RODO, 'sub-rodo')).toMatchObject({ status: 'canceled', cancelAtPeriodEnd: true });

    const postRows = await db.select().from(posts).where(eq(posts.id, 'post-rodo'));
    expect(postRows[0]).toMatchObject({ authorDisplay: DELETED_MEMBER_DISPLAY, body: 'Świetny kurs!', deletedAt: null });

    const consentRows = await db.select().from(consents).where(eq(consents.id, 'consent-rodo'));
    expect(consentRows[0]).toMatchObject({ userId: 'user-rodo-buyer', email: 'jan.kowalski@together.dev' });

    const suppressionRows = await db.select().from(suppressions).where(eq(suppressions.sourceRef, 'mem-rodo'));
    expect(suppressionRows).toMatchObject([{
      tenantId: RODO,
      email: null,
      emailHmac: emailHmac.compute(RODO, 'jan.kowalski@together.dev'),
      reason: 'erasure',
    }]);
    expect(
      await db
        .select()
        .from(erasedMemberImports)
        .where(eq(erasedMemberImports.memberId, 'mem-rodo')),
    ).toEqual([
      expect.objectContaining({
        tenantId: RODO,
        legacyId: 'legacy-mem-rodo',
        emailHmac: emailHmac.compute(RODO, 'jan.kowalski@together.dev'),
        erasedAt: REMOVAL_AT,
      }),
    ]);

    const progressRows = await db
      .select()
      .from(memberCourseProgress)
      .where(eq(memberCourseProgress.memberId, 'mem-rodo'));
    expect(progressRows).toHaveLength(1);
    expect(progressRows[0]).toMatchObject({ completedLessonIds: ['l1', 'l2'] });

    expect(
      await db.select().from(invoices).where(eq(invoices.id, 'invoice-rodo')),
    ).toMatchObject([{ invoiceNumber: 'FV/RODO/1', orderId: 'order-rodo-1' }]);

    const eventRows = await db.select().from(emailEvents).where(eq(emailEvents.tenantId, RODO));
    expect(eventRows.map((event) => event.type).sort()).toEqual([
      'bounced',
      'delivered',
      'delivered',
    ]);
    expect(eventRows.every((event) =>
      !JSON.stringify(event.meta).toLowerCase().includes('jan.kowalski@together.dev'),
    )).toBe(true);
    expect(
      await db
        .select({ email: couponRedemptions.email })
        .from(couponRedemptions)
        .where(eq(couponRedemptions.id, 'redemption-rodo')),
    ).toEqual([{ email: memberTombstone('mem-rodo').email }]);
    expect(
      await db
        .select({ email: couponCheckoutSessions.memberEmail })
        .from(couponCheckoutSessions)
        .where(eq(couponCheckoutSessions.id, 'coupon-session-rodo')),
    ).toEqual([{ email: memberTombstone('mem-rodo').email }]);
    const otherTenantEvents = await db
      .select()
      .from(emailEvents)
      .where(eq(emailEvents.tenantId, OTHER));
    expect(JSON.stringify(otherTenantEvents[0]?.meta)).toContain('jan.kowalski@together.dev');
  });

  it('treats tombstone dollar characters as literal JSON replacements', async () => {
    await createMemberErasureRepository(db, emailHmac).pseudonymize(RODO, {
      ...pseudonymizationInput('mem-rodo-dollar'),
      tombstoneEmail: 'deleted-$&@anonymized.invalid',
    });
    const rows = await db
      .select({ meta: emailEvents.meta })
      .from(emailEvents)
      .where(eq(emailEvents.id, 'event-rodo-dollar'));
    expect(rows[0]?.meta).toEqual({ recipient: 'deleted-$&@anonymized.invalid' });
  });

  it('keeps order rows, the sales list, and revenue unchanged after removal', async () => {
    const repo = createOrderRepository(db);
    const all = await repo.list(RODO, { page: 1, pageSize: 20 });
    expect(all.total).toBe(2);
    expect(all.orders.map((o) => o.status)).toEqual(['paid', 'paid']);
    expect(all.orders[0]).toMatchObject({ memberEmail: memberTombstone('mem-rodo').email, memberName: null });

    const revenue = await repo.revenueSince(RODO, PAST);
    expect(revenue).toEqual([{ currency: 'PLN', amountCents: 20000 }]);
  });

  it('keeps the pseudonymized row in the member list export source', async () => {
    const listed = await createMemberRepository(db).listWithProductIds(RODO, '1998-07-21T00:00:00.000Z');
    const removed = listed.find((row) => row.id === 'mem-rodo');
    expect(removed).toMatchObject({
      email: memberTombstone('mem-rodo').email,
      displayName: null,
      deletedAt: REMOVAL_AT,
      productIds: ['prod-rodo'],
      activeProductIds: [],
    });
  });

  it('lets the same e-mail join again as a fresh member instead of resurrecting the row', async () => {
    const membersRepo = createMemberRepository(db);
    expect(await membersRepo.findByEmail(RODO, 'jan.kowalski@together.dev')).toBeNull();

    await db.insert(user).values({ id: 'user-rodo-buyer-2', name: 'Jan Kowalski', email: 'jan.kowalski@together.dev' });
    await membersRepo.create(RODO, member({ id: 'mem-rodo-fresh', tenantId: RODO, userId: 'user-rodo-buyer-2', email: 'jan.kowalski@together.dev' }));

    const fresh = await membersRepo.findByEmail(RODO, 'jan.kowalski@together.dev');
    expect(fresh).toMatchObject({ id: 'mem-rodo-fresh', deletedAt: null });
    expect(await membersRepo.findById(RODO, 'mem-rodo')).toMatchObject({ deletedAt: REMOVAL_AT });
  });

  it('reports an already pseudonymized member without touching it again', async () => {
    const result = await createMemberErasureRepository(db, emailHmac).pseudonymize(RODO, pseudonymizationInput('mem-rodo'));
    expect(result).toEqual({ alreadyDeleted: true, authUserErased: false });
  });

  it('returns null for a member of another tenant', async () => {
    const result = await createMemberErasureRepository(db, emailHmac).pseudonymize(OTHER, pseudonymizationInput('mem-rodo'));
    expect(result).toBeNull();
  });

  it('keeps the auth user when other tenant memberships still reference it', async () => {
    const result = await createMemberErasureRepository(db, emailHmac).pseudonymize(RODO, pseudonymizationInput('mem-rodo-shared'));
    expect(result).toEqual({ alreadyDeleted: false, authUserErased: false });

    const authRows = await db.select().from(user).where(eq(user.id, 'user-rodo-shared'));
    expect(authRows).toHaveLength(1);
    expect(await createMemberRepository(db).findById(OTHER, 'mem-other-shared')).toMatchObject({
      email: 'anna.shared@together.dev',
      deletedAt: null,
    });
  });

  it('blocks a hard member delete while order history exists', async () => {
    await expect(
      db.delete(members).where(and(eq(members.tenantId, RODO), eq(members.id, 'mem-rodo'))),
    ).rejects.toThrow();
  });
});
