import { describe, expect, it, vi } from 'vitest';

import {
  DEMO_SEED_PASSWORD,
  SMOKE_TENANT_COURSE_TITLE,
  SMOKE_TENANT_MEMBER_EMAIL,
} from '#core/domain/index.js';

import {
  remoteSmokeOptionsFromEnv,
  runRemoteSmoke,
  runStagingSmoke,
  stagingSmokeOptionsFromEnv,
  VERCEL_BYPASS_HEADER,
  type RemoteSmokeOptions,
  type StagingSmokeOptions,
} from './remote-smoke.js';

const SHA = 'abc123';
const PRODUCTION_FINGERPRINT = '4ef296aa90bd';
const STAGING_FINGERPRINT = 'a71c3d05e9f2';

const healthPayload = (overrides: Record<string, unknown> = {}) => ({
  ok: true,
  data: {
    status: 'ok',
    database: 'up',
    version: '0.1.0',
    sha: SHA,
    environment: 'production',
    production: true,
    commit: SHA,
    databaseFingerprint: 'b1bfbb98b4f7',
    expectedMigrations: 82,
    appliedMigrations: 82,
    schemaCurrent: true,
    schemaFingerprint: 'c087b16a6bb6',
    schemaFingerprintMatch: true,
    ...overrides,
  },
});

const deepHealthPayload = (failing: string[] = []) => ({
  ok: true,
  data: {
    ok: failing.length === 0,
    checkedAt: '2026-09-05T12:00:00.000Z',
    failing,
    checks: failing.map((name) => ({ name, ok: false, ms: 3, error: 'boom', skipped: null })),
  },
});

const offerPayload = (products: unknown[] = [{
  id: 'product-acme-course',
  type: 'course',
  slug: 'acme-course',
  title: SMOKE_TENANT_COURSE_TITLE,
  description: '',
  coverUrl: null,
  priceCents: 9900,
  currency: 'PLN',
  prices: [],
}]) => ({
  ok: true,
  data: {
    tenant: {
      slug: 'acme',
      name: 'Acme Courses',
      branding: { logoUrl: null, accentColor: null, faviconUrl: null },
      legal: { termsUrl: null, privacyUrl: null },
    },
    contentVersion: 1,
    products,
  },
});

const mePayload = {
  ok: true,
  data: {
    userId: 'user-1',
    email: 'smoke@together.dev',
    name: 'Smoke',
    emailVerified: true,
    tenant: {
      id: 't-acme',
      slug: 'acme',
      name: 'Acme',
      staffRole: null,
      memberId: 'member-1',
      banned: false,
    },
  },
};

const coursesPayload = {
  ok: true,
  data: {
    courses: [{
      id: 'course-1',
      tenantId: 't-acme',
      name: SMOKE_TENANT_COURSE_TITLE,
      description: '',
      imageUrl: null,
      moduleOrder: [],
      publiclyVisible: true,
      legacyId: null,
      createdAt: '2026-01-01T00:00:00.000Z',
    }],
  },
};

const structurePayload = {
  ok: true,
  data: {
    structure: {
      courseId: 'course-1',
      name: 'Course',
      accessStatus: 'fully-accessible',
      completionStatus: 'not-completed',
      modules: [{
        id: 'module-1',
        name: 'Module',
        accessStatus: 'fully-accessible',
        completionStatus: 'not-completed',
        chapters: [{
          id: 'chapter-1',
          name: 'Chapter',
          accessStatus: 'fully-accessible',
          completionStatus: 'not-completed',
          lessons: [{
            contentId: 'content-1',
            lessonId: 'lesson-1',
            name: 'Lesson',
            accessStatus: 'fully-accessible',
            completionStatus: 'not-completed',
          }],
        }],
      }],
    },
  },
};

const playbackPayload = (kind: 'bunny' | 'unavailable') => ({
  ok: true,
  data: {
    lessonId: 'lesson-1',
    expiresAt: '2026-09-05T13:00:00.000Z',
    videos: [kind === 'bunny'
      ? {
          kind: 'bunny',
          storageKey: 'lesson-1/video',
          videoId: 'video-1',
          libraryId: 'lib-1',
          embedUrl: 'https://iframe.mediadelivery.net/embed/lib-1/video-1',
          hlsUrl: null,
          signed: true,
        }
      : { kind: 'unavailable', storageKey: 'lesson-1/video', reason: 'missing_library_id' }],
  },
});

