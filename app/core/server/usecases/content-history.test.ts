import { describe, expect, it } from 'vitest';

import {
  computeCourseModuleName,
  ok,
  type Course,
  type CourseLesson,
  type CourseModule,
  type EntityHistoryEntry,
  type Identity,
  type Product,
  type StaffRole,
  type TenantAuditEventInput,
} from '#core/domain/index.js';

import type {
  CourseLessonRepository,
  EntityVersionRecord,
  EntityVersionRepository,
  StoredEntityVersion,
} from '../ports.js';
import {
  getContentHistory,
  getContentVersion,
  restoreContentVersion,
  type ContentHistoryDeps,
  type ContentRestoreDeps,
} from './content-history.js';

const identity = (tenantId: string | null, staffRole: StaffRole | null): Identity => ({
  userId: 'u1',
  email: 'creator@together.dev',
  name: 'Creator',
  emailVerified: true,
  tenantId,
  tenantSlug: tenantId ? 'studio' : null,
  tenantName: tenantId ? 'Studio' : null,
  staffRole,
  memberId: null,
  image: null,
  memberDisplayName: null,
  memberBannedAt: null,
  memberDmOptOutAt: null,
  memberLanguage: null,
  memberVideoAutoplay: false,
});

const entry = (
  over: Partial<EntityHistoryEntry> & { tenantId: string },
): EntityHistoryEntry & { tenantId: string } => ({
  id: 'v1',
  entityKind: 'course',
  entityId: 'c1',
  ordinal: 1,
  schemaVersion: 1,
  createdAt: '2026-01-01T00:00:00.000Z',
  createdBy: 'u1',
  ...over,
});

const record = (
  over: Partial<StoredEntityVersion> & { tenantId: string },
): StoredEntityVersion & { tenantId: string } => ({
  id: 'v1',
  entityKind: 'course',
  entityId: 'c1',
  ordinal: 1,
  schemaVersion: 1,
  payload: {
    id: 'c1',
    tenantId: over.tenantId,
    name: 'Old name',
    description: '',
    imageUrl: null,
    legacyId: null,
    createdAt: '2026-01-01T00:00:00.000Z',
  },
  createdAt: '2026-01-01T00:00:00.000Z',
  createdBy: 'u1',
  ...over,
});

const versionsRepo = (
  entries: (EntityHistoryEntry & { tenantId: string })[],
  records: (StoredEntityVersion & { tenantId: string })[] = [],
): EntityVersionRepository => ({
  list: async (tenantId, query) =>
    entries
      .filter(
        (item) =>
          item.tenantId === tenantId &&
          item.entityKind === query.entityKind &&
          item.entityId === query.entityId,
      )
      .slice(0, query.limit)
      .map((item) => ({
        id: item.id,
        entityKind: item.entityKind,
        entityId: item.entityId,
        ordinal: item.ordinal,
        schemaVersion: item.schemaVersion,
        createdAt: item.createdAt,
        createdBy: item.createdBy,
      })),
  findById: async (tenantId, id) => {
    const found = records.find((item) => item.tenantId === tenantId && item.id === id);
    if (!found) return null;
    return {
      id: found.id,
      entityKind: found.entityKind,
      entityId: found.entityId,
      ordinal: found.ordinal,
      schemaVersion: found.schemaVersion,
      payload: found.payload,
      createdAt: found.createdAt,
      createdBy: found.createdBy,
    };
  },
});

const course: Course = {
  id: 'c1',
  tenantId: 't-acme',
  name: 'Course one',
  description: 'Current description',
  imageUrl: null,
  moduleOrder: ['m1'],
  publiclyVisible: false,
  legacyId: null,
  createdAt: '2026-01-01T00:00:00.000Z',
};

const moduleRow: CourseModule = {
  id: 'm1',
  tenantId: 't-acme',
  courseIds: ['c1'],
  title: 'Foundations',
  prefix: null,
  name: computeCourseModuleName(null, 'Foundations'),
  chapters: [],
  legacyId: null,
  createdAt: '2026-01-01T00:00:00.000Z',
};

const lessonRow: CourseLesson = {
  id: 'l1',
  tenantId: 't-acme',
  name: 'Lesson one',
  isPreview: false,
  contents: [],
  legacyId: null,
  createdAt: '2026-01-01T00:00:00.000Z',
};

const productRow: Product = {
  id: 'p1',
  tenantId: 't-acme',
  type: 'course',
  slug: 'product-one',
  title: 'Product one',
  description: 'Current copy',
  coverUrl: null,
  priceCents: 12_000,
  currency: 'PLN',
  published: false,
  accessItems: [],
  checkoutConsentDefinitionIds: [],
  legacyId: null,
  createdAt: '2026-01-01T00:00:00.000Z',
};

