import { pathToFileURL } from 'node:url';
import type { z } from 'zod';

import { createAuthE2eClient } from '#adapters/auth/e2e-http.js';
import {
  SMOKE_TENANT_COURSE_TITLE,
  SMOKE_TENANT_MEMBER_EMAIL,
  SMOKE_TENANT_SLUG,
} from '#core/domain/index.js';
import {
  courseStructureOutputSchema,
  deepHealthOutputSchema,
  envelopeSchema,
  healthOutputSchema,
  meOutputSchema,
  publicOfferOutputSchema,
  studentCoursesOutputSchema,
  studentLessonPlaybackOutputSchema,
  TENANT_HEADER,
} from '#core/contract/index.js';

export type MemberCredentials =
  | { status: 'configured'; email: string; password: string }
  | { status: 'absent' }
  | { status: 'incomplete'; missing: string };

export interface RemoteSmokeOptions {
  baseUrl: string;
  tenant: string;
  publicPagePath: string;
  expectedSha?: string;
  member: MemberCredentials;
  /** Absent on a foreign tenant, whose content the smoke cannot know. */
  expectedCourseTitle?: string;
}

export interface RemoteSmokeCheck {
  name: string;
  status: 'ok' | 'failed' | 'skipped';
  ms: number;
  detail: string | null;
}

export interface RemoteSmokeResult {
  ok: boolean;
  failing: string[];
  skipped: string[];
  checks: RemoteSmokeCheck[];
}

/**
 * Every tenant API key scope maps to marketing, transactional, enrollment or
 * import capabilities; none of them grants `tenant:settings:read`, so the
 * Studio settings read cannot be driven by a key from a workflow.
 */
const STUDIO_SETTINGS_SKIP_REASON =
  'no tenant API key scope grants tenant:settings:read';

const MEMBER_CREDENTIALS_SKIP_REASON =
  'SMOKE_MEMBER_EMAIL and SMOKE_MEMBER_PASSWORD are not configured';

const MEMBER_CREDENTIALS_NOTICE =
  'smoke:remote: NOTICE member checks skipped — set SMOKE_MEMBER_EMAIL and SMOKE_MEMBER_PASSWORD';

const MEMBER_CHECKS = [
  'member-sign-in',
  'member-identity',
  'student-courses',
  'lesson-playback',
] as const;

type Fetch = typeof fetch;

type Get = (path: string, headers?: Record<string, string>) => Promise<Response>;

interface SmokeTarget {
  baseUrl: string;
  tenant: string;
  headers: Record<string, string>;
}

const endpoint = (baseUrl: string, path: string): URL => new URL(path, new URL(baseUrl));

const envelopeOf = async <T extends z.ZodTypeAny>(
  response: Response,
  schema: T,
  name: string,
): Promise<z.output<T>> => {
  let payload: unknown;
  try {
    payload = await response.json();
  } catch {
    throw new Error(`${name} returned HTTP ${String(response.status)} without a JSON body`);
  }
  return schema.parse(payload);
};

const unwrap = <T>(
  envelope: { ok: true; data: T } | { ok: false; error: { code: string } },
  name: string,
): T => {
  if (!envelope.ok) throw new Error(`${name} failed with ${envelope.error.code}`);
  return envelope.data;
};

const expectStatus = (response: Response, name: string, status: number): Response => {
  if (response.status !== status) {
    throw new Error(`${name} returned HTTP ${String(response.status)}`);
  }
  return response;
};

const createRun = (target: SmokeTarget, request: Fetch) => {
  const checks: RemoteSmokeCheck[] = [];
  return {
    get: (path: string, headers: Record<string, string> = {}): Promise<Response> =>
      request(endpoint(target.baseUrl, path), {
        headers: { [TENANT_HEADER]: target.tenant, ...target.headers, ...headers },
      }),
    step: async <T>(name: string, probe: () => T | Promise<T>): Promise<T | null> => {
      const startedAt = Date.now();
      try {
        const value = await probe();
        checks.push({ name, status: 'ok', ms: Date.now() - startedAt, detail: null });
        return value;
      } catch (cause) {
        checks.push({
          name,
          status: 'failed',
          ms: Date.now() - startedAt,
          detail: cause instanceof Error ? cause.message : String(cause),
        });
        return null;
      }
    },
    skip: (name: string, reason: string): void => {
      checks.push({ name, status: 'skipped', ms: 0, detail: reason });
    },
    result: (): RemoteSmokeResult => {
      const failing = checks.filter((check) => check.status === 'failed').map((check) => check.name);
      return {
        ok: failing.length === 0,
        failing,
        skipped: checks.filter((check) => check.status === 'skipped').map((check) => check.name),
        checks,
      };
    },
  };
};

