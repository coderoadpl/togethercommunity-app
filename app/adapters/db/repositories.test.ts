import { drizzle } from 'drizzle-orm/node-postgres';
import { migrate } from 'drizzle-orm/node-postgres/migrator';
import pg from 'pg';
import { beforeAll, describe, expect, it } from 'vitest';

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
  createHealthPort,
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
import { user } from './schema.js';

const TEST_DB = 'together_repositories_test';
const baseDatabaseUrl = process.env['DATABASE_URL'] ?? 'postgres://together:together@localhost:48912/together';
const testUrl = (() => {
  const url = new URL(baseDatabaseUrl);
  url.pathname = `/${TEST_DB}`;
  return url.toString();
})();

const NOW = '2026-07-14T10:00:00.000Z';
const PAST = '2026-01-01T00:00:00.000Z';
const FUTURE = '2026-12-01T00:00:00.000Z';

const ACME = 'tenant-acme';
const GLOBEX = 'tenant-globex';

let db: Db;

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
    const afterExpiry = await repo.listActiveForMember(ACME, 'mem-acme', '2027-01-01T00:00:00.000Z');
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
    const updated = await repo.updateSettings(ACME, { billingPortalUrl: 'https://billing.acme.test', bunnyStreamLibraryId: 'lib-1' });
    expect(updated).toEqual({ billingPortalUrl: 'https://billing.acme.test', bunnyStreamLibraryId: 'lib-1' });
    expect(await repo.findSettings(ACME)).toMatchObject({ bunnyStreamLibraryId: 'lib-1' });
  });

  it('exposes staff memberships and members through the access reader', async () => {
    const reader = createTenantAccessReader(db);
    const tenants = await reader.listTenantsForStaff('user-acme-owner');
    expect(tenants.map((t) => t.tenant.slug)).toEqual(['acme']);
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
