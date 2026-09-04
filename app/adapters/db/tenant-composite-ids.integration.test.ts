import { and, eq } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { createContentHash } from '#adapters/crypto/content-hash.js';
import {
  capabilitiesForApiKey,
  type AppError,
  type ImportBatchResponse,
  type Result,
  type TenantApiKey,
} from '#core/domain/index.js';
import {
  importM2mContent,
  importM2mUsers,
  type Ctx,
  type M2mImportContentDeps,
  type M2mImportUsersDeps,
} from '#core/server/index.js';

import type { Db } from './client.js';
import { createImportContentRepository } from './content-import.js';
import { createImportAuditEventRepository } from './import-audit-events.js';
import {
  createCourseLessonRepository,
  createCourseModuleRepository,
  createCourseRepository,
  createProductRepository,
} from './repositories.js';
import {
  courses,
  memberCourseProgress,
  members,
  productGrants,
  tenantApiKeys,
  tenants,
} from './schema.js';
import { createTestDatabase } from './test-database-name.js';
import { createImportUsersRepository } from './users-import.js';

const baseDatabaseUrl =
  process.env['DATABASE_URL'] ?? 'postgres://together:together@localhost:48912/together';
const NOW = '1998-08-14T10:00:00.000Z';
const DATASET_VERSION = 'together-import/v1';
const GRANT_STARTS_AT = '1998-01-01T00:00:00.000Z';
const BASE_COURSE = 'base-course';
const BASE_PRODUCT = 'base-product';
const FOREIGN_KEY_VIOLATION = '23503';

type Tenant = { id: string; slug: string; apiKey: TenantApiKey; ctx: Ctx };

const tenantFixture = (slug: string): Tenant => {
  const id = `tenant-${slug}`;
  const apiKey: TenantApiKey = {
    id: `key-${slug}`,
    tenantId: id,
    name: 'Migration',
    keyHash: `hash-${slug}`,
    scopes: ['import:content', 'import:users'],
    createdAt: NOW,
    expiresAt: '1998-08-20T10:00:00.000Z',
    revokedAt: null,
  };
  return {
    id,
    slug,
    apiKey,
    ctx: {
      identity: {
        userId: 'api-key',
        email: 'api-key@invalid.test',
        name: 'Migration API',
        emailVerified: true,
        tenantId: id,
        tenantSlug: slug,
        tenantName: slug,
        staffRole: null,
        memberId: null,
        memberBannedAt: null,
        memberDmOptOutAt: null,
        memberLanguage: null,
        image: null,
        memberDisplayName: null,
      },
      capabilities: capabilitiesForApiKey(apiKey),
    },
  };
};

const tenantA = tenantFixture('composite-a');
const tenantB = tenantFixture('composite-b');

let db: Db;
let closeTestDatabase: () => Promise<void>;
let contentDeps: M2mImportContentDeps;
let usersDeps: M2mImportUsersDeps;
let idSequence = 0;
let contentReads = 0;

const ids = { nextId: (): string => `generated-${String((idSequence += 1))}` };
const clock = { nowIso: (): string => NOW };
const hash = createContentHash();

const countContentRead = <T>(read: Promise<T>): Promise<T> => {
  contentReads += 1;
  return read;
};

const measureContentReads = async (
  run: () => Promise<ImportBatchResponse>,
): Promise<{ response: ImportBatchResponse; reads: number }> => {
  contentReads = 0;
  const response = await run();
  return { response, reads: contentReads };
};

const unwrap = (result: Result<ImportBatchResponse, AppError>): ImportBatchResponse => {
  if (!result.ok) throw new Error(`Import was rejected: ${result.error.message}`);
  return result.value;
};

const responseSignature = (response: ImportBatchResponse) => ({
  summary: response.summary,
  results: response.results.map((result) => ({
    fields: Object.keys(result).sort(),
    action: result.action,
    idEchoesImportKey: result.action === 'error' ? null : result.id === result.importKey,
  })),
});

