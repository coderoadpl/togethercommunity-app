import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { buildSnapshot, type CourseLesson } from '#core/domain/index.js';
import type { EntityVersionRecord, ImportContentMutation } from '#core/server/index.js';

import type { Db } from './client.js';
import { createImportContentRepository } from './content-import.js';
import { insertEntityVersion } from './entity-versions.js';
import { createLessonEditionRepository } from './lesson-editions.js';
import { createCourseLessonRepository, createEntityVersionRepository } from './repositories.js';
import { tenantApiKeys, tenants } from './schema.js';
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
    const database = await createTestDatabase('together_lesson_editions', 'postgres://together:together@localhost:48912/together');
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
