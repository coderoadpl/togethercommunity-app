import { describe, expect, it } from 'vitest';

import {
  err,
  integrationNotConfigured,
  notFound,
  ok,
  type Course,
  type CourseLesson,
  type CourseModule,
  type SchedulerRun,
  type Tenant,
  type TenantSecret,
  type TenantSettings,
} from '#core/domain/index.js';

import { checkDeepHealth, type DeepHealthDeps } from './deep-health.js';

const NOW = '2026-09-05T12:00:00.000Z';

const acme: Tenant = {
  id: 't-acme',
  slug: 'acme',
  name: 'Acme',
  status: 'active',
  plan: 'self_hosted',
  contentVersion: 3,
};

const settings: TenantSettings = {
  name: 'Acme',
  socialLinks: [],
  billingPortalUrl: null,
  bunnyStreamLibraryId: null,
  bunnyStreamCdnHostname: null,
  logoUrl: null,
  logoDarkUrl: null,
  accentColor: null,
  faviconUrl: null,
  ogTitle: null,
  ogDescription: null,
  ogImageUrl: null,
  supportEmail: null,
  supportUrl: null,
  termsUrl: null,
  privacyUrl: null,
  defaultHomeSpaceId: null,
};

const course: Course = {
  id: 'course-1',
  tenantId: acme.id,
  name: 'Course',
  description: '',
  imageUrl: null,
  moduleOrder: ['module-1'],
  publiclyVisible: true,
  legacyId: null,
  createdAt: NOW,
};

const module: CourseModule = {
  id: 'module-1',
  tenantId: acme.id,
  courseIds: [course.id],
  title: 'Module',
  prefix: null,
  name: 'Module',
  chapters: [
    { id: 'chapter-1', name: 'Chapter', contents: [{ id: 'content-1', name: 'Lesson', lessonId: 'lesson-1' }] },
  ],
  legacyId: null,
  createdAt: NOW,
};

const lesson: CourseLesson = {
  id: 'lesson-1',
  tenantId: acme.id,
  name: 'Lesson',
  isPreview: true,
  contents: [],
  legacyId: null,
  createdAt: NOW,
};

const secret: TenantSecret = {
  id: 'secret-1',
  tenantId: acme.id,
  key: 'stripe.restrictedKey',
  ciphertext: 'cipher',
  iv: 'iv',
  authTag: 'tag',
  maskedPreview: '••••1234',
  updatedAt: NOW,
};

const schedulerRun: SchedulerRun = {
  id: 'run-1',
  kind: 'marketing_tick',
  trigger: 'cron',
  startedAt: '2026-09-05T11:30:00.000Z',
  finishedAt: '2026-09-05T11:30:01.000Z',
  durationMs: 1000,
  status: 'completed',
  error: null,
  totals: {
    campaignsTouched: 0,
    sendsAttempted: 0,
    sent: 0,
    failed: 0,
    skipped: 0,
    reEnqueued: false,
  },
  createdAt: '2026-09-05T11:30:00.000Z',
};

const storageConfiguration = JSON.stringify({
  provider: 'aws_s3',
  endpoint: 'https://s3.eu-central-1.amazonaws.com',
  region: 'eu-central-1',
  bucket: 'together-acme',
  accessKeyId: 'AKIA-test',
  secretAccessKey: 'secret-access-key',
});