const importCourse = async (
  tenant: Tenant,
  importKey: string,
  name: string,
): Promise<ImportBatchResponse> =>
  unwrap(await importM2mContent(tenant.ctx, tenant.apiKey, 'course', {
    datasetVersion: DATASET_VERSION,
    records: [{ importKey, name, description: '', imageUrl: null, moduleOrder: [] }],
  }, contentDeps));

const importProduct = async (
  tenant: Tenant,
  importKey: string,
): Promise<ImportBatchResponse> =>
  unwrap(await importM2mContent(tenant.ctx, tenant.apiKey, 'product', {
    datasetVersion: DATASET_VERSION,
    records: [{
      importKey,
      type: 'course',
      slug: importKey,
      title: importKey,
      description: '',
      coverUrl: null,
      priceCents: 0,
      currency: 'PLN',
      accessItems: [],
    }],
  }, contentDeps));

const importMember = async (
  tenant: Tenant,
  importKey: string,
): Promise<ImportBatchResponse> =>
  unwrap(await importM2mUsers(tenant.ctx, tenant.apiKey, 'member', {
    datasetVersion: DATASET_VERSION,
    records: [{
      importKey,
      email: `${importKey}-${tenant.slug}@composite.test`,
      displayName: importKey,
    }],
  }, usersDeps));

const importGrant = async (
  tenant: Tenant,
  importKey: string,
  memberKey: string,
): Promise<ImportBatchResponse> =>
  unwrap(await importM2mUsers(tenant.ctx, tenant.apiKey, 'grant', {
    datasetVersion: DATASET_VERSION,
    records: [{
      importKey,
      memberKey,
      productKey: BASE_PRODUCT,
      startsAt: GRANT_STARTS_AT,
      expiresAt: null,
    }],
  }, usersDeps));

const importProgress = async (
  tenant: Tenant,
  importKey: string,
  memberKey: string,
): Promise<ImportBatchResponse> =>
  unwrap(await importM2mUsers(tenant.ctx, tenant.apiKey, 'progress', {
    datasetVersion: DATASET_VERSION,
    records: [{
      importKey,
      memberKey,
      courseKey: BASE_COURSE,
      completedLessonKeys: [],
      updatedAt: NOW,
    }],
  }, usersDeps));

const createdResults = (importKey: string) => [{ importKey, action: 'created', id: importKey }];

const courseRow = async (tenant: Tenant, id: string) => {
  const rows = await db
    .select({ id: courses.id, name: courses.name })
    .from(courses)
    .where(and(eq(courses.tenantId, tenant.id), eq(courses.id, id)));
  return rows[0] ?? null;
};

const memberRow = async (tenant: Tenant, id: string) => {
  const rows = await db
    .select({ id: members.id, email: members.email })
    .from(members)
    .where(and(eq(members.tenantId, tenant.id), eq(members.id, id)));
  return rows[0] ?? null;
};

const grantRow = async (tenant: Tenant, id: string) => {
  const rows = await db
    .select({ id: productGrants.id, memberId: productGrants.memberId })
    .from(productGrants)
    .where(and(eq(productGrants.tenantId, tenant.id), eq(productGrants.id, id)));
  return rows[0] ?? null;
};

const progressRow = async (tenant: Tenant, id: string) => {
  const rows = await db
    .select({ id: memberCourseProgress.id, memberId: memberCourseProgress.memberId })
    .from(memberCourseProgress)
    .where(and(
      eq(memberCourseProgress.tenantId, tenant.id),
      eq(memberCourseProgress.id, id),
    ));
  return rows[0] ?? null;
};