const signIn = async (
  options: RemoteSmokeOptions,
  member: { email: string; password: string },
  request: Fetch,
): Promise<string> => {
  const auth = createAuthE2eClient({
    connectUrl: options.baseUrl,
    origin: new URL(options.baseUrl).origin,
    request,
  });
  const signedIn = await auth.signInEmail(member);
  if (signedIn.status !== 200) {
    throw new Error(`member sign-in returned HTTP ${String(signedIn.status)}`);
  }
  if (signedIn.token === null || signedIn.token === '') {
    throw new Error('member sign-in returned no session token');
  }
  return signedIn.token;
};

const probeDeepHealth = async (get: Get): Promise<void> => {
  const response = await get('/api/health/deep');
  const report = unwrap(
    await envelopeOf(response, envelopeSchema(deepHealthOutputSchema), 'deep health'),
    'deep health',
  );
  if (response.status !== 200 || !report.ok) {
    throw new Error(`deep health failed: ${report.failing.join(', ')}`);
  }
};

export const runRemoteSmoke = async (
  options: RemoteSmokeOptions,
  request: Fetch = fetch,
): Promise<RemoteSmokeResult> => {
  const run = createRun({ ...options, headers: {} }, request);

  await run.step('health-attestation', async () => {
    const health = unwrap(
      await envelopeOf(await run.get('/api/health'), envelopeSchema(healthOutputSchema), 'health'),
      'health',
    );
    if (health.database !== 'up') throw new Error('health reported the database down');
    if (!health.schemaCurrent) throw new Error('health reported a stale schema');
    if (options.expectedSha !== undefined && health.sha !== options.expectedSha) {
      throw new Error(`expected SHA ${options.expectedSha}, received ${health.sha}`);
    }
  });

  await run.step('health-deep', () => probeDeepHealth(run.get));

  await run.step('public-offer', async () => {
    const offer = unwrap(
      await envelopeOf(
        await run.get('/api/public/offer'),
        envelopeSchema(publicOfferOutputSchema),
        'public offer',
      ),
      'public offer',
    );
    if (options.expectedCourseTitle !== undefined && offer.products.length === 0) {
      throw new Error('the public offer lists no published product');
    }
  });

  await run.step('public-page', async () => {
    const response = expectStatus(await run.get(options.publicPagePath), 'public page', 200);
    const contentType = response.headers.get('content-type') ?? '';
    if (!contentType.toLowerCase().includes('text/html')) {
      throw new Error(`public page returned content type "${contentType}"`);
    }
    await response.text();
  });

  const member = options.member;
  if (member.status === 'absent') {
    for (const name of MEMBER_CHECKS) run.skip(name, MEMBER_CREDENTIALS_SKIP_REASON);
    run.skip('studio-tenant-settings', STUDIO_SETTINGS_SKIP_REASON);
    return run.result();
  }

  const token = await run.step('member-sign-in', () => {
    if (member.status === 'incomplete') {
      throw new Error(`${member.missing} is absent while the other member credential is set`);
    }
    return signIn(options, member, request);
  });
  if (token === null) {
    run.skip('member-identity', 'member sign-in failed');
    run.skip('student-courses', 'member sign-in failed');
    run.skip('lesson-playback', 'member sign-in failed');
    run.skip('studio-tenant-settings', STUDIO_SETTINGS_SKIP_REASON);
    return run.result();
  }
  const authenticated = { authorization: `Bearer ${token}` };

  await run.step('member-identity', async () => {
    const me = unwrap(
      await envelopeOf(
        await run.get('/api/me', authenticated),
        envelopeSchema(meOutputSchema),
        'member identity',
      ),
      'member identity',
    );
    if (me.tenant === null) throw new Error('the smoke member has no membership on this tenant');
  });

  const lessonId = await run.step('student-courses', async () => {
    const courses = unwrap(
      await envelopeOf(
        await run.get('/api/student/courses', authenticated),
        envelopeSchema(studentCoursesOutputSchema),
        'student courses',
      ),
      'student courses',
    );
    const expectedTitle = options.expectedCourseTitle;
    const course = expectedTitle === undefined
      ? courses.courses[0]
      : courses.courses.find((candidate) => candidate.name === expectedTitle);
    if (course === undefined) {
      throw new Error(expectedTitle === undefined
        ? 'the smoke member sees no course'
        : `the smoke member does not see the seeded course "${expectedTitle}"`);
    }
    const structure = unwrap(
      await envelopeOf(
        await run.get(`/api/student/courses/${encodeURIComponent(course.id)}/structure`, authenticated),
        envelopeSchema(courseStructureOutputSchema),
        'course structure',
      ),
      'course structure',
    );
    const accessible = structure.structure.modules
      .flatMap((module) => module.chapters)
      .flatMap((chapter) => chapter.lessons)
      .find((lesson) => lesson.accessStatus !== 'not-accessible');
    if (accessible === undefined) throw new Error('the smoke member has no accessible lesson');
    return accessible.lessonId;
  });

  if (lessonId === null) {
    run.skip('lesson-playback', 'no accessible lesson was discovered');
  } else {
    await run.step('lesson-playback', async () => {
      const playback = unwrap(
        await envelopeOf(
          await run.get(`/api/student/lessons/${encodeURIComponent(lessonId)}/playback`, authenticated),
          envelopeSchema(studentLessonPlaybackOutputSchema),
          'lesson playback',
        ),
        'lesson playback',
      );
      const unavailable = playback.videos.find((video) => video.kind === 'unavailable');
      if (unavailable !== undefined) {
        throw new Error(`lesson playback is unavailable: ${unavailable.reason}`);
      }
      if (options.expectedCourseTitle === undefined) return;
      const playable = playback.videos.find((video) => video.kind === 'bunny' && video.embedUrl !== '');
      if (playable === undefined) throw new Error('the seeded lesson resolved no playback URL');
    });
  }

  run.skip('studio-tenant-settings', STUDIO_SETTINGS_SKIP_REASON);
  return run.result();
};

