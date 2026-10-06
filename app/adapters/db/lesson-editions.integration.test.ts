import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { buildSnapshot, type CourseLesson } from '#core/domain/index.js';
import { markLessonEdition, type Ctx, type EntityVersionRecord, type ImportContentMutation } from '#core/server/index.js';

import type { Db } from './client.js';
import { createImportContentRepository } from './content-import.js';
import { insertEntityVersion } from './entity-versions.js';
import { createLessonEditionRepository } from './lesson-editions.js';
import { createCourseLessonRepository, createEntityVersionRepository } from './repositories.js';
import { entityVersions, tenantApiKeys, tenants } from './schema.js';
import { createTestDatabase } from './test-database-name.js';

const NOW = '2026-01-01T00:00:00.000Z';
const TENANT = 'edition-tenant';
const lesson: CourseLesson = { id: 'lesson-1', tenantId: TENANT, name: 'Chapter 3', contents: [], isPreview: false, legacyId: null, createdAt: NOW };
const version = (id: string, resource: CourseLesson = lesson): EntityVersionRecord => {
  const snapshot = buildSnapshot('course_lesson', resource);
  if (!snapshot.ok) throw new Error(snapshot.error.message);
  return { id, entityId: resource.id, entityKind: 'course_lesson', ...snapshot.value, createdAt: NOW, createdBy: null };
};