const unpinnedOptions: RemoteSmokeOptions = {
  baseUrl: 'https://acme.togethercommunity.app/',
  tenant: 'acme',
  publicPagePath: '/',
  member: { status: 'configured', email: SMOKE_TENANT_MEMBER_EMAIL, password: 'smoke-password' },
  expectedCourseTitle: SMOKE_TENANT_COURSE_TITLE,
};

const options: RemoteSmokeOptions = { ...unpinnedOptions, expectedSha: SHA };

const htmlResponse = () =>
  new Response('<!doctype html><html><body>Together</body></html>', {
    headers: { 'content-type': 'text/html; charset=utf-8' },
  });

const stubbedFetch = (overrides: {
  health?: unknown;
  deep?: { payload: unknown; status: number };
  signInStatus?: number;
  playback?: unknown;
  offer?: unknown;
  courses?: unknown;
} = {}) =>
  vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
    const url = new URL(String(input));
    if (url.pathname === '/api/health') return Response.json(overrides.health ?? healthPayload());
    if (url.pathname === '/api/health/deep') {
      const deep = overrides.deep ?? { payload: deepHealthPayload(), status: 200 };
      return Response.json(deep.payload, { status: deep.status });
    }
    if (url.pathname === '/api/public/offer') return Response.json(overrides.offer ?? offerPayload());
    if (url.pathname.endsWith('/sign-in/email')) {
      const status = overrides.signInStatus ?? 200;
      expect(init?.method).toBe('POST');
      return new Response(status === 200 ? '{}' : '{"code":"INVALID_CREDENTIALS"}', {
        status,
        headers: status === 200
          ? { 'content-type': 'application/json', 'set-auth-token': 'session-token' }
          : { 'content-type': 'application/json' },
      });
    }
    if (url.pathname === '/api/me') {
      expect(new Headers(init?.headers).get('authorization')).toBe('Bearer session-token');
      return Response.json(mePayload);
    }
    if (url.pathname === '/api/student/courses') return Response.json(overrides.courses ?? coursesPayload);
    if (url.pathname === '/api/student/courses/course-1/structure') {
      return Response.json(structurePayload);
    }
    if (url.pathname === '/api/student/lessons/lesson-1/playback') {
      return Response.json(overrides.playback ?? playbackPayload('bunny'));
    }
    if (url.pathname === '/') return htmlResponse();
    return new Response('not found', { status: 404 });
  });