beforeAll(async () => {
  const testDatabase = await createTestDatabase('together_tenant_composite_ids', baseDatabaseUrl);
  db = testDatabase.db;
  closeTestDatabase = testDatabase.close;
  for (const tenant of [tenantA, tenantB]) {
    await db.insert(tenants).values({
      id: tenant.id,
      slug: tenant.slug,
      name: tenant.slug,
      createdAt: NOW,
    });
    await db.insert(tenantApiKeys).values({
      id: tenant.apiKey.id,
      tenantId: tenant.id,
      name: tenant.apiKey.name,
      keyHash: tenant.apiKey.keyHash,
      scopes: tenant.apiKey.scopes,
      createdAt: NOW,
      expiresAt: tenant.apiKey.expiresAt,
    });
  }

  const courseRepository = createCourseRepository(db);
  const moduleRepository = createCourseModuleRepository(db);
  const lessonRepository = createCourseLessonRepository(db);
  const productRepository = createProductRepository(db);
  const auditRepository = createImportAuditEventRepository(db);
  const usersRepository = createImportUsersRepository(db);

  contentDeps = {
    courses: {
      findById: (tenantId, id) => countContentRead(courseRepository.findById(tenantId, id)),
    },
    modules: {
      findById: (tenantId, id) => countContentRead(moduleRepository.findById(tenantId, id)),
      list: (tenantId) => countContentRead(moduleRepository.list(tenantId)),
    },
    lessons: {
      findById: (tenantId, id) => countContentRead(lessonRepository.findById(tenantId, id)),
    },
    products: {
      findById: (tenantId, id) => countContentRead(productRepository.findById(tenantId, id)),
      listByTenant: (tenantId) => countContentRead(productRepository.listByTenant(tenantId)),
      listPublishedByTenant: (tenantId) =>
        countContentRead(productRepository.listPublishedByTenant(tenantId)),
    },
    importAuditEvents: {
      findLatestByImportKey: (tenantId, kind, importKey) =>
        countContentRead(auditRepository.findLatestByImportKey(tenantId, kind, importKey)),
    },
    importContent: createImportContentRepository(db),
    ids,
    clock,
    hash,
  };

  usersDeps = {
    courses: courseRepository,
    modules: moduleRepository,
    lessons: lessonRepository,
    products: { findById: (tenantId, id) => productRepository.findById(tenantId, id) },
    importAuditEvents: auditRepository,
    importUsers: usersRepository,
    ids,
    clock,
    hash,
  };

  for (const tenant of [tenantA, tenantB]) {
    await importCourse(tenant, BASE_COURSE, `${tenant.slug} base course`);
    await importProduct(tenant, BASE_PRODUCT);
  }
}, 120_000);

afterAll(async () => {
  await closeTestDatabase();
});

describe('content import across tenants', () => {
  it('reveals nothing when an import key collides with another tenant resource', async () => {
    await db.insert(courses).values({
      id: 'oracle-course',
      tenantId: tenantA.id,
      name: 'Tenant A course',
      description: 'Seeded outside the import',
      imageUrl: null,
      moduleOrder: [],
      createdAt: NOW,
    });

    const colliding = await measureContentReads(async () =>
      importCourse(tenantB, 'oracle-course', 'Tenant B course'));
    const fresh = await measureContentReads(async () =>
      importCourse(tenantB, 'oracle-course-fresh', 'Tenant B course'));

    expect(colliding.response.results).toEqual(createdResults('oracle-course'));
    expect(responseSignature(colliding.response)).toEqual(responseSignature(fresh.response));
    expect(colliding.reads).toBe(fresh.reads);
    expect(await courseRow(tenantA, 'oracle-course')).toEqual({
      id: 'oracle-course',
      name: 'Tenant A course',
    });
    expect(await courseRow(tenantB, 'oracle-course')).toEqual({
      id: 'oracle-course',
      name: 'Tenant B course',
    });
  });

  it('lets a tenant claim an import key another tenant already took', async () => {
    const squatter = await importCourse(tenantB, 'squat-course', 'Tenant B course');
    const owner = await importCourse(tenantA, 'squat-course', 'Tenant A course');

    expect(squatter.results).toEqual(createdResults('squat-course'));
    expect(owner.results).toEqual(createdResults('squat-course'));
    expect(await courseRow(tenantA, 'squat-course')).toEqual({
      id: 'squat-course',
      name: 'Tenant A course',
    });
    expect(await courseRow(tenantB, 'squat-course')).toEqual({
      id: 'squat-course',
      name: 'Tenant B course',
    });
  });

  it('reports an unchanged action when the same payload is imported twice', async () => {
    const first = await importCourse(tenantA, 'idempotent-course', 'Tenant A course');
    const second = await importCourse(tenantA, 'idempotent-course', 'Tenant A course');

    expect(first.results).toEqual(createdResults('idempotent-course'));
    expect(second.results).toEqual([
      { importKey: 'idempotent-course', action: 'unchanged', id: 'idempotent-course' },
    ]);
    expect(second.summary).toEqual({ created: 0, updated: 0, unchanged: 1, failed: 0 });
  });
});

