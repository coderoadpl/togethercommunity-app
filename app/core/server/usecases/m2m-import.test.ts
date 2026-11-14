import { describe, expect, it, vi } from 'vitest';

import {
  capabilitiesForApiKey,
  type Course,
  type CourseLesson,
  type CourseModule,
  type ImportAuditEvent,
  type Product,
  type TenantDomain,
  type TenantApiKey,
} from '#core/domain/index.js';

import type { Ctx } from '../context.js';
import type { EntityVersionRecord, ImportContentMutation } from '../ports.js';
import {
  claimM2mImportRateLimit,
  importM2mContent,
  validateM2mImport,
  type M2mImportContentDeps,
  type M2mImportValidationDeps,
} from './m2m-import.js';

const NOW = '1998-08-14T10:00:00.000Z';
const TENANT_ID = 'tenant-1';
const COURSE_ASSET_PATH = '/api/public/assets/course-cover/00000000-0000-4000-8000-000000000001.jpg';
const PRODUCT_ASSET_PATH = '/api/public/assets/product-cover/00000000-0000-4000-8000-000000000002.webp';

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
    tenantAccess: 'member',
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

const moduleRecord = (title = 'Module') => ({
  importKey: 'module-source',
  courseKeys: ['course-source'],
  title,
  prefix: '1',
  chapters: [{
    id: 'chapter-1',
    name: 'Chapter',
    contents: [{ id: 'content-1', name: 'Lesson', lessonKey: 'lesson-source' }],
  }],
});

const productRecord = () => ({
  importKey: 'product-source',
  type: 'course' as const,
  slug: 'full-course',
  title: 'Full course',
  description: '',
  coverUrl: null,
  priceCents: 0,
  currency: 'PLN',
  accessItems: [{
    level: 'modules' as const,
    courseKey: 'course-source',
    moduleKeys: ['module-source'],
  }],
});

const customDomain = (domain = 'courses.example.org'): TenantDomain => ({
  id: `domain-${domain}`,
  tenantId: TENANT_ID,
  domain,
  kind: 'custom',
  verified: true,
  provider: 'manual',
  providerVerified: true,
  verification: [],
  records: [],
  createdAt: NOW,
  verifiedAt: NOW,
  lastCheckedAt: NOW,
  lastError: null,
});

const harness = () => {
  let sequence = 0;
  let commitCalls = 0;
  const courses = new Map<string, Course>();
  const modules = new Map<string, CourseModule>();
  const lessons = new Map<string, CourseLesson>();
  const products = new Map<string, Product>();
  const audits = new Map<string, ImportAuditEvent>();
  const domains: TenantDomain[] = [];
  const versions: EntityVersionRecord[] = [];
  const mutations: ImportContentMutation[] = [];
  const save = (mutation: ImportContentMutation): void => {
    mutations.push(mutation);
    if (mutation.version !== undefined) versions.push(mutation.version);
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
      listPublishedByTenant: async () => [...products.values()].filter((product) => product.published),
    },
    importAuditEvents: {
      findLatestByImportKey: async (_tenantId, kind, importKey) => audits.get(`${kind}:${importKey}`) ?? null,
    },
    tenantDomains: {
      listByTenant: async (tenantId) => domains.filter((domain) => domain.tenantId === tenantId),
    },
    appBaseUrl: 'http://localhost:48730',
    baseDomain: 'localhost',
    singleTenantMode: false,
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
    redirects: {
      findById: async () => null,
      findByFromPath: async () => null,
      listPage: async () => ({ redirects: [], total: 0 }),
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
    domains,
    versions,
    mutations,
    commitCalls: () => commitCalls,
    resetCommitCalls: () => {
      commitCalls = 0;
    },
  };
};

const seedImportedProduct = async (h: ReturnType<typeof harness>): Promise<void> => {
  await importM2mContent(ctx, apiKey, 'course', {
    datasetVersion: 'together-import/v1', records: [courseRecord()],
  }, h.deps);
  await importM2mContent(ctx, apiKey, 'lesson', {
    datasetVersion: 'together-import/v1', records: [lessonRecord()],
  }, h.deps);
  await importM2mContent(ctx, apiKey, 'module', {
    datasetVersion: 'together-import/v1', records: [moduleRecord()],
  }, h.deps);
  await importM2mContent(ctx, apiKey, 'product', {
    datasetVersion: 'together-import/v1', records: [productRecord()],
  }, h.deps);
};

