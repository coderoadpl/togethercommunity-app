import { and, eq } from 'drizzle-orm';
import { drizzle } from 'drizzle-orm/node-postgres';
import { migrate } from 'drizzle-orm/node-postgres/migrator';
import pg from 'pg';
import { beforeAll, describe, expect, it } from 'vitest';

import { memberTombstone, ok } from '@core/domain/index.js';
import { createAuth, type Auth } from '@adapters/auth/create-auth.js';
import {
  createImportAuthGateway,
  type ImportAuthGateway,
} from '@adapters/auth/import-credential.js';
import { deriveLegacyPasswordHash } from '@adapters/auth/legacy-password.js';

import { createDb, type Db } from './client.js';
import { createMemberErasureRepository, createOrderRepository } from './repositories.js';
import {
  resolveImportTenants,
  runImport,
  type ImportTarget,
  type KindReport,
  type TenantBundle,
} from './importer.js';
import {
  account,
  courseModules,
  courses,
  memberCourseProgress,
  members,
  orders,
  productGrants,
  products,
  tenantAdmins,
  tenantDomains,
  tenants,
  user,
} from './schema.js';

const TEST_DB = 'together_importer_test';
const baseDatabaseUrl =
  process.env['DATABASE_URL'] ?? 'postgres://together:together@localhost:48912/together';
const testUrl = (() => {
  const url = new URL(baseDatabaseUrl);
  url.pathname = `/${TEST_DB}`;
  return url.toString();
})();

const TENANT_ID = 'tenant-import-spec';
const TENANT_SLUG = 'import-spec';

const PASSWORD = 'legacy-pass-1234';
const SALT = 'a1b2c3d4e5f60718293a4b5c6d7e8f90a1b2c3d4e5f60718293a4b5c6d7e8f90';
const MARKER = deriveLegacyPasswordHash(PASSWORD, SALT);

const ids = {
  u1: '64b7dd851bb3ae9014e30001',
  u2: '64b7dd851bb3ae9014e30002',
  c1: '656b0000000000000aa10c01',
  m1: '65a524f8b5bd26b9d2ab0d01',
  l1: '65a524f6b5bd26b9d2ab0e01',
  l2: '65a524f6b5bd26b9d2ab0e02',
  p1: '67c495c337610bc83aa10f01',
  p2: '67c495c337610bc83aa10f02',
  g1: '67c495dc37610bc83aa11001',
  g1dup: '67c495dc37610bc83aa11002',
  g2: '67c495dc37610bc83aa11003',
  pr1: '67ccd5c2e5fb7a977be41101',
};

const EMAIL_1 = 'import-user-1@together.dev';
const EMAIL_2 = 'import-user-2@together.dev';