describe('users import across tenants', () => {
  it('reveals nothing when a member import key collides with another tenant member', async () => {
    await importMember(tenantA, 'oracle-member');

    const colliding = await importMember(tenantB, 'oracle-member');
    const fresh = await importMember(tenantB, 'oracle-member-fresh');

    expect(colliding.results).toEqual(createdResults('oracle-member'));
    expect(responseSignature(colliding)).toEqual(responseSignature(fresh));
    expect(await memberRow(tenantA, 'oracle-member')).toEqual({
      id: 'oracle-member',
      email: `oracle-member-${tenantA.slug}@composite.test`,
    });
    expect(await memberRow(tenantB, 'oracle-member')).toEqual({
      id: 'oracle-member',
      email: `oracle-member-${tenantB.slug}@composite.test`,
    });
  });

  it('lets a tenant claim a member import key another tenant already took', async () => {
    const squatter = await importMember(tenantB, 'squat-member');
    const owner = await importMember(tenantA, 'squat-member');

    expect(squatter.results).toEqual(createdResults('squat-member'));
    expect(owner.results).toEqual(createdResults('squat-member'));
    expect(await memberRow(tenantA, 'squat-member')).not.toBeNull();
    expect(await memberRow(tenantB, 'squat-member')).not.toBeNull();
  });

  it('reveals nothing when a grant import key collides with another tenant grant', async () => {
    await importMember(tenantA, 'oracle-grant-member');
    await importGrant(tenantA, 'oracle-grant', 'oracle-grant-member');
    await importMember(tenantB, 'oracle-grant-member');
    await importMember(tenantB, 'oracle-grant-fresh-member');

    const colliding = await importGrant(tenantB, 'oracle-grant', 'oracle-grant-member');
    const fresh = await importGrant(tenantB, 'oracle-grant-fresh', 'oracle-grant-fresh-member');

    expect(colliding.results).toEqual(createdResults('oracle-grant'));
    expect(responseSignature(colliding)).toEqual(responseSignature(fresh));
    expect(await grantRow(tenantA, 'oracle-grant')).toEqual({
      id: 'oracle-grant',
      memberId: 'oracle-grant-member',
    });
    expect(await grantRow(tenantB, 'oracle-grant')).toEqual({
      id: 'oracle-grant',
      memberId: 'oracle-grant-member',
    });
  });

  it('lets a tenant claim a grant import key another tenant already took', async () => {
    await importMember(tenantB, 'squat-grant-member');
    await importMember(tenantA, 'squat-grant-member');

    const squatter = await importGrant(tenantB, 'squat-grant', 'squat-grant-member');
    const owner = await importGrant(tenantA, 'squat-grant', 'squat-grant-member');

    expect(squatter.results).toEqual(createdResults('squat-grant'));
    expect(owner.results).toEqual(createdResults('squat-grant'));
    expect(await grantRow(tenantA, 'squat-grant')).not.toBeNull();
    expect(await grantRow(tenantB, 'squat-grant')).not.toBeNull();
  });

  it('reveals nothing when a progress import key collides with another tenant progress', async () => {
    await importMember(tenantA, 'oracle-progress-member');
    await importProgress(tenantA, 'oracle-progress', 'oracle-progress-member');
    await importMember(tenantB, 'oracle-progress-member');
    await importMember(tenantB, 'oracle-progress-fresh-member');

    const colliding = await importProgress(tenantB, 'oracle-progress', 'oracle-progress-member');
    const fresh = await importProgress(
      tenantB,
      'oracle-progress-fresh',
      'oracle-progress-fresh-member',
    );

    expect(colliding.results).toEqual(createdResults('oracle-progress'));
    expect(responseSignature(colliding)).toEqual(responseSignature(fresh));
    expect(await progressRow(tenantA, 'oracle-progress')).toEqual({
      id: 'oracle-progress',
      memberId: 'oracle-progress-member',
    });
    expect(await progressRow(tenantB, 'oracle-progress')).toEqual({
      id: 'oracle-progress',
      memberId: 'oracle-progress-member',
    });
  });

  it('lets a tenant claim a progress import key another tenant already took', async () => {
    await importMember(tenantB, 'squat-progress-member');
    await importMember(tenantA, 'squat-progress-member');

    const squatter = await importProgress(tenantB, 'squat-progress', 'squat-progress-member');
    const owner = await importProgress(tenantA, 'squat-progress', 'squat-progress-member');

    expect(squatter.results).toEqual(createdResults('squat-progress'));
    expect(owner.results).toEqual(createdResults('squat-progress'));
    expect(await progressRow(tenantA, 'squat-progress')).not.toBeNull();
    expect(await progressRow(tenantB, 'squat-progress')).not.toBeNull();
  });

  it('reports an unchanged action when the same member payload is imported twice', async () => {
    const first = await importMember(tenantA, 'idempotent-member');
    const second = await importMember(tenantA, 'idempotent-member');

    expect(first.results).toEqual(createdResults('idempotent-member'));
    expect(second.results).toEqual([
      { importKey: 'idempotent-member', action: 'unchanged', id: 'idempotent-member' },
    ]);
    expect(second.summary).toEqual({ created: 0, updated: 0, unchanged: 1, failed: 0 });
  });
});

