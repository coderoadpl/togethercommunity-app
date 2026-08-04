import { and, asc, eq, inArray, sql } from 'drizzle-orm';
import { drizzle } from 'drizzle-orm/node-postgres';
import { migrate } from 'drizzle-orm/node-postgres/migrator';
import pg from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import {
  DELETED_MEMBER_DISPLAY,
  err,
  invoiceVatTreatmentsEqual,
  memberTombstone,
  ok,
  validation,
} from '#core/domain/index.js';
import type {
  CourseLesson,
  CourseModule,
  Course,
  Member,
  MemberSubscription,
  Order,
  Post,
  PostReport,
  ProcessedPaymentEvent,
  Product,
  ProductGrant,
  ProductPrice,
  TenantApiKey,
  TenantSecret,
} from '#core/domain/index.js';

import type { Db } from './client.js';
import {
  createCourseLessonRepository,
  createCourseModuleRepository,
  createCourseRepository,
  createCheckoutConsentCaptureRepository,
  createDevSinkPurge,
  createHealthPort,
  createMemberErasureRepository,
  createMemberRepository,
  createMemberSubscriptionRepository,
  createOrderRepository,
  createPostRepository,
  createPostReportRepository,
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
import { createPaymentTransactionPort } from './payment-transaction.js';
import { createMemberErasureRequestRepository } from './member-erasure-requests.js';
import {
  consents,
  couponRedemptions,
  couponCheckoutSessions,
  coupons,
  devEmails,
  devMagicLinks,
  emailOutbox,
  emailEvents,
  invoices,
  erasedMemberImports,
  memberCourseProgress,
  memberEvents,
  memberSubscriptions,
  members,
  memberErasureRequestEvents,
  orders,
  postReportEvents,
  postReports,
  posts,
  processedPaymentEvents,
  productGrants,
  productPriceHistory,
  productPrices,
  suppressions,
  user,
} from './schema.js';
import * as dbSchema from './schema.js';
import { uniqueTestDatabaseName } from './test-database-name.js';

const TEST_DB = uniqueTestDatabaseName('together_repositories_test');
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
let dbPool: pg.Pool;
const emailHmac = { compute: (tenantId: string, email: string) => `${tenantId}:${email.trim().toLowerCase()}` };

afterAll(async () => {
  await dbPool.end();
  const admin = new pg.Client({ connectionString: baseDatabaseUrl });
  await admin.connect();
  await admin.query(`DROP DATABASE IF EXISTS ${TEST_DB} WITH (FORCE)`);
  await admin.end();
});

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
  bannedAt: over.bannedAt ?? null,
  bannedReason: over.bannedReason ?? null,
  bannedByUserId: over.bannedByUserId ?? null,
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

  dbPool = new pg.Pool({ connectionString: testUrl });
  db = drizzle(dbPool, { schema: dbSchema });

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

describe('dev sink purge', () => {
  it('reports deleted rows and leaves both sinks empty', async () => {
    await db.insert(devMagicLinks).values({
      email: 'purge@together.dev',
      url: 'http://localhost/magic',
      token: 'purge-token',
      createdAt: NOW,
    });
    await db.insert(devEmails).values({
      to: 'purge@together.dev',
      subject: 'Subject',
      html: '<p>Body</p>',
      text: 'Body',
      createdAt: NOW,
    });

    await expect(createDevSinkPurge(db).purge()).resolves.toEqual({ magicLinks: 1, emails: 1 });
    await expect(db.select().from(devMagicLinks)).resolves.toEqual([]);
    await expect(db.select().from(devEmails)).resolves.toEqual([]);
  });
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

  it('updates ban state and appends its event atomically', async () => {
    const repo = createMemberRepository(db);
    const event = {
      id: 'member-event-acme-ban',
      tenantId: ACME,
      memberId: 'mem-acme',
      type: 'banned' as const,
      reason: 'Repeated abuse',
      actorUserId: 'user-acme-owner',
      occurredAt: NOW,
    };

    await expect(repo.setBanned(
      ACME,
      {
        memberId: 'mem-acme',
        bannedAt: NOW,
        reason: event.reason,
        actorUserId: event.actorUserId,
      },
      { ...event, id: 'member-event-invalid', memberId: 'missing-member' },
    )).rejects.toThrow();
    expect(await repo.findById(ACME, 'mem-acme')).toMatchObject({ bannedAt: null });

    await expect(repo.setBanned(
      ACME,
      {
        memberId: 'mem-acme',
        bannedAt: NOW,
        reason: event.reason,
        actorUserId: event.actorUserId,
      },
      event,
    )).resolves.toMatchObject({
      bannedAt: NOW,
      bannedReason: event.reason,
      bannedByUserId: event.actorUserId,
    });
    expect(await db.select().from(memberEvents).where(eq(memberEvents.id, event.id))).toMatchObject([
      {
        tenantId: ACME,
        memberId: 'mem-acme',
        type: 'banned',
        reason: event.reason,
        actorUserId: event.actorUserId,
      },
    ]);
    expect(
      (await repo.listWithProductIds(ACME, NOW)).find((row) => row.id === 'mem-acme'),
    ).toMatchObject({ bannedAt: NOW, bannedReason: event.reason });
  });
});

describe('post report repository', () => {
  it('deduplicates member and heuristic reports and resolves a post queue atomically', async () => {
    await db.insert(posts).values({
      id: 'post-acme-report',
      tenantId: ACME,
      contextKind: 'space',
      contextId: 'space-acme',
      parentPostId: null,
      rootPostId: 'post-acme-report',
      authorUserId: 'user-acme-owner',
      authorDisplay: 'Acme Owner',
      authorIsStaff: true,
      body: 'Report target',
      createdAt: NOW,
    });

    const repo = createPostReportRepository(db);
    const memberReport = {
      id: 'report-acme-member',
      tenantId: ACME,
      postId: 'post-acme-report',
      reporterUserId: 'user-acme-member',
      reporterDisplay: 'Acme Member',
      source: 'member' as const,
      reason: 'spam' as const,
      note: null,
      signals: null,
      status: 'open' as const,
      createdAt: NOW,
      resolvedAt: null,
      resolvedByUserId: null,
    };
    const openedEvent = {
      id: 'report-event-acme-member-opened',
      tenantId: ACME,
      reportId: memberReport.id,
      postId: memberReport.postId,
      type: 'opened' as const,
      occurredAt: NOW,
    };

    await expect(repo.open(
      ACME,
      { ...memberReport, id: 'report-acme-rollback' },
      { ...openedEvent, id: 'report-event-acme-rollback', reportId: 'missing-report' },
    )).rejects.toThrow();
    await expect(repo.findById(ACME, 'report-acme-rollback')).resolves.toBeNull();

    await expect(repo.open(ACME, memberReport, openedEvent)).resolves.toMatchObject({
      id: memberReport.id,
      source: 'member',
    });
    await expect(repo.open(
      ACME,
      { ...memberReport, id: 'report-acme-member-duplicate' },
      { ...openedEvent, id: 'report-event-acme-member-duplicate', reportId: 'report-acme-member-duplicate' },
    )).resolves.toBeNull();

    const heuristicReport: PostReport = {
      ...memberReport,
      id: 'report-acme-heuristic',
      reporterUserId: null,
      reporterDisplay: null,
      source: 'heuristic' as const,
      signals: ['link-flood'],
    };
    await expect(repo.open(
      ACME,
      heuristicReport,
      { ...openedEvent, id: 'report-event-acme-heuristic', reportId: heuristicReport.id },
    )).resolves.toMatchObject({ id: heuristicReport.id, source: 'heuristic' });
    await expect(repo.open(
      ACME,
      { ...heuristicReport, id: 'report-acme-heuristic-duplicate' },
      {
        ...openedEvent,
        id: 'report-event-acme-heuristic-duplicate',
        reportId: 'report-acme-heuristic-duplicate',
      },
    )).resolves.toBeNull();

    await expect(repo.resolveAllForPost(
      ACME,
      {
        postId: memberReport.postId,
        resolvedAt: FUTURE,
        resolvedByUserId: 'user-acme-owner',
      },
      (reportId) => ({
        id: `report-event-${reportId}-removed`,
        tenantId: ACME,
        reportId,
        postId: memberReport.postId,
        type: 'post_removed',
        occurredAt: FUTURE,
      }),
    )).resolves.toBe(2);
    await expect(repo.countOpen(ACME)).resolves.toBe(0);
    expect(
      await db
        .select()
        .from(postReportEvents)
        .where(eq(postReportEvents.postId, memberReport.postId)),
    ).toHaveLength(4);
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

  it('lists only paid orders without a matching tenant member product grant', async () => {
    const repo = createOrderRepository(db);
    await repo.create(
      ACME,
      order({
        id: 'order-acme-missing-grant',
        tenantId: ACME,
        memberId: 'mem-acme',
        productId: 'prod-acme-draft',
        createdAt: NOW,
      }),
    );

    const rows = await repo.listPaidWithoutGrant(ACME, { paidBefore: NOW, limit: 10 });

    expect(rows).toEqual([
      expect.objectContaining({
        orderId: 'order-acme-missing-grant',
        memberEmail: 'buyer-acme@together.dev',
        productTitle: 'Draft',
      }),
    ]);
    expect(await repo.listPaidWithoutGrant(GLOBEX, { paidBefore: NOW, limit: 10 })).toEqual([]);
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

describe('invoice repository', () => {
  it('compares an exempt VAT treatment after a jsonb round-trip', async () => {
    const repo = createInvoiceRepository(db);
    await repo.create(
      ACME,
      {
        id: 'invoice-vat-jsonb',
        tenantId: ACME,
        orderId: 'order-acme-2',
        status: 'failed',
        provider: 'ifirma',
        providerInvoiceId: null,
        invoiceNumber: null,
        pdfUrl: null,
        error: 'integration_unavailable',
        issuedAt: null,
        createdAt: NOW,
      },
      {
        id: 'invoice-event-vat-jsonb',
        tenantId: ACME,
        invoiceId: 'invoice-vat-jsonb',
        orderId: 'order-acme-2',
        type: 'requested',
        error: null,
        meta: {
          vat: {
            kind: 'exempt',
            basisKind: 'art_113_1',
            basis: 'art. 113 ust. 1',
          },
        },
        occurredAt: NOW,
      },
    );

    const event = await repo.findLatestRequestedEvent(ACME, 'invoice-vat-jsonb');
    expect(invoiceVatTreatmentsEqual(event?.meta.vat, {
      kind: 'exempt',
      basisKind: 'art_113_1',
      basis: 'art. 113 ust. 1',
    })).toBe(true);
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
      ogTitle: null,
      ogDescription: null,
      ogImageUrl: null,
      supportEmail: null,
      supportUrl: null,
      termsUrl: null,
      privacyUrl: null,
      invoiceVatMode: 'exempt',
      invoiceVatRatePercent: null,
      invoiceExemptionBasisKind: 'other_statute',
      invoiceExemptionBasis: '§ 1 rozporządzenia',
    });
    expect(updated).toMatchObject({ billingPortalUrl: 'https://billing.acme.test', bunnyStreamLibraryId: 'lib-1' });
    expect(await repo.findSettings(ACME)).toMatchObject({
      bunnyStreamLibraryId: 'lib-1',
      invoiceVatMode: 'exempt',
      invoiceVatRatePercent: null,
      invoiceExemptionBasisKind: 'other_statute',
      invoiceExemptionBasis: '§ 1 rozporządzenia',
    });
  });

  it('rejects unsupported persisted VAT modes', async () => {
    await expect(db.execute(sql`
      UPDATE tenants SET invoice_vat_mode = 'reverse_charge' WHERE id = ${ACME}
    `)).rejects.toThrow();
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

  it('leases, reclaims, finalizes, and releases payment event claims', async () => {
    const repo = createProcessedPaymentEventRepository(db);
    const event: ProcessedPaymentEvent = {
      id: 'evt-1',
      tenantId: ACME,
      type: 'invoice.paid',
      objectId: 'in-1',
      processedAt: NOW,
    };
    const lease = {
      workerId: 'worker-1',
      now: NOW,
      leaseExpiresAt: '1998-07-14T10:05:00.000Z',
    };
    expect(await repo.claim(ACME, event, lease)).toBe('claimed');
    expect(await repo.claim(ACME, event, lease)).toBe('duplicate');
    expect(await repo.claim(ACME, { ...event, id: 'evt-2' }, lease)).toBe('duplicate');
    const reclaimed = {
      workerId: 'worker-2',
      now: '1998-07-14T10:06:00.000Z',
      leaseExpiresAt: '1998-07-14T10:11:00.000Z',
    };
    expect(await repo.claim(ACME, event, reclaimed)).toBe('claimed');
    await repo.finalize(ACME, event.id, lease.workerId, reclaimed.now);
    await repo.release(ACME, event.id, lease.workerId);
    expect(await repo.claim(ACME, event, reclaimed)).toBe('duplicate');
    await repo.finalize(ACME, event.id, reclaimed.workerId, reclaimed.now);
    expect(
      await repo.claim(ACME, event, {
        ...reclaimed,
        now: '1998-07-14T10:12:00.000Z',
        leaseExpiresAt: '1998-07-14T10:17:00.000Z',
      }),
    ).toBe('duplicate');

    const releasable = { ...event, id: 'evt-3', objectId: 'in-3' };
    expect(await repo.claim(ACME, releasable, lease)).toBe('claimed');
    await repo.release(ACME, releasable.id, lease.workerId);
    expect(await repo.claim(ACME, releasable, lease)).toBe('claimed');
  });

  it('rolls back payment repository writes when the branch fails', async () => {
    const transaction = createPaymentTransactionPort(db);
    const rolledBackOrder = order({
      id: 'order-payment-rollback',
      tenantId: ACME,
      memberId: 'mem-acme',
      productId: 'prod-acme',
    });

    const result = await transaction.run(async (transactionDeps) => {
      await transactionDeps.orders.create(ACME, rolledBackOrder);
      return err(validation('reject payment branch'));
    });

    expect(result).toMatchObject({ ok: false, error: { code: 'validation' } });
    const rows = await db
      .select({ id: orders.id })
      .from(orders)
      .where(and(eq(orders.tenantId, ACME), eq(orders.id, rolledBackOrder.id)));
    expect(rows).toEqual([]);
  });

  it('rolls back writes from every payment transaction repository', async () => {
    await db.insert(coupons).values({
      id: 'coupon-bundle-rollback',
      tenantId: ACME,
      code: 'BUNDLEROLLBACK',
      kind: 'amount',
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
      createdAt: NOW,
    });
    const refundableOrder = order({
      id: 'order-bundle-refundable',
      tenantId: ACME,
      memberId: 'mem-acme',
      productId: 'prod-acme',
    });
    await createOrderRepository(db).create(ACME, refundableOrder);
    const claimedEvent: ProcessedPaymentEvent = {
      id: 'evt-bundle-rollback',
      tenantId: ACME,
      type: 'invoice.paid',
      objectId: 'invoice-bundle-rollback',
      processedAt: NOW,
    };
    const claimLease = {
      workerId: 'worker-bundle',
      now: NOW,
      leaseExpiresAt: '1998-07-14T10:05:00.000Z',
    };
    await createProcessedPaymentEventRepository(db).claim(
      ACME,
      claimedEvent,
      claimLease,
    );
    const transaction = createPaymentTransactionPort(db);
    const transactionMember = member({
      id: 'mem-bundle-rollback',
      tenantId: ACME,
      userId: 'user-acme-owner',
      email: 'owner-acme@together.dev',
    });
    const nestedMember = member({
      id: 'mem-bundle-nested',
      tenantId: ACME,
      userId: 'user-globex-owner',
      email: 'owner-globex@together.dev',
    });
    const transactionOrder = order({
      id: 'order-bundle-rollback',
      tenantId: ACME,
      memberId: transactionMember.id,
      productId: 'prod-acme',
    });
    const couponOrder = order({
      id: 'order-bundle-coupon',
      tenantId: ACME,
      memberId: transactionMember.id,
      productId: 'prod-acme',
      couponId: 'coupon-bundle-rollback',
      discountCents: 100,
    });

    const result = await transaction.run(async (transactionDeps) => {
      await transactionDeps.members.create(ACME, transactionMember);
      await transactionDeps.grants.createGrant(
        ACME,
        grant({
          id: 'grant-bundle-rollback',
          tenantId: ACME,
          memberId: transactionMember.id,
          productId: 'prod-acme',
        }),
      );
      await transactionDeps.orders.create(ACME, transactionOrder);
      await transactionDeps.subscriptions.create(
        ACME,
        subscription({
          id: 'sub-bundle-rollback',
          tenantId: ACME,
          memberId: transactionMember.id,
          productId: 'prod-acme',
          priceId: 'price-acme',
          providerSubscriptionId: 'psub-bundle-rollback',
        }),
      );
      await transactionDeps.paymentRefunds.markOrderRefunded(
        ACME,
        refundableOrder.id,
      );
      await transactionDeps.couponRedemptions.createOrderAndClaim(ACME, {
        order: couponOrder,
        redemption: {
          id: 'redemption-bundle-rollback',
          tenantId: ACME,
          couponId: 'coupon-bundle-rollback',
          orderId: couponOrder.id,
          memberId: transactionMember.id,
          email: transactionMember.email,
          discountCents: 100,
          createdAt: NOW,
        },
        event: {
          id: 'redemption-event-bundle-rollback',
          tenantId: ACME,
          redemptionId: 'redemption-bundle-rollback',
          couponId: 'coupon-bundle-rollback',
          orderId: couponOrder.id,
          type: 'redeemed',
          occurredAt: NOW,
        },
        maxRedemptions: null,
        maxRedemptionsPerMember: null,
      });
      await transactionDeps.emailOutbox.enqueue({
        id: 'outbox-bundle-rollback',
        tenantId: ACME,
        to: transactionMember.email,
        payload: {
          kind: 'reset-password',
          language: 'pl',
          actionUrl: 'https://acme.example.test/reset',
        },
        now: NOW,
      });
      await transactionDeps.processedPaymentEvents.finalize(
        ACME,
        claimedEvent.id,
        claimLease.workerId,
        NOW,
      );
      await transactionDeps.enrollmentTransaction.run(async (nestedDeps) => {
        await nestedDeps.members.create(ACME, nestedMember);
        await nestedDeps.grants.createGrant(
          ACME,
          grant({
            id: 'grant-bundle-nested',
            tenantId: ACME,
            memberId: nestedMember.id,
            productId: 'prod-acme',
          }),
        );
        await nestedDeps.emailOutbox.enqueue({
          id: 'outbox-bundle-nested',
          tenantId: ACME,
          to: nestedMember.email,
          payload: {
            kind: 'reset-password',
            language: 'pl',
            actionUrl: 'https://acme.example.test/reset',
          },
          now: NOW,
        });
        return ok(undefined);
      });
      return err(validation('reject full payment bundle'));
    });

    expect(result).toMatchObject({ ok: false, error: { code: 'validation' } });
    expect(
      await db
        .select({ id: members.id })
        .from(members)
        .where(inArray(members.id, [transactionMember.id, nestedMember.id])),
    ).toEqual([]);
    expect(
      await db
        .select({ id: productGrants.id })
        .from(productGrants)
        .where(inArray(productGrants.id, [
          'grant-bundle-rollback',
          'grant-bundle-nested',
        ])),
    ).toEqual([]);
    expect(
      await db
        .select({ id: orders.id })
        .from(orders)
        .where(inArray(orders.id, [transactionOrder.id, couponOrder.id])),
    ).toEqual([]);
    expect(
      await db
        .select({ id: memberSubscriptions.id })
        .from(memberSubscriptions)
        .where(eq(memberSubscriptions.id, 'sub-bundle-rollback')),
    ).toEqual([]);
    expect(
      await db
        .select({ id: couponRedemptions.id })
        .from(couponRedemptions)
        .where(eq(couponRedemptions.id, 'redemption-bundle-rollback')),
    ).toEqual([]);
    expect(
      await db
        .select({ id: emailOutbox.id })
        .from(emailOutbox)
        .where(inArray(emailOutbox.id, [
          'outbox-bundle-rollback',
          'outbox-bundle-nested',
        ])),
    ).toEqual([]);
    expect(
      await db
        .select({ status: orders.status })
        .from(orders)
        .where(eq(orders.id, refundableOrder.id)),
    ).toEqual([{ status: 'paid' }]);
    expect(
      await db
        .select({
          status: processedPaymentEvents.status,
          workerId: processedPaymentEvents.workerId,
        })
        .from(processedPaymentEvents)
        .where(eq(processedPaymentEvents.id, claimedEvent.id)),
    ).toEqual([{ status: 'processing', workerId: claimLease.workerId }]);
  });

  it('keeps the outer payment transaction usable after a coupon savepoint fails', async () => {
    await db.insert(coupons).values({
      id: 'coupon-savepoint',
      tenantId: ACME,
      code: 'SAVEPOINT',
      kind: 'amount',
      value: 100,
      scope: { kind: 'all' },
      appliesTo: 'one_time',
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
    const transaction = createPaymentTransactionPort(db);
    const nestedOrder = order({
      id: 'order-savepoint-nested',
      tenantId: ACME,
      memberId: 'mem-acme',
      productId: 'prod-acme',
      couponId: 'coupon-savepoint',
      discountCents: 100,
    });
    const outerOrder = order({
      id: 'order-savepoint-outer',
      tenantId: ACME,
      memberId: 'mem-acme',
      productId: 'prod-acme',
    });

    const result = await transaction.run(async (transactionDeps) => {
      await expect(
        transactionDeps.couponRedemptions.createOrderAndClaim(ACME, {
          order: nestedOrder,
          redemption: {
            id: 'redemption-savepoint',
            tenantId: ACME,
            couponId: 'coupon-savepoint',
            orderId: nestedOrder.id,
            memberId: 'mem-acme',
            email: 'member@together.dev',
            discountCents: 100,
            createdAt: NOW,
          },
          event: {
            id: 'redemption-event-savepoint',
            tenantId: ACME,
            redemptionId: 'missing-redemption',
            couponId: 'coupon-savepoint',
            orderId: nestedOrder.id,
            type: 'redeemed',
            occurredAt: NOW,
          },
          maxRedemptions: null,
          maxRedemptionsPerMember: null,
        }),
      ).rejects.toBeDefined();
      await transactionDeps.orders.create(ACME, outerOrder);
      return ok(undefined);
    });

    expect(result).toEqual(ok(undefined));
    expect(
      await db
        .select({ id: orders.id })
        .from(orders)
        .where(inArray(orders.id, [nestedOrder.id, outerOrder.id]))
        .orderBy(asc(orders.id)),
    ).toEqual([{ id: outerOrder.id }]);
    expect(
      await db
        .select({ id: couponRedemptions.id })
        .from(couponRedemptions)
        .where(eq(couponRedemptions.id, 'redemption-savepoint')),
    ).toEqual([]);
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
    const module: CourseModule = {
      id: 'module-acme', tenantId: ACME, courseIds: ['course-acme'], title: 'M', prefix: null, name: 'M',
      chapters: [{ id: 'chapter-acme', name: 'Chapter', contents: [{ id: 'content-acme', name: 'L', lessonId: 'lesson-acme' }] }],
      legacyId: null, createdAt: NOW,
    };
    const lesson: CourseLesson = { id: 'lesson-acme', tenantId: ACME, name: 'L', isPreview: true, contents: [], legacyId: null, createdAt: NOW };
    await courses.create(ACME, course);
    await modules.create(ACME, module);
    await lessons.create(ACME, lesson);

    expect((await courses.list(ACME)).map((c) => c.id)).toEqual(['course-acme']);
    expect(await courses.list(GLOBEX)).toEqual([]);
    expect(await modules.findById(ACME, 'module-acme')).toMatchObject({ courseIds: ['course-acme'] });
    expect(await lessons.findById(ACME, 'lesson-acme')).toMatchObject({ isPreview: true });
    expect(await lessons.findById(GLOBEX, 'lesson-acme')).toBeNull();
    expect(await lessons.listPreviews(ACME)).toEqual([
      { id: 'lesson-acme', name: 'L', courseId: 'course-acme' },
    ]);
    expect(await lessons.listPreviews(GLOBEX)).toEqual([]);
  });
});

describe('post repository', () => {
  it('counts and lists only recent non-deleted posts by the tenant author', async () => {
    const repo = createPostRepository(db);
    const postAt = (id: string, createdAt: string, deletedAt: string | null = null): Post => ({
      id,
      tenantId: ACME,
      contextKind: 'space',
      contextId: 'space-spam-window',
      parentPostId: null,
      rootPostId: id,
      authorUserId: 'user-acme-spammer',
      authorDisplay: 'Acme Member',
      authorIsStaff: false,
      body: `Body ${id}`,
      createdAt,
      editedAt: null,
      deletedAt,
      pinnedAt: null,
    });
    await repo.createPost(ACME, postAt('post-spam-old', '1998-07-14T08:00:00.000Z'));
    await repo.createPost(ACME, postAt('post-spam-recent-a', '1998-07-14T09:50:00.000Z'));
    await repo.createPost(ACME, postAt('post-spam-recent-b', '1998-07-14T09:55:00.000Z'));
    await repo.createPost(
      ACME,
      postAt('post-spam-deleted', '1998-07-14T09:59:00.000Z', '1998-07-14T10:00:00.000Z'),
    );

    const query = {
      authorUserId: 'user-acme-spammer',
      since: '1998-07-14T09:45:00.000Z',
    };
    await expect(repo.countByAuthorSince(ACME, query)).resolves.toBe(2);
    await expect(repo.countByAuthorSince(GLOBEX, query)).resolves.toBe(0);
    await expect(repo.listRecentBodiesByAuthor(ACME, { ...query, limit: 1 }))
      .resolves.toEqual(['Body post-spam-recent-b']);
    await expect(repo.findByIds(ACME, ['post-spam-recent-a', 'missing']))
      .resolves.toMatchObject([{ id: 'post-spam-recent-a' }]);
    await expect(repo.findByIds(GLOBEX, ['post-spam-recent-a'])).resolves.toEqual([]);
  });

  it('lists only posts for the requested tenant and author', async () => {
    const repo = createPostRepository(db);
    const authoredPost = (
      id: string,
      tenantId: string,
      authorUserId: string,
    ): Post => ({
      id,
      tenantId,
      contextKind: 'space',
      contextId: `space-${id}`,
      parentPostId: null,
      rootPostId: id,
      authorUserId,
      authorDisplay: authorUserId,
      authorIsStaff: false,
      body: id,
      createdAt: NOW,
      editedAt: null,
      deletedAt: null,
      pinnedAt: null,
    });
    await repo.createPost(
      ACME,
      authoredPost('post-author-acme', ACME, 'user-acme-member'),
    );
    await repo.createPost(
      ACME,
      authoredPost('post-other-author', ACME, 'user-acme-owner'),
    );
    await repo.createPost(
      GLOBEX,
      authoredPost('post-author-globex', GLOBEX, 'user-acme-member'),
    );

    await expect(repo.listByAuthor(ACME, 'user-acme-member')).resolves.toEqual([
      expect.objectContaining({ id: 'post-author-acme', tenantId: ACME }),
    ]);
  });

  it('clears a pin when soft-deleting a post', async () => {
    const repo = createPostRepository(db);
    const post: Post = {
      id: 'post-pinned-delete',
      tenantId: ACME,
      contextKind: 'space',
      contextId: 'space-pinned-delete',
      parentPostId: null,
      rootPostId: 'post-pinned-delete',
      authorUserId: 'user-acme-member',
      authorDisplay: 'Acme Member',
      authorIsStaff: false,
      body: 'Pinned post',
      createdAt: NOW,
      editedAt: null,
      deletedAt: null,
      pinnedAt: null,
    };

    await repo.createPost(ACME, post);
    await repo.setPinned(ACME, { id: post.id, pinnedAt: NOW });
    await repo.softDelete(ACME, { id: post.id, deletedAt: FUTURE });

    const rows = await db
      .select({ pinnedAt: posts.pinnedAt })
      .from(posts)
      .where(and(eq(posts.tenantId, ACME), eq(posts.id, post.id)));
    expect(rows).toEqual([{ pinnedAt: null }]);
    await expect(repo.listPinnedForContext(ACME, {
      contextKind: post.contextKind,
      contextId: post.contextId,
      limit: 10,
    })).resolves.toEqual([]);
    await expect(repo.countPinnedForContext(ACME, {
      contextKind: post.contextKind,
      contextId: post.contextId,
    })).resolves.toBe(0);
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
    await db.insert(postReports).values({
      id: 'report-rodo',
      tenantId: RODO,
      postId: 'post-rodo',
      reporterUserId: 'user-rodo-buyer',
      reporterDisplay: 'Jan Kowalski',
      source: 'member',
      reason: 'spam',
      note: null,
      signals: null,
      status: 'open',
      createdAt: NOW,
      resolvedAt: null,
      resolvedByUserId: null,
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
    expect(result).toEqual({
      alreadyDeleted: false,
      authUserErased: true,
      erasureRequestId: null,
    });

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
    bannedAt: null,
    bannedReason: null,
    bannedByUserId: null,
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

    const reportRows = await db.select().from(postReports).where(eq(postReports.id, 'report-rodo'));
    expect(reportRows[0]).toMatchObject({
      reporterUserId: 'user-rodo-buyer',
      reporterDisplay: DELETED_MEMBER_DISPLAY,
    });

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
    expect(result).toEqual({
      alreadyDeleted: true,
      authUserErased: false,
      erasureRequestId: null,
    });
  });

  it('returns null for a member of another tenant', async () => {
    const result = await createMemberErasureRepository(db, emailHmac).pseudonymize(OTHER, pseudonymizationInput('mem-rodo'));
    expect(result).toBeNull();
  });

  it('keeps the auth user when other tenant memberships still reference it', async () => {
    const result = await createMemberErasureRepository(db, emailHmac).pseudonymize(RODO, pseudonymizationInput('mem-rodo-shared'));
    expect(result).toEqual({
      alreadyDeleted: false,
      authUserErased: false,
      erasureRequestId: null,
    });

    const authRows = await db.select().from(user).where(eq(user.id, 'user-rodo-shared'));
    expect(authRows).toHaveLength(1);
    expect(await createMemberRepository(db).findById(OTHER, 'mem-other-shared')).toMatchObject({
      email: 'anna.shared@together.dev',
      deletedAt: null,
    });
  });

  it('writes request events atomically and completes an open request during erasure', async () => {
    await db.insert(user).values({
      id: 'user-erasure-request',
      name: 'Request Member',
      email: 'request.member@together.dev',
    });
    await createMemberRepository(db).create(
      RODO,
      member({
        id: 'mem-erasure-request',
        tenantId: RODO,
        userId: 'user-erasure-request',
        email: 'request.member@together.dev',
      }),
    );
    const repository = createMemberErasureRequestRepository(db);
    const request = {
      id: 'erasure-request-1',
      tenantId: RODO,
      memberId: 'mem-erasure-request',
      status: 'open' as const,
      reason: null,
      requestedAt: NOW,
      dueAt: '1998-08-13T10:00:00.000Z',
      resolvedAt: null,
      resolvedByUserId: null,
      resolutionNote: null,
    };
    const event = {
      id: 'erasure-event-1',
      tenantId: RODO,
      requestId: request.id,
      type: 'requested' as const,
      actorUserId: 'user-erasure-request',
      meta: null,
      occurredAt: NOW,
      createdAt: NOW,
    };
    expect(await repository.create(RODO, request, event)).toBe('created');
    expect(
      await repository.create(
        RODO,
        { ...request, id: 'erasure-request-2' },
        { ...event, id: 'erasure-event-2', requestId: 'erasure-request-2' },
      ),
    ).toBe('already-open');

    const erased = await createMemberErasureRepository(db, emailHmac).pseudonymize(
      RODO,
      pseudonymizationInput('mem-erasure-request'),
    );
    expect(erased).toMatchObject({ erasureRequestId: request.id });
    expect(await repository.findLatestForMember(RODO, request.memberId)).toMatchObject({
      id: request.id,
      status: 'completed',
    });
    const events = await db
      .select({ type: memberErasureRequestEvents.type })
      .from(memberErasureRequestEvents)
      .where(eq(memberErasureRequestEvents.requestId, request.id))
      .orderBy(asc(memberErasureRequestEvents.occurredAt));
    expect(events).toEqual([{ type: 'requested' }, { type: 'completed' }]);
  });

  it('blocks a hard member delete while order history exists', async () => {
    await expect(
      db.delete(members).where(and(eq(members.tenantId, RODO), eq(members.id, 'mem-rodo'))),
    ).rejects.toThrow();
  });
});