const buildBundle = (): TenantBundle => ({
  users: [
    {
      legacyId: ids.u1,
      email: EMAIL_1,
      name: 'Jan Import',
      payloadPasswordMarker: MARKER,
      role: 'student',
    },
    { legacyId: ids.u2, email: EMAIL_2, name: null, payloadPasswordMarker: null, role: 'student' },
  ],
  courses: [
    {
      legacyId: ids.c1,
      name: 'Legacy Course',
      description: 'A course from the legacy platform',
      imageUrl: null,
      moduleOrder: [ids.m1],
    },
  ],
  modules: [
    {
      legacyId: ids.m1,
      courseLegacyIds: [ids.c1],
      title: 'Module 1',
      prefix: 'CR 1',
      chapters: [
        {
          id: 'chapter-array-id-1',
          name: 'Chapter 1',
          contents: [
            { id: 'content-array-id-1', name: 'Lesson 1', lessonId: ids.l1 },
            { id: 'content-array-id-2', name: 'Lesson 2', lessonId: ids.l2 },
          ],
        },
      ],
    },
  ],
  lessons: [
    {
      legacyId: ids.l1,
      name: 'Lesson 1',
      contents: [
        {
          type: 'video',
          storageKey: 'legacy/videos/lesson-1.mov',
          streamVideoId: 'd332529c-50c5-461a-afa0-38affed70001',
          streamLibraryId: '424242',
          streamCollectionId: 'b4d27848-4b4e-42eb-b664-e0df4d740001',
        },
      ],
    },
    {
      legacyId: ids.l2,
      name: 'Lesson 2',
      contents: [{ type: 'html', html: '<p>Legacy content</p>' }],
    },
  ],
  products: [
    {
      legacyId: ids.p1,
      title: 'Full course access',
      accessItems: [{ level: 'course', courseId: ids.c1 }],
    },
    {
      legacyId: ids.p2,
      title: 'Single lesson access',
      accessItems: [{ level: 'lessons', courseId: ids.c1, lessonIds: [ids.l2] }],
    },
  ],
  members: [
    { legacyId: ids.u1, email: EMAIL_1, displayName: 'Jan Import' },
    { legacyId: ids.u2, email: EMAIL_2, displayName: null },
  ],
  grants: [
    {
      legacyId: ids.g1,
      memberLegacyId: ids.u1,
      productLegacyId: ids.p1,
      startsAt: '2025-01-01T00:00:00.000Z',
      expiresAt: null,
    },
    {
      legacyId: ids.g1dup,
      memberLegacyId: ids.u1,
      productLegacyId: ids.p1,
      startsAt: '2024-01-01T00:00:00.000Z',
      expiresAt: '2024-06-01T00:00:00.000Z',
    },
    {
      legacyId: ids.g2,
      memberLegacyId: ids.u2,
      productLegacyId: ids.p2,
      startsAt: '2024-01-01T00:00:00.000Z',
      expiresAt: '2024-02-01T00:00:00.000Z',
    },
  ],
  progress: [
    {
      legacyId: ids.pr1,
      userLegacyId: ids.u1,
      courseLegacyId: ids.c1,
      lastViewedLessonId: ids.l1,
      lastViewedModuleId: ids.m1,
      lastViewedChapterId: 'chapter-array-id-1',
      completedLessonIds: [ids.l1],
      updatedAt: '2025-03-01T12:00:00.000Z',
    },
  ],
});

let db: Db;
let auth: Auth;
let gateway: ImportAuthGateway;

const targets = (bundle: TenantBundle): ImportTarget[] => [
  {
    tenant: {
      bundleSlug: 'legacy-tenant',
      tenantId: TENANT_ID,
      tenantSlug: TENANT_SLUG,
      tenantName: 'Import Spec',
      created: false,
    },
    bundle,
  },
];

const nowIso = (): string => new Date().toISOString();

const reportByKind = (kinds: KindReport[], kind: string): KindReport => {
  const found = kinds.find((entry) => entry.kind === kind);
  if (found === undefined) throw new Error(`No report for kind ${kind}`);
  return found;
};

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
  auth = createAuth(db, {
    secret: 'importer-test-secret-at-least-32-characters',
    baseUrl: 'http://localhost:48730',
    baseDomain: 'localhost',
    trustedOrigins: ['http://localhost:48730'],
    secureCookies: false,
    exposeMagicLinks: false,
    email: { send: () => Promise.resolve(ok({ messageId: null })) },
    defaultTenantName: 'Together',
    google: null,
  });
  gateway = createImportAuthGateway(auth);

  await db.insert(tenants).values({
    id: TENANT_ID,
    slug: TENANT_SLUG,
    name: 'Import Spec',
    createdAt: nowIso(),
  });
}, 60000);