describe('composite foreign keys', () => {
  it('rejects progress referencing a course that exists only in another tenant', async () => {
    await importCourse(tenantA, 'fk-course', 'Tenant A course');
    await importMember(tenantB, 'fk-progress-member');

    await expect(db.insert(memberCourseProgress).values({
      id: 'fk-cross-tenant-progress',
      tenantId: tenantB.id,
      memberId: 'fk-progress-member',
      courseId: 'fk-course',
      completedLessonIds: [],
      updatedAt: NOW,
    })).rejects.toMatchObject({
      cause: {
        code: FOREIGN_KEY_VIOLATION,
        constraint: 'member_course_progress_tenant_course_fk',
      },
    });

    await importCourse(tenantB, 'fk-course', 'Tenant B course');
    await db.insert(memberCourseProgress).values({
      id: 'fk-same-tenant-progress',
      tenantId: tenantB.id,
      memberId: 'fk-progress-member',
      courseId: 'fk-course',
      completedLessonIds: [],
      updatedAt: NOW,
    });

    expect(await progressRow(tenantB, 'fk-same-tenant-progress')).not.toBeNull();
  });

  it('rejects a grant referencing a member that exists only in another tenant', async () => {
    await importMember(tenantA, 'fk-grant-member');

    await expect(db.insert(productGrants).values({
      id: 'fk-cross-tenant-grant',
      tenantId: tenantB.id,
      memberId: 'fk-grant-member',
      productId: BASE_PRODUCT,
      source: 'import',
      startsAt: GRANT_STARTS_AT,
      expiresAt: null,
      createdAt: NOW,
    })).rejects.toMatchObject({
      cause: {
        code: FOREIGN_KEY_VIOLATION,
        constraint: 'product_grants_tenant_member_fk',
      },
    });
  });
});