describe('remote smoke', () => {
  it('drives the deployed surface from health through lesson playback', async () => {
    const result = await runRemoteSmoke(options, stubbedFetch());

    expect(result.ok).toBe(true);
    expect(result.failing).toEqual([]);
    expect(result.checks.map((check) => check.name)).toEqual([
      'health-attestation',
      'health-deep',
      'public-offer',
      'public-page',
      'member-sign-in',
      'member-identity',
      'student-courses',
      'lesson-playback',
      'studio-tenant-settings',
    ]);
    expect(result.skipped).toEqual(['studio-tenant-settings']);
  });

  it('fails when a different deployment SHA answers', async () => {
    const result = await runRemoteSmoke(
      options,
      stubbedFetch({ health: healthPayload({ sha: 'old-sha', commit: 'old-sha' }) }),
    );

    expect(result.ok).toBe(false);
    expect(result.failing).toEqual(['health-attestation']);
    expect(result.checks[0]?.detail).toBe(`expected SHA ${SHA}, received old-sha`);
  });

  it('accepts any served commit when no SHA is expected', async () => {
    const result = await runRemoteSmoke(
      unpinnedOptions,
      stubbedFetch({ health: healthPayload({ sha: 'other-sha', commit: 'other-sha' }) }),
    );

    expect(result.ok).toBe(true);
    expect(result.failing).toEqual([]);
  });

  it('names the failing deep-health checks when the probe answers 500', async () => {
    const result = await runRemoteSmoke(options, stubbedFetch({
      deep: { payload: deepHealthPayload(['tenant-settings', 'storage-presign']), status: 500 },
    }));

    expect(result.failing).toEqual(['health-deep']);
    expect(result.checks[1]?.detail).toBe('deep health failed: tenant-settings, storage-presign');
  });

  it('skips the authenticated checks when the member cannot sign in', async () => {
    const result = await runRemoteSmoke(options, stubbedFetch({ signInStatus: 401 }));

    expect(result.failing).toEqual(['member-sign-in']);
    expect(result.skipped).toEqual([
      'member-identity',
      'student-courses',
      'lesson-playback',
      'studio-tenant-settings',
    ]);
  });

  it('fails when the lesson has no resolvable playback video', async () => {
    const result = await runRemoteSmoke(
      options,
      stubbedFetch({ playback: playbackPayload('unavailable') }),
    );

    expect(result.failing).toEqual(['lesson-playback']);
    expect(result.checks.find((check) => check.name === 'lesson-playback')?.detail)
      .toBe('lesson playback is unavailable: missing_library_id');
  });

  it('fails when the smoke tenant publishes no product', async () => {
    const result = await runRemoteSmoke(options, stubbedFetch({ offer: offerPayload([]) }));

    expect(result.failing).toEqual(['public-offer']);
    expect(result.checks.find((check) => check.name === 'public-offer')?.detail)
      .toBe('the public offer lists no published product');
  });

  it('fails when the seeded course is missing from the student course list', async () => {
    const result = await runRemoteSmoke(options, stubbedFetch({
      courses: {
        ok: true,
        data: { courses: [{ ...coursesPayload.data.courses[0], name: 'Something else' }] },
      },
    }));

    expect(result.failing).toEqual(['student-courses']);
    expect(result.checks.find((check) => check.name === 'student-courses')?.detail)
      .toContain(`does not see the seeded course "${SMOKE_TENANT_COURSE_TITLE}"`);
  });

  it('skips the member checks when neither credential is configured', async () => {
    const request = stubbedFetch();
    const result = await runRemoteSmoke({ ...options, member: { status: 'absent' } }, request);

    expect(result.ok).toBe(true);
    expect(result.failing).toEqual([]);
    expect(result.skipped).toEqual([
      'member-sign-in',
      'member-identity',
      'student-courses',
      'lesson-playback',
      'studio-tenant-settings',
    ]);
    expect(result.checks.find((check) => check.name === 'member-sign-in')?.detail)
      .toBe('SMOKE_MEMBER_EMAIL and SMOKE_MEMBER_PASSWORD are not configured');
    expect(request.mock.calls.some(([input]) => String(input).includes('/sign-in/email')))
      .toBe(false);
  });

  it('fails when only one of the two member credentials is configured', async () => {
    const result = await runRemoteSmoke(
      { ...options, member: { status: 'incomplete', missing: 'SMOKE_MEMBER_PASSWORD' } },
      stubbedFetch(),
    );

    expect(result.ok).toBe(false);
    expect(result.failing).toEqual(['member-sign-in']);
    expect(result.checks.find((check) => check.name === 'member-sign-in')?.detail)
      .toBe('SMOKE_MEMBER_PASSWORD is absent while the other member credential is set');
    expect(JSON.stringify(result)).not.toContain('smoke-password');
  });
});

const stagingHealth = (overrides: Record<string, unknown> = {}) =>
  healthPayload({
    environment: 'staging',
    production: false,
    databaseFingerprint: STAGING_FINGERPRINT,
    ...overrides,
  });

const stagingOptions: StagingSmokeOptions = {
  baseUrl: 'https://acme.staging.togethercommunity.app/',
  tenant: 'acme',
  publicPagePath: '/',
  member: { status: 'configured', email: SMOKE_TENANT_MEMBER_EMAIL, password: DEMO_SEED_PASSWORD },
  bypassSecret: 'bypass-secret',
  productionFingerprint: PRODUCTION_FINGERPRINT,
  expectedFingerprint: STAGING_FINGERPRINT,
  sanitized: true,
};

const detailOf = (result: { checks: { name: string; detail: string | null }[] }, name: string) =>
  result.checks.find((check) => check.name === name)?.detail;

