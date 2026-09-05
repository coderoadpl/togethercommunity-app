import { describe, expect, it, vi } from 'vitest';

import {
  remoteSmokeOptionsFromEnv,
  runRemoteSmoke,
  type RemoteSmokeOptions,
} from './remote-smoke.js';

const SHA = 'abc123';

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
    checks: failing.map((name) => ({ name, ok: false, ms: 3, error: 'boom' })),
  },
});

const offerPayload = {
  ok: true,
  data: {
    tenant: {
      slug: 'coderoad',
      name: 'CodeRoad',
      branding: { logoUrl: null, accentColor: null, faviconUrl: null },
      legal: { termsUrl: null, privacyUrl: null },
    },
    contentVersion: 1,
    products: [],
  },
};

const mePayload = {
  ok: true,
  data: {
    userId: 'user-1',
    email: 'smoke@together.dev',
    name: 'Smoke',
    emailVerified: true,
    tenant: {
      id: 't-coderoad',
      slug: 'coderoad',
      name: 'CodeRoad',
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
      tenantId: 't-coderoad',
      name: 'Course',
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
  baseUrl: 'https://coderoad.togethercommunity.app/',
  tenant: 'coderoad',
  publicPagePath: '/',
  member: { status: 'configured', email: 'smoke@together.dev', password: 'smoke-password' },
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
} = {}) =>
  vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
    const url = new URL(String(input));
    if (url.pathname === '/api/health') return Response.json(overrides.health ?? healthPayload());
    if (url.pathname === '/api/health/deep') {
      const deep = overrides.deep ?? { payload: deepHealthPayload(), status: 200 };
      return Response.json(deep.payload, { status: deep.status });
    }
    if (url.pathname === '/api/public/offer') return Response.json(offerPayload);
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
    if (url.pathname === '/api/student/courses') return Response.json(coursesPayload);
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

describe('remoteSmokeOptionsFromEnv', () => {
  const environment = {
    BASE_URL: 'https://coderoad.togethercommunity.app',
    SMOKE_TENANT: 'coderoad',
    EXPECTED_SHA: SHA,
    SMOKE_MEMBER_EMAIL: 'smoke@together.dev',
    SMOKE_MEMBER_PASSWORD: 'smoke-password',
  };

  it('reads the deployment under test', () => {
    expect(remoteSmokeOptionsFromEnv(environment)).toEqual({
      baseUrl: environment.BASE_URL,
      tenant: 'coderoad',
      publicPagePath: '/',
      expectedSha: SHA,
      member: { status: 'configured', email: 'smoke@together.dev', password: 'smoke-password' },
    });
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