const publishImportedProduct = (h: ReturnType<typeof harness>): void => {
  const product = h.products.get('product-source');
  if (product === undefined) throw new Error('Expected imported product');
  h.products.set(product.id, { ...product, published: true });
};

describe('m2m content import', () => {
  const boundaryVimeoRecord = () => {
    const videoId = '1'.repeat(2_048 - 'https://vimeo.com/'.length);
    return {
      record: { ...lessonRecord(), contents: [{ type: 'embed', embedUrl: `https://vimeo.com/${videoId}` }] },
      embedUrl: `https://player.vimeo.com/video/${videoId}`,
    };
  };

  it('validates a boundary-length Vimeo URL after its embed transform without writing', async () => {
    const h = harness();
    const { record } = boundaryVimeoRecord();
    const result = await validateM2mImport(ctx, {
      datasetVersion: 'together-import/v1', records: [{ kind: 'lesson', ...record }],
    }, h.deps);

    expect(record.contents[0]?.embedUrl).toHaveLength(2_048);
    expect(result).toMatchObject({ ok: true, value: { valid: true, errors: [] } });
    expect(h.commitCalls()).toBe(0);
  });

  it('writes a boundary-length Vimeo URL after another record and keeps replays unchanged', async () => {
    const h = harness();
    const { record, embedUrl } = boundaryVimeoRecord();
    const input = {
      datasetVersion: 'together-import/v1' as const,
      records: [{ ...lessonRecord(), importKey: 'earlier-lesson' }, record],
    };
    const written = await importM2mContent(ctx, apiKey, 'lesson', input, h.deps);
    const replayed = await importM2mContent(ctx, apiKey, 'lesson', input, h.deps);

    expect(record.contents[0]?.embedUrl).toHaveLength(2_048);
    expect(written).toMatchObject({ ok: true, value: { summary: { created: 2, failed: 0 } } });
    expect(replayed).toMatchObject({ ok: true, value: { summary: { unchanged: 2, failed: 0 } } });
    expect(h.lessons.get('lesson-source')?.contents).toEqual([{ type: 'embed', embedUrl }]);
  });

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

  it('records a version for every created and updated record, stamped with the key label', async () => {
    const h = harness();
    await importM2mContent(ctx, apiKey, 'lesson', {
      datasetVersion: 'together-import/v1', records: [lessonRecord()],
    }, h.deps);
    await importM2mContent(ctx, apiKey, 'lesson', {
      datasetVersion: 'together-import/v1', records: [lessonRecord('Updated lesson')],
    }, h.deps);
    await importM2mContent(ctx, apiKey, 'lesson', {
      datasetVersion: 'together-import/v1', records: [lessonRecord('Updated lesson')],
    }, h.deps);

    expect(h.versions).toMatchObject([
      {
        entityKind: 'course_lesson',
        entityId: 'lesson-source',
        createdBy: 'Migration',
        payload: expect.objectContaining({ name: 'Lesson' }),
      },
      {
        entityKind: 'course_lesson',
        entityId: 'lesson-source',
        createdBy: 'Migration',
        payload: expect.objectContaining({ name: 'Updated lesson' }),
      },
    ]);
  });

  it('names the version author "import" when the key carries no label', async () => {
    const h = harness();
    await importM2mContent(ctx, { ...apiKey, name: '  ' }, 'course', {
      datasetVersion: 'together-import/v1', records: [courseRecord()],
    }, h.deps);

    expect(h.versions).toMatchObject([
      { entityKind: 'course', entityId: 'course-source', createdBy: 'import' },
    ]);
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

  it('imports product safety information and variant fields with a physical product', async () => {
    const h = harness();
    const compliance = {
      manufacturerName: 'Example Workshop',
      manufacturerAddress: 'Example Street 1, Warsaw',
      manufacturerEmail: 'safety@example.com',
      modelIdentifier: 'STAND-1',
      instructionsUrl: 'https://example.com/manual.pdf',
    };
    const result = await importM2mContent(ctx, apiKey, 'product', {
      datasetVersion: 'together-import/v1',
      records: [{
        importKey: 'stand-black', type: 'physical', slug: 'stand-black', title: 'Printed stand', description: '',
        coverUrl: null, priceCents: 4900, currency: 'PLN', accessItems: [], compliance, variantGroup: 'stand', variantLabel: 'Black',
      }],
    }, h.deps);
    expect(result).toMatchObject({ ok: true, value: { summary: { created: 1 } } });
    expect(h.products.get('stand-black')).toMatchObject({
      compliance: { ...compliance, safetyWarnings: '' }, variantGroup: 'stand', variantLabel: 'Black', published: false,
    });
  });

  it('rejects import updates of content reachable from a published product', async () => {
    const h = harness();
    await seedImportedProduct(h);
    publishImportedProduct(h);

    const lessonResult = await importM2mContent(ctx, apiKey, 'lesson', {
      datasetVersion: 'together-import/v1', records: [lessonRecord('Hacked lesson')],
    }, h.deps);
    const moduleResult = await importM2mContent(ctx, apiKey, 'module', {
      datasetVersion: 'together-import/v1', records: [moduleRecord('Hacked module')],
    }, h.deps);
    const courseResult = await importM2mContent(ctx, apiKey, 'course', {
      datasetVersion: 'together-import/v1', records: [courseRecord('Hacked course')],
    }, h.deps);
    const replayResult = await importM2mContent(ctx, apiKey, 'lesson', {
      datasetVersion: 'together-import/v1', records: [lessonRecord()],
    }, h.deps);

    expect(lessonResult).toMatchObject({
      ok: true,
      value: {
        results: [{ importKey: 'lesson-source', action: 'error', error: { code: 'conflict' } }],
        summary: { failed: 1 },
      },
    });
    expect(moduleResult).toMatchObject({
      ok: true,
      value: {
        results: [{ importKey: 'module-source', action: 'error', error: { code: 'conflict' } }],
        summary: { failed: 1 },
      },
    });
    expect(courseResult).toMatchObject({
      ok: true,
      value: {
        results: [{ importKey: 'course-source', action: 'error', error: { code: 'conflict' } }],
        summary: { failed: 1 },
      },
    });
    expect(replayResult).toMatchObject({ ok: true, value: { summary: { unchanged: 1 } } });
    expect(h.lessons.get('lesson-source')?.name).toBe('Lesson');
    expect(h.modules.get('module-source')?.title).toBe('Module');
    expect(h.courses.get('course-source')?.name).toBe('Course');
  });

  it('still updates imported draft content while its product is unpublished', async () => {
    const h = harness();
    await seedImportedProduct(h);

    const result = await importM2mContent(ctx, apiKey, 'lesson', {
      datasetVersion: 'together-import/v1', records: [lessonRecord('Updated lesson')],
    }, h.deps);

    expect(result).toMatchObject({ ok: true, value: { summary: { updated: 1 } } });
    expect(h.lessons.get('lesson-source')?.name).toBe('Updated lesson');
  });

  it('rejects attaching a new imported module to a published product course', async () => {
    const h = harness();
    await seedImportedProduct(h);
    publishImportedProduct(h);

    const result = await importM2mContent(ctx, apiKey, 'module', {
      datasetVersion: 'together-import/v1',
      records: [{
        importKey: 'module-two', courseKeys: ['course-source'], title: 'Module two',
        prefix: null, chapters: [],
      }],
    }, h.deps);

    expect(result).toMatchObject({
      ok: true,
      value: { results: [{ action: 'error', error: { code: 'conflict' } }] },
    });
    expect(h.modules.has('module-two')).toBe(false);
  });

  it('surfaces the published freeze at validate time', async () => {
    const h = harness();
    await seedImportedProduct(h);
    publishImportedProduct(h);
    h.resetCommitCalls();

    const result = await validateM2mImport(ctx, {
      datasetVersion: 'together-import/v1',
      records: [{ kind: 'lesson', ...lessonRecord('Hacked lesson') }],
    }, h.deps);

    expect(result).toMatchObject({
      ok: true,
      value: {
        valid: false,
        errors: [{
          kind: 'lesson', importKey: 'lesson-source', error: { code: 'conflict' },
        }],
      },
    });
    expect(h.commitCalls()).toBe(0);
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
      publiclyVisible: false,
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

  it('normalizes platform-host public asset URLs before storing content', async () => {
    const h = harness();
    const result = await importM2mContent(ctx, apiKey, 'course', {
      datasetVersion: 'together-import/v1',
      records: [{
        ...courseRecord(),
        imageUrl: `https://tenant.localhost${COURSE_ASSET_PATH}`,
      }],
    }, h.deps);

    expect(result).toMatchObject({ ok: true, value: { summary: { created: 1 } } });
    expect(h.courses.get('course-source')?.imageUrl).toBe(COURSE_ASSET_PATH);
    expect(h.audits.get('course:course-source')?.payloadHash).toContain(COURSE_ASSET_PATH);
    expect(h.audits.get('course:course-source')?.payloadHash).not.toContain('tenant.localhost');
  });

  it('normalizes verified custom-domain public asset URLs before storing content', async () => {
    const h = harness();
    h.domains.push(customDomain());
    const result = await importM2mContent(ctx, apiKey, 'product', {
      datasetVersion: 'together-import/v1',
      records: [{
        ...productRecord(),
        coverUrl: `https://courses.example.org${PRODUCT_ASSET_PATH}`,
        accessItems: [],
      }],
    }, h.deps);

    expect(result).toMatchObject({ ok: true, value: { summary: { created: 1 } } });
    expect(h.products.get('product-source')?.coverUrl).toBe(PRODUCT_ASSET_PATH);
  });

  it('keeps external absolute asset URLs unchanged', async () => {
    const h = harness();
    const externalUrl = `https://cdn.example.org${COURSE_ASSET_PATH}`;
    const result = await importM2mContent(ctx, apiKey, 'course', {
      datasetVersion: 'together-import/v1',
      records: [{ ...courseRecord(), imageUrl: externalUrl }],
    }, h.deps);

    expect(result).toMatchObject({ ok: true, value: { summary: { created: 1 } } });
    expect(h.courses.get('course-source')?.imageUrl).toBe(externalUrl);
  });

  it('reports public asset URL normalization during validation', async () => {
    const h = harness();
    const result = await validateM2mImport(ctx, {
      datasetVersion: 'together-import/v1',
      records: [{
        kind: 'course',
        ...courseRecord(),
        imageUrl: `https://tenant.localhost${COURSE_ASSET_PATH}`,
      }],
    }, h.deps);

    expect(result).toMatchObject({
      ok: true,
      value: {
        valid: true,
        infos: [{
          index: 0,
          kind: 'course',
          importKey: 'course-source',
          message: `imageUrl normalized to ${COURSE_ASSET_PATH}`,
        }],
      },
    });
    expect(h.commitCalls()).toBe(0);
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
            course: 1, module: 1, lesson: 0, product: 1, member: 0, grant: 0, progress: 0, redirect: 0,
          },
          update: {
            course: 0, module: 0, lesson: 0, product: 0, member: 0, grant: 0, progress: 0, redirect: 0,
          },
          unchanged: {
            course: 0, module: 0, lesson: 0, product: 0, member: 0, grant: 0, progress: 0, redirect: 0,
          },
        },
        errors: [],
        warnings: [],
        infos: [],
        valid: true,
      },
    });
    expect(h.commitCalls()).toBe(0);
  });
});