const deps = (overrides: Partial<DeepHealthDeps> = {}): DeepHealthDeps => ({
  tenantDirectory: { listAll: async () => [acme] },
  tenants: {
    findById: async () => acme,
    findBySlug: async () => acme,
    findSole: async () => acme,
    hasAny: async () => true,
    findSettings: async () => settings,
    updateSettings: async (_tenantId, next) => next,
    createTenantWithOwnerGrant: async () => null,
  },
  courses: {
    list: async () => [course],
    findById: async () => course,
    findByIds: async () => [course],
    create: async () => undefined,
    update: async () => null,
    delete: async () => false,
  },
  modules: {
    list: async () => [module],
    findById: async () => module,
    findByIds: async () => [module],
    create: async () => undefined,
    update: async () => null,
    delete: async () => false,
  },
  lessons: {
    list: async () => [lesson],
    listPreviews: async () => [{ id: lesson.id, name: lesson.name, courseId: course.id }],
    findById: async () => lesson,
    findByIds: async () => [lesson],
    create: async () => undefined,
    update: async () => null,
    delete: async () => false,
  },
  products: {
    listByTenant: async () => [],
    listPublishedByTenant: async () => [],
    findById: async () => null,
    create: async () => 'created',
    updateAccessItems: async () => null,
    setPublished: async () => undefined,
    bumpContentVersion: async () => undefined,
  },
  prices: {
    listByProduct: async () => [],
    listActiveByProducts: async () => [],
    findById: async () => null,
    create: async () => undefined,
    setActive: async () => null,
  },
  tenantSecrets: {
    listByTenant: async () => [secret],
    findByKey: async () => secret,
    upsert: async (_tenantId, stored) => stored,
    delete: async () => false,
  },
  secretCrypto: {
    encrypt: () => ({ ciphertext: 'cipher', iv: 'iv', authTag: 'tag' }),
    decrypt: () => ok('plaintext'),
  },
  secretResolver: {
    resolve: async (_tenantId, key) =>
      key === 's3.configuration' ? ok(storageConfiguration) : err(notFound(`No secret "${key}"`)),
  },
  storage: {
    objectUrl: (configuration, key) => new URL(`${configuration.endpoint}/${configuration.bucket}/${key}`),
    probe: async () => ok({ code: 'storage.available', message: 'Storage is available.' }),
    presignPut: (input) => ok(input.url),
    presignGet: (input) => ok(`${input.url}?X-Amz-Signature=test`),
    delete: async () => ok({ deleted: true }),
    head: async () => ok({ sizeBytes: 1 }),
    healthcheck: async () => ok({ healthy: true }),
    test: async () => ok({ code: 'storage.available', message: 'Storage is available.' }),
  },
  emailTransports: {
    resolve: async () => ({
      send: async () => ok({ messageId: 'message-1' }),
      healthcheck: async () => ok({ healthy: true }),
      test: async () => ok({ code: 'email.available', message: 'Email is available.' }),
    }),
  },
  clock: { nowIso: () => NOW },
  schedulerRuns: { listPage: async () => ({ runs: [schedulerRun], nextCursor: null }) },
  ...overrides,
});

const checkNamed = (report: Awaited<ReturnType<typeof checkDeepHealth>>, name: string) => {
  const found = report.checks.find((check) => check.name === name);
  if (found === undefined) throw new Error(`no check named "${name}"`);
  return found;
};