const readDeps = (repo: EntityVersionRepository): ContentHistoryDeps => ({
  entityVersions: repo,
  courses: {
    list: async () => [course],
    findById: async (tenantId, id) => (tenantId === course.tenantId && id === course.id ? course : null),
    findByIds: async () => [course],
    create: async () => undefined,
    update: async () => null,
    delete: async () => false,
  },
  modules: {
    list: async (tenantId) => (tenantId === moduleRow.tenantId ? [moduleRow] : []),
    findById: async () => moduleRow,
    findByIds: async () => [moduleRow],
    create: async () => undefined,
    update: async () => null,
    delete: async () => false,
  },
  lessons: { findById: async () => lessonRow },
  products: { findById: async () => productRow },
  userDisplays: {
    findDisplayNames: async (_tenantId, userIds) =>
      new Map(userIds.flatMap((userId) => (userId === 'u1' ? [[userId, 'Ada Creator'] as const] : []))),
  },
});

interface RestoreHarness {
  deps: ContentRestoreDeps;
  courses: Course[];
  modules: CourseModule[];
  lessons: CourseLesson[];
  products: Product[];
  writtenVersions: EntityVersionRecord[];
  auditTrail: TenantAuditEventInput[];
}

const restoreHarness = (records: (StoredEntityVersion & { tenantId: string })[]): RestoreHarness => {
  const courses = [{ ...course }];
  const modules = [{ ...moduleRow }];
  const lessons = [{ ...lessonRow }];
  const products = [{ ...productRow }];
  const writtenVersions: EntityVersionRecord[] = [];
  const auditTrail: TenantAuditEventInput[] = [];
  const store = <T extends { id: string; tenantId: string }>(items: T[]) => ({
    list: async (tenantId: string) => items.filter((item) => item.tenantId === tenantId),
    findById: async (tenantId: string, id: string) =>
      items.find((item) => item.tenantId === tenantId && item.id === id) ?? null,
    findByIds: async (tenantId: string, ids: string[]) =>
      items.filter((item) => item.tenantId === tenantId && ids.includes(item.id)),
    create: async (_tenantId: string, item: T) => {
      items.push(item);
    },
    update: async (tenantId: string, item: T, version?: EntityVersionRecord) => {
      const index = items.findIndex((row) => row.tenantId === tenantId && row.id === item.id);
      if (index < 0) return null;
      if (version) writtenVersions.push(version);
      items[index] = item;
      return item;
    },
    delete: async () => false,
  });

  const courseStore = store(courses);
  const moduleStore = store(modules);
  const lessonStore = store(lessons);

  const deps: ContentRestoreDeps = {
    entityVersions: versionsRepo([], records),
    courses: courseStore,
    modules: moduleStore,
    lessons: { ...lessonStore, listPreviews: async () => [] } satisfies CourseLessonRepository,
    products: {
      listByTenant: async (tenantId) => products.filter((item) => item.tenantId === tenantId),
      listPublishedByTenant: async () => [],
      findById: async (tenantId, id) =>
        products.find((item) => item.tenantId === tenantId && item.id === id) ?? null,
      create: async () => 'created',
      updateAccessItems: async () => null,
      setPublished: async () => undefined,
      bumpContentVersion: async () => undefined,
      update: async (tenantId, item, version) => {
        const index = products.findIndex((row) => row.tenantId === tenantId && row.id === item.id);
        if (index < 0) return null;
        writtenVersions.push(version);
        products[index] = item;
        return item;
      },
    },
    userDisplays: { findDisplayNames: async () => new Map() },
    progress: {
      findByMemberAndCourse: async () => null,
      listByMember: async () => [],
      findOrCreate: async (tenantId, input) => ({
        id: input.id,
        tenantId,
        memberId: input.memberId,
        courseId: input.courseId,
        completedLessonIds: [],
        updatedAt: input.now,
      }),
      update: async (_tenantId, progress) => progress,
      countReferencingLesson: async () => 0,
    },
    attachments: {
      create: async () => undefined,
      findById: async () => null,
      listByLesson: async () => [],
      listReadyByLesson: async () => [],
      markReady: async () => null,
      delete: async () => false,
    },
    storage: {
      objectUrl: (configuration, key) =>
        new URL(`${configuration.endpoint}/${configuration.bucket}/${key}`),
      probe: async () => ok({ code: 'storage.available', message: 'ok' }),
      presignPut: (request) => ok(request.url),
      presignGet: (request) => ok(request.url),
      delete: async () => ok({ deleted: true }),
      head: async () => ok({ sizeBytes: 1 }),
      healthcheck: async () => ok({ healthy: true }),
      test: async () => ok({ code: 'storage.available', message: 'ok' }),
    },
    secretResolver: { resolve: async () => ok('{}') },
    auditEvents: {
      record: async (_tenantId, event) => {
        auditTrail.push(event);
      },
    },
    ids: { nextId: () => `generated-${writtenVersions.length + 1}` },
    clock: { nowIso: () => '2026-02-02T00:00:00.000Z' },
  };

  return { deps, courses, modules, lessons, products, writtenVersions, auditTrail };
};

