import { pathToFileURL } from 'node:url';
import type { z } from 'zod';

import { createAuthE2eClient } from '#adapters/auth/e2e-http.js';
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

export interface RemoteSmokeOptions {
  baseUrl: string;
  tenant: string;
  publicPagePath: string;
  expectedSha?: string;
  member?: { email: string; password: string };
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

type Fetch = typeof fetch;

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

const createRun = (options: RemoteSmokeOptions, request: Fetch) => {
  const checks: RemoteSmokeCheck[] = [];
  return {
    get: (path: string, headers: Record<string, string> = {}): Promise<Response> =>
      request(endpoint(options.baseUrl, path), {
        headers: { [TENANT_HEADER]: options.tenant, ...headers },
      }),
    step: async <T>(name: string, probe: () => Promise<T>): Promise<T | null> => {
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

const signIn = async (options: RemoteSmokeOptions, request: Fetch): Promise<string> => {
  const member = options.member;
  if (member === undefined) throw new Error('SMOKE_MEMBER_EMAIL/SMOKE_MEMBER_PASSWORD are absent');
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

export const runRemoteSmoke = async (
  options: RemoteSmokeOptions,
  request: Fetch = fetch,
): Promise<RemoteSmokeResult> => {
  const run = createRun(options, request);

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

  await run.step('health-deep', async () => {
    const response = await run.get('/api/health/deep');
    const report = unwrap(
      await envelopeOf(response, envelopeSchema(deepHealthOutputSchema), 'deep health'),
      'deep health',
    );
    if (response.status !== 200 || !report.ok) {
      throw new Error(`deep health failed: ${report.failing.join(', ')}`);
    }
  });

  await run.step('public-offer', async () => {
    unwrap(
      await envelopeOf(
        await run.get('/api/public/offer'),
        envelopeSchema(publicOfferOutputSchema),
        'public offer',
      ),
      'public offer',
    );
  });

  await run.step('public-page', async () => {
    const response = expectStatus(await run.get(options.publicPagePath), 'public page', 200);
    const contentType = response.headers.get('content-type') ?? '';
    if (!contentType.toLowerCase().includes('text/html')) {
      throw new Error(`public page returned content type "${contentType}"`);
    }
    await response.text();
  });

  const token = await run.step('member-sign-in', () => signIn(options, request));
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
    const course = courses.courses[0];
    if (course === undefined) throw new Error('the smoke member sees no course');
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
    });
  }

  run.skip('studio-tenant-settings', STUDIO_SETTINGS_SKIP_REASON);
  return run.result();
};

type Environment = Record<string, string | undefined>;

/** The workflow exports every variable unconditionally, so "unset" arrives as an empty string. */
const provided = (env: Environment, name: string): string | null => {
  const value = env[name];
  return value === undefined || value === '' ? null : value;
};

export const remoteSmokeOptionsFromEnv = (env: Environment): RemoteSmokeOptions | null => {
  const baseUrl = provided(env, 'BASE_URL');
  if (baseUrl === null) return null;
  const expectedSha = provided(env, 'EXPECTED_SHA');
  const email = provided(env, 'SMOKE_MEMBER_EMAIL');
  const password = provided(env, 'SMOKE_MEMBER_PASSWORD');
  return {
    baseUrl,
    tenant: provided(env, 'SMOKE_TENANT') ?? 'acme',
    publicPagePath: provided(env, 'PUBLIC_PAGE_PATH') ?? '/',
    ...(expectedSha === null ? {} : { expectedSha }),
    ...(email === null || password === null ? {} : { member: { email, password } }),
  };
};

const main = async (): Promise<void> => {
  const options = remoteSmokeOptionsFromEnv(process.env);
  if (options === null) {
    process.stderr.write('smoke:remote: BASE_URL is required\n');
    process.exitCode = 2;
    return;
  }

  const startedAt = Date.now();
  const result = await runRemoteSmoke(options);

  for (const check of result.checks) {
    const detail = check.detail === null ? '' : ` — ${check.detail}`;
    process.stdout.write(
      `  [${check.status}] ${check.name} (${String(check.ms)}ms)${detail}\n`,
    );
  }
  const seconds = ((Date.now() - startedAt) / 1000).toFixed(1);
  if (result.ok) {
    process.stdout.write(`smoke:remote: PASS (${seconds}s)\n`);
    return;
  }
  process.stderr.write(`smoke:remote: FAIL failing=${result.failing.join(',')}\n`);
  process.exitCode = 1;
};

const invokedPath = process.argv[1];
if (invokedPath !== undefined && import.meta.url === pathToFileURL(invokedPath).href) {
  await main();
}