describe('staging smoke', () => {
  it('accepts a staging deployment answering from the pinned staging database', async () => {
    const request = stubbedFetch({ health: stagingHealth() });

    const result = await runStagingSmoke(stagingOptions, request);

    expect(result.ok).toBe(true);
    expect(result.failing).toEqual([]);
    expect(result.observedFingerprint).toBe(STAGING_FINGERPRINT);
    expect(result.checks.map((check) => check.name)).toEqual([
      'health-attestation',
      'staging-environment',
      'database-fingerprint',
      'health-deep',
      'public-offer',
      'public-page',
      'member-sign-in',
      'member-identity',
      'student-courses',
      'lesson-playback',
      'studio-tenant-settings',
    ]);
    expect(request.mock.calls).toHaveLength(9);
    expect(request.mock.calls.every(([, init]) =>
      new Headers(init?.headers).get(VERCEL_BYPASS_HEADER) === 'bypass-secret')).toBe(true);
  });

  it('fails when staging answers from the production database', async () => {
    const result = await runStagingSmoke(
      stagingOptions,
      stubbedFetch({ health: stagingHealth({ databaseFingerprint: PRODUCTION_FINGERPRINT }) }),
    );

    expect(result.failing).toEqual(['database-fingerprint']);
    expect(result.unpinnedOnly).toBe(false);
    expect(detailOf(result, 'database-fingerprint'))
      .toBe(`staging answers from the production database (fingerprint ${PRODUCTION_FINGERPRINT})`);
  });

  it('reports the production database as an incident even while the pin is missing', async () => {
    const result = await runStagingSmoke(
      { ...stagingOptions, expectedFingerprint: null },
      stubbedFetch({ health: stagingHealth({ databaseFingerprint: PRODUCTION_FINGERPRINT }) }),
    );

    expect(result.failing).toEqual(['database-fingerprint']);
    expect(result.unpinnedOnly).toBe(false);
  });

  it('reports more than the missing pin when another check fails too', async () => {
    const result = await runStagingSmoke(
      { ...stagingOptions, expectedFingerprint: null },
      stubbedFetch({
        health: stagingHealth(),
        deep: { payload: deepHealthPayload(['tenant-settings']), status: 500 },
      }),
    );

    expect(result.failing).toEqual(['database-fingerprint', 'health-deep']);
    expect(result.unpinnedOnly).toBe(false);
  });

  it('fails with the pin instruction while the staging fingerprint is unset', async () => {
    const result = await runStagingSmoke(
      { ...stagingOptions, expectedFingerprint: null },
      stubbedFetch({ health: stagingHealth() }),
    );

    expect(result.failing).toEqual(['database-fingerprint']);
    expect(result.observedFingerprint).toBe(STAGING_FINGERPRINT);
    expect(result.unpinnedOnly).toBe(true);
    expect(detailOf(result, 'database-fingerprint'))
      .toBe(`the staging database is unpinned: set STAGING_DATABASE_FINGERPRINT=${STAGING_FINGERPRINT}`);
  });

  it('fails when another database than the pinned one answers', async () => {
    const result = await runStagingSmoke(
      stagingOptions,
      stubbedFetch({ health: stagingHealth({ databaseFingerprint: 'ff00ff00ff00' }) }),
    );

    expect(result.failing).toEqual(['database-fingerprint']);
    expect(detailOf(result, 'database-fingerprint'))
      .toBe(`expected database fingerprint ${STAGING_FINGERPRINT}, received ff00ff00ff00`);
  });

  it('fails when the staging host reports the production posture', async () => {
    const result = await runStagingSmoke(
      stagingOptions,
      stubbedFetch({
        health: healthPayload({ databaseFingerprint: PRODUCTION_FINGERPRINT }),
      }),
    );

    expect(result.failing).toEqual(['staging-environment', 'database-fingerprint']);
    expect(detailOf(result, 'staging-environment'))
      .toBe('health reports environment "production", not staging');
  });

  it('fails when the staging deployment reports its database down', async () => {
    const result = await runStagingSmoke(
      stagingOptions,
      stubbedFetch({ health: stagingHealth({ database: 'down' }) }),
    );

    expect(result.failing).toEqual(['staging-environment']);
    expect(detailOf(result, 'staging-environment')).toBe('health reported the database down');
  });

  it('fails on a stale schema', async () => {
    const result = await runStagingSmoke(
      stagingOptions,
      stubbedFetch({ health: stagingHealth({ schemaCurrent: false }) }),
    );

    expect(result.failing).toEqual(['staging-environment']);
    expect(detailOf(result, 'staging-environment')).toBe('health reported a stale schema');
  });

  it('fails when deep health does not answer 200', async () => {
    const result = await runStagingSmoke(stagingOptions, stubbedFetch({
      health: stagingHealth(),
      deep: { payload: deepHealthPayload(['tenant-settings']), status: 500 },
    }));

    expect(result.failing).toEqual(['health-deep']);
    expect(detailOf(result, 'health-deep')).toBe('deep health failed: tenant-settings');
  });

  it('skips the database assertions when health itself does not answer', async () => {
    const result = await runStagingSmoke(stagingOptions, stubbedFetch({
      health: { ok: false, error: { code: 'INTERNAL' } },
    }));

    expect(result.failing).toEqual(['health-attestation']);
    expect(result.skipped).toEqual([
      'staging-environment',
      'database-fingerprint',
      'studio-tenant-settings',
    ]);
    expect(result.observedFingerprint).toBeNull();
  });

  it('warns instead of failing on an unsanitized secret-decryption failure', async () => {
    const result = await runStagingSmoke({ ...stagingOptions, sanitized: false }, stubbedFetch({
      health: stagingHealth(),
      deep: { payload: deepHealthPayload(['tenant-secret-decryption']), status: 500 },
    }));

    expect(result.ok).toBe(true);
    expect(result.failing).toEqual([]);
    expect(result.checks.find((check) => check.name === 'health-deep')?.status).toBe('warning');
    expect(detailOf(result, 'health-deep')).toBe('deep health failed: tenant-secret-decryption');
  });

  it('warns instead of failing on an unsanitized storage-presign failure', async () => {
    const result = await runStagingSmoke({ ...stagingOptions, sanitized: false }, stubbedFetch({
      health: stagingHealth(),
      deep: {
        payload: deepHealthPayload(['tenant-secret-decryption', 'storage-presign']),
        status: 500,
      },
    }));

    expect(result.ok).toBe(true);
    expect(result.failing).toEqual([]);
    expect(result.checks.find((check) => check.name === 'health-deep')?.status).toBe('warning');
  });

  it('still fails an unsanitized deployment on a deep-health check outside the warning set', async () => {
    const result = await runStagingSmoke({ ...stagingOptions, sanitized: false }, stubbedFetch({
      health: stagingHealth(),
      deep: {
        payload: deepHealthPayload(['tenant-secret-decryption', 'tenant-settings']),
        status: 500,
      },
    }));

    expect(result.ok).toBe(false);
    expect(result.failing).toEqual(['health-deep']);
    expect(result.checks.find((check) => check.name === 'health-deep')?.status).toBe('failed');
  });

  it('still fails a sanitized deployment on the same tenant-secret-decryption check', async () => {
    const result = await runStagingSmoke({ ...stagingOptions, sanitized: true }, stubbedFetch({
      health: stagingHealth(),
      deep: { payload: deepHealthPayload(['tenant-secret-decryption']), status: 500 },
    }));

    expect(result.ok).toBe(false);
    expect(result.failing).toEqual(['health-deep']);
    expect(result.checks.find((check) => check.name === 'health-deep')?.status).toBe('failed');
  });
});