describe('content history use-cases', () => {
  it('requires staff tenant context', async () => {
    const result = await getContentHistory(
      { identity: identity('t-acme', null) },
      { courseId: 'c1' },
      readDeps(versionsRepo([])),
    );
    expect(result).toMatchObject({ ok: false, error: { code: 'forbidden' } });
  });

  it('scopes history to the staff tenant', async () => {
    const repo = versionsRepo([
      entry({ tenantId: 't-acme', id: 'a1' }),
      entry({ tenantId: 't-other', id: 'b1' }),
    ]);
    const result = await getContentHistory(
      { identity: identity('t-acme', 'admin') },
      { courseId: 'c1' },
      readDeps(repo),
    );
    expect(result.ok && result.value).toEqual([
      expect.objectContaining({
        id: 'a1',
        ordinal: 1,
        subjectKind: 'course',
        subjectName: 'Course one',
        createdByDisplayName: 'Ada Creator',
      }),
    ]);
  });

  it('keeps each entity ordinal and falls back to the stored author label', async () => {
    const repo = versionsRepo([
      entry({ tenantId: 't-acme', id: 'a1', ordinal: 1, createdBy: 'legacy import' }),
      entry({ tenantId: 't-acme', id: 'a2', ordinal: 2, createdAt: '2026-01-03T00:00:00.000Z' }),
    ]);
    const result = await getContentHistory(
      { identity: identity('t-acme', 'owner') },
      { courseId: 'c1' },
      readDeps(repo),
    );
    expect(result.ok && result.value.map((version) => [version.ordinal, version.createdByDisplayName])).toEqual([
      [2, 'Ada Creator'],
      [1, 'legacy import'],
    ]);
  });

  it('applies the pagination-lite limit', async () => {
    const repo = versionsRepo([
      entry({ tenantId: 't-acme', id: 'a1' }),
      entry({ tenantId: 't-acme', id: 'a2' }),
      entry({ tenantId: 't-acme', id: 'a3' }),
    ]);
    const result = await getContentHistory(
      { identity: identity('t-acme', 'owner') },
      { courseId: 'c1', limit: 2 },
      readDeps(repo),
    );
    expect(result.ok && result.value).toHaveLength(2);
  });

  it('merges course and module snapshots chronologically with resolved creator names', async () => {
    const repo = versionsRepo([
      entry({ tenantId: 't-acme', id: 'course-old', createdAt: '2026-01-01T00:00:00.000Z' }),
      entry({
        tenantId: 't-acme',
        id: 'module-new',
        entityKind: 'course_module',
        entityId: 'm1',
        createdAt: '2026-01-02T00:00:00.000Z',
      }),
    ]);

    const result = await getContentHistory(
      { identity: identity('t-acme', 'owner') },
      { courseId: 'c1' },
      readDeps(repo),
    );

    expect(result.ok && result.value).toEqual([
      expect.objectContaining({
        id: 'module-new',
        subjectKind: 'module',
        subjectName: 'Foundations',
        createdByDisplayName: 'Ada Creator',
      }),
      expect.objectContaining({ id: 'course-old', subjectKind: 'course' }),
    ]);
  });

  it('rejects a missing course id', async () => {
    const result = await getContentHistory(
      { identity: identity('t-acme', 'owner') },
      {},
      readDeps(versionsRepo([])),
    );
    expect(result).toMatchObject({ ok: false, error: { code: 'validation' } });
  });

  it('fetches a single version and upcasts it to the current schema', async () => {
    const repo = versionsRepo([], [record({ tenantId: 't-acme', id: 'v9' })]);
    const result = await getContentVersion({ identity: identity('t-acme', 'owner') }, 'v9', readDeps(repo));
    expect(result).toMatchObject({
      ok: true,
      value: { version: { id: 'v9', entityKind: 'course', schemaVersion: 1, currentSchemaVersion: 4 } },
    });
    expect(result.ok && result.value.version.payload).toMatchObject({
      id: 'c1',
      name: 'Old name',
      moduleOrder: [],
    });
  });

  it('previews the snapshot as edit-form fields and diffs it against the current state', async () => {
    const repo = versionsRepo([], [record({ tenantId: 't-acme', id: 'v9' })]);
    const result = await getContentVersion({ identity: identity('t-acme', 'owner') }, 'v9', readDeps(repo));
    expect(result.ok && result.value.preview.fields.map((field) => field.name)).toEqual([
      'title',
      'description',
      'imageUrl',
      'publiclyVisible',
      'modules',
    ]);
    expect(result.ok && result.value.changedFields).toEqual(['title', 'description', 'modules']);
    expect(result.ok && result.value.current?.fields[0]?.value).toEqual({
      kind: 'text',
      value: 'Course one',
    });
  });

  it('returns not_found for an unknown version id', async () => {
    const result = await getContentVersion(
      { identity: identity('t-acme', 'owner') },
      'missing',
      readDeps(versionsRepo([])),
    );
    expect(result).toMatchObject({ ok: false, error: { code: 'not_found' } });
  });

  it('scopes a single-version fetch to the staff tenant', async () => {
    const repo = versionsRepo([], [record({ tenantId: 't-other', id: 'v9' })]);
    const result = await getContentVersion({ identity: identity('t-acme', 'owner') }, 'v9', readDeps(repo));
    expect(result).toMatchObject({ ok: false, error: { code: 'not_found' } });
  });
});

