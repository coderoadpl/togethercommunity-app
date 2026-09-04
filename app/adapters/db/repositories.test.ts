import { and, asc, eq, inArray, sql, type SQL } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import {
  NO_DM_BLOCKS,
  deletedMemberDisplay,
  err,
  invoiceVatTreatmentsEqual,
  memberTombstone,
  normalizeEmail,
  ok,
  validation,
} from '#core/domain/index.js';
import type {
  CourseLesson,
  CourseModule,
  Course,
  DmConversation,
  DmMessage,
  DmReport,
  Member,
  MemberBlock,
  MemberSubscription,
  Notification,
  Order,
  Post,
  PostReport,
  ProcessedPaymentEvent,
  ImportAuditEvent,
  Product,
  ProductGrant,
  ProductPrice,
  Space,
  SpaceEvent,
  TenantApiKey,
  TenantSecret,
} from '#core/domain/index.js';

import type { Db } from './client.js';
import {
  createAvatarSourceReader,
  createCourseLessonRepository,
  createCourseModuleRepository,
  createCourseRepository,
  createCheckoutConsentCaptureRepository,
  createDevSinkPurge,
  createHealthPort,
  createMemberCourseProgressRepository,
  createMemberErasureRepository,
  createMemberRepository,
  createDmConversationRepository,
  createDmConversationStateRepository,
  createDmMessageRepository,
  createDmReportRepository,
  createMemberBlockRepository,
  createMemberSubscriptionRepository,
  createNotificationRepository,
  createOrderRepository,
  createPostRepository,
  createPostReportRepository,
  createProcessedPaymentEventRepository,
  createPurchaseRepository,
  createProductGrantRepository,
  createProductPriceRepository,
  createProductRepository,
  createSignInMethodReader,
  createSpaceEventRepository,
  createSpaceEventRsvpRepository,
  createSpaceRepository,
  createSpaceSeenRepository,
  createTenantAccessReader,
  createTenantApiKeyRepository,
  createApiKeyRateLimitRepository,
  createPublicRateLimitRepository,
  createTenantRepository,
  createTenantSecretRepository,
  createUserDisplayReader,
} from './repositories.js';
import { createMemberEventRepository } from './member-events.js';
import { createImportAuditEventRepository } from './import-audit-events.js';
import {
  createCouponRedemptionRepository,
  createCouponStatsRepository,
  createProductPriceHistoryRepository,
} from './coupon-repositories.js';
import { createInvoiceRepository } from './invoice-repositories.js';
import { createAutoInvoiceJobRepository } from './auto-invoice-jobs.js';
import { createPaymentTransactionPort } from './payment-transaction.js';
import { createMemberErasureRequestRepository } from './member-erasure-requests.js';
import {
  account,
  autoInvoiceJobs,
  consents,
  couponRedemptions,
  couponCheckoutSessions,
  dmReports,
  coupons,
  courses,
  devEmails,
  devMagicLinks,
  emailOutbox,
  emailEvents,
  invoices,
  erasedMemberImports,
  memberBlocks,
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
import { createNotificationFanoutJobRepository, insertFanoutJob } from './notification-fanout-jobs.js';
import { createTestDatabase } from './test-database-name.js';

const baseDatabaseUrl = process.env['DATABASE_URL'] ?? 'postgres://together:together@localhost:48912/together';

const NOW = '1998-07-14T10:00:00.000Z';
const PAST = '1998-01-01T00:00:00.000Z';
const FUTURE = '1998-12-01T00:00:00.000Z';

const ACME = 'tenant-acme';
const GLOBEX = 'tenant-globex';

let db: Db;
let closeTestDatabase: () => Promise<void>;
const emailHmac = { compute: (tenantId: string, email: string) => `${tenantId}:${email.trim().toLowerCase()}` };

afterAll(async () => {
  await closeTestDatabase();
});

const product = (over: Partial<Product> & { id: string; tenantId: string }): Product => ({
  type: 'course',
  slug: over.id,
  title: 'Course',
  description: 'desc',
  coverUrl: null,
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
  dmOptOutAt: over.dmOptOutAt ?? null,
});

beforeAll(async () => {
  const testDatabase = await createTestDatabase('together_repositories_test', baseDatabaseUrl);
  db = testDatabase.db;
  closeTestDatabase = testDatabase.close;

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
    expect((await repo.findByIds(ACME, ['prod-acme', 'prod-globex'])).map((product) => product.id))
      .toEqual(['prod-acme']);
  });

  it('returns slug_taken for the tenant slug unique constraint', async () => {
    const repo = createProductRepository(db);
    await expect(repo.create(ACME, product({
      id: 'prod-acme-duplicate-slug',
      tenantId: ACME,
      slug: 'prod-acme',
    }))).resolves.toBe('slug_taken');
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

  it('sets and clears the display name inside the owning tenant only', async () => {
    const repo = createMemberRepository(db);

    expect(await repo.updateDisplayName(ACME, 'mem-acme', 'Ada L.')).toMatchObject({
      id: 'mem-acme',
      displayName: 'Ada L.',
    });
    expect(await repo.findById(ACME, 'mem-acme')).toMatchObject({ displayName: 'Ada L.' });
    expect(await repo.updateDisplayName(GLOBEX, 'mem-acme', 'Stolen')).toBeNull();
    expect(await repo.findById(ACME, 'mem-acme')).toMatchObject({ displayName: 'Ada L.' });
    expect(await repo.updateDisplayName(ACME, 'mem-acme', null)).toMatchObject({
      displayName: null,
    });
  });

  it('updates ban state and appends its event atomically', async () => {
    const repo = createMemberRepository(db);
    const event = {
      id: 'member-event-acme-ban',
      tenantId: ACME,
      memberId: 'mem-acme',
      type: 'banned' as const,
      payload: { reason: 'Repeated abuse', actorUserId: 'user-acme-owner' },
      occurredAt: NOW,
    };

    await expect(repo.setBanned(
      ACME,
      {
        memberId: 'mem-acme',
        bannedAt: NOW,
        reason: event.payload.reason,
        actorUserId: event.payload.actorUserId,
      },
      { ...event, id: 'member-event-invalid', memberId: 'missing-member' },
    )).rejects.toThrow();
    expect(await repo.findById(ACME, 'mem-acme')).toMatchObject({ bannedAt: null });

    await expect(repo.setBanned(
      ACME,
      {
        memberId: 'mem-acme',
        bannedAt: NOW,
        reason: event.payload.reason,
        actorUserId: event.payload.actorUserId,
      },
      event,
    )).resolves.toMatchObject({
      bannedAt: NOW,
      bannedReason: event.payload.reason,
      bannedByUserId: event.payload.actorUserId,
    });
    expect(await db.select().from(memberEvents).where(eq(memberEvents.id, event.id))).toMatchObject([
      {
        tenantId: ACME,
        memberId: 'mem-acme',
        type: 'banned',
        payload: event.payload,
      },
    ]);
    expect(
      (await repo.listWithProductIds(ACME, NOW)).find((row) => row.id === 'mem-acme'),
    ).toMatchObject({ bannedAt: NOW, bannedReason: event.payload.reason });
  });
});

describe('member event repository', () => {
  it('merges commerce, access, subscription, and learning events newest-first', async () => {
    await createCourseRepository(db).create(ACME, {
      id: 'course-member-events',
      tenantId: ACME,
      name: 'Member events course',
      description: '',
      imageUrl: null,
      moduleOrder: [],
      publiclyVisible: false,
      legacyId: null,
      createdAt: NOW,
    });
    const progress = createMemberCourseProgressRepository(db);
    const row = await progress.findOrCreate(ACME, {
      id: 'progress-member-events',
      memberId: 'mem-acme',
      courseId: 'course-member-events',
      now: PAST,
    });
    await progress.update(ACME, {
      ...row,
      memberId: 'mem-globex',
      completedLessonIds: ['lesson-member-events'],
      updatedAt: FUTURE,
    });

    const events = await createMemberEventRepository(db).listForMember(ACME, 'mem-acme');
    expect(events.map((event) => event.type)).toEqual(expect.arrayContaining([
      'purchase',
      'grant',
      'subscription-change',
      'lesson-completion',
    ]));
    expect(events[0]).toMatchObject({
      type: 'lesson-completion',
      payload: { courseId: 'course-member-events', lessonId: 'lesson-member-events' },
    });
    expect(events.every((event) => event.tenantId === ACME && event.memberId === 'mem-acme')).toBe(true);

    await db.delete(memberCourseProgress).where(eq(memberCourseProgress.id, 'progress-member-events'));
    await db.delete(courses).where(eq(courses.id, 'course-member-events'));
  });

  it('stores open event types and skips rows unsupported by the current registry', async () => {
    await db.insert(memberEvents).values([
      {
        id: 'member-event-open-type',
        tenantId: ACME,
        memberId: 'mem-acme',
        type: 'community-post',
        payload: { postId: 'post-1' },
        occurredAt: NOW,
      },
      {
        id: 'member-event-invalid-payload',
        tenantId: ACME,
        memberId: 'mem-acme',
        type: 'purchase',
        payload: { orderId: 'legacy-order' },
        occurredAt: NOW,
      },
    ]);
    const [stored] = await db.select({
      type: memberEvents.type,
      payload: memberEvents.payload,
    }).from(memberEvents).where(eq(memberEvents.id, 'member-event-open-type'));
    expect(stored).toEqual({ type: 'community-post', payload: { postId: 'post-1' } });
    const visible = await createMemberEventRepository(db).listForMember(ACME, 'mem-acme');
    expect(visible.map((event) => event.id)).not.toEqual(expect.arrayContaining([
      'member-event-open-type',
      'member-event-invalid-payload',
    ]));
    await db.delete(memberEvents).where(inArray(memberEvents.id, [
      'member-event-open-type',
      'member-event-invalid-payload',
    ]));
  });
});

describe('purchase repository', () => {
  it('records the access change created by a simulated purchase', async () => {
    await db.insert(user).values({
      id: 'user-simulated-purchase',
      name: 'Simulated Buyer',
      email: 'simulated-buyer@together.dev',
    });
    const result = await createPurchaseRepository(db).createMemberGrant({
      tenantId: ACME,
      userId: 'user-simulated-purchase',
      email: 'simulated-buyer@together.dev',
      memberId: 'member-simulated-purchase',
      grantId: 'grant-simulated-purchase',
      productId: 'prod-acme',
      createdAt: NOW,
    });

    expect(result.grantCreated).toBe(true);
    expect(await createMemberEventRepository(db).listForMember(
      ACME,
      'member-simulated-purchase',
    )).toContainEqual(expect.objectContaining({
      type: 'grant',
      payload: {
        grantId: 'grant-simulated-purchase',
        productId: 'prod-acme',
        source: 'simulated',
        startsAt: NOW,
        expiresAt: null,
      },
    }));

    await db.delete(memberEvents).where(eq(memberEvents.memberId, 'member-simulated-purchase'));
    await db.delete(productGrants).where(eq(productGrants.memberId, 'member-simulated-purchase'));
    await db.delete(members).where(eq(members.id, 'member-simulated-purchase'));
    await db.delete(user).where(eq(user.id, 'user-simulated-purchase'));
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
    expect(await createMemberEventRepository(db).listForMember(ACME, 'mem-acme')).toContainEqual(
      expect.objectContaining({
        type: 'revoke',
        payload: { grantId: 'grant-acme', productId: 'prod-acme', expiresAt: NOW },
      }),
    );
    await repo.setGrantWindow(ACME, 'grant-acme', {
      startsAt: PAST,
      expiresAt: FUTURE,
      occurredAt: NOW,
    });
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

    const memberOrders = await repo.listForMember(ACME, 'mem-acme');
    expect(memberOrders.map((entry) => entry.memberId)).toEqual(['mem-acme', 'mem-acme']);
    expect(memberOrders[0]).toMatchObject({
      memberEmail: 'buyer-acme@together.dev',
      productTitle: 'Acme Course',
    });
    expect(await repo.listForMember(ACME, 'mem-globex')).toEqual([]);
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
    const [redemption] = await db
      .select({ orderId: couponRedemptions.orderId })
      .from(couponRedemptions)
      .where(eq(couponRedemptions.couponId, 'coupon-race'));
    expect(await db.select().from(memberEvents).where(
      eq(memberEvents.id, `purchase:${redemption?.orderId ?? 'missing'}`),
    )).toMatchObject([{
      tenantId: ACME,
      memberId: 'mem-acme',
      type: 'purchase',
      payload: expect.objectContaining({
        orderId: redemption?.orderId,
        amountCents: 2450,
      }),
    }]);
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
    let multipleTenantWarnings = 0;
    const repo = createTenantRepository(db, {
      onMultipleTenants: () => {
        multipleTenantWarnings += 1;
      },
    });
    expect(await repo.findBySlug('acme')).toMatchObject({
      id: ACME,
      slug: 'acme',
      status: 'active',
      plan: 'self_hosted',
    });
    expect(await repo.findById(GLOBEX)).toMatchObject({ slug: 'globex' });
    expect(await repo.findSole()).toBeNull();
    expect(multipleTenantWarnings).toBe(1);
    const previousVersion = (await repo.findById(ACME))?.contentVersion;
    expect(await repo.hasAny()).toBe(true);
    expect(await repo.createTenantWithOwnerGrant(
      {
        tenant: {
          id: 'tenant-bootstrap-rejected',
          slug: 'bootstrap-rejected',
          name: 'Rejected',
          createdAt: NOW,
        },
        ownerGrant: {
          id: 'admin-bootstrap-rejected',
          userId: 'user-acme-owner',
          staffRole: 'owner',
        },
      },
      { requireEmpty: true },
    )).toBeNull();
    expect(await repo.findById('tenant-bootstrap-rejected')).toBeNull();
    const updated = await repo.updateSettings(ACME, {
      name: 'Acme Academy',
      socialLinks: [{ label: 'YouTube', url: 'https://youtube.com/@acme' }],
      billingPortalUrl: 'https://billing.acme.test',
      bunnyStreamLibraryId: 'lib-1',
      bunnyStreamCdnHostname: 'vz-acme.b-cdn.net',
      logoUrl: null,
      logoDarkUrl: null,
      accentColor: null,
      faviconUrl: null,
      ogTitle: null,
      ogDescription: null,
      ogImageUrl: null,
      supportEmail: null,
      supportUrl: null,
      termsUrl: null,
      privacyUrl: null,
      defaultHomeSpaceId: null,
      invoiceVatMode: 'exempt',
      invoiceVatRatePercent: null,
      invoiceExemptionBasisKind: 'other_statute',
      invoiceExemptionBasis: '§ 1 rozporządzenia',
    });
    expect(updated).toMatchObject({
      name: 'Acme Academy',
      socialLinks: [{ label: 'YouTube', url: 'https://youtube.com/@acme' }],
      billingPortalUrl: 'https://billing.acme.test',
      bunnyStreamLibraryId: 'lib-1',
      bunnyStreamCdnHostname: 'vz-acme.b-cdn.net',
    });
    expect(await repo.findSettings(ACME)).toMatchObject({
      name: 'Acme Academy',
      socialLinks: [{ label: 'YouTube', url: 'https://youtube.com/@acme' }],
      bunnyStreamLibraryId: 'lib-1',
      bunnyStreamCdnHostname: 'vz-acme.b-cdn.net',
      invoiceVatMode: 'exempt',
      invoiceVatRatePercent: null,
      invoiceExemptionBasisKind: 'other_statute',
      invoiceExemptionBasis: '§ 1 rozporządzenia',
    });
    expect((await repo.findById(ACME))?.contentVersion).toBe((previousVersion ?? 0) + 1);
  });

  it('rejects unsupported persisted VAT modes', async () => {
    await expect(db.execute(sql`
      UPDATE tenants SET invoice_vat_mode = 'reverse_charge' WHERE id = ${ACME}
    `)).rejects.toThrow();
  });

  it('rejects unsupported tenant lifecycle values', async () => {
    await expect(db.execute(sql`
      UPDATE tenants SET status = 'deleted' WHERE id = ${ACME}
    `)).rejects.toThrow();
    await expect(db.execute(sql`
      UPDATE tenants SET plan = 'enterprise' WHERE id = ${ACME}
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
    expect(await reader.findMember(ACME, 'user-acme-member')).toMatchObject({ id: 'mem-acme' });
  });

  it('limits user display names to identities belonging to the tenant', async () => {
    const reader = createUserDisplayReader(db);
    const displays = await reader.findDisplayNames(ACME, [
      'user-acme-owner',
      'user-acme-member',
      'user-globex-owner',
      'user-globex-member',
    ]);
    expect(displays).toEqual(new Map([
      ['user-acme-owner', 'Acme Owner'],
      ['user-acme-member', 'Acme Member'],
    ]));
  });

  it('reads avatar sources for tenant identities only, preferring the member e-mail', async () => {
    await db.insert(user).values({
      id: 'user-acme-avatar',
      name: 'Avatar Member',
      email: 'account-avatar@together.dev',
      image: 'https://lh3.googleusercontent.com/a/avatar',
    });
    await createMemberRepository(db).create(ACME, member({
      id: 'mem-acme-avatar',
      tenantId: ACME,
      userId: 'user-acme-avatar',
      email: 'member-avatar@together.dev',
    }));

    const reader = createAvatarSourceReader(db);
    const sources = await reader.listAvatarSources(ACME, [
      'user-acme-avatar',
      'user-acme-owner',
      'user-globex-member',
    ]);

    expect([...sources].sort((a, b) => a.userId.localeCompare(b.userId))).toEqual([
      { userId: 'user-acme-avatar', email: 'member-avatar@together.dev', image: 'https://lh3.googleusercontent.com/a/avatar' },
      { userId: 'user-acme-owner', email: 'owner-acme@together.dev', image: null },
    ]);
    expect(await reader.listAvatarSources(GLOBEX, ['user-acme-avatar'])).toEqual([]);
    expect(await reader.listAvatarSources(ACME, [])).toEqual([]);
  });

  it('stores and revokes API keys by hash within the tenant', async () => {
    const repo = createTenantApiKeyRepository(db);
    const apiKey: TenantApiKey = {
      id: 'key-acme',
      tenantId: ACME,
      name: 'CI',
      keyHash: 'hash-abc',
      scopes: null,
      createdAt: NOW,
      expiresAt: null,
      revokedAt: null,
    };
    await repo.create(ACME, apiKey);
    expect(await repo.findActiveByHash(ACME, 'hash-abc')).toMatchObject({ id: 'key-acme' });
    expect(await repo.findActiveByHash(GLOBEX, 'hash-abc')).toBeNull();
    const rateLimits = createApiKeyRateLimitRepository(db);
    const claim = { apiKeyId: apiKey.id, period: 'minute' as const, windowStartedAt: NOW, limit: 1 };
    expect(await rateLimits.claim(ACME, claim)).toBe(true);
    expect(await rateLimits.claim(ACME, claim)).toBe(false);
    expect(await rateLimits.claim(ACME, { ...claim, windowStartedAt: '1998-07-22T00:01:00.000Z' })).toBe(true);
    await repo.revoke(ACME, 'key-acme', NOW);
    expect(await repo.findActiveByHash(ACME, 'hash-abc')).toBeNull();
  });

  it('counts public rate-limit windows and purges only the expired ones', async () => {
    const buckets = createPublicRateLimitRepository(db);
    const window = {
      scope: 'public-write:ip',
      key: '203.0.113.7',
      windowStartedAt: NOW,
      expiresAt: '1998-07-14T10:01:00.000Z',
      limit: 2,
    };

    expect(await buckets.claim(window)).toBe(true);
    expect(await buckets.claim(window)).toBe(true);
    expect(await buckets.claim(window)).toBe(false);
    expect(await buckets.claim({ ...window, key: '203.0.113.8' })).toBe(true);
    expect(await buckets.claim({
      ...window,
      windowStartedAt: '1998-07-14T10:01:00.000Z',
      expiresAt: '1998-07-14T10:02:00.000Z',
    })).toBe(true);

    expect(await buckets.purgeExpired('1998-07-14T10:01:30.000Z')).toBe(1);
    expect(await buckets.claim({
      ...window,
      windowStartedAt: '1998-07-14T10:01:00.000Z',
      expiresAt: '1998-07-14T10:02:00.000Z',
    })).toBe(true);
    expect(await buckets.purgeExpired('1998-07-14T11:00:00.000Z')).toBe(1);
  });

  it('appends and tenant-scopes import audit events', async () => {
    const apiKeys = createTenantApiKeyRepository(db);
    await apiKeys.create(ACME, {
      id: 'key-import-acme',
      tenantId: ACME,
      name: 'Migration',
      keyHash: 'hash-import-acme',
      scopes: ['import:content'],
      createdAt: NOW,
      expiresAt: FUTURE,
      revokedAt: null,
    });
    const repo = createImportAuditEventRepository(db);
    const first: ImportAuditEvent = {
      id: 'import-audit-1',
      tenantId: ACME,
      apiKeyId: 'key-import-acme',
      kind: 'course',
      importKey: 'course-source-1',
      resourceId: 'course-source-1',
      action: 'created',
      payloadHash: 'a'.repeat(64),
      at: NOW,
    };
    const second: ImportAuditEvent = {
      ...first,
      id: 'import-audit-2',
      action: 'unchanged',
      payloadHash: 'b'.repeat(64),
      at: '1998-07-14T10:01:00.000Z',
    };
    await repo.append(ACME, first);
    await repo.append(ACME, second);

    expect(await repo.listByApiKey(ACME, 'key-import-acme', { limit: 10 })).toEqual({
      events: [second, first],
      nextCursor: null,
    });
    const firstPage = await repo.listByApiKey(ACME, 'key-import-acme', { limit: 1 });
    expect(firstPage).toEqual({ events: [second], nextCursor: second.id });
    expect(await repo.listByApiKey(ACME, 'key-import-acme', {
      cursor: firstPage.nextCursor ?? '',
      limit: 1,
    })).toEqual({ events: [first], nextCursor: null });
    expect(await repo.listByApiKey(GLOBEX, 'key-import-acme', { limit: 10 })).toEqual({
      events: [],
      nextCursor: null,
    });
    expect(await repo.findLatestByImportKey(ACME, 'course', 'course-source-1')).toEqual(second);
    expect(await repo.findLatestByImportKey(GLOBEX, 'course', 'course-source-1')).toBeNull();
    await expect(repo.append(GLOBEX, { ...first, id: 'import-audit-cross-tenant' })).rejects.toThrow();
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
    expect(await repo.claim(ACME, event, lease)).toBe('in_progress');
    expect(await repo.claim(ACME, { ...event, id: 'evt-2' }, lease)).toBe('in_progress');
    const reclaimed = {
      workerId: 'worker-2',
      now: '1998-07-14T10:06:00.000Z',
      leaseExpiresAt: '1998-07-14T10:11:00.000Z',
    };
    expect(await repo.claim(ACME, event, reclaimed)).toBe('claimed');
    await repo.finalize(ACME, event.id, lease.workerId, reclaimed.now);
    await repo.release(ACME, event.id, lease.workerId);
    expect(await repo.claim(ACME, event, reclaimed)).toBe('in_progress');
    await repo.finalize(ACME, event.id, reclaimed.workerId, reclaimed.now);
    expect(
      await repo.claim(ACME, event, {
        ...reclaimed,
        now: '1998-07-14T10:12:00.000Z',
        leaseExpiresAt: '1998-07-14T10:17:00.000Z',
      }),
    ).toBe('processed');
    expect(await repo.claim(ACME, { ...event, id: 'evt-2' }, reclaimed)).toBe('processed');

    const releasable = { ...event, id: 'evt-3', objectId: 'in-3' };
    expect(await repo.claim(ACME, releasable, lease)).toBe('claimed');
    await repo.release(ACME, releasable.id, lease.workerId);
    expect(await repo.claim(ACME, releasable, lease)).toBe('claimed');
  });

  it('dedupes fulfillment events by object and lets later subscription updates through', async () => {
    const repo = createProcessedPaymentEventRepository(db);
    const lease = {
      workerId: 'worker-index',
      now: NOW,
      leaseExpiresAt: '1998-07-14T10:05:00.000Z',
    };
    const completed: ProcessedPaymentEvent = {
      id: 'evt-cs-1',
      tenantId: ACME,
      type: 'checkout.session.completed',
      objectId: 'cs-index',
      processedAt: NOW,
    };
    const updated: ProcessedPaymentEvent = {
      id: 'evt-sub-1',
      tenantId: ACME,
      type: 'customer.subscription.updated',
      objectId: 'sub-index',
      processedAt: NOW,
    };

    expect(await repo.claim(ACME, completed, lease)).toBe('claimed');
    expect(await repo.claim(ACME, { ...completed, id: 'evt-cs-2' }, lease)).toBe('in_progress');
    await repo.finalize(ACME, completed.id, lease.workerId, NOW);
    expect(await repo.claim(ACME, { ...completed, id: 'evt-cs-2' }, lease)).toBe('processed');
    expect(
      await repo.claim(GLOBEX, { ...completed, id: 'evt-cs-3', tenantId: GLOBEX }, lease),
    ).toBe('claimed');
    expect(await repo.claim(ACME, updated, lease)).toBe('claimed');
    expect(await repo.claim(ACME, { ...updated, id: 'evt-sub-2' }, lease)).toBe('claimed');
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
      await transactionDeps.autoInvoiceJobs.enqueue(ACME, {
        id: 'auto-invoice-bundle-rollback',
        tenantId: ACME,
        webhookEventId: 'event-auto-invoice-bundle-rollback',
        orderId: transactionOrder.id,
        status: 'queued',
        attempts: 0,
        nextAttemptAt: NOW,
        lockedAt: null,
        lastError: null,
        createdAt: NOW,
      });
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
        .select({ id: autoInvoiceJobs.id })
        .from(autoInvoiceJobs)
        .where(eq(autoInvoiceJobs.id, 'auto-invoice-bundle-rollback')),
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

  it('reclaims and completes durable automatic invoice jobs', async () => {
    const repository = createAutoInvoiceJobRepository(db);
    const jobOrder = order({
      id: 'order-auto-invoice-job',
      tenantId: ACME,
      memberId: 'mem-acme',
      productId: 'prod-acme',
    });
    await createOrderRepository(db).create(ACME, jobOrder);
    expect(await repository.enqueue(ACME, {
      id: 'auto-invoice-job',
      tenantId: ACME,
      webhookEventId: 'event-auto-invoice-job',
      orderId: jobOrder.id,
      status: 'queued',
      attempts: 0,
      nextAttemptAt: NOW,
      lockedAt: null,
      lastError: null,
      createdAt: NOW,
    })).toBe(true);
    expect(await repository.enqueue(ACME, {
      id: 'auto-invoice-job-duplicate',
      tenantId: ACME,
      webhookEventId: 'event-auto-invoice-job',
      orderId: jobOrder.id,
      status: 'queued',
      attempts: 0,
      nextAttemptAt: NOW,
      lockedAt: null,
      lastError: null,
      createdAt: NOW,
    })).toBe(false);

    const claimed = await repository.claimDue(NOW);
    expect(claimed).toMatchObject({
      id: 'auto-invoice-job',
      status: 'running',
      attempts: 1,
      lockedAt: expect.any(String),
    });
    if (claimed === null) throw new Error('Automatic invoice job was not claimed');
    await repository.complete(ACME, claimed.id);
    expect(await repository.claimDue(NOW)).toBeNull();
    expect(
      await db
        .select({ status: autoInvoiceJobs.status })
        .from(autoInvoiceJobs)
        .where(eq(autoInvoiceJobs.id, claimed.id)),
    ).toEqual([{ status: 'completed' }]);
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

    const course: Course = { id: 'course-acme', tenantId: ACME, name: 'C', description: '', imageUrl: null, moduleOrder: [], publiclyVisible: false, legacyId: null, createdAt: NOW };
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

  it('pages newest-first root threads across several spaces', async () => {
    const repo = createPostRepository(db);
    const feedPost = (
      id: string,
      contextId: string,
      createdAt: string,
      over: Partial<Post> = {},
    ): Post => ({
      id,
      tenantId: ACME,
      contextKind: 'space',
      contextId,
      parentPostId: null,
      rootPostId: id,
      authorUserId: 'user-acme-member',
      authorDisplay: 'Acme Member',
      authorIsStaff: false,
      body: `Body ${id}`,
      createdAt,
      editedAt: null,
      deletedAt: null,
      pinnedAt: null,
      ...over,
    });
    const spaceIds = ['space-feed-one', 'space-feed-two'];
    await repo.createPost(ACME, feedPost('post-feed-a', 'space-feed-one', '1998-07-14T08:00:00.000Z'));
    await repo.createPost(ACME, feedPost('post-feed-b', 'space-feed-two', '1998-07-14T09:00:00.000Z'));
    await repo.createPost(ACME, feedPost('post-feed-c', 'space-feed-one', '1998-07-14T10:00:00.000Z'));
    await repo.createPost(
      ACME,
      feedPost('post-feed-reply', 'space-feed-one', '1998-07-14T11:00:00.000Z', {
        parentPostId: 'post-feed-c',
        rootPostId: 'post-feed-c',
      }),
    );
    await repo.createPost(
      ACME,
      feedPost('post-feed-elsewhere', 'space-feed-unlisted', '1998-07-14T12:00:00.000Z'),
    );
    await repo.createPost(
      GLOBEX,
      feedPost('post-feed-globex', 'space-feed-one', '1998-07-14T13:00:00.000Z', { tenantId: GLOBEX }),
    );

    const first = await repo.listThreadsForSpaces(ACME, { spaceIds, limit: 2 });
    expect(first.threads.map((thread) => thread.post.id)).toEqual(['post-feed-c', 'post-feed-b']);
    expect(first.threads[0]?.replyCount).toBe(1);
    expect(first.nextCursor).not.toBeNull();

    const second = await repo.listThreadsForSpaces(ACME, {
      spaceIds,
      limit: 2,
      cursor: first.nextCursor ?? '',
    });
    expect(second.threads.map((thread) => thread.post.id)).toEqual(['post-feed-a']);
    expect(second.nextCursor).toBeNull();

    await expect(repo.listThreadsForSpaces(ACME, { spaceIds: [], limit: 2 })).resolves.toEqual({
      threads: [],
      nextCursor: null,
    });
  });

  it('reports the newest non-deleted root post per space and ignores replies', async () => {
    const repo = createPostRepository(db);
    const activityPost = (
      id: string,
      contextId: string,
      createdAt: string,
      over: Partial<Post> = {},
    ): Post => ({
      id,
      tenantId: ACME,
      contextKind: 'space',
      contextId,
      parentPostId: null,
      rootPostId: id,
      authorUserId: 'user-acme-member',
      authorDisplay: 'Acme Member',
      authorIsStaff: false,
      body: `Body ${id}`,
      createdAt,
      editedAt: null,
      deletedAt: null,
      pinnedAt: null,
      ...over,
    });
    await repo.createPost(ACME, activityPost('post-activity-root', 'space-activity-one', '1998-07-14T08:00:00.000Z'));
    await repo.createPost(
      ACME,
      activityPost('post-activity-reply', 'space-activity-one', '1998-07-14T09:00:00.000Z', {
        parentPostId: 'post-activity-root',
        rootPostId: 'post-activity-root',
      }),
    );
    await repo.createPost(ACME, activityPost('post-activity-older', 'space-activity-two', '1998-07-14T08:00:00.000Z'));
    await repo.createPost(
      ACME,
      activityPost('post-activity-erased', 'space-activity-two', '1998-07-14T10:00:00.000Z', { deletedAt: FUTURE }),
    );
    await repo.createPost(
      ACME,
      activityPost('post-activity-quiet', 'space-activity-three', '1998-07-14T10:00:00.000Z', { deletedAt: FUTURE }),
    );
    await repo.createPost(
      GLOBEX,
      activityPost('post-activity-globex', 'space-activity-one', '1998-07-14T12:00:00.000Z', { tenantId: GLOBEX }),
    );

    const spaceIds = ['space-activity-one', 'space-activity-two', 'space-activity-three'];
    await expect(repo.latestRootPostAt(ACME, spaceIds)).resolves.toEqual(
      new Map([
        ['space-activity-one', '1998-07-14T08:00:00.000Z'],
        ['space-activity-two', '1998-07-14T08:00:00.000Z'],
      ]),
    );
    await expect(repo.latestRootPostAt(GLOBEX, spaceIds)).resolves.toEqual(
      new Map([['space-activity-one', '1998-07-14T12:00:00.000Z']]),
    );
    await expect(repo.latestRootPostAt(ACME, [])).resolves.toEqual(new Map());
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

describe('space event repositories', () => {
  const eventSpace = (id: string, tenantId: string): Space => ({
    id,
    tenantId,
    slug: id,
    name: id,
    description: null,
    visibility: 'members',
    productIds: [],
    publicReadOnly: false,
    position: 0,
    archivedAt: null,
    createdAt: NOW,
  });

  const spaceEvent = (id: string, over: Partial<SpaceEvent> = {}): SpaceEvent => ({
    id,
    tenantId: ACME,
    spaceId: 'space-events',
    title: `Event ${id}`,
    description: null,
    startsAt: FUTURE,
    endsAt: '1998-12-01T02:00:00.000Z',
    location: null,
    url: null,
    liveEmbedUrl: null,
    replayUrl: null,
    discussionRootPostId: null,
    createdByUserId: 'user-acme-owner',
    createdAt: NOW,
    updatedAt: null,
    deletedAt: null,
    ...over,
  });

  beforeAll(async () => {
    const spacesRepo = createSpaceRepository(db);
    await spacesRepo.create(ACME, eventSpace('space-events', ACME));
    await spacesRepo.create(ACME, eventSpace('space-events-other', ACME));
    await spacesRepo.create(GLOBEX, eventSpace('space-events-globex', GLOBEX));
  });

  it('splits upcoming and past events around now and paginates by cursor', async () => {
    const repository = createSpaceEventRepository(db);
    await repository.insert(
      ACME,
      spaceEvent('event-past', { startsAt: PAST, endsAt: '1998-01-01T02:00:00.000Z' }),
    );
    await repository.insert(ACME, spaceEvent('event-soon'));
    await repository.insert(
      ACME,
      spaceEvent('event-later', {
        startsAt: '1998-12-24T18:00:00.000Z',
        endsAt: '1998-12-24T20:00:00.000Z',
      }),
    );

    const first = await repository.listForSpace(ACME, {
      spaceId: 'space-events',
      scope: 'upcoming',
      now: NOW,
      limit: 1,
    });
    if (first.nextCursor === null) throw new Error('Expected a second event page');
    const second = await repository.listForSpace(ACME, {
      spaceId: 'space-events',
      scope: 'upcoming',
      now: NOW,
      cursor: first.nextCursor,
      limit: 10,
    });
    const past = await repository.listForSpace(ACME, {
      spaceId: 'space-events',
      scope: 'past',
      now: NOW,
      limit: 10,
    });

    expect(first.events.map((row) => row.id)).toEqual(['event-soon']);
    expect(second.events.map((row) => row.id)).toEqual(['event-later']);
    expect(past.events.map((row) => row.id)).toEqual(['event-past']);
  });

  it('scopes reads to the tenant and hides soft-deleted events', async () => {
    const repository = createSpaceEventRepository(db);
    await repository.insert(ACME, spaceEvent('event-deleted'));
    await repository.softDelete(ACME, { id: 'event-deleted', deletedAt: NOW });

    const listed = await repository.listForSpace(ACME, {
      spaceId: 'space-events',
      scope: 'upcoming',
      now: NOW,
      limit: 10,
    });

    expect(listed.events.map((row) => row.id)).not.toContain('event-deleted');
    expect(await repository.findById(GLOBEX, 'event-soon')).toBeNull();
    expect((await repository.findById(ACME, 'event-deleted'))?.deletedAt).toBe(NOW);
  });

  it('lists upcoming events across several spaces in start order', async () => {
    const repository = createSpaceEventRepository(db);
    await repository.insert(
      ACME,
      spaceEvent('event-other-space', {
        spaceId: 'space-events-other',
        startsAt: '1998-11-01T18:00:00.000Z',
        endsAt: '1998-11-01T20:00:00.000Z',
      }),
    );

    const upcoming = await repository.listUpcomingForSpaces(ACME, {
      spaceIds: ['space-events', 'space-events-other'],
      now: NOW,
      limit: 10,
    });

    expect(upcoming.map((row) => row.id)).toEqual(['event-other-space', 'event-soon', 'event-later']);
    expect(
      await repository.listUpcomingForSpaces(ACME, { spaceIds: [], now: NOW, limit: 10 }),
    ).toEqual([]);
  });

  it('persists edits to the event projection', async () => {
    const repository = createSpaceEventRepository(db);
    const stored = await repository.findById(ACME, 'event-soon');
    if (stored === null) throw new Error('Expected the stored event');

    const updated = await repository.update(ACME, {
      ...stored,
      title: 'Event renamed',
      location: 'Online',
      updatedAt: FUTURE,
    });

    expect(updated).toMatchObject({ title: 'Event renamed', location: 'Online', updatedAt: FUTURE });
    expect(await repository.update(GLOBEX, { ...stored, title: 'Nope' })).toBeNull();
  });

  it('keeps one rsvp per viewer and counts both answers', async () => {
    const repository = createSpaceEventRsvpRepository(db);

    await repository.upsert(ACME, {
      eventId: 'event-soon',
      userId: 'user-acme-member',
      status: 'going',
      updatedAt: NOW,
    });
    await repository.upsert(ACME, {
      eventId: 'event-soon',
      userId: 'user-acme-member',
      status: 'not-going',
      updatedAt: FUTURE,
    });
    await repository.upsert(ACME, {
      eventId: 'event-soon',
      userId: 'user-acme-owner',
      status: 'going',
      updatedAt: NOW,
    });

    const counts = await repository.countsForEvents(ACME, ['event-soon', 'event-later']);
    const viewer = await repository.listForViewer(ACME, {
      userId: 'user-acme-member',
      eventIds: ['event-soon'],
    });

    expect(counts.get('event-soon')).toEqual({ going: 1, notGoing: 1 });
    expect(counts.get('event-later')).toEqual({ going: 0, notGoing: 0 });
    expect(viewer).toMatchObject([{ eventId: 'event-soon', status: 'not-going', updatedAt: FUTURE }]);
    expect(await repository.listForViewer(GLOBEX, { userId: 'user-acme-member', eventIds: ['event-soon'] })).toEqual([]);
    expect(await repository.countsForEvents(ACME, [])).toEqual(new Map());
  });
});

describe('space seen repository', () => {
  const seenSpace = (id: string, tenantId: string): Space => ({
    id,
    tenantId,
    slug: id,
    name: id,
    description: null,
    visibility: 'members',
    productIds: [],
    publicReadOnly: false,
    position: 0,
    archivedAt: null,
    createdAt: NOW,
  });

  it('moves an existing mark forward instead of duplicating it', async () => {
    const spacesRepo = createSpaceRepository(db);
    const repo = createSpaceSeenRepository(db);
    await spacesRepo.create(ACME, seenSpace('space-seen-upsert', ACME));

    await repo.markSeen(ACME, { userId: 'user-acme-member', spaceId: 'space-seen-upsert', seenAt: NOW });
    await repo.markSeen(ACME, { userId: 'user-acme-member', spaceId: 'space-seen-upsert', seenAt: FUTURE });

    await expect(
      repo.listForUser(ACME, { userId: 'user-acme-member', spaceIds: ['space-seen-upsert'] }),
    ).resolves.toEqual([{ spaceId: 'space-seen-upsert', seenAt: FUTURE }]);
  });

  it('scopes marks to the tenant, the viewer and the requested spaces', async () => {
    const spacesRepo = createSpaceRepository(db);
    const repo = createSpaceSeenRepository(db);
    await spacesRepo.create(ACME, seenSpace('space-seen-scoped', ACME));
    await spacesRepo.create(ACME, seenSpace('space-seen-other', ACME));
    await spacesRepo.create(GLOBEX, seenSpace('space-seen-globex', GLOBEX));

    await repo.markSeen(ACME, { userId: 'user-acme-member', spaceId: 'space-seen-scoped', seenAt: NOW });
    await repo.markSeen(ACME, { userId: 'user-acme-owner', spaceId: 'space-seen-other', seenAt: NOW });
    await repo.markSeen(GLOBEX, { userId: 'user-acme-member', spaceId: 'space-seen-globex', seenAt: NOW });

    await expect(
      repo.listForUser(ACME, {
        userId: 'user-acme-member',
        spaceIds: ['space-seen-scoped', 'space-seen-other'],
      }),
    ).resolves.toEqual([{ spaceId: 'space-seen-scoped', seenAt: NOW }]);
    await expect(
      repo.listForUser(GLOBEX, { userId: 'user-acme-member', spaceIds: ['space-seen-scoped'] }),
    ).resolves.toEqual([]);
    await expect(
      repo.listForUser(ACME, { userId: 'user-acme-member', spaceIds: [] }),
    ).resolves.toEqual([]);
  });
});

describe('notification repository', () => {
  it('paginates equal timestamps without duplicates or omissions', async () => {
    const repository = createNotificationRepository(db);
    const recipientUserId = 'user-acme-member';
    const notification = (id: string, createdAt: string): Notification => ({
      id,
      tenantId: ACME,
      recipientUserId,
      kind: 'thread-reply',
      payload: {
        rootPostId: `root-${id}`,
        postId: `post-${id}`,
        contextKind: 'lesson',
        contextId: 'lesson-notification-pagination',
        courseId: 'course-notification-pagination',
        eventId: null,
        lessonName: 'Pagination',
        authorDisplay: 'Author',
        authorAvatarUrl: null,
        snippet: id,
      },
      sourceKey: null,
      readAt: null,
      createdAt,
    });
    await Promise.all([
      repository.insert(ACME, notification('notification-page-1', '1998-07-14T09:00:00.000Z')),
      repository.insert(ACME, notification('notification-page-2', '1998-07-14T10:00:00.000Z')),
      repository.insert(ACME, notification('notification-page-3', '1998-07-14T11:00:00.000Z')),
      repository.insert(ACME, notification('notification-page-4', '1998-07-14T11:00:00.000Z')),
      repository.insert(ACME, notification('notification-page-5', '1998-07-14T12:00:00.000Z')),
    ]);

    const first = await repository.listForRecipient(ACME, { recipientUserId, limit: 2 });
    if (first.nextCursor === null) throw new Error('Expected a second notification page');
    const second = await repository.listForRecipient(ACME, {
      recipientUserId,
      cursor: first.nextCursor,
      limit: 2,
    });
    if (second.nextCursor === null) throw new Error('Expected a third notification page');
    const third = await repository.listForRecipient(ACME, {
      recipientUserId,
      cursor: second.nextCursor,
      limit: 2,
    });
    const ids = [...first.notifications, ...second.notifications, ...third.notifications]
      .map((item) => item.id);

    expect(ids).toEqual([
      'notification-page-5',
      'notification-page-4',
      'notification-page-3',
      'notification-page-2',
      'notification-page-1',
    ]);
    expect(new Set(ids).size).toBe(ids.length);
    expect(third.nextCursor).toBeNull();
  });

  it('hides every dm-context notification when direct messages are excluded', async () => {
    const repository = createNotificationRepository(db);
    const recipientUserId = 'user-acme-dm-filter';
    const row = (
      id: string,
      kind: Notification['kind'],
      contextKind: 'space' | 'dm',
    ): Notification => ({
      id,
      tenantId: ACME,
      recipientUserId,
      kind,
      payload: {
        rootPostId: `root-${id}`,
        postId: `post-${id}`,
        contextKind,
        contextId: `context-${id}`,
        courseId: null,
        eventId: null,
        lessonName: 'DM filter',
        authorDisplay: 'Author',
        authorAvatarUrl: null,
        snippet: id,
      },
      sourceKey: null,
      readAt: null,
      createdAt: NOW,
    });
    await repository.insertMany(ACME, [
      row('dm-message-hidden', 'dm-message', 'dm'),
      row('dm-report-hidden', 'dm-report', 'dm'),
      row('space-post-visible', 'space-post', 'space'),
    ]);

    const page = await repository.listForRecipient(ACME, {
      recipientUserId,
      limit: 50,
      excludeDms: true,
    });

    expect(page.notifications.map((item) => item.id)).toEqual(['space-post-visible']);
    expect(await repository.unreadCount(ACME, recipientUserId, { excludeDms: true })).toBe(1);
    expect(await repository.unreadCount(ACME, recipientUserId)).toBe(3);
  });

  it('bulk insert skips rows already carrying the same fan-out source key', async () => {
    const repository = createNotificationRepository(db);
    const row = (id: string, recipientUserId: string, sourceKey: string | null): Notification => ({
      id,
      tenantId: ACME,
      recipientUserId,
      kind: 'space-post',
      payload: {
        rootPostId: 'root-bulk',
        postId: 'post-bulk',
        contextKind: 'space',
        contextId: 'space-bulk',
        courseId: null,
        eventId: null,
        lessonName: 'Bulk',
        authorDisplay: 'Author',
        authorAvatarUrl: null,
        snippet: id,
      },
      sourceKey,
      readAt: null,
      createdAt: NOW,
    });

    const first = await repository.insertMany(ACME, [
      row('bulk-1', 'user-acme-member', 'space-post:post-bulk'),
      row('bulk-2', 'user-acme-owner', 'space-post:post-bulk'),
    ]);
    const retry = await repository.insertMany(ACME, [
      row('bulk-1-retry', 'user-acme-member', 'space-post:post-bulk'),
      row('bulk-2-retry', 'user-acme-owner', 'space-post:post-bulk'),
      row('bulk-3', 'user-acme-member', 'space-post:post-bulk-other'),
    ]);
    const unkeyed = await repository.insertMany(ACME, [
      row('bulk-null-1', 'user-acme-member', null),
      row('bulk-null-2', 'user-acme-member', null),
    ]);

    expect(first.map((item) => item.id)).toEqual(['bulk-1', 'bulk-2']);
    expect(retry.map((item) => item.id)).toEqual(['bulk-3']);
    expect(unkeyed).toHaveLength(2);
    expect(await repository.insertMany(ACME, [])).toEqual([]);
  });

  it('scopes the fan-out source key per tenant', async () => {
    const repository = createNotificationRepository(db);
    const row = (id: string, tenantId: string, recipientUserId: string): Notification => ({
      id,
      tenantId,
      recipientUserId,
      kind: 'space-post',
      payload: {
        rootPostId: 'root-scoped',
        postId: 'post-scoped',
        contextKind: 'space',
        contextId: 'space-scoped',
        courseId: null,
        eventId: null,
        lessonName: 'Scoped',
        authorDisplay: 'Author',
        authorAvatarUrl: null,
        snippet: id,
      },
      sourceKey: 'space-post:post-scoped',
      readAt: null,
      createdAt: NOW,
    });

    await repository.insertMany(ACME, [row('scoped-acme', ACME, 'user-acme-member')]);
    const other = await repository.insertMany(GLOBEX, [row('scoped-globex', GLOBEX, 'user-globex-member')]);

    expect(other.map((item) => item.id)).toEqual(['scoped-globex']);
  });
});

describe('notification fan-out job repository', () => {
  const job = (id: string, sourceKey: string, nextAttemptAt: string) => ({
    id,
    tenantId: ACME,
    kind: 'space-post' as const,
    sourceKey,
    payload: {
      postId: 'post-fanout',
      eventId: null,
      tenantName: 'Acme',
      tenantSlug: 'acme',
      authorDisplay: null,
    },
    status: 'pending' as const,
    attempts: 0,
    cursorUserId: null,
    nextAttemptAt,
    createdAt: NOW,
    updatedAt: NOW,
  });

  it('enqueues once per source key, leases due jobs and stops claiming completed ones', async () => {
    const repository = createNotificationFanoutJobRepository(db);
    await insertFanoutJob(db, ACME, job('fanout-1', 'space-post:fanout-1', NOW));
    await insertFanoutJob(db, ACME, job('fanout-duplicate', 'space-post:fanout-1', NOW));

    const claimed = await repository.claimDue({
      now: NOW,
      limit: 10,
      leaseUntil: '1998-07-14T10:05:00.000Z',
    });
    const secondPass = await repository.claimDue({
      now: NOW,
      limit: 10,
      leaseUntil: '1998-07-14T10:05:00.000Z',
    });

    expect(claimed.map((item) => item.id)).toEqual(['fanout-1']);
    expect(claimed[0]?.attempts).toBe(1);
    expect(secondPass).toEqual([]);

    const afterLease = await repository.claimDue({
      now: '1998-07-14T10:06:00.000Z',
      limit: 10,
      leaseUntil: '1998-07-14T10:11:00.000Z',
    });
    expect(afterLease.map((item) => item.id)).toEqual(['fanout-1']);

    await repository.save(ACME, {
      id: 'fanout-1',
      status: 'completed',
      attempts: 0,
      cursorUserId: 'user-acme-member',
      nextAttemptAt: '1998-07-14T10:06:00.000Z',
      updatedAt: '1998-07-14T10:06:00.000Z',
    });

    expect(
      await repository.claimDue({
        now: '1998-07-14T11:00:00.000Z',
        limit: 10,
        leaseUntil: '1998-07-14T11:05:00.000Z',
      }),
    ).toEqual([]);
  });
});

describe('direct message repositories', () => {
  const conversation = (id: string, over: Partial<DmConversation> = {}): DmConversation => ({
    id,
    tenantId: ACME,
    participantLowUserId: 'user-acme-member',
    participantHighUserId: 'user-acme-owner',
    createdByUserId: 'user-acme-member',
    createdAt: NOW,
    lastMessageId: null,
    lastMessageAt: NOW,
    lastMessageSnippet: '',
    lastMessageSenderUserId: 'user-acme-member',
    ...over,
  });

  const message = (id: string, over: Partial<DmMessage> = {}): DmMessage => ({
    id,
    tenantId: ACME,
    conversationId: 'dm-conversation-1',
    senderUserId: 'user-acme-member',
    body: `Body ${id}`,
    createdAt: NOW,
    ...over,
  });

  it('keeps one row per canonical pair and finds it from either side', async () => {
    const repository = createDmConversationRepository(db);
    await repository.insert(ACME, conversation('dm-conversation-1'));

    const found = await repository.findByParticipants(ACME, {
      low: 'user-acme-member',
      high: 'user-acme-owner',
    });
    const crossTenant = await repository.findById(GLOBEX, 'dm-conversation-1');

    expect(found?.id).toBe('dm-conversation-1');
    expect(crossTenant).toBeNull();
    await expect(
      repository.insert(ACME, conversation('dm-conversation-duplicate')),
    ).rejects.toThrow();
  });

  it('orders conversations by the last message and paginates by cursor', async () => {
    const repository = createDmConversationRepository(db);
    const messages = createDmMessageRepository(db);
    await repository.insert(
      ACME,
      conversation('dm-conversation-2', {
        participantHighUserId: 'user-acme-second',
        lastMessageAt: '1998-07-14T09:00:00.000Z',
      }),
    );
    await messages.insert(ACME, message('dm-message-1', { createdAt: '1998-07-14T09:30:00.000Z' }));
    await repository.applyLastMessage(ACME, {
      conversationId: 'dm-conversation-1',
      lastMessageId: 'dm-message-1',
      lastMessageAt: '1998-07-14T09:30:00.000Z',
      lastMessageSnippet: 'Body dm-message-1',
      lastMessageSenderUserId: 'user-acme-member',
    });

    const first = await repository.listForParticipant(ACME, {
      userId: 'user-acme-member',
      limit: 1,
    });
    if (first.nextCursor === null) throw new Error('Expected a second conversation page');
    const second = await repository.listForParticipant(ACME, {
      userId: 'user-acme-member',
      cursor: first.nextCursor,
      limit: 1,
    });

    expect(first.conversations.map((row) => row.id)).toEqual(['dm-conversation-1']);
    expect(second.conversations.map((row) => row.id)).toEqual(['dm-conversation-2']);
    expect(second.nextCursor).toBeNull();
  });

  it('counts unread conversations against the viewer read cursor', async () => {
    const repository = createDmConversationRepository(db);
    const states = createDmConversationStateRepository(db);

    const senderBefore = await repository.countUnreadForParticipant(ACME, 'user-acme-member');
    const recipientBefore = await repository.countUnreadForParticipant(ACME, 'user-acme-owner');
    await states.markRead(ACME, {
      conversationId: 'dm-conversation-1',
      userId: 'user-acme-owner',
      lastReadAt: '1998-07-14T10:00:00.000Z',
    });
    const recipientAfter = await repository.countUnreadForParticipant(ACME, 'user-acme-owner');

    expect(senderBefore).toBe(0);
    expect(recipientBefore).toBe(1);
    expect(recipientAfter).toBe(0);
  });

  it('counts a sender rate-limit window and paginates messages newest first', async () => {
    const repository = createDmMessageRepository(db);
    await repository.insert(ACME, message('dm-message-2', { createdAt: '1998-07-14T10:30:00.000Z' }));

    const page = await repository.listForConversation(ACME, {
      conversationId: 'dm-conversation-1',
      limit: 10,
    });
    const windowed = await repository.countRecentBySender(
      ACME,
      'user-acme-member',
      '1998-07-14T10:00:00.000Z',
    );

    expect(page.messages.map((row) => row.id)).toEqual(['dm-message-2', 'dm-message-1']);
    expect(windowed).toBe(1);
  });

  it('collapses direct-message notifications per conversation until they are read', async () => {
    const repository = createNotificationRepository(db);
    const dmNotification: Notification = {
      id: 'notification-dm-1',
      tenantId: ACME,
      recipientUserId: 'user-acme-owner',
      kind: 'dm-message',
      payload: {
        rootPostId: 'dm-message-1',
        postId: 'dm-message-1',
        contextKind: 'dm',
        contextId: 'dm-conversation-1',
        courseId: null,
        eventId: null,
        lessonName: 'Acme Member',
        authorDisplay: 'Acme Member',
        authorAvatarUrl: null,
        snippet: 'Body dm-message-1',
      },
      sourceKey: null,
      readAt: null,
      createdAt: NOW,
    };
    await repository.insert(ACME, dmNotification);

    const pending = await repository.hasUnreadDmNotification(
      ACME,
      'user-acme-owner',
      'dm-conversation-1',
    );
    const otherConversation = await repository.hasUnreadDmNotification(
      ACME,
      'user-acme-owner',
      'dm-conversation-2',
    );
    const marked = await repository.markDmConversationRead(ACME, {
      recipientUserId: 'user-acme-owner',
      conversationId: 'dm-conversation-1',
      readAt: '1998-07-14T11:00:00.000Z',
    });
    const afterRead = await repository.hasUnreadDmNotification(
      ACME,
      'user-acme-owner',
      'dm-conversation-1',
    );

    expect(pending).toBe(true);
    expect(otherConversation).toBe(false);
    expect(marked).toBe(1);
    expect(afterRead).toBe(false);
  });

  it('stores the direct-message opt-out on the member row', async () => {
    const repository = createMemberRepository(db);

    const optedOut = await repository.updateDmOptOut(ACME, 'mem-acme', NOW);
    const clearedForOtherTenant = await repository.updateDmOptOut(GLOBEX, 'mem-acme', NOW);
    const cleared = await repository.updateDmOptOut(ACME, 'mem-acme', null);

    expect(optedOut?.dmOptOutAt).toBe(NOW);
    expect(clearedForOtherTenant).toBeNull();
    expect(cleared?.dmOptOutAt).toBeNull();
  });

  it('keeps member blocks idempotent, directional and tenant-scoped', async () => {
    const repository = createMemberBlockRepository(db);
    const block = (over: Partial<MemberBlock> = {}): MemberBlock => ({
      tenantId: ACME,
      blockerUserId: 'user-acme-member',
      blockedUserId: 'user-acme-owner',
      createdAt: NOW,
      ...over,
    });

    const first = await repository.block(ACME, block());
    const repeated = await repository.block(ACME, block());
    const otherTenant = await repository.block(GLOBEX, block({ tenantId: GLOBEX }));
    const blockerView = await repository.findDirections(ACME, {
      viewerUserId: 'user-acme-member',
      otherUserIds: ['user-acme-owner', 'user-acme-second'],
    });
    const blockedView = await repository.findDirections(ACME, {
      viewerUserId: 'user-acme-owner',
      otherUserIds: ['user-acme-member'],
    });
    const otherTenantView = await repository.findDirections(GLOBEX, {
      viewerUserId: 'user-acme-member',
      otherUserIds: ['user-acme-owner'],
    });

    expect([first, repeated, otherTenant]).toEqual([true, false, true]);
    expect(blockerView.get('user-acme-owner')).toEqual({ blockedByViewer: true, blocksViewer: false });
    expect(blockerView.get('user-acme-second')).toEqual(NO_DM_BLOCKS);
    expect(blockedView.get('user-acme-member')).toEqual({ blockedByViewer: false, blocksViewer: true });
    expect(otherTenantView.get('user-acme-owner')).toEqual({
      blockedByViewer: true,
      blocksViewer: false,
    });

    const removed = await repository.unblock(ACME, {
      blockerUserId: 'user-acme-member',
      blockedUserId: 'user-acme-owner',
    });
    const removedAgain = await repository.unblock(ACME, {
      blockerUserId: 'user-acme-member',
      blockedUserId: 'user-acme-owner',
    });
    const afterUnblock = await repository.findDirections(ACME, {
      viewerUserId: 'user-acme-member',
      otherUserIds: ['user-acme-owner'],
    });

    expect([removed, removedAgain]).toEqual([true, false]);
    expect(afterUnblock.get('user-acme-owner')).toEqual(NO_DM_BLOCKS);
    expect(await repository.unblock(GLOBEX, {
      blockerUserId: 'user-acme-member',
      blockedUserId: 'user-acme-owner',
    })).toBe(true);
  });

  it('allows one open report per reporter and conversation, then resolves it once', async () => {
    const repository = createDmReportRepository(db);
    const dmReport = (id: string, over: Partial<DmReport> = {}): DmReport => ({
      id,
      tenantId: ACME,
      conversationId: 'dm-conversation-1',
      reporterUserId: 'user-acme-member',
      reporterDisplay: 'Acme Member',
      reportedUserId: 'user-acme-owner',
      reportedDisplay: 'Acme Owner',
      reason: 'harassment',
      snapshot: [
        {
          id: 'dm-message-1',
          senderDisplay: 'Acme Member',
          senderIsReporter: true,
          body: 'Body dm-message-1',
          createdAt: NOW,
        },
      ],
      status: 'open',
      createdAt: NOW,
      resolvedAt: null,
      resolvedByUserId: null,
      ...over,
    });

    const opened = await repository.open(ACME, dmReport('dm-report-1'));
    const duplicate = await repository.open(ACME, dmReport('dm-report-duplicate'));
    const otherReporter = await repository.open(
      ACME,
      dmReport('dm-report-2', {
        reporterUserId: 'user-acme-owner',
        reportedUserId: 'user-acme-member',
        createdAt: '1998-07-14T10:05:00.000Z',
      }),
    );
    const otherTenant = await repository.countOpen(GLOBEX);

    expect(opened?.snapshot).toHaveLength(1);
    expect(duplicate).toBeNull();
    expect(otherReporter?.id).toBe('dm-report-2');
    expect(await repository.countOpen(ACME)).toBe(2);
    expect(otherTenant).toBe(0);

    const firstPage = await repository.listByStatus(ACME, { status: 'open', limit: 1 });
    if (firstPage.nextCursor === null) throw new Error('Expected a second report page');
    const secondPage = await repository.listByStatus(ACME, {
      status: 'open',
      cursor: firstPage.nextCursor,
      limit: 1,
    });

    expect(firstPage.reports.map((row) => row.id)).toEqual(['dm-report-2']);
    expect(secondPage.reports.map((row) => row.id)).toEqual(['dm-report-1']);
    expect(secondPage.nextCursor).toBeNull();

    const resolveInput = {
      id: 'dm-report-1',
      resolvedAt: '1998-07-14T12:00:00.000Z',
      resolvedByUserId: 'user-acme-owner',
    };
    const resolved = await repository.resolve(ACME, resolveInput);
    const resolvedTwice = await repository.resolve(ACME, resolveInput);
    const crossTenant = await repository.resolve(GLOBEX, {
      ...resolveInput,
      id: 'dm-report-2',
    });
    const reopened = await repository.open(ACME, dmReport('dm-report-3'));

    expect(resolved).toMatchObject({ status: 'resolved', resolvedAt: '1998-07-14T12:00:00.000Z' });
    expect(resolvedTwice).toBeNull();
    expect(crossTenant).toBeNull();
    expect(reopened?.id).toBe('dm-report-3');
    expect(
      (await repository.listByStatus(ACME, { status: 'resolved', limit: 10 })).reports.map(
        (row) => row.id,
      ),
    ).toEqual(['dm-report-1']);
  });
});

describe('health port', () => {
  it('pings the database successfully', async () => {
    expect(await createHealthPort(db).pingDatabase()).toBe(true);
  });

  it('reports the fully migrated schema as current', async () => {
    const status = await createHealthPort(db).schemaStatus();

    expect(status.schemaCurrent).toBe(true);
    expect(status.appliedMigrations).toBe(status.expectedMigrations);
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
    postAuthorDisplay: deletedMemberDisplay(),
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
    await createDmConversationRepository(db).insert(RODO, {
      id: 'dm-conversation-rodo',
      tenantId: RODO,
      participantLowUserId: 'user-rodo-buyer',
      participantHighUserId: 'user-rodo-shared',
      createdByUserId: 'user-rodo-buyer',
      createdAt: NOW,
      lastMessageId: null,
      lastMessageAt: NOW,
      lastMessageSnippet: '',
      lastMessageSenderUserId: 'user-rodo-buyer',
    });
    const rodoSnapshot = [
      { id: 'dm-rodo-1', senderDisplay: 'Jan Kowalski', senderIsReporter: true, body: 'Pierwsza', createdAt: NOW },
      { id: 'dm-rodo-2', senderDisplay: 'Anna Shared', senderIsReporter: false, body: 'Druga', createdAt: NOW },
    ];
    await db.insert(dmReports).values([
      {
        id: 'dm-report-rodo-by',
        tenantId: RODO,
        conversationId: 'dm-conversation-rodo',
        reporterUserId: 'user-rodo-buyer',
        reporterDisplay: 'Jan Kowalski',
        reportedUserId: 'user-rodo-shared',
        reportedDisplay: 'Anna Shared',
        reason: 'harassment',
        snapshot: rodoSnapshot,
        status: 'open',
        createdAt: NOW,
        resolvedAt: null,
        resolvedByUserId: null,
      },
      {
        id: 'dm-report-rodo-about',
        tenantId: RODO,
        conversationId: 'dm-conversation-rodo',
        reporterUserId: 'user-rodo-shared',
        reporterDisplay: 'Anna Shared',
        reportedUserId: 'user-rodo-buyer',
        reportedDisplay: 'Jan Kowalski',
        reason: 'spam',
        snapshot: rodoSnapshot.map((entry) => ({ ...entry, senderIsReporter: !entry.senderIsReporter })),
        status: 'open',
        createdAt: NOW,
        resolvedAt: null,
        resolvedByUserId: null,
      },
    ]);
    await db.insert(memberBlocks).values([
      { tenantId: RODO, blockerUserId: 'user-rodo-buyer', blockedUserId: 'user-rodo-shared', createdAt: NOW },
      { tenantId: RODO, blockerUserId: 'user-rodo-shared', blockedUserId: 'user-rodo-buyer', createdAt: NOW },
      { tenantId: RODO, blockerUserId: 'user-rodo-owner', blockedUserId: 'user-rodo-dollar', createdAt: NOW },
    ]);
    await createCourseRepository(db).create(RODO, {
      id: 'course-rodo',
      tenantId: RODO,
      name: 'Kurs RODO',
      description: '',
      imageUrl: null,
      moduleOrder: [],
      publiclyVisible: false,
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
    expect(postRows[0]).toMatchObject({ authorDisplay: deletedMemberDisplay(), body: 'Świetny kurs!', deletedAt: null });

    const reportRows = await db.select().from(postReports).where(eq(postReports.id, 'report-rodo'));
    expect(reportRows[0]).toMatchObject({
      reporterUserId: 'user-rodo-buyer',
      reporterDisplay: deletedMemberDisplay(),
    });

    const dmReportRows = await db
      .select()
      .from(dmReports)
      .where(eq(dmReports.tenantId, RODO))
      .orderBy(asc(dmReports.id));
    expect(dmReportRows[0]).toMatchObject({
      id: 'dm-report-rodo-about',
      reporterDisplay: 'Anna Shared',
      reportedDisplay: deletedMemberDisplay(),
    });
    expect(dmReportRows[0]?.snapshot).toEqual([
      { id: 'dm-rodo-1', senderDisplay: deletedMemberDisplay(), senderIsReporter: false, body: 'Pierwsza', createdAt: NOW },
      { id: 'dm-rodo-2', senderDisplay: 'Anna Shared', senderIsReporter: true, body: 'Druga', createdAt: NOW },
    ]);
    expect(dmReportRows[1]).toMatchObject({
      id: 'dm-report-rodo-by',
      reporterDisplay: deletedMemberDisplay(),
      reportedDisplay: 'Anna Shared',
    });
    expect(dmReportRows[1]?.snapshot.map((entry) => entry.senderDisplay)).toEqual([
      deletedMemberDisplay(),
      'Anna Shared',
    ]);

    expect(await db.select().from(memberBlocks).where(eq(memberBlocks.tenantId, RODO))).toEqual([
      { tenantId: RODO, blockerUserId: 'user-rodo-owner', blockedUserId: 'user-rodo-dollar', createdAt: NOW },
    ]);

    const consentRows = await db.select().from(consents).where(eq(consents.id, 'consent-rodo'));
    expect(consentRows[0]).toMatchObject({
      userId: 'user-rodo-buyer',
      email: 'jan.kowalski@together.dev',
    });
    expect(new Date(consentRows[0]?.retentionStartedAt ?? '').toISOString()).toBe(REMOVAL_AT);

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

describe('createSignInMethodReader', () => {
  const explainPredicate = async (
    executor: Pick<Db, 'execute'>,
    predicate: SQL,
  ): Promise<string> => {
    const result: unknown = await executor.execute(
      sql`explain select 1 from ${user} where ${predicate}`,
    );
    if (
      typeof result !== 'object'
      || result === null
      || !('rows' in result)
      || !Array.isArray(result.rows)
    ) {
      throw new Error('explain did not return rows');
    }
    return JSON.stringify(result.rows);
  };

  beforeAll(async () => {
    await db.insert(account).values({
      id: 'account-signin-lookup',
      accountId: 'owner-acme@together.dev',
      providerId: 'credential',
      userId: 'user-acme-owner',
      password: 'hashed-password',
      updatedAt: new Date(NOW),
    });
  });

  it('resolves a mixed-case identifier exactly like the stored address', async () => {
    const reader = createSignInMethodReader(db);

    expect(await reader.hasCredentialAccount(ACME, 'owner-acme@together.dev')).toBe(true);
    expect(await reader.hasCredentialAccount(ACME, '  Owner-Acme@Together.DEV ')).toBe(true);
    expect(await reader.hasCredentialAccount(ACME, 'buyer-acme@together.dev')).toBe(false);
    expect(await reader.hasCredentialAccount(GLOBEX, 'owner-acme@together.dev')).toBe(false);
  });

  it('keeps the identifier predicate on the unique e-mail index', async () => {
    await db.transaction(async (tx) => {
      await tx.execute(sql`set local enable_seqscan = off`);

      expect(
        await explainPredicate(tx, eq(user.email, normalizeEmail('  Owner-Acme@Together.DEV '))),
      ).toContain('Index Cond');
      expect(
        await explainPredicate(tx, sql`lower(btrim(${user.email})) = 'owner-acme@together.dev'`),
      ).not.toContain('Index Cond');
    });
  });
});