describe('stagingSmokeOptionsFromEnv', () => {
  const environment = {
    STAGING_BASE_URL: 'https://acme.staging.togethercommunity.app',
    VERCEL_AUTOMATION_BYPASS_SECRET: 'bypass-secret',
    PRODUCTION_DATABASE_FINGERPRINT: PRODUCTION_FINGERPRINT,
    STAGING_DATABASE_FINGERPRINT: STAGING_FINGERPRINT,
  };

  it('reads the staging target', () => {
    expect(stagingSmokeOptionsFromEnv(environment)).toEqual({
      baseUrl: environment.STAGING_BASE_URL,
      tenant: 'acme',
      publicPagePath: '/',
      member: { status: 'configured', email: SMOKE_TENANT_MEMBER_EMAIL, password: DEMO_SEED_PASSWORD },
      bypassSecret: 'bypass-secret',
      productionFingerprint: PRODUCTION_FINGERPRINT,
      expectedFingerprint: STAGING_FINGERPRINT,
      sanitized: true,
    });
  });

  it('defaults to sanitized when the workflow does not report otherwise', () => {
    expect(stagingSmokeOptionsFromEnv(environment)?.sanitized).toBe(true);
    expect(stagingSmokeOptionsFromEnv({ ...environment, SANITIZED: '' })?.sanitized).toBe(true);
  });

  it('reads an unsanitized deployment from the workflow-exported flag', () => {
    expect(stagingSmokeOptionsFromEnv({ ...environment, SANITIZED: 'false' })?.sanitized)
      .toBe(false);
  });

  it('leaves the staging database unpinned when its variable is unset', () => {
    expect(stagingSmokeOptionsFromEnv({ ...environment, STAGING_DATABASE_FINGERPRINT: '' })
      ?.expectedFingerprint).toBeNull();
  });

  it('runs no probe without the bypass secret or the production fingerprint', () => {
    expect(stagingSmokeOptionsFromEnv({ ...environment, VERCEL_AUTOMATION_BYPASS_SECRET: '' }))
      .toBeNull();
    expect(stagingSmokeOptionsFromEnv({ ...environment, PRODUCTION_DATABASE_FINGERPRINT: '' }))
      .toBeNull();
    expect(stagingSmokeOptionsFromEnv({ ...environment, STAGING_BASE_URL: '' })).toBeNull();
  });

  it('targets the seeded smoke tenant even when a copied tenant override is present', () => {
    expect(stagingSmokeOptionsFromEnv({
      ...environment,
      SMOKE_TENANT: 'studio',
      SMOKE_MEMBER_PASSWORD: 'custom-password',
    })).toMatchObject({
      tenant: 'acme',
      member: { status: 'configured', email: SMOKE_TENANT_MEMBER_EMAIL, password: 'custom-password' },
    });
  });
});