export const VERCEL_BYPASS_HEADER = 'x-vercel-protection-bypass';

export interface StagingSmokeOptions {
  baseUrl: string;
  tenant: string;
  bypassSecret: string;
  productionFingerprint: string;
  /** Null until the owner pins the observed fingerprint in a repository variable. */
  expectedFingerprint: string | null;
}

export interface StagingSmokeResult extends RemoteSmokeResult {
  observedFingerprint: string | null;
  /** The run fails on nothing but the fingerprint nobody has pinned yet. */
  unpinnedOnly: boolean;
}

const HEALTH_UNREACHABLE = 'the health attestation did not answer';

type Health = z.output<typeof healthOutputSchema>;

const readHealth = async (get: Get): Promise<Health> =>
  unwrap(
    await envelopeOf(await get('/api/health'), envelopeSchema(healthOutputSchema), 'health'),
    'health',
  );

const assertStagingIdentity = (health: Health): void => {
  if (health.database !== 'up') throw new Error('health reported the database down');
  if (health.environment !== 'staging') {
    throw new Error(`health reports environment "${health.environment}", not staging`);
  }
  if (health.production) throw new Error('health reports the deployment as production');
  if (!health.schemaCurrent) throw new Error('health reported a stale schema');
};

const assertStagingDatabase = (health: Health, options: StagingSmokeOptions): void => {
  const fingerprint = health.databaseFingerprint;
  if (fingerprint === null) throw new Error('health reported no database fingerprint');
  if (fingerprint === options.productionFingerprint) {
    throw new Error(`staging answers from the production database (fingerprint ${fingerprint})`);
  }
  if (options.expectedFingerprint === null) {
    throw new Error(
      `the staging database is unpinned: set STAGING_DATABASE_FINGERPRINT=${fingerprint}`,
    );
  }
  if (fingerprint !== options.expectedFingerprint) {
    throw new Error(
      `expected database fingerprint ${options.expectedFingerprint}, received ${fingerprint}`,
    );
  }
};

const failsOnlyOnTheMissingPin = (
  result: RemoteSmokeResult,
  options: StagingSmokeOptions,
  observedFingerprint: string | null,
): boolean =>
  options.expectedFingerprint === null
  && observedFingerprint !== null
  && observedFingerprint !== options.productionFingerprint
  && result.failing.length === 1
  && result.failing[0] === 'database-fingerprint';

export const runStagingSmoke = async (
  options: StagingSmokeOptions,
  request: Fetch = fetch,
): Promise<StagingSmokeResult> => {
  const run = createRun(
    { ...options, headers: { [VERCEL_BYPASS_HEADER]: options.bypassSecret } },
    request,
  );

  const health = await run.step('health-attestation', () => readHealth(run.get));
  if (health === null) {
    run.skip('staging-environment', HEALTH_UNREACHABLE);
    run.skip('database-fingerprint', HEALTH_UNREACHABLE);
  } else {
    await run.step('staging-environment', () => { assertStagingIdentity(health); });
    await run.step('database-fingerprint', () => { assertStagingDatabase(health, options); });
  }

  await run.step('health-deep', () => probeDeepHealth(run.get));

  const result = run.result();
  const observedFingerprint = health?.databaseFingerprint ?? null;
  return {
    ...result,
    observedFingerprint,
    unpinnedOnly: failsOnlyOnTheMissingPin(result, options, observedFingerprint),
  };
};

type Environment = Record<string, string | undefined>;

/** The workflow exports every variable unconditionally, so "unset" arrives as an empty string. */
const provided = (env: Environment, name: string): string | null => {
  const value = env[name];
  return value === undefined || value === '' ? null : value;
};

