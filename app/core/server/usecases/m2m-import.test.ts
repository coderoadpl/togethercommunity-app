import { describe, expect, it } from 'vitest';

import {
  capabilitiesForApiKey,
  type Course,
  type CourseLesson,
  type CourseModule,
  type ImportAuditEvent,
  type Product,
  type TenantApiKey,
} from '#core/domain/index.js';

import type { Ctx } from '../context.js';
import type { ImportContentMutation } from '../ports.js';
import {
  claimM2mImportRateLimit,
  importM2mContent,
  validateM2mImport,
  type M2mImportContentDeps,
  type M2mImportValidationDeps,
} from './m2m-import.js';

const NOW = '1998-08-14T10:00:00.000Z';
const TENANT_ID = 'tenant-1';

const apiKey: TenantApiKey = {
  id: 'key-1',
  tenantId: TENANT_ID,
  name: 'Migration',
  keyHash: 'hash',
  scopes: ['import:content'],
  createdAt: NOW,
  expiresAt: '1998-08-20T10:00:00.000Z',
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
    memberBannedAt: null,
  },
  capabilities: capabilitiesForApiKey(apiKey),
};

const courseRecord = (name = 'Course') => ({
  importKey: 'course-source',
  name,
  description: '',
  imageUrl: null,
  moduleOrder: [],
});

const lessonRecord = (name = 'Lesson') => ({
  importKey: 'lesson-source',
  name,
  isPreview: false,
  contents: [{ type: 'html' as const, html: '<p>Lesson</p>' }],
});