describe('checkDeepHealth', () => {
  it('reports every probe green for a fully configured tenant', async () => {
    const report = await checkDeepHealth(deps());

    expect(report.ok).toBe(true);
    expect(report.failing).toEqual([]);
    expect(report.tenants).toBe(1);
    expect(report.checkedAt).toBe(NOW);
    expect(report.checks.map((check) => check.name)).toEqual([
      'tenant-directory',
      'scheduler-freshness',
      'tenant-settings',
      'public-offer',
      'course-content',
      'tenant-secret-decryption',
      'email-transport',
      'storage-presign',
    ]);
    expect(report.checks.every((check) => check.ok && check.error === null)).toBe(true);
    expect(checkNamed(report, 'storage-presign').subjects).toBe(1);
    expect(checkNamed(report, 'course-content').subjects).toBe(1);
  });

  it('reaches a members-only course through its modules', async () => {
    const membersOnly = { ...course, publiclyVisible: false };
    const report = await checkDeepHealth(deps({
      courses: { ...deps().courses, list: async () => [membersOnly], findById: async () => membersOnly },
    }));

    expect(report.ok).toBe(true);
    expect(checkNamed(report, 'course-content').subjects).toBe(1);
  });

  it('fails a members-only course whose module references a missing lesson', async () => {
    const membersOnly = { ...course, publiclyVisible: false };
    const report = await checkDeepHealth(deps({
      courses: { ...deps().courses, list: async () => [membersOnly], findById: async () => membersOnly },
      lessons: { ...deps().lessons, findById: async () => null },
    }));

    expect(report.failing).toEqual(['course-content']);
    expect(checkNamed(report, 'course-content').error)
      .toBe('a lesson referenced by a course structure is missing');
  });

  it('counts an unconfigured subject as checked by nobody without failing', async () => {
    const report = await checkDeepHealth(deps({
      secretResolver: { resolve: async (_tenantId, key) => err(notFound(`No secret "${key}"`)) },
      emailTransports: { resolve: async () => null },
      tenantSecrets: {
        listByTenant: async () => [],
        findByKey: async () => null,
        upsert: async (_tenantId, stored) => stored,
        delete: async () => false,
      },
    }));

    expect(report.ok).toBe(true);
    expect(checkNamed(report, 'storage-presign').subjects).toBe(0);
    expect(checkNamed(report, 'email-transport').subjects).toBe(0);
    expect(checkNamed(report, 'tenant-secret-decryption').subjects).toBe(0);
  });

  it('fails the settings probe when a stored row no longer parses', async () => {
    const report = await checkDeepHealth(deps({
      tenants: {
        ...deps().tenants,
        findSettings: async () => ({ ...settings, billingPortalUrl: 'not-a-url' }),
      },
    }));

    expect(report.ok).toBe(false);
    expect(report.failing).toEqual(['tenant-settings']);
    expect(checkNamed(report, 'tenant-settings').error).toContain('billingPortalUrl');
    expect(checkNamed(report, 'public-offer').ok).toBe(true);
  });

  it('fails the scheduler probe when the last run is older than two hours', async () => {
    const report = await checkDeepHealth(deps({
      schedulerRuns: {
        listPage: async () => ({
          runs: [{ ...schedulerRun, startedAt: '2026-09-05T08:00:00.000Z' }],
          nextCursor: null,
        }),
      },
    }));

    expect(report.failing).toEqual(['scheduler-freshness']);
    expect(checkNamed(report, 'scheduler-freshness').error).toContain('240 minutes ago');
  });

  it('keeps the failing check name without leaking the stored secret', async () => {
    const report = await checkDeepHealth(deps({
      secretCrypto: {
        encrypt: () => ({ ciphertext: 'cipher', iv: 'iv', authTag: 'tag' }),
        decrypt: () => err(integrationNotConfigured('sk_live_supersecret is unreadable')),
      },
    }));

    expect(report.failing).toEqual(['tenant-secret-decryption']);
    expect(checkNamed(report, 'tenant-secret-decryption').error)
      .toBe('secret decryption failed with integration_not_configured');
  });

  it('reports an unexpected cause as its type instead of the driver message', async () => {
    class DrizzleQueryError extends Error {}
    const report = await checkDeepHealth(deps({
      tenantDirectory: {
        listAll: async () => {
          throw new DrizzleQueryError(
            'Failed query: select * from tenants where id = $1\nparams: t-acme, sk_live_supersecret',
          );
        },
      },
    }));

    expect(report.tenants).toBe(0);
    expect(checkNamed(report, 'tenant-directory').error).toBe('unexpected DrizzleQueryError');
    expect(JSON.stringify(report)).not.toContain('sk_live_supersecret');
    expect(JSON.stringify(report)).not.toContain('select');
  });

  it('truncates a long failure message', async () => {
    const unparsable: TenantSettings = {
      ...settings,
      socialLinks: [0, 1, 2].map((index) => ({ label: `Link ${String(index)}`, url: 'not-a-url' })),
      billingPortalUrl: 'not-a-url',
      logoUrl: 'not-a-url',
      logoDarkUrl: 'not-a-url',
      accentColor: 'not-a-colour',
      faviconUrl: 'not-a-url',
      supportEmail: 'not-an-email',
      supportUrl: 'not-a-url',
      termsUrl: 'not-a-url',
      privacyUrl: 'not-a-url',
      ogImageUrl: 'not-a-url',
    };
    const report = await checkDeepHealth(deps({
      tenants: { ...deps().tenants, findSettings: async () => unparsable },
    }));

    expect(report.failing).toEqual(['tenant-settings']);
    expect(checkNamed(report, 'tenant-settings').error).toHaveLength(200);
    expect(checkNamed(report, 'tenant-settings').error?.endsWith('…')).toBe(true);
  });

  it('stops at the deadline and names the probes it never finished', async () => {
    const report = await checkDeepHealth(
      deps({ tenantDirectory: { listAll: () => new Promise(() => undefined) } }),
      10,
    );

    expect(report.ok).toBe(false);
    expect(report.failing).toEqual(['deadline']);
    expect(checkNamed(report, 'deadline').error)
      .toBe('the 10 ms probe budget expired at tenant-directory, scheduler-freshness');
  });

  it('marks the scheduler probe not applicable without a repository or any run', async () => {
    const withoutRepository = await checkDeepHealth(deps({ schedulerRuns: undefined }));
    const withoutHistory = await checkDeepHealth(deps({
      schedulerRuns: { listPage: async () => ({ runs: [], nextCursor: null }) },
    }));

    expect(withoutRepository.ok).toBe(true);
    expect(checkNamed(withoutRepository, 'scheduler-freshness').subjects).toBe(0);
    expect(withoutHistory.ok).toBe(true);
    expect(checkNamed(withoutHistory, 'scheduler-freshness').subjects).toBe(0);
  });
});