const memberFromEnv = (env: Environment, tenant: string): MemberCredentials => {
  const email = provided(env, 'SMOKE_MEMBER_EMAIL')
    ?? (tenant === SMOKE_TENANT_SLUG ? SMOKE_TENANT_MEMBER_EMAIL : null);
  const password = provided(env, 'SMOKE_MEMBER_PASSWORD');
  if (email !== null && password !== null) return { status: 'configured', email, password };
  if (email === null && password === null) return { status: 'absent' };
  return {
    status: 'incomplete',
    missing: email === null ? 'SMOKE_MEMBER_EMAIL' : 'SMOKE_MEMBER_PASSWORD',
  };
};

export const remoteSmokeOptionsFromEnv = (env: Environment): RemoteSmokeOptions | null => {
  const baseUrl = provided(env, 'BASE_URL');
  if (baseUrl === null) return null;
  const expectedSha = provided(env, 'EXPECTED_SHA');
  const tenant = provided(env, 'SMOKE_TENANT') ?? SMOKE_TENANT_SLUG;
  return {
    baseUrl,
    tenant,
    publicPagePath: provided(env, 'PUBLIC_PAGE_PATH') ?? '/',
    ...(expectedSha === null ? {} : { expectedSha }),
    member: memberFromEnv(env, tenant),
    ...(tenant === SMOKE_TENANT_SLUG ? { expectedCourseTitle: SMOKE_TENANT_COURSE_TITLE } : {}),
  };
};

export const stagingSmokeOptionsFromEnv = (env: Environment): StagingSmokeOptions | null => {
  const baseUrl = provided(env, 'STAGING_BASE_URL');
  const bypassSecret = provided(env, 'VERCEL_AUTOMATION_BYPASS_SECRET');
  const productionFingerprint = provided(env, 'PRODUCTION_DATABASE_FINGERPRINT');
  if (baseUrl === null || bypassSecret === null || productionFingerprint === null) return null;
  return {
    baseUrl,
    tenant: provided(env, 'SMOKE_TENANT') ?? SMOKE_TENANT_SLUG,
    bypassSecret,
    productionFingerprint,
    expectedFingerprint: provided(env, 'STAGING_DATABASE_FINGERPRINT'),
  };
};

const writeChecks = (checks: readonly RemoteSmokeCheck[]): void => {
  for (const check of checks) {
    const detail = check.detail === null ? '' : ` — ${check.detail}`;
    process.stdout.write(
      `  [${check.status}] ${check.name} (${String(check.ms)}ms)${detail}\n`,
    );
  }
};

const elapsed = (startedAt: number): string => ((Date.now() - startedAt) / 1000).toFixed(1);

const mainRemote = async (): Promise<void> => {
  const options = remoteSmokeOptionsFromEnv(process.env);
  if (options === null) {
    process.stderr.write('smoke:remote: BASE_URL is required\n');
    process.exitCode = 2;
    return;
  }

  const startedAt = Date.now();
  const result = await runRemoteSmoke(options);

  writeChecks(result.checks);
  if (options.member.status === 'absent') {
    process.stdout.write(`${MEMBER_CREDENTIALS_NOTICE}\n`);
  }
  if (result.ok) {
    process.stdout.write(`smoke:remote: PASS (${elapsed(startedAt)}s)\n`);
    return;
  }
  process.stderr.write(`smoke:remote: FAIL failing=${result.failing.join(',')}\n`);
  process.exitCode = 1;
};

const mainStaging = async (): Promise<void> => {
  const options = stagingSmokeOptionsFromEnv(process.env);
  if (options === null) {
    process.stderr.write(
      'smoke:staging: STAGING_BASE_URL, VERCEL_AUTOMATION_BYPASS_SECRET and PRODUCTION_DATABASE_FINGERPRINT are required\n',
    );
    process.exitCode = 2;
    return;
  }

  const startedAt = Date.now();
  const result = await runStagingSmoke(options);

  writeChecks(result.checks);
  process.stdout.write(
    `smoke:staging: databaseFingerprint=${result.observedFingerprint ?? 'unknown'}\n`,
  );
  if (result.unpinnedOnly) process.stdout.write('smoke:staging: unpinned=true\n');
  if (result.ok) {
    process.stdout.write(`smoke:staging: PASS (${elapsed(startedAt)}s)\n`);
    return;
  }
  process.stderr.write(`smoke:staging: FAIL failing=${result.failing.join(',')}\n`);
  process.exitCode = 1;
};

const main = async (): Promise<void> => {
  await (process.argv.includes('--staging') ? mainStaging() : mainRemote());
};

const invokedPath = process.argv[1];
if (invokedPath !== undefined && import.meta.url === pathToFileURL(invokedPath).href) {
  await main();
}