const harness = () => {
  let sequence = 0;
  let commitCalls = 0;
  const courses = new Map<string, Course>();
  const modules = new Map<string, CourseModule>();
  const lessons = new Map<string, CourseLesson>();
  const products = new Map<string, Product>();
  const audits = new Map<string, ImportAuditEvent>();
  const save = (mutation: ImportContentMutation): void => {
    if (mutation.kind === 'course') courses.set(mutation.resource.id, mutation.resource);
    if (mutation.kind === 'module') modules.set(mutation.resource.id, mutation.resource);
    if (mutation.kind === 'lesson') lessons.set(mutation.resource.id, mutation.resource);
    if (mutation.kind === 'product') products.set(mutation.resource.id, mutation.resource);
    audits.set(`${mutation.kind}:${mutation.event.importKey}`, mutation.event);
  };
  const deps: M2mImportContentDeps & M2mImportValidationDeps = {
    courses: { findById: async (_tenantId, id) => courses.get(id) ?? null },
    modules: {
      findById: async (_tenantId, id) => modules.get(id) ?? null,
      list: async () => [...modules.values()],
    },
    lessons: { findById: async (_tenantId, id) => lessons.get(id) ?? null },
    products: {
      findById: async (_tenantId, id) => products.get(id) ?? null,
      listByTenant: async () => [...products.values()],
    },
    importAuditEvents: {
      findLatestByImportKey: async (_tenantId, kind, importKey) => audits.get(`${kind}:${importKey}`) ?? null,
    },
    importContent: {
      commit: async (_tenantId, mutation) => {
        commitCalls += 1;
        save(mutation);
        return 'saved';
      },
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
    ids: { nextId: () => `id-${sequence += 1}` },
    clock: { nowIso: () => NOW },
    hash: { sha256: (content) => String(content) },
  };
  return {
    deps,
    courses,
    modules,
    lessons,
    products,
    audits,
    commitCalls: () => commitCalls,
  };
};

describe('m2m content import', () => {
  it('creates, updates, and leaves canonical replays unchanged by importKey', async () => {
    const h = harness();
    const created = await importM2mContent(ctx, apiKey, 'lesson', {
      datasetVersion: 'together-import/v1',
      records: [lessonRecord()],
    }, h.deps);
    const updated = await importM2mContent(ctx, apiKey, 'lesson', {
      datasetVersion: 'together-import/v1',
      records: [lessonRecord('Updated lesson')],
    }, h.deps);
    const unchanged = await importM2mContent(ctx, apiKey, 'lesson', {
      datasetVersion: 'together-import/v1',
      records: [lessonRecord('Updated lesson')],
    }, h.deps);

    expect(created).toMatchObject({ ok: true, value: { summary: { created: 1 } } });
    expect(updated).toMatchObject({ ok: true, value: { summary: { updated: 1 } } });
    expect(unchanged).toMatchObject({ ok: true, value: { summary: { unchanged: 1 } } });
    expect(h.lessons.get('lesson-source')?.name).toBe('Updated lesson');
    expect(h.audits.get('lesson:lesson-source')?.action).toBe('unchanged');
  });

  it('resolves tenant references and forces products to remain unpublished', async () => {
    const h = harness();
    await importM2mContent(ctx, apiKey, 'course', {
      datasetVersion: 'together-import/v1', records: [courseRecord()],
    }, h.deps);
    await importM2mContent(ctx, apiKey, 'lesson', {
      datasetVersion: 'together-import/v1', records: [lessonRecord()],
    }, h.deps);
    const moduleResult = await importM2mContent(ctx, apiKey, 'module', {
      datasetVersion: 'together-import/v1',
      records: [{
        importKey: 'module-source',
        courseKeys: ['course-source'],
        title: 'Module',
        prefix: '1',
        chapters: [{
          id: 'chapter-1',
          name: 'Chapter',
          contents: [{ id: 'content-1', name: 'Lesson', lessonKey: 'lesson-source' }],
        }],
      }],
    }, h.deps);
    const productResult = await importM2mContent(ctx, apiKey, 'product', {
      datasetVersion: 'together-import/v1',
      records: [{
        importKey: 'product-source',
        type: 'course',
        slug: 'full-course',
        title: 'Full course',
        description: '',
        coverUrl: null,
        priceCents: 0,
        currency: 'PLN',
        accessItems: [{
          level: 'modules',
          courseKey: 'course-source',
          moduleKeys: ['module-source'],
        }],
      }],
    }, h.deps);

    expect(moduleResult).toMatchObject({ ok: true, value: { summary: { created: 1 } } });
    expect(h.modules.get('module-source')).toMatchObject({
      name: '1 - Module',
      courseIds: ['course-source'],
      chapters: [{ contents: [{ lessonId: 'lesson-source' }] }],
    });
    expect(productResult).toMatchObject({ ok: true, value: { summary: { created: 1 } } });
    expect(h.products.get('product-source')).toMatchObject({
      published: false,
      accessItems: [{ courseId: 'course-source', moduleIds: ['module-source'] }],
    });
  });

  it('returns record errors for dangling references and rejected publish fields', async () => {
    const h = harness();
    const result = await importM2mContent(ctx, apiKey, 'product', {
      datasetVersion: 'together-import/v1',
      records: [
        {
          importKey: 'product-dangling', type: 'course', slug: 'dangling', title: 'Dangling',
          description: '', coverUrl: null, priceCents: 0, currency: 'PLN',
          accessItems: [{ level: 'course', courseKey: 'missing-course' }],
        },
        {
          importKey: 'product-published', type: 'course', slug: 'published', title: 'Published',
          description: '', coverUrl: null, priceCents: 0, currency: 'PLN', accessItems: [], published: true,
        },
        {
          importKey: 'product-good', type: 'course', slug: 'good', title: 'Good',
          description: '', coverUrl: null, priceCents: 0, currency: 'PLN', accessItems: [],
        },
      ],
    }, h.deps);

    expect(result).toMatchObject({
      ok: true,
      value: {
        results: [
          { action: 'error', error: { code: 'conflict' } },
          { action: 'error', error: { code: 'validation' } },
          { action: 'created', id: 'product-good' },
        ],
        summary: { created: 1, failed: 2 },
      },
    });
  });

  it('rejects attaching an imported module to a native course', async () => {
    const h = harness();
    h.courses.set('native-course', {
      id: 'native-course', tenantId: TENANT_ID, name: 'Live', description: '', imageUrl: null,
      moduleOrder: [], legacyId: null, createdAt: NOW,
    });
    const result = await importM2mContent(ctx, apiKey, 'module', {
      datasetVersion: 'together-import/v1',
      records: [{
        importKey: 'module-injected', courseKeys: ['native-course'], title: 'Injected',
        prefix: null, chapters: [],
      }],
    }, h.deps);

    expect(result).toMatchObject({
      ok: true,
      value: { results: [{ action: 'error', error: { code: 'conflict' } }] },
    });
    expect(h.modules.has('module-injected')).toBe(false);
  });

  it('validates mixed forward references without invoking the write port', async () => {
    const h = harness();
    const result = await validateM2mImport(ctx, {
      datasetVersion: 'together-import/v1',
      records: [
        { kind: 'course', ...courseRecord() },
        { kind: 'module', importKey: 'module-source', courseKeys: ['course-source'], title: 'Module', prefix: null, chapters: [] },
        { kind: 'product', importKey: 'product-source', type: 'course', slug: 'course', title: 'Course', description: '', coverUrl: null, priceCents: 0, currency: 'PLN', accessItems: [{ level: 'modules', courseKey: 'course-source', moduleKeys: ['module-source'] }] },
      ],
    }, h.deps);

    expect(result).toEqual({
      ok: true,
      value: {
        plan: {
          create: {
            course: 1, module: 1, lesson: 0, product: 1, member: 0, grant: 0, progress: 0,
          },
          update: {
            course: 0, module: 0, lesson: 0, product: 0, member: 0, grant: 0, progress: 0,
          },
          unchanged: {
            course: 0, module: 0, lesson: 0, product: 0, member: 0, grant: 0, progress: 0,
          },
        },
        errors: [],
        warnings: [],
        valid: true,
      },
    });
    expect(h.commitCalls()).toBe(0);
  });
});

describe('m2m import rate limits', () => {
  it('uses weighted daily claims and releases the minute claim when the daily budget is exhausted', async () => {
    const claims: Array<{ period: 'minute' | 'hour' | 'day'; cost: number }> = [];
    const releases: Array<'minute' | 'hour' | 'day'> = [];
    const result = await claimM2mImportRateLimit(TENANT_ID, apiKey, {
      mode: 'content', recordCount: 200,
    }, {
      clock: { nowIso: () => NOW },
      rateLimits: {
        claim: async (_tenantId, input) => {
          claims.push({ period: input.period, cost: input.cost ?? 1 });
          return input.period !== 'day';
        },
        release: async (_tenantId, input) => {
          releases.push(input.period);
        },
      },
    });

    expect(result).toMatchObject({ ok: false, error: { code: 'rate_limited' } });
    expect(claims).toEqual([{ period: 'minute', cost: 1 }, { period: 'day', cost: 200 }]);
    expect(releases).toEqual(['minute']);
  });

  it('uses the lower daily record budget for member imports', async () => {
    const limits: number[] = [];
    const result = await claimM2mImportRateLimit(TENANT_ID, apiKey, {
      mode: 'users', kind: 'member', recordCount: 200,
    }, {
      clock: { nowIso: () => NOW },
      rateLimits: {
        claim: async (_tenantId, input) => {
          limits.push(input.limit);
          return true;
        },
        release: async () => undefined,
      },
    });

    expect(result).toEqual({ ok: true, value: undefined });
    expect(limits).toEqual([60, 2_000]);
  });
});