describe('remoteSmokeOptionsFromEnv', () => {
  const environment = {
    BASE_URL: 'https://studio.togethercommunity.app',
    SMOKE_TENANT: 'studio',
    EXPECTED_SHA: SHA,
    SMOKE_MEMBER_EMAIL: 'smoke@together.dev',
    SMOKE_MEMBER_PASSWORD: 'smoke-password',
  };

  it('reads the deployment under test', () => {
    expect(remoteSmokeOptionsFromEnv(environment)).toEqual({
      baseUrl: environment.BASE_URL,
      tenant: 'studio',
      publicPagePath: '/',
      expectedSha: SHA,
      member: { status: 'configured', email: 'smoke@together.dev', password: 'smoke-password' },
    });
  });

  it('defaults to the smoke tenant and its seeded member address', () => {
    expect(remoteSmokeOptionsFromEnv({
      BASE_URL: environment.BASE_URL,
      SMOKE_MEMBER_PASSWORD: 'production-only-member-password',
    })).toEqual({
      baseUrl: environment.BASE_URL,
      tenant: 'acme',
      publicPagePath: '/',
      member: { status: 'configured', email: SMOKE_TENANT_MEMBER_EMAIL, password: 'production-only-member-password' },
      expectedCourseTitle: SMOKE_TENANT_COURSE_TITLE,
    });
  });

  it('keeps the member address override above the seeded default', () => {
    expect(remoteSmokeOptionsFromEnv({
      BASE_URL: environment.BASE_URL,
      SMOKE_MEMBER_EMAIL: 'other@together.dev',
      SMOKE_MEMBER_PASSWORD: 'other-password',
    })?.member).toEqual({ status: 'configured', email: 'other@together.dev', password: 'other-password' });
  });

  it('signs nobody in without the member password', () => {
    expect(remoteSmokeOptionsFromEnv({
      BASE_URL: environment.BASE_URL,
      SMOKE_MEMBER_EMAIL: 'real-member@acme.pl',
    })?.member).toEqual({ status: 'incomplete', missing: 'SMOKE_MEMBER_PASSWORD' });
  });

  it('asserts on known content only on the smoke tenant', () => {
    expect(remoteSmokeOptionsFromEnv(environment)).not.toHaveProperty('expectedCourseTitle');
  });

  it('treats an empty variable as absent, as a manual dispatch exports it', () => {
    const options = remoteSmokeOptionsFromEnv({
      ...environment,
      EXPECTED_SHA: '',
      SMOKE_MEMBER_EMAIL: '',
      SMOKE_MEMBER_PASSWORD: '',
    });

    expect(options).not.toHaveProperty('expectedSha');
    expect(options?.member).toEqual({ status: 'absent' });
  });

  it('names the missing variable when only one credential is configured', () => {
    expect(remoteSmokeOptionsFromEnv({ ...environment, SMOKE_MEMBER_PASSWORD: '' })?.member)
      .toEqual({ status: 'incomplete', missing: 'SMOKE_MEMBER_PASSWORD' });
    expect(remoteSmokeOptionsFromEnv({ ...environment, SMOKE_MEMBER_EMAIL: '' })?.member)
      .toEqual({ status: 'incomplete', missing: 'SMOKE_MEMBER_EMAIL' });
  });

  it('reports a missing base URL', () => {
    expect(remoteSmokeOptionsFromEnv({ ...environment, BASE_URL: '' })).toBeNull();
    expect(remoteSmokeOptionsFromEnv({})).toBeNull();
  });
});
