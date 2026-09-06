import { describe, expect, it } from 'vitest';

import {
  capabilitiesForApiKey,
  type Course,
  type CourseLesson,
  type CourseModule,
  type ImportAuditEvent,
  type TenantApiKey,
  type TenantRedirect,
} from '#core/domain/index.js';

import type { Ctx } from '../context.js';
import { importM2mRedirects, type M2mImportRedirectDeps } from './m2m-import-redirects.js';
import { validateM2mImport, type M2mImportValidationDeps } from './m2m-import.js';

const NOW = '1998-08-14T10:00:00.000Z';
const TENANT_ID = 'tenant-1';

const apiKey: TenantApiKey = {
  id: 'key-1',
  tenantId: TENANT_ID,
  name: 'Migration',
  keyHash: 'hash',
  scopes: ['import:content'],
  createdAt: NOW,
  expiresAt: null,
  revokedAt: null,
};

const ctx: Ctx = {
  identity: {
    userId: 'api-key',
    email: 'api-key@invalid.test',
    name: 'Migration API',
    emailVerified: true,
    tenantId: TENANT_ID,
    tenantSlug: 'tenant',
    tenantName: 'Tenant',
    staffRole: null,
    memberId: null,
    image: null,
    memberDisplayName: null,
    memberBannedAt: null,
    memberDmOptOutAt: null,
    memberLanguage: null,
    memberVideoAutoplay: false,
  },
  capabilities: capabilitiesForApiKey(apiKey),
};

const lesson: CourseLesson = {
  id: 'lesson-intro',
  tenantId: TENANT_ID,
  name: 'Lesson',
  isPreview: false,
  contents: [],
  legacyId: null,
  createdAt: NOW,
};

const course: Course = {
  id: 'course-js',
  tenantId: TENANT_ID,
  name: 'Course',
  description: '',
  imageUrl: null,
  moduleOrder: ['module-basics'],
  publiclyVisible: false,
  legacyId: null,
  createdAt: NOW,
};

const courseModule: CourseModule = {
  id: 'module-basics',
  tenantId: TENANT_ID,
  courseIds: [course.id],
  title: 'Module',
  prefix: null,
  name: 'Module',
  chapters: [{
    id: 'chapter-1',
    name: 'Chapter',
    contents: [{ id: 'content-1', name: 'Lesson', lessonId: lesson.id }],
  }],
  legacyId: null,
  createdAt: NOW,
};

const harness = () => {
  let sequence = 0;
  const redirects = new Map<string, TenantRedirect>();
  const audits = new Map<string, ImportAuditEvent>();
  const importedContent = (importKey: string, resourceId: string): ImportAuditEvent => ({
    id: `audit-${importKey}`,
    tenantId: TENANT_ID,
    apiKeyId: apiKey.id,
    kind: 'course',
    importKey,
    resourceId,
    action: 'created',
    payloadHash: 'a'.repeat(64),
    at: NOW,
  });
  audits.set('course:course-source', { ...importedContent('course-source', course.id) });
  audits.set('module:module-source', {
    ...importedContent('module-source', courseModule.id),
    kind: 'module',
  });
  audits.set('lesson:lesson-source', {
    ...importedContent('lesson-source', lesson.id),
    kind: 'lesson',
  });
  const deps: M2mImportRedirectDeps = {
    courses: { findById: async (_tenantId, id) => id === course.id ? course : null },
    modules: { findById: async (_tenantId, id) => id === courseModule.id ? courseModule : null },
    lessons: { findById: async (_tenantId, id) => id === lesson.id ? lesson : null },
    importAuditEvents: {
      findLatestByImportKey: async (_tenantId, kind, importKey) =>
        audits.get(`${kind}:${importKey}`) ?? null,
    },
    redirects: {
      findById: async (_tenantId, id) => redirects.get(id) ?? null,
      findByFromPath: async (_tenantId, fromPath) =>
        [...redirects.values()].find((redirect) => redirect.fromPath === fromPath) ?? null,
      listByTenant: async () => [...redirects.values()],
      commit: async (_tenantId, mutation) => {
        redirects.set(mutation.resource.id, mutation.resource);
        audits.set(`redirect:${mutation.event.importKey}`, mutation.event);
        return 'saved';
      },
    },
    ids: { nextId: () => `id-${sequence += 1}` },
    clock: { nowIso: () => NOW },
    hash: { sha256: (content) => String(content) },
  };
  return { deps, redirects, audits };
};

const validationHarness = () => {
  const h = harness();
  const deps: M2mImportValidationDeps = {
    ...h.deps,
    modules: { ...h.deps.modules, list: async () => [courseModule] },
    products: {
      findById: async () => null,
      listByTenant: async () => [],
      listPublishedByTenant: async () => [],
    },
    importUsers: {
      findAuthUserByEmail: async () => null,
      findMemberById: async () => null,
      findMemberByEmail: async () => null,
      findGrantById: async () => null,
      findGrantByPair: async () => null,
      findProgressById: async () => null,
      findProgressByPair: async () => null,
    },
  };
  return { ...h, deps };
};

const write = (records: unknown[]) => ({ datasetVersion: 'together-import/v1' as const, records });

const redirectRecord = (overrides: Record<string, unknown> = {}) => ({
  importKey: 'redirect-course',
  fromPath: '/kurs/javascript',
  target: { kind: 'course', importKey: 'course-source' },
  permanent: true,
  ...overrides,
});

