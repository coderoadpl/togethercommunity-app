import { describe, expect, it } from 'vitest';

import {
  computeCourseModuleName,
  type Course,
  type CourseModule,
  type EntityHistoryEntry,
  type Identity,
  type StaffRole,
} from '#core/domain/index.js';

import type {
  CourseModuleRepository,
  CourseRepository,
  EntityVersionRecord,
  EntityVersionRepository,
} from '../ports.js';
import { getContentHistory, getContentVersion, type ContentHistoryDeps } from './content-history.js';

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
memberBannedAt: null,
});

const entry = (over: Partial<EntityHistoryEntry> & { tenantId: string }): EntityHistoryEntry & { tenantId: string } => ({
  id: 'v1',
  entityKind: 'course',
  entityId: 'c1',
  schemaVersion: 1,
  createdAt: '2026-01-01T00:00:00.000Z',
  createdBy: 'u1',
  ...over,
});

const record = (over: Partial<EntityVersionRecord> & { tenantId: string }): EntityVersionRecord & { tenantId: string } => ({
  id: 'v1',
  entityKind: 'course',
  entityId: 'c1',
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
  records: (EntityVersionRecord & { tenantId: string })[] = [],
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
  description: '',
  imageUrl: null,
  moduleOrder: ['m1'],
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

const courses: CourseRepository = {
  list: async () => [course],
  findById: async (tenantId, id) => (tenantId === course.tenantId && id === course.id ? course : null),
  findByIds: async () => [course],
  create: async () => undefined,
  update: async () => null,
  delete: async () => false,
};

const modules: CourseModuleRepository = {
  list: async (tenantId) => (tenantId === moduleRow.tenantId ? [moduleRow] : []),
  findById: async () => moduleRow,
  findByIds: async () => [moduleRow],
  create: async () => undefined,
  update: async () => null,
  delete: async () => false,
};

const deps = (repo: EntityVersionRepository): ContentHistoryDeps => ({
  entityVersions: repo,
  courses,
  modules,
  userDisplays: {
    findDisplayNames: async (_tenantId, userIds) =>
      new Map(userIds.map((userId) => [userId, userId === 'u1' ? 'Ada Creator' : userId])),
  },
});

describe('content history use-cases', () => {
  it('requires staff tenant context', async () => {
    const result = await getContentHistory(
      { identity: identity('t-acme', null) },
      { courseId: 'c1' },
      deps(versionsRepo([])),
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
      deps(repo),
    );
    expect(result.ok && result.value).toEqual([
      expect.objectContaining({
        id: 'a1',
        subjectKind: 'course',
        subjectName: 'Course one',
        createdByDisplayName: 'Ada Creator',
      }),
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
      deps(repo),
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
      deps(repo),
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
      deps(versionsRepo([])),
    );
    expect(result).toMatchObject({ ok: false, error: { code: 'validation' } });
  });

  it('fetches a single version and upcasts it to the current schema', async () => {
    const repo = versionsRepo([], [record({ tenantId: 't-acme', id: 'v9' })]);
    const result = await getContentVersion({ identity: identity('t-acme', 'owner') }, 'v9', deps(repo));
    expect(result).toMatchObject({
      ok: true,
      value: { id: 'v9', entityKind: 'course', schemaVersion: 1, currentSchemaVersion: 2 },
    });
    expect(result.ok && result.value.payload).toMatchObject({ id: 'c1', name: 'Old name', moduleOrder: [] });
  });

  it('returns not_found for an unknown version id', async () => {
    const result = await getContentVersion(
      { identity: identity('t-acme', 'owner') },
      'missing',
      deps(versionsRepo([])),
    );
    expect(result).toMatchObject({ ok: false, error: { code: 'not_found' } });
  });

  it('scopes a single-version fetch to the staff tenant', async () => {
    const repo = versionsRepo([], [record({ tenantId: 't-other', id: 'v9' })]);
    const result = await getContentVersion({ identity: identity('t-acme', 'owner') }, 'v9', deps(repo));
    expect(result).toMatchObject({ ok: false, error: { code: 'not_found' } });
  });
});