describe('restoring a content version', () => {
  it('re-applies a course snapshot as a new save and appends a version', async () => {
    const harness = restoreHarness([record({ tenantId: 't-acme', id: 'v9' })]);

    const result = await restoreContentVersion(
      { identity: identity('t-acme', 'owner') },
      { versionId: 'v9' },
      harness.deps,
    );

    expect(result).toMatchObject({
      ok: true,
      value: { entityKind: 'course', entityId: 'c1', restoredFromVersionId: 'v9', restoredFromOrdinal: 1 },
    });
    expect(harness.courses[0]).toMatchObject({
      name: 'Old name',
      description: '',
      moduleOrder: ['m1'],
    });
    expect(harness.writtenVersions).toMatchObject([
      { entityKind: 'course', entityId: 'c1', payload: expect.objectContaining({ name: 'Course one' }) },
    ]);
  });

  it('records a tenant audit event naming the restored version', async () => {
    const harness = restoreHarness([record({ tenantId: 't-acme', id: 'v9', ordinal: 3 })]);

    await restoreContentVersion(
      { identity: identity('t-acme', 'owner') },
      { versionId: 'v9' },
      harness.deps,
    );

    expect(harness.auditTrail).toMatchObject([
      {
        kind: 'content_version_restored',
        actorUserId: 'u1',
        actorEmail: 'creator@together.dev',
        subjectMemberId: null,
        reason: 'course c1 restored to version 3',
      },
    ]);
  });

  it('drops module ids the course no longer has attached', async () => {
    const harness = restoreHarness([
      record({
        tenantId: 't-acme',
        id: 'v9',
        payload: {
          id: 'c1',
          tenantId: 't-acme',
          name: 'Old name',
          description: '',
          imageUrl: null,
          moduleOrder: ['m1', 'gone'],
          publiclyVisible: false,
          legacyId: null,
          createdAt: '2026-01-01T00:00:00.000Z',
        },
        schemaVersion: 4,
      }),
    ]);

    await restoreContentVersion(
      { identity: identity('t-acme', 'owner') },
      { versionId: 'v9' },
      harness.deps,
    );

    expect(harness.courses[0]?.moduleOrder).toEqual(['m1']);
  });

  it('restores a product snapshot through the product update path', async () => {
    const harness = restoreHarness([
      record({
        tenantId: 't-acme',
        id: 'v9',
        entityKind: 'product',
        entityId: 'p1',
        schemaVersion: 4,
        payload: {
          id: 'p1',
          tenantId: 't-acme',
          type: 'course',
          slug: 'product-one',
          title: 'Older title',
          description: 'Older copy',
          coverUrl: null,
          priceCents: 9_900,
          currency: 'PLN',
          published: false,
          accessItems: [],
          checkoutConsentDefinitionIds: [],
          legacyId: null,
          createdAt: '2026-01-01T00:00:00.000Z',
        },
      }),
    ]);

    const result = await restoreContentVersion(
      { identity: identity('t-acme', 'owner') },
      { versionId: 'v9' },
      harness.deps,
    );

    expect(result.ok).toBe(true);
    expect(harness.products[0]).toMatchObject({ title: 'Older title', description: 'Older copy' });
  });

  it('refuses a restore without the write capability', async () => {
    const harness = restoreHarness([record({ tenantId: 't-acme', id: 'v9' })]);

    const result = await restoreContentVersion(
      { identity: identity('t-acme', 'owner'), capabilities: ['course:history:read'] },
      { versionId: 'v9' },
      harness.deps,
    );

    expect(result).toMatchObject({ ok: false, error: { code: 'forbidden' } });
    expect(harness.auditTrail).toEqual([]);
  });

  it('returns not_found for an unknown version id', async () => {
    const harness = restoreHarness([]);
    const result = await restoreContentVersion(
      { identity: identity('t-acme', 'owner') },
      { versionId: 'missing' },
      harness.deps,
    );
    expect(result).toMatchObject({ ok: false, error: { code: 'not_found' } });
  });
});