describe('lesson edition persistence', () => {
  let db: Db;
  let close: (() => Promise<void>) | undefined;
  beforeAll(async () => {
    const database = await createTestDatabase('together_lesson_editions', process.env['DATABASE_URL'] ?? 'postgres://together:together@localhost:48912/together');
    db = database.db;
    close = database.close;
    await db.insert(tenants).values({ id: TENANT, slug: 'editions', name: 'Workspace', createdAt: NOW });
    await db.insert(tenantApiKeys).values({ id: 'edition-key', tenantId: TENANT, name: 'Import', keyHash: 'edition-hash', scopes: ['import:content'], createdAt: NOW });
  });
  afterAll(async () => { await close?.(); });

  it('hides ordinary versions, enforces tenant and number uniqueness, and keeps unmarked history', async () => {
    const editions = createLessonEditionRepository(db);
    await insertEntityVersion(db, TENANT, version('ordinary'));
    expect(await editions.list(TENANT, lesson.id)).toEqual([]);
    expect(await editions.find(TENANT, lesson.id, 'ordinary')).toBeNull();
    expect(await editions.mark(TENANT, version('ordinary'), { number: '2' }, NOW)).toMatchObject({ number: '2' });
    expect(await editions.mark(TENANT, version('duplicate'), { number: '2' }, NOW)).toBe('conflict');
    expect(await editions.find('other-tenant', lesson.id, '2')).toBeNull();
    expect(await editions.unmark('other-tenant', lesson.id, '2')).toBe(false);
    expect(await editions.unmark(TENANT, lesson.id, '2')).toBe(true);
    expect(await editions.find(TENANT, lesson.id, '2')).toBeNull();
    expect(await createEntityVersionRepository(db).findById(TENANT, 'ordinary')).not.toBeNull();
  });

  it('reuses an identical unnumbered snapshot but preserves it when marking a different edition', async () => {
    const resource = { ...lesson, id: 'current-lesson' };
    const lessons = createCourseLessonRepository(db);
    const versions = createEntityVersionRepository(db);
    const editions = createLessonEditionRepository(db);
    await lessons.create(TENANT, resource);
    await insertEntityVersion(db, TENANT, version('current-version', resource));
    const ctx: Ctx = { identity: {
      userId: 'author', email: 'author@invalid.test', name: 'Author', emailVerified: true,
      tenantAccess: 'staff', tenantId: TENANT, tenantSlug: 'editions', tenantName: 'Workspace',
      staffRole: 'owner', memberId: null, image: null, memberDisplayName: null,
      memberBannedAt: null, memberDmOptOutAt: null, memberLanguage: null, memberVideoAutoplay: false,
    } };
    const deps = {
      lessons, entityVersions: versions, lessonEditions: editions,
      ids: { nextId: () => 'new-current-version' }, clock: { nowIso: () => '2026-01-02T00:00:00.000Z' },
    };
    expect(await markLessonEdition(ctx, { lessonId: resource.id, edition: { number: '2' } }, deps))
      .toMatchObject({ ok: true, value: { versionId: 'current-version', number: '2' } });
    const oldEdition = await editions.find(TENANT, resource.id, '2');
    expect(await markLessonEdition(ctx, { lessonId: resource.id, edition: { number: '3' } }, deps))
      .toMatchObject({ ok: true, value: { versionId: 'new-current-version', number: '3' } });
    expect(await editions.find(TENANT, resource.id, '2')).toEqual(oldEdition);
    expect((await editions.find(TENANT, resource.id, '3'))?.payload).toEqual(oldEdition?.payload);
    expect(await versions.list(TENANT, { entityKind: 'course_lesson', entityId: resource.id, limit: 10 }))
      .toHaveLength(2);
  });

  it('lists at most 100 editions in descending numeric edition order', async () => {
    const editions = createLessonEditionRepository(db);
    const numbered = { ...lesson, id: 'numbered-lesson' };
    const numbers = ['2.9', '2', '2.10', '2.0.0', '999999999999', '2.0'];
    await db.insert(entityVersions).values(numbers.map((number) => ({
      ...version(`numbered-${number}`, numbered), tenantId: TENANT, editionNumber: number, editionMarkedAt: NOW,
    })));
    expect((await editions.list(TENANT, numbered.id)).map(({ number }) => number))
      .toEqual(['999999999999', '2.10', '2.9', '2.0.0', '2.0', '2']);
    const bounded = { ...lesson, id: 'bounded-lesson' };
    await db.insert(entityVersions).values(Array.from({ length: 101 }, (_, index) => ({
      ...version(`bounded-${index}`, bounded), tenantId: TENANT, editionNumber: String(index), editionMarkedAt: NOW,
    })));
    expect((await editions.list(TENANT, bounded.id)).map(({ number }) => number))
      .toEqual(Array.from({ length: 100 }, (_, index) => String(100 - index)));
  });

  it('creates an edition with the import and updates its note without duplicating or replacing the snapshot', async () => {
    const resource = { ...lesson, id: 'imported-lesson' };
    const mutation = (id: string, action: 'created' | 'updated', note: string): ImportContentMutation => ({
      kind: 'lesson', action, resource: { ...resource, name: action === 'created' ? 'Chapter 3' : 'Chapter 3 revised' },
      version: version(id, { ...resource, name: action === 'created' ? 'Chapter 3' : 'Chapter 3 revised' }),
      edition: { number: '1', note },
      event: { id: `event-${id}`, tenantId: TENANT, apiKeyId: 'edition-key', kind: 'lesson', importKey: 'chapter-3', resourceId: resource.id, action, payloadHash: 'a'.repeat(64), at: NOW },
    });
    const importer = createImportContentRepository(db);
    expect(await importer.commit(TENANT, mutation('import-v1', 'created', 'First note'))).toBe('saved');
    expect(await importer.commit(TENANT, mutation('import-v2', 'updated', 'Updated note'))).toBe('saved');
    const editions = createLessonEditionRepository(db);
    expect(await editions.list(TENANT, resource.id)).toEqual([{ versionId: 'import-v1', number: '1', note: 'Updated note', markedAt: NOW }]);
    expect((await editions.find(TENANT, resource.id, '1'))?.payload).toMatchObject({ name: 'Chapter 3' });
  });

  it('rolls back the lesson and marked snapshot when the import audit rejects the write', async () => {
    const resource = { ...lesson, id: 'rolled-back-lesson' };
    const mutation: ImportContentMutation = {
      kind: 'lesson', action: 'created', resource, version: version('rolled-back-version', resource),
      edition: { number: '1' }, event: { id: 'rolled-back-event', tenantId: TENANT, apiKeyId: 'missing-key',
        kind: 'lesson', importKey: resource.id, resourceId: resource.id, action: 'created',
        payloadHash: 'b'.repeat(64), at: NOW },
    };
    await expect(createImportContentRepository(db).commit(TENANT, mutation))
      .rejects.toThrow('Import audit API key does not belong to tenant');
    expect(await createCourseLessonRepository(db).findById(TENANT, resource.id)).toBeNull();
    expect(await createEntityVersionRepository(db).findById(TENANT, 'rolled-back-version')).toBeNull();
    expect(await createLessonEditionRepository(db).list(TENANT, resource.id)).toEqual([]);
  });

});