describe('m2m import rate limits', () => {
  it('uses weighted daily claims and releases the minute claim when the daily budget is exhausted', async () => {
    const claims: Array<{ period: 'minute' | 'hour' | 'day' | 'import-validate-records'; cost: number }> = [];
    const releases: Array<'minute' | 'hour' | 'day' | 'import-validate-records'> = [];
    const result = await claimM2mImportRateLimit(TENANT_ID, apiKey, {
      mode: 'content', recordCount: 200,
    }, {
      clock: { nowIso: () => NOW },
      importDailyMemberRecordLimit: 321,
      importDailyRecordLimit: 654,
      importHourlyValidationRecordLimit: 50_000,
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

  it.each([
    [{ mode: 'users', kind: 'member', recordCount: 200 }, 321],
    [{ mode: 'users', kind: 'grant', recordCount: 200 }, 654],
    [{ mode: 'users', kind: 'progress', recordCount: 200 }, 654],
    [{ mode: 'content', recordCount: 200 }, 654],
  ] as const)('uses the injected daily record budget for %j', async (input, expectedLimit) => {
    const limits: number[] = [];
    const result = await claimM2mImportRateLimit(TENANT_ID, apiKey, input, {
      clock: { nowIso: () => NOW },
      importDailyMemberRecordLimit: 321,
      importDailyRecordLimit: 654,
      importHourlyValidationRecordLimit: 50_000,
      rateLimits: {
        claim: async (_tenantId, input) => {
          limits.push(input.limit);
          return true;
        },
        release: async () => undefined,
      },
    });

    expect(result).toEqual({ ok: true, value: undefined });
    expect(limits).toEqual([60, expectedLimit]);
  });
});


describe('lesson edition imports', () => {
  it('preserves the published-product write guard for edition imports', async () => {
    const h = harness();
    await seedImportedProduct(h);
    publishImportedProduct(h);
    expect(await importM2mContent(ctx, apiKey, 'lesson', {
      datasetVersion: 'together-import/v1', records: [{ ...lessonRecord(), edition: { number: '2' } }],
    }, h.deps)).toMatchObject({ ok: true, value: { results: [{ action: 'error', error: { code: 'conflict' } }] } });
  });

  it('carries edition metadata and a snapshot through create, note updates, and unchanged reimports', async () => {
    const h = harness();
    const record = { ...lessonRecord(), edition: { number: '2.1', note: 'First note' } };
    const write = (note: string) => importM2mContent(ctx, apiKey, 'lesson', {
      datasetVersion: 'together-import/v1', records: [{ ...record, edition: { number: '2.1', note } }],
    }, h.deps);
    expect(await write('First note')).toMatchObject({ ok: true, value: { results: [{ action: 'created' }] } });
    expect(h.mutations.at(-1)).toMatchObject({ kind: 'lesson', edition: { number: '2.1', note: 'First note' },
      version: { entityKind: 'course_lesson', payload: { name: 'Lesson' } } });
    expect(await write('Updated note')).toMatchObject({ ok: true, value: { results: [{ action: 'updated' }] } });
    expect(h.mutations.at(-1)).toMatchObject({ edition: { number: '2.1', note: 'Updated note' } });
    expect(await write('Updated note')).toMatchObject({ ok: true, value: { results: [{ action: 'unchanged' }] } });
    expect(h.mutations.at(-1)?.version).toBeDefined();
  });
});


it('rejects new references to archived imported courses while allowing course updates', async () => {
  const h = harness();
  await importM2mContent(ctx, apiKey, 'course', {
    datasetVersion: 'together-import/v1', records: [courseRecord()],
  }, h.deps);
  const stored = h.courses.get('course-source');
  if (stored === undefined) throw new Error('Expected imported course');
  h.courses.set(stored.id, { ...stored, archivedAt: NOW });
  const reference = await importM2mContent(ctx, apiKey, 'module', {
    datasetVersion: 'together-import/v1', records: [{ ...moduleRecord(), chapters: [] }],
  }, h.deps);
  expect(reference).toMatchObject({ ok: true, value: { results: [{ action: 'error', error: { code: 'conflict', message: 'Referenced course "course-source" is archived' } }], summary: { failed: 1 } } });
  expect(await importM2mContent(ctx, apiKey, 'course', {
    datasetVersion: 'together-import/v1', records: [courseRecord('Updated archived course')],
  }, h.deps)).toMatchObject({ ok: true });
  expect(h.courses.get(stored.id)).toMatchObject({ name: 'Updated archived course', archivedAt: NOW });
  h.courses.set(stored.id, { ...stored, archivedAt: null });
  expect(await importM2mContent(ctx, apiKey, 'module', {
    datasetVersion: 'together-import/v1', records: [{ ...moduleRecord(), chapters: [] }],
  }, h.deps)).toMatchObject({ ok: true });
});

describe('import creation timestamp skew', () => {
  describe.each([
    { kind: 'course', record: courseRecord() },
    { kind: 'module', record: moduleRecord() },
    { kind: 'lesson', record: lessonRecord() },
    { kind: 'product', record: productRecord() },
  ] as const)('$kind records', ({ kind, record }) => {
    it.each([
      [undefined, true],
      ['1990-01-01T00:00:00.000Z', true],
      [NOW, true],
      ['1998-08-14T10:04:59.999Z', true],
      ['1998-08-14T10:05:00.000Z', true],
      ['1998-08-14T10:05:00.001Z', false],
      ['2098-08-14T10:00:00.000Z', false],
      ['not-a-date', false],
    ] as const)('applies the same createdAt rule to validate and write: %s', async (createdAt, valid) => {
      const h = harness();
      await seedImportedProduct(h);
      const clock = vi.fn(() => NOW);
      h.deps.clock = { nowIso: clock };
      const payload = { ...record, ...(createdAt === undefined ? {} : { createdAt }) };
      const validated = await validateM2mImport(ctx, {
        datasetVersion: 'together-import/v1', records: [{ kind, ...payload }],
      }, h.deps);
      expect(validated).toMatchObject({ ok: true, value: { valid } });
      expect(clock).toHaveBeenCalledTimes(1);
      clock.mockClear();
      const before = h.commitCalls();
      const written = await importM2mContent(ctx, apiKey, kind, {
        datasetVersion: 'together-import/v1', records: [payload],
      }, h.deps);
      expect(written).toMatchObject({ ok: true, value: { summary: { failed: valid ? 0 : 1 } } });
      expect(h.commitCalls() - before).toBe(valid ? 1 : 0);
      expect(clock).toHaveBeenCalledTimes(1);
    });
  });

  it('uses a single clock reading for every record, version and audit in a write call', async () => {
    const h = harness();
    const clock = vi.fn(() => NOW);
    h.deps.clock = { nowIso: clock };
    expect(await importM2mContent(ctx, apiKey, 'lesson', {
      datasetVersion: 'together-import/v1',
      records: [lessonRecord(), { ...lessonRecord(), importKey: 'other-lesson' }],
    }, h.deps)).toMatchObject({ ok: true, value: { summary: { created: 2 } } });
    expect(clock).toHaveBeenCalledTimes(1);
    expect(h.mutations.map((mutation) => mutation.event.at)).toEqual([NOW, NOW]);
    expect(h.versions.map((version) => version.createdAt)).toEqual([NOW, NOW]);
  });
});

describe('request-scoped import reference reads', () => {
  it('shares cached reference hits across content, users and redirects and reads modules once for progress', async () => {
    const h = harness();
    await seedImportedProduct(h);
    const member = { id: 'member-source', tenantId: TENANT_ID, userId: 'user-source', email: 'user@example.test', displayName: 'Member', legacyId: null, createdAt: NOW };
    h.audits.set('member:member-source', { id: 'member-audit', tenantId: TENANT_ID, apiKeyId: apiKey.id, kind: 'member', importKey: 'member-source', resourceId: member.id, action: 'created', payloadHash: 'hash', at: NOW });
    const audit = vi.fn(h.deps.importAuditEvents.findLatestByImportKey);
    const course = vi.fn(h.deps.courses.findById);
    const lesson = vi.fn(h.deps.lessons.findById);
    const module = vi.fn(h.deps.modules.findById);
    const modules = vi.fn(h.deps.modules.list);
    const memberById = vi.fn(async () => member);
    h.deps.importAuditEvents.findLatestByImportKey = audit;
    h.deps.courses.findById = course;
    h.deps.lessons.findById = lesson;
    h.deps.modules.findById = module;
    h.deps.modules.list = modules;
    h.deps.importUsers.findMemberById = memberById;
    const fullCtx = { ...ctx, capabilities: capabilitiesForApiKey({ ...apiKey, scopes: ['import:content', 'import:users'] }) };
    const result = await validateM2mImport(fullCtx, {
      datasetVersion: 'together-import/v1',
      records: [
        { kind: 'module', importKey: 'new-module', title: 'Module', courseKeys: ['course-source'], prefix: null, chapters: [] },
        ...Array.from({ length: 20 }, (_, index) => ({ kind: 'progress', importKey: `progress-${index}`, memberKey: 'member-source', courseKey: 'course-source', completedLessonKeys: ['lesson-source'], lastViewedLessonKey: 'lesson-source', lastViewedModuleKey: 'module-source', lastViewedChapterId: 'chapter-1', updatedAt: NOW })),
        { kind: 'redirect', importKey: 'redirect', fromPath: '/old-course', target: { kind: 'course', importKey: 'course-source' }, permanent: true },
      ],
    }, h.deps);
    expect(result).toMatchObject({ ok: true, value: { valid: true, plan: { create: { module: 1, progress: 20, redirect: 1 } } } });
    expect(course).toHaveBeenCalledTimes(1);
    expect(lesson).toHaveBeenCalledTimes(1);
    expect(memberById).toHaveBeenCalledTimes(1);
    expect(modules).toHaveBeenCalledTimes(1);
    expect(module.mock.calls.filter(([, id]) => id === 'module-source')).toHaveLength(1);
    expect(audit.mock.calls.filter(([, kind, key]) => kind === 'course' && key === 'course-source')).toHaveLength(1);
    expect(audit.mock.calls.filter(([, kind, key]) => kind === 'lesson' && key === 'lesson-source')).toHaveLength(1);
  });

  it('memoizes misses within a call but rechecks later calls and tenant contexts', async () => {
    const h = harness();
    const audit = vi.fn(h.deps.importAuditEvents.findLatestByImportKey);
    h.deps.importAuditEvents.findLatestByImportKey = audit;
    const records = Array.from({ length: 3 }, (_, index) => ({ kind: 'module', importKey: `module-${index}`, title: 'Module', courseKeys: ['missing'], prefix: null, chapters: [] }));
    const request = { datasetVersion: 'together-import/v1' as const, records };
    expect(await validateM2mImport(ctx, request, h.deps)).toMatchObject({ ok: true, value: { valid: false } });
    expect(audit).toHaveBeenCalledTimes(1);
    expect(await validateM2mImport(ctx, request, h.deps)).toMatchObject({ ok: true, value: { valid: false } });
    expect(audit).toHaveBeenCalledTimes(2);
    const otherCtx = { ...ctx, identity: { ...ctx.identity, tenantId: 'other-tenant' } };
    await validateM2mImport(otherCtx, request, h.deps);
    expect(audit).toHaveBeenCalledTimes(3);
    expect(audit).toHaveBeenLastCalledWith('other-tenant', 'course', 'missing');
  });

  it('refreshes cached content state after each successful write in the same call', async () => {
    const h = harness();
    const result = await importM2mContent(ctx, apiKey, 'course', {
      datasetVersion: 'together-import/v1', records: [courseRecord(), courseRecord()],
    }, h.deps);
    expect(result).toMatchObject({ ok: true, value: { results: [{ action: 'created' }, { action: 'unchanged' }] } });
    expect(h.courses.size).toBe(1);
  });
});

describe('weighted import validation budget', () => {
  it.each([1, 25, 5_000])('charges %i parsed records independently of the request ceiling', async (recordCount) => {
    const claim = vi.fn(async () => true);
    expect(await claimM2mImportRateLimit(TENANT_ID, apiKey, { mode: 'validate', recordCount }, {
      clock: { nowIso: () => NOW }, importHourlyValidationRecordLimit: 50_000,
      importDailyMemberRecordLimit: 10_000, importDailyRecordLimit: 20_000,
      rateLimits: { claim, release: async () => undefined },
    })).toEqual({ ok: true, value: undefined });
    expect(claim.mock.calls).toEqual([
      [TENANT_ID, { apiKeyId: apiKey.id, period: 'hour', windowStartedAt: NOW, limit: 30 }],
      [TENANT_ID, { apiKeyId: apiKey.id, period: 'import-validate-records', windowStartedAt: NOW, limit: 50_000, cost: recordCount }],
    ]);
  });

  it('rolls back the request claim when the configurable hourly record budget is exhausted', async () => {
    const claim = vi.fn(async (_tenantId: string, input: { period: string }) => input.period !== 'import-validate-records');
    const release = vi.fn(async () => undefined);
    expect(await claimM2mImportRateLimit(TENANT_ID, apiKey, { mode: 'validate', recordCount: 26 }, {
      clock: { nowIso: () => NOW }, importHourlyValidationRecordLimit: 25,
      importDailyMemberRecordLimit: 10_000, importDailyRecordLimit: 20_000,
      rateLimits: { claim, release },
    })).toMatchObject({ ok: false, error: { code: 'rate_limited', details: { period: 'hour', retryAfterSeconds: 3_600 } } });
    expect(claim).toHaveBeenLastCalledWith(TENANT_ID, expect.objectContaining({ limit: 25, cost: 26 }));
    expect(release).toHaveBeenCalledWith(TENANT_ID, { apiKeyId: apiKey.id, period: 'hour', windowStartedAt: NOW });
  });

  it('does not charge records when the 30-request hourly ceiling is exhausted', async () => {
    const claim = vi.fn(async () => false);
    const release = vi.fn(async () => undefined);
    const result = await claimM2mImportRateLimit(TENANT_ID, apiKey, { mode: 'validate', recordCount: 1 }, {
      clock: { nowIso: () => '1998-08-14T10:59:59.999Z' }, importHourlyValidationRecordLimit: 50_000,
      importDailyMemberRecordLimit: 10_000, importDailyRecordLimit: 20_000,
      rateLimits: { claim, release },
    });
    expect(result).toMatchObject({ ok: false, error: { code: 'rate_limited', details: { retryAfterSeconds: 1 } } });
    expect(claim).toHaveBeenCalledTimes(1);
    expect(release).not.toHaveBeenCalled();
  });
});

it('preserves forward content, user, progress and redirect references regardless of record order', async () => {
  const h = harness();
  const modules = vi.fn(h.deps.modules.list);
  h.deps.modules.list = modules;
  const fullCtx = { ...ctx, capabilities: capabilitiesForApiKey({ ...apiKey, scopes: ['import:content', 'import:users'] }) };
  const future = '2098-01-01T00:00:00.000Z';
  const result = await validateM2mImport(fullCtx, {
    datasetVersion: 'together-import/v1',
    records: [
      { kind: 'progress', importKey: 'progress', memberKey: 'member', courseKey: 'course-source', completedLessonKeys: ['lesson-source'], lastViewedLessonKey: 'lesson-source', lastViewedModuleKey: 'module-source', lastViewedChapterId: 'chapter-1', updatedAt: future },
      { kind: 'redirect', importKey: 'redirect', fromPath: '/old', target: { kind: 'module-as-course', importKey: 'module-source' }, permanent: true },
      { kind: 'grant', importKey: 'grant', memberKey: 'member', productKey: 'product-source', startsAt: future, expiresAt: '2099-01-01T00:00:00.000Z' },
      { kind: 'module', ...moduleRecord() },
      { kind: 'lesson', ...lessonRecord() },
      { kind: 'course', ...courseRecord() },
      { kind: 'product', ...productRecord() },
      { kind: 'member', importKey: 'member', email: 'member@example.test', displayName: 'Member' },
    ],
  }, h.deps);
  expect(result).toMatchObject({ ok: true, value: { valid: true, errors: [], plan: { create: { course: 1, module: 1, lesson: 1, product: 1, member: 1, grant: 1, progress: 1, redirect: 1 } } } });
  expect(modules).toHaveBeenCalledTimes(1);
  expect(h.commitCalls()).toBe(0);
});