describe('importer', () => {
  it('backfills owner admin and domain when a prior tenant-only creation is resumed', async () => {
    const tenantId = 'tenant-import-resume';
    const tenantSlug = 'import-resume';
    const ownerEmail = 'import-resume-owner@together.dev';
    await db.insert(tenants).values({
      id: tenantId,
      slug: tenantSlug,
      name: 'Import Resume',
      createdAt: nowIso(),
    });

    const resolved = await resolveImportTenants(
      db,
      gateway,
      [{ bundleSlug: 'legacy-resume', target: tenantSlug }],
      { createMissing: true, ownerEmail, apply: true, nowIso },
    );

    expect(resolved).toEqual([
      {
        bundleSlug: 'legacy-resume',
        tenantId,
        tenantSlug,
        tenantName: 'Import Resume',
        created: false,
      },
    ]);
    const ownerUsers = await db.select().from(user).where(eq(user.email, ownerEmail));
    const adminRows = await db
      .select()
      .from(tenantAdmins)
      .where(eq(tenantAdmins.tenantId, tenantId));
    expect(adminRows).toEqual([
      {
        id: `admin-${tenantSlug}`,
        tenantId,
        userId: ownerUsers[0]?.id,
        role: 'owner',
      },
    ]);
    const domainRows = await db
      .select()
      .from(tenantDomains)
      .where(eq(tenantDomains.tenantId, tenantId));
    expect(domainRows).toEqual([
      {
        id: `domain-${tenantSlug}`,
        tenantId,
        domain: `${tenantSlug}.localhost`,
        kind: 'subdomain',
        verified: true,
      },
    ]);

    await resolveImportTenants(
      db,
      gateway,
      [{ bundleSlug: 'legacy-resume', target: tenantSlug }],
      { createMissing: true, ownerEmail, apply: true, nowIso },
    );
    expect(
      await db.select().from(tenantAdmins).where(eq(tenantAdmins.tenantId, tenantId)),
    ).toHaveLength(1);
    expect(
      await db.select().from(tenantDomains).where(eq(tenantDomains.tenantId, tenantId)),
    ).toHaveLength(1);
  }, 30000);

  it('dry-run plans creates without writing anything', async () => {
    const result = await runImport(db, gateway, targets(buildBundle()), {
      apply: false,
      nowIso,
    });
    expect(result.mode).toBe('dry-run');
    expect(result.users.create).toBe(2);
    expect(reportByKind(result.tenants[0]?.kinds ?? [], 'courses').create).toBe(1);
    expect(reportByKind(result.tenants[0]?.kinds ?? [], 'grants').create).toBe(2);
    expect(reportByKind(result.tenants[0]?.kinds ?? [], 'grants').dropped).toBe(1);
    expect(result.verification).toBeNull();

    const courseRows = await db.select().from(courses).where(eq(courses.tenantId, TENANT_ID));
    expect(courseRows).toHaveLength(0);
    const userRows = await db.select().from(user).where(eq(user.email, EMAIL_1));
    expect(userRows).toHaveLength(0);
  }, 30000);

  it('apply imports everything keyed by legacyId and passes verification', async () => {
    const result = await runImport(db, gateway, targets(buildBundle()), {
      apply: true,
      nowIso,
    });
    expect(result.users.create).toBe(2);

    const courseRows = await db.select().from(courses).where(eq(courses.tenantId, TENANT_ID));
    expect(courseRows).toHaveLength(1);
    expect(courseRows[0]?.id).toBe(ids.c1);
    expect(courseRows[0]?.legacyId).toBe(ids.c1);
    expect(courseRows[0]?.moduleOrder).toEqual([ids.m1]);

    const moduleRows = await db
      .select()
      .from(courseModules)
      .where(eq(courseModules.tenantId, TENANT_ID));
    expect(moduleRows[0]?.chapters[0]?.id).toBe('chapter-array-id-1');
    expect(moduleRows[0]?.chapters[0]?.contents.map((content) => content.lessonId)).toEqual([
      ids.l1,
      ids.l2,
    ]);

    const memberRows = await db
      .select()
      .from(members)
      .where(and(eq(members.tenantId, TENANT_ID), eq(members.legacyId, ids.u1)));
    const memberRow = memberRows[0];
    expect(memberRow?.email).toBe(EMAIL_1);
    const authUsers = await db.select().from(user).where(eq(user.email, EMAIL_1));
    expect(memberRow?.userId).toBe(authUsers[0]?.id);

    const credentialRows = await db
      .select()
      .from(account)
      .where(and(eq(account.userId, authUsers[0]?.id ?? ''), eq(account.providerId, 'credential')));
    expect(credentialRows[0]?.password).toBe(MARKER);

    const grantRowsAll = await db
      .select()
      .from(productGrants)
      .where(eq(productGrants.tenantId, TENANT_ID));
    expect(grantRowsAll).toHaveLength(2);
    const winner = grantRowsAll.find((row) => row.legacyId === ids.g1);
    expect(winner?.expiresAt).toBeNull();
    expect(grantRowsAll.some((row) => row.legacyId === ids.g1dup)).toBe(false);

    const progressRows = await db
      .select()
      .from(memberCourseProgress)
      .where(eq(memberCourseProgress.tenantId, TENANT_ID));
    expect(progressRows).toHaveLength(1);
    expect(progressRows[0]?.completedLessonIds).toEqual([ids.l1]);
    expect(progressRows[0]?.lastViewedChapterId).toBe('chapter-array-id-1');
    expect(progressRows[0]?.updatedAt).toBe('2025-03-01T12:00:00.000Z');

    const productRows = await db.select().from(products).where(eq(products.tenantId, TENANT_ID));
    expect(productRows).toHaveLength(2);
    expect(productRows.every((row) => !row.published)).toBe(true);

    expect(result.verification?.pass).toBe(true);
    const spotChecks = result.verification?.tenants[0]?.spotChecks ?? [];
    expect(spotChecks.length).toBeGreaterThan(0);
    expect(result.verification?.tenants[0]?.markersVerified).toBe(1);
    expect(result.verification?.tenants[0]?.markersTotal).toBe(1);
  }, 60000);

  it('lets the imported user sign in with the legacy password', async () => {
    const signedIn = await auth.api.signInEmail({
      body: { email: EMAIL_1, password: PASSWORD },
      headers: new Headers({ origin: 'http://localhost:48730' }),
    });
    expect(signedIn.user.email).toBe(EMAIL_1);
    await expect(
      auth.api.signInEmail({
        body: { email: EMAIL_1, password: 'wrong-password' },
        headers: new Headers({ origin: 'http://localhost:48730' }),
      }),
    ).rejects.toThrowError();
  }, 30000);

  it('is idempotent: a second apply skips every row', async () => {
    const result = await runImport(db, gateway, targets(buildBundle()), {
      apply: true,
      nowIso,
    });
    expect(result.users.create).toBe(0);
    expect(result.users.update).toBe(0);
    expect(result.users.skip).toBe(2);
    for (const report of result.tenants[0]?.kinds ?? []) {
      expect({ kind: report.kind, create: report.create, update: report.update }).toEqual({
        kind: report.kind,
        create: 0,
        update: 0,
      });
    }
    expect(reportByKind(result.tenants[0]?.kinds ?? [], 'courses').skip).toBe(1);
    expect(reportByKind(result.tenants[0]?.kinds ?? [], 'lessons').skip).toBe(2);
    expect(reportByKind(result.tenants[0]?.kinds ?? [], 'grants').skip).toBe(2);
    expect(reportByKind(result.tenants[0]?.kinds ?? [], 'progress').skip).toBe(1);
    expect(result.verification?.pass).toBe(true);
  }, 60000);

  it('updates changed fields and merges progress as a union', async () => {
    const bundle = buildBundle();
    const course = bundle.courses[0];
    if (course === undefined) throw new Error('bundle course missing');
    course.name = 'Legacy Course (renamed)';
    const progress = bundle.progress[0];
    if (progress === undefined) throw new Error('bundle progress missing');
    progress.completedLessonIds = [ids.l2];
    progress.lastViewedLessonId = ids.l2;

    const result = await runImport(db, gateway, targets(bundle), { apply: true, nowIso });
    const courseReport = reportByKind(result.tenants[0]?.kinds ?? [], 'courses');
    expect(courseReport.update).toBe(1);
    expect(courseReport.samples[0]?.changes.some((change) => change.field === 'name')).toBe(true);

    const courseRows = await db.select().from(courses).where(eq(courses.tenantId, TENANT_ID));
    expect(courseRows[0]?.name).toBe('Legacy Course (renamed)');

    const progressRows = await db
      .select()
      .from(memberCourseProgress)
      .where(eq(memberCourseProgress.tenantId, TENANT_ID));
    expect(progressRows[0]?.completedLessonIds).toEqual([ids.l1, ids.l2]);
    expect(progressRows[0]?.lastViewedLessonId).toBe(ids.l1);
  }, 60000);

  it('never clobbers a native password set after import', async () => {
    const authUsers = await db.select().from(user).where(eq(user.email, EMAIL_1));
    const userId = authUsers[0]?.id ?? '';
    await db
      .update(account)
      .set({ password: 'native-hash-set-by-the-user' })
      .where(and(eq(account.userId, userId), eq(account.providerId, 'credential')));

    const result = await runImport(db, gateway, targets(buildBundle()), {
      apply: true,
      nowIso,
    });
    expect(
      result.users.anomalies.some((anomaly) => anomaly.kind === 'credential-kept-native'),
    ).toBe(true);

    const credentialRows = await db
      .select()
      .from(account)
      .where(and(eq(account.userId, userId), eq(account.providerId, 'credential')));
    expect(credentialRows[0]?.password).toBe('native-hash-set-by-the-user');
  }, 60000);

  it('derives member createdAt from the legacy ObjectId timestamp', async () => {
    const memberRows = await db
      .select()
      .from(members)
      .where(and(eq(members.tenantId, TENANT_ID), eq(members.legacyId, ids.u1)));
    expect(memberRows[0]?.createdAt).toBe('2023-07-19T12:56:37.000Z');
  }, 30000);

  const restoreImportedCredential = async (): Promise<void> => {
    const authUsers = await db.select().from(user).where(eq(user.email, EMAIL_1));
    await db
      .update(account)
      .set({ password: MARKER })
      .where(and(eq(account.userId, authUsers[0]?.id ?? ''), eq(account.providerId, 'credential')));
  };

  it('drops module→course links the course does not list in its module order', async () => {
    await restoreImportedCredential();
    const bundle = buildBundle();
    const detachedId = '65a524f8b5bd26b9d2ab0d99';
    bundle.modules.push({
      legacyId: detachedId,
      courseLegacyIds: [ids.c1],
      title: 'Module 1 (detached duplicate)',
      prefix: null,
      chapters: [],
    });

    const result = await runImport(db, gateway, targets(bundle), { apply: true, nowIso });
    const moduleReport = reportByKind(result.tenants[0]?.kinds ?? [], 'modules');
    expect(
      moduleReport.anomalies.some((anomaly) => anomaly.kind === 'module-detached-from-course'),
    ).toBe(true);

    const rows = await db
      .select()
      .from(courseModules)
      .where(and(eq(courseModules.tenantId, TENANT_ID), eq(courseModules.legacyId, detachedId)));
    expect(rows[0]?.courseIds).toEqual([]);
    expect(result.verification?.pass).toBe(true);
  }, 60000);

  it('re-apply repairs rows imported before the detached-link and join-date fixes', async () => {
    await restoreImportedCredential();
    const staleModuleId = '65a524f8b5bd26b9d2ab0d98';
    await db.insert(courseModules).values({
      id: staleModuleId,
      tenantId: TENANT_ID,
      courseIds: [ids.c1],
      title: 'Stale detached duplicate',
      prefix: null,
      chapters: [],
      legacyId: staleModuleId,
      createdAt: nowIso(),
    });
    await db
      .update(members)
      .set({ createdAt: '2026-07-19T22:03:15.098Z' })
      .where(and(eq(members.tenantId, TENANT_ID), eq(members.legacyId, ids.u1)));

    const bundle = buildBundle();
    bundle.modules.push({
      legacyId: staleModuleId,
      courseLegacyIds: [ids.c1],
      title: 'Stale detached duplicate',
      prefix: null,
      chapters: [],
    });

    const result = await runImport(db, gateway, targets(bundle), { apply: true, nowIso });
    const moduleReport = reportByKind(result.tenants[0]?.kinds ?? [], 'modules');
    expect(moduleReport.update).toBe(1);
    const memberReport = reportByKind(result.tenants[0]?.kinds ?? [], 'members');
    expect(memberReport.update).toBe(1);

    const moduleRows = await db
      .select()
      .from(courseModules)
      .where(and(eq(courseModules.tenantId, TENANT_ID), eq(courseModules.legacyId, staleModuleId)));
    expect(moduleRows[0]?.courseIds).toEqual([]);
    const memberRows = await db
      .select()
      .from(members)
      .where(and(eq(members.tenantId, TENANT_ID), eq(members.legacyId, ids.u1)));
    expect(memberRows[0]?.createdAt).toBe('2023-07-19T12:56:37.000Z');
    expect(result.verification?.pass).toBe(true);
  }, 60000);

  it('re-apply creates a fresh member without restoring a pseudonymized member or its history', async () => {
    await restoreImportedCredential();
    await db.insert(orders).values({
      id: 'order-import-erasure',
      tenantId: TENANT_ID,
      memberId: ids.u1,
      productId: ids.p1,
      priceId: null,
      kind: 'one_time',
      status: 'paid',
      amountCents: 12345,
      currency: 'PLN',
      provider: 'simulated',
      providerObjectIds: { payment: 'retained-payment' },
      createdAt: '2025-02-01T00:00:00.000Z',
    });
    const removedAt = '2026-07-20T12:00:00.000Z';
    await createMemberErasureRepository(db).pseudonymize(TENANT_ID, {
      memberId: ids.u1,
      deletedAt: removedAt,
      tombstoneEmail: memberTombstone(ids.u1).email,
      severedUserId: memberTombstone(ids.u1).userId,
      postAuthorDisplay: 'Konto usunięte',
    });

    const ordersBefore = await db.select().from(orders).where(eq(orders.id, 'order-import-erasure'));
    const revenueBefore = await createOrderRepository(db).revenueSince(
      TENANT_ID,
      '2025-01-01T00:00:00.000Z',
    );
    const grantsBefore = await db
      .select()
      .from(productGrants)
      .where(eq(productGrants.memberId, ids.u1));
    const progressBefore = await db
      .select()
      .from(memberCourseProgress)
      .where(eq(memberCourseProgress.memberId, ids.u1));

    const result = await runImport(db, gateway, targets(buildBundle()), { apply: true, nowIso });

    const tombstones = await db.select().from(members).where(eq(members.id, ids.u1));
    expect(tombstones[0]).toMatchObject({
      email: memberTombstone(ids.u1).email,
      userId: memberTombstone(ids.u1).userId,
      displayName: null,
      legacyId: null,
      tags: [],
      marketingConsents: {},
      externalCustomerIds: {},
      deletedAt: removedAt,
    });
    const freshRows = await db
      .select()
      .from(members)
      .where(and(eq(members.tenantId, TENANT_ID), eq(members.legacyId, ids.u1)));
    expect(freshRows).toHaveLength(1);
    expect(freshRows[0]).toMatchObject({
      email: EMAIL_1,
      displayName: 'Jan Import',
      deletedAt: null,
    });
    expect(freshRows[0]?.id).not.toBe(ids.u1);

    const grantsAfter = await db
      .select()
      .from(productGrants)
      .where(eq(productGrants.memberId, ids.u1));
    expect(grantsAfter).toEqual(grantsBefore);
    expect(grantsAfter[0]?.expiresAt).toBe(removedAt);
    expect(
      await db
        .select()
        .from(memberCourseProgress)
        .where(eq(memberCourseProgress.memberId, ids.u1)),
    ).toEqual(progressBefore);
    expect(await db.select().from(orders).where(eq(orders.id, 'order-import-erasure'))).toEqual(
      ordersBefore,
    );
    expect(
      await createOrderRepository(db).revenueSince(TENANT_ID, '2025-01-01T00:00:00.000Z'),
    ).toEqual(revenueBefore);
    expect(result.verification?.pass).toBe(true);
  }, 60000);
});