describe('m2m redirect import', () => {
  it('resolves a course target to its member page and stores the normalised path', async () => {
    const h = harness();

    const result = await importM2mRedirects(ctx, apiKey, write([
      redirectRecord({ fromPath: '/Kurs/JavaScript/' }),
    ]), h.deps);

    expect(result).toMatchObject({ ok: true, value: { summary: { created: 1, failed: 0 } } });
    expect(h.redirects.get('redirect-course')).toMatchObject({
      fromPath: '/kurs/javascript',
      targetKind: 'course',
      targetId: course.id,
      targetPath: `/my/courses/${course.id}`,
      permanent: true,
    });
  });

  it('resolves a lesson target inside its course', async () => {
    const h = harness();

    await importM2mRedirects(ctx, apiKey, write([
      redirectRecord({
        importKey: 'redirect-lesson',
        fromPath: '/kurs/javascript/wstep',
        target: { kind: 'lesson', importKey: 'lesson-source', courseKey: 'course-source' },
        permanent: false,
      }),
    ]), h.deps);

    expect(h.redirects.get('redirect-lesson')).toMatchObject({
      targetKind: 'lesson',
      targetId: lesson.id,
      targetPath: `/my/courses/${course.id}/lessons/${lesson.id}`,
      permanent: false,
    });
  });

  it('resolves a module target to the course page that holds it', async () => {
    const h = harness();

    await importM2mRedirects(ctx, apiKey, write([
      redirectRecord({
        importKey: 'redirect-module',
        fromPath: '/kurs/javascript/modul',
        target: { kind: 'module-as-course', importKey: 'module-source' },
      }),
    ]), h.deps);

    expect(h.redirects.get('redirect-module')).toMatchObject({
      targetKind: 'module-as-course',
      targetId: courseModule.id,
      targetPath: `/my/courses/${course.id}`,
    });
  });

  it('keeps a literal path target as written', async () => {
    const h = harness();

    await importM2mRedirects(ctx, apiKey, write([
      redirectRecord({
        importKey: 'redirect-path',
        target: { kind: 'path', path: '/my' },
      }),
    ]), h.deps);

    expect(h.redirects.get('redirect-path')).toMatchObject({
      targetKind: 'path',
      targetId: null,
      targetPath: '/my',
    });
  });

  it('repeats as unchanged and follows an edited payload', async () => {
    const h = harness();

    const first = await importM2mRedirects(ctx, apiKey, write([redirectRecord()]), h.deps);
    const repeat = await importM2mRedirects(ctx, apiKey, write([redirectRecord()]), h.deps);
    const edited = await importM2mRedirects(ctx, apiKey, write([
      redirectRecord({ permanent: false }),
    ]), h.deps);

    expect(first).toMatchObject({ ok: true, value: { summary: { created: 1 } } });
    expect(repeat).toMatchObject({ ok: true, value: { summary: { unchanged: 1 } } });
    expect(edited).toMatchObject({ ok: true, value: { summary: { updated: 1 } } });
    expect(h.redirects.get('redirect-course')?.permanent).toBe(false);
  });

  it('refuses a source path another redirect already answers', async () => {
    const h = harness();

    await importM2mRedirects(ctx, apiKey, write([redirectRecord()]), h.deps);
    const result = await importM2mRedirects(ctx, apiKey, write([
      redirectRecord({ importKey: 'redirect-other' }),
    ]), h.deps);

    expect(result).toMatchObject({
      ok: true,
      value: { results: [{ action: 'error', error: { code: 'conflict' } }] },
    });
  });

  it('refuses a target that no import created', async () => {
    const h = harness();

    const result = await importM2mRedirects(ctx, apiKey, write([
      redirectRecord({ target: { kind: 'course', importKey: 'course-unknown' } }),
    ]), h.deps);

    expect(result).toMatchObject({
      ok: true,
      value: { results: [{ action: 'error', error: { code: 'conflict' } }] },
    });
  });

  it('rejects a source path that is not a path', async () => {
    const h = harness();

    const result = await importM2mRedirects(ctx, apiKey, write([
      redirectRecord({ fromPath: 'kurs/javascript' }),
    ]), h.deps);

    expect(result).toMatchObject({
      ok: true,
      value: { results: [{ action: 'error', error: { code: 'validation' } }] },
    });
  });

  it.each([
    ['a protocol-relative source path', { fromPath: '//evil.example' }],
    ['a backslash source path', { fromPath: '/\\evil.example' }],
    ['a protocol-relative path target', { target: { kind: 'path', path: '//evil.example' } }],
    ['a backslash path target', { target: { kind: 'path', path: '/\\evil.example' } }],
  ])('rejects %s that would leave the workspace origin', async (_case, overrides) => {
    const h = harness();

    const result = await importM2mRedirects(ctx, apiKey, write([
      redirectRecord(overrides),
    ]), h.deps);

    expect(result).toMatchObject({
      ok: true,
      value: { results: [{ action: 'error', error: { code: 'validation' } }] },
    });
    expect(h.redirects.size).toBe(0);
  });

  it('plans a redirect during validation without writing it', async () => {
    const h = validationHarness();

    const result = await validateM2mImport(ctx, write([
      { kind: 'redirect', ...redirectRecord() },
    ]), h.deps);

    expect(result).toMatchObject({ ok: true, value: { valid: true } });
    expect(result.ok && result.value.plan.create['redirect']).toBe(1);
    expect(h.redirects.size).toBe(0);
  });

  it('fails validation when two records in one call claim the same source path', async () => {
    const h = validationHarness();

    const result = await validateM2mImport(ctx, write([
      { kind: 'redirect', ...redirectRecord() },
      { kind: 'redirect', ...redirectRecord({ importKey: 'redirect-other' }) },
    ]), h.deps);

    expect(result).toMatchObject({
      ok: true,
      value: {
        valid: false,
        errors: [{ index: 1, importKey: 'redirect-other', error: { code: 'conflict' } }],
      },
    });
  });
});
