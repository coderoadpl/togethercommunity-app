import type { ChildProcess } from 'node:child_process';
import { rmSync } from 'node:fs';
import { join } from 'node:path';

import pg from 'pg';
import { chromium, type Browser, type Page } from 'playwright-core';
import type { ZodTypeAny, output } from 'zod';

import {
  API_PATHS,
  courseStructureOutputSchema,
  looseEnvelopeSchema,
  publicNavigationOutputSchema,
  spaceFeedOutputSchema,
} from '#core/contract/index.js';

import { resolveE2eDatabaseUrl } from './e2e-config.js';
import {
  bootServer,
  ephemeralPort,
  killServer,
  rootDir,
  run,
  tsxBin,
} from './server-harness.js';

const viteBin = join(rootDir, 'node_modules/.bin/vite');
const webDistDir = join(rootDir, 'dist/web');
const chromeExecutablePath = process.env['PLAYWRIGHT_CHROME_EXECUTABLE_PATH'];
const E2E_DB = 'together_e2e_public_authz';
const baseDatabaseUrl = resolveE2eDatabaseUrl(process.env);
const e2eUrlObject = new URL(baseDatabaseUrl);
e2eUrlObject.pathname = `/${E2E_DB}`;
const e2eDatabaseUrl = e2eUrlObject.toString();

const studioSpaceId = 'space-studio-spolecznosc';
const privateSpaceId = 'space-studio-klub-js';
const publicThreadId = 'post-spolecznosc-hello';
const privateThreadId = 'post-klub-wyzwanie';
const publicCourseId = 'course-js';
const hiddenCourseId = 'course-react';
const previewLessonId = 'lesson-js-funkcje-2';
const lockedLessonId = 'lesson-js-funkcje-1';

class E2eFailure extends Error {}

function assert(condition: boolean, message: string): asserts condition {
  if (!condition) throw new E2eFailure(message);
}

const setupDatabase = async (adminUrl: string): Promise<void> => {
  const client = new pg.Client({ connectionString: adminUrl });
  try {
    await client.connect();
    await client.query(`DROP DATABASE IF EXISTS ${E2E_DB} WITH (FORCE)`);
    await client.query(`CREATE DATABASE ${E2E_DB}`);
  } catch (cause) {
    throw new E2eFailure(
      `Could not prepare the public-authz database "${E2E_DB}". Is the dev Postgres up (pnpm run db:up)?\n${String(cause)}`,
    );
  } finally {
    await client.end();
  }
};

const dropDatabase = async (adminUrl: string): Promise<void> => {
  const client = new pg.Client({ connectionString: adminUrl });
  await client.connect();
  try {
    await client.query(`DROP DATABASE IF EXISTS ${E2E_DB} WITH (FORCE)`);
  } finally {
    await client.end();
  }
};

const migrateSeedAndEnablePreview = async (databaseUrl: string): Promise<void> => {
  const migrate = await run(tsxBin, ['adapters/db/migrate.ts'], { DATABASE_URL: databaseUrl });
  assert(migrate.code === 0, `Migration failed:\n${migrate.stdout}${migrate.stderr}`);
  const seed = await run(tsxBin, ['adapters/db/seed.ts'], { DATABASE_URL: databaseUrl });
  assert(seed.code === 0, `Seed failed:\n${seed.stdout}${seed.stderr}`);

  const client = new pg.Client({ connectionString: databaseUrl });
  await client.connect();
  try {
    const updated = await client.query(
      'UPDATE course_lessons SET is_preview = true WHERE tenant_id = $1 AND id = $2',
      ['tenant-studio', previewLessonId],
    );
    assert(updated.rowCount === 1, `Expected to enable one preview lesson, updated ${String(updated.rowCount)}`);
  } finally {
    await client.end();
  }
};

const buildWeb = async (): Promise<void> => {
  const build = await run(viteBin, ['build', '--config', 'apps/web/vite.config.ts'], {});
  assert(build.code === 0, `Web build failed:\n${build.stdout}${build.stderr}`);
};

const readJson = (raw: string, label: string): unknown => {
  try {
    return JSON.parse(raw);
  } catch {
    throw new E2eFailure(`${label}: expected JSON.\n${raw}`);
  }
};

const requestRaw = async (baseUrl: string, path: string, label: string): Promise<string> => {
  const response = await fetch(new URL(path, baseUrl));
  const raw = await response.text();
  assert(response.status === 200, `${label}: expected HTTP 200, got ${response.status}.\n${raw}`);
  return raw;
};

const parseOk = <S extends ZodTypeAny>(raw: string, label: string, schema: S): output<S> => {
  const envelope = looseEnvelopeSchema.parse(readJson(raw, label));
  assert(envelope.ok, `${label}: expected an ok envelope.\n${raw}`);
  const parsed = schema.safeParse(envelope.data);
  if (!parsed.success) {
    throw new E2eFailure(`${label}: response did not match its contract.\n${parsed.error.message}`);
  }
  return parsed.data;
};

const requestOk = async <S extends ZodTypeAny>(
  baseUrl: string,
  path: string,
  label: string,
  schema: S,
): Promise<output<S>> => parseOk(await requestRaw(baseUrl, path, label), label, schema);

const requestError = async (
  baseUrl: string,
  path: string,
  label: string,
  status: number,
  code: string,
  init?: RequestInit,
): Promise<void> => {
  const response = await fetch(new URL(path, baseUrl), init);
  const raw = await response.text();
  assert(response.status === status, `${label}: expected HTTP ${status}, got ${response.status}.\n${raw}`);
  const envelope = looseEnvelopeSchema.parse(readJson(raw, label));
  assert(!envelope.ok, `${label}: expected an error envelope.\n${raw}`);
  assert(envelope.error.code === code, `${label}: expected error "${code}", got "${envelope.error.code}"`);
};

const identityKeys = new Set(['authorUserId', 'email', 'memberId', 'userId']);

const findIdentityKeys = (value: unknown, path = '$'): string[] => {
  if (Array.isArray(value)) {
    return value.flatMap((item, index) => findIdentityKeys(item, `${path}[${String(index)}]`));
  }
  if (value === null || typeof value !== 'object') return [];
  return Object.entries(value).flatMap(([key, nested]) => [
    ...(identityKeys.has(key) ? [`${path}.${key}`] : []),
    ...findIdentityKeys(nested, `${path}.${key}`),
  ]);
};

const expectHref = async (page: Page, testId: string, expected: string): Promise<void> => {
  const href = await page.getByTestId(testId).getAttribute('href');
  assert(href === expected, `${testId}: expected href "${expected}", got "${String(href)}"`);
};

const expectNoDiscussionControls = async (page: Page, label: string): Promise<void> => {
  for (const selector of [
    '[data-testid="discussion-composer"]',
    '[data-testid="discussion-composer-open"]',
    '[data-testid^="reply-button-"]',
    '[data-testid^="reply-composer-"]',
  ]) {
    const count = await page.locator(selector).count();
    assert(count === 0, `${label}: found ${String(count)} control(s) matching ${selector}`);
  }
};

const runHomeJourney = async (page: Page, studioBaseUrl: string): Promise<void> => {
  await page.goto(`${studioBaseUrl}/`, { waitUntil: 'domcontentloaded' });
  await page.getByTestId('anon-home-feed').waitFor({ state: 'visible', timeout: 15000 });
  await page.getByTestId('anon-sidebar').waitFor({ state: 'visible' });
  await page.getByTestId(`anon-sidebar-space-${studioSpaceId}`).waitFor({ state: 'visible' });
  await page.getByTestId(`course-card-${publicCourseId}`).waitFor({ state: 'visible' });
  await page.getByTestId(`locked-space-card-${privateSpaceId}`).waitFor({ state: 'visible' });
  await page.getByTestId('locked-space-card-space-studio-klub-react').waitFor({ state: 'visible' });
  await page.getByTestId(`public-feed-post-${publicThreadId}`).waitFor({ state: 'visible' });
  assert(
    await page.getByTestId(`course-card-${hiddenCourseId}`).count() === 0,
    'anonymous home exposed the hidden React course',
  );
  assert(
    await page.getByTestId(`space-card-${studioSpaceId}`).count() === 0,
    'anonymous home tiled the home space alongside its own feed',
  );
  await expectHref(page, `anon-sidebar-space-${studioSpaceId}`, `/community/${studioSpaceId}`);
  await expectHref(page, `course-card-${publicCourseId}`, `/my/courses/${publicCourseId}`);
  await expectHref(page, `locked-space-cta-${privateSpaceId}`, '/checkout/product-js-full');

  const navigation = await requestOk(
    studioBaseUrl,
    API_PATHS.publicNavigation,
    'Studio public navigation',
    publicNavigationOutputSchema,
  );
  assert(
    navigation.navigation.defaultHomeSpaceId === studioSpaceId,
    `Studio default public space was ${String(navigation.navigation.defaultHomeSpaceId)}`,
  );
  assert(
    navigation.navigation.spaces.map(({ id }) => id).join(',') === studioSpaceId,
    `Studio public spaces were ${navigation.navigation.spaces.map(({ id }) => id).join(',')}`,
  );
  assert(
    navigation.navigation.courses.map(({ id }) => id).join(',') === publicCourseId,
    `Studio public courses were ${navigation.navigation.courses.map(({ id }) => id).join(',')}`,
  );

  const feedLabel = 'Studio public home feed';
  const feedRaw = await requestRaw(
    studioBaseUrl,
    API_PATHS.publicSpaceFeed.replace(':spaceId', studioSpaceId),
    feedLabel,
  );
  parseOk(feedRaw, feedLabel, spaceFeedOutputSchema);
  const exposedKeys = findIdentityKeys(readJson(feedRaw, feedLabel));
  assert(exposedKeys.length === 0, `Studio public feed exposed identity keys: ${exposedKeys.join(', ')}`);
  for (const privateValue of [
    'creator@together.dev',
    'kursant.aktywny@together.dev',
    'free@together.dev',
    'user-kursant-aktywny',
    'user-free',
  ]) {
    assert(!feedRaw.includes(privateValue), `Studio public feed exposed ${privateValue}`);
  }
  console.log('public-authz-e2e: anonymous home and public feed OK');
};

const runReadOnlyCommunityJourney = async (page: Page, studioBaseUrl: string): Promise<void> => {
  await page.goto(`${studioBaseUrl}/community/${studioSpaceId}`, { waitUntil: 'domcontentloaded' });
  await page.getByTestId(`public-feed-post-${publicThreadId}`).waitFor({ state: 'visible', timeout: 15000 });
  await page.getByTestId('anon-read-only').waitFor({ state: 'visible' });
  await expectNoDiscussionControls(page, 'public space feed');

  await page.goto(`${studioBaseUrl}/community/${studioSpaceId}/posts/${publicThreadId}`, {
    waitUntil: 'domcontentloaded',
  });
  await page.getByTestId('public-thread').waitFor({ state: 'visible', timeout: 15000 });
  await page.getByTestId('public-reply-post-spolecznosc-hello-r1').waitFor({ state: 'visible' });
  await page.getByTestId('anon-join-cta').waitFor({ state: 'visible' });
  await expectNoDiscussionControls(page, 'public thread');

  await requestError(
    studioBaseUrl,
    API_PATHS.postsCreate,
    'anonymous post create',
    401,
    'unauthorized',
    {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ contextKind: 'space', contextId: studioSpaceId, body: 'unauthorized probe' }),
    },
  );
  console.log('public-authz-e2e: read-only public space and thread OK');
};

const runCourseJourney = async (page: Page, studioBaseUrl: string): Promise<void> => {
  await page.goto(`${studioBaseUrl}/my/courses/${publicCourseId}`, { waitUntil: 'domcontentloaded' });
  await page.getByTestId('anon-course-program').waitFor({ state: 'visible', timeout: 15000 });

  const preview = page.getByTestId(`lesson-button-${previewLessonId}`);
  await preview.waitFor({ state: 'visible' });
  assert(await preview.isEnabled(), 'preview lesson was disabled in the public course program');
  await expectHref(
    page,
    `lesson-button-${previewLessonId}`,
    `/my/courses/${publicCourseId}/lessons/${previewLessonId}`,
  );

  const locked = page.getByTestId(`lesson-button-${lockedLessonId}`);
  await locked.waitFor({ state: 'visible' });
  assert(await locked.isDisabled(), 'non-preview lesson was enabled in the public course program');
  const unlockHref = await page.getByTestId(`unlock-lesson-${lockedLessonId}`).getAttribute('href');
  assert(
    unlockHref?.startsWith('/checkout/') === true,
    `non-preview lesson did not link to checkout: ${String(unlockHref)}`,
  );

  const structure = await requestOk(
    studioBaseUrl,
    API_PATHS.publicCourseStructure.replace(':courseId', publicCourseId),
    'Studio public course structure',
    courseStructureOutputSchema,
  );
  const lessons = structure.structure.modules.flatMap((module) =>
    module.chapters.flatMap((chapter) => chapter.lessons),
  );
  assert(
    lessons.find(({ lessonId }) => lessonId === previewLessonId)?.accessStatus === 'fully-accessible',
    'preview lesson was not fully accessible in the public course API',
  );
  assert(
    lessons.find(({ lessonId }) => lessonId === lockedLessonId)?.accessStatus === 'not-accessible',
    'non-preview lesson was not locked in the public course API',
  );

  await page.goto(
    `${studioBaseUrl}/my/courses/${publicCourseId}/lessons/${previewLessonId}`,
    { waitUntil: 'domcontentloaded' },
  );
  await page.getByTestId('lesson-html').waitFor({ state: 'visible', timeout: 15000 });

  await page.goto(
    `${studioBaseUrl}/my/courses/${publicCourseId}/lessons/${lockedLessonId}`,
    { waitUntil: 'domcontentloaded' },
  );
  await page.waitForURL((url) => url.pathname === '/login', { timeout: 15000 });
  console.log('public-authz-e2e: public course preview and locked lessons OK');
};

const runBoundaryJourney = async (studioBaseUrl: string, akademiaBaseUrl: string): Promise<void> => {
  const studioNotFoundPaths = [
    API_PATHS.publicCourseStructure.replace(':courseId', hiddenCourseId),
    API_PATHS.publicSpaceFeed.replace(':spaceId', privateSpaceId),
    API_PATHS.publicSpaceThread.replace(':spaceId', privateSpaceId).replace(':postId', privateThreadId),
    API_PATHS.publicSpaceEvents.replace(':spaceId', privateSpaceId),
  ];
  for (const path of studioNotFoundPaths) {
    await requestError(studioBaseUrl, path, `hidden Studio resource ${path}`, 404, 'not_found');
  }

  await requestError(
    studioBaseUrl,
    API_PATHS.spaceFeed.replace(':spaceId', privateSpaceId),
    'member-only private space feed',
    401,
    'unauthorized',
  );
  await requestError(
    studioBaseUrl,
    API_PATHS.studentLesson.replace(':lessonId', lockedLessonId),
    'member-only non-preview lesson',
    401,
    'unauthorized',
  );

  const akademiaLabel = 'Akademia public navigation';
  const akademiaRaw = await requestRaw(akademiaBaseUrl, API_PATHS.publicNavigation, akademiaLabel);
  parseOk(akademiaRaw, akademiaLabel, publicNavigationOutputSchema);
  for (const studioId of [
    'tenant-studio',
    publicCourseId,
    hiddenCourseId,
    studioSpaceId,
    privateSpaceId,
    'product-js-full',
  ]) {
    assert(!akademiaRaw.includes(studioId), `Akademia public navigation exposed ${studioId}`);
  }

  for (const path of [
    API_PATHS.publicCourseStructure.replace(':courseId', publicCourseId),
    API_PATHS.publicSpaceFeed.replace(':spaceId', studioSpaceId),
    API_PATHS.publicSpaceThread.replace(':spaceId', studioSpaceId).replace(':postId', publicThreadId),
    API_PATHS.publicSpaceEvents.replace(':spaceId', studioSpaceId),
  ]) {
    await requestError(akademiaBaseUrl, path, `cross-tenant Akademia resource ${path}`, 404, 'not_found');
  }
  console.log('public-authz-e2e: hidden-resource and tenant-isolation boundaries OK');
};

const startedAt = Date.now();
let server: ChildProcess | null = null;
let browser: Browser | null = null;
try {
  console.log('public-authz-e2e: preparing isolated database...');
  await setupDatabase(baseDatabaseUrl);
  await migrateSeedAndEnablePreview(e2eDatabaseUrl);
  console.log('public-authz-e2e: building the web SPA...');
  await buildWeb();
  const port = await ephemeralPort();
  const connectUrl = `http://127.0.0.1:${port}`;
  const studioBaseUrl = `http://studio.localhost:${port}`;
  const akademiaBaseUrl = `http://akademia.localhost:${port}`;
  console.log(`public-authz-e2e: booting server on port ${port}...`);
  server = await bootServer({
    port,
    healthUrl: `${connectUrl}/api/health`,
    env: {
      DATABASE_URL: e2eDatabaseUrl,
      APP_BASE_URL: studioBaseUrl,
      APP_BASE_DOMAIN: 'localhost',
      WEB_DIST_DIR: 'dist/web',
      AUTH_DEV_EXPOSE_MAGIC_LINKS: 'true',
      EMAIL_PROVIDER: 'dev',
      SIMULATED_PAYMENTS: 'true',
    },
  });

  browser = await chromium.launch(
    chromeExecutablePath
      ? { executablePath: chromeExecutablePath, headless: true }
      : { channel: 'chrome', headless: true },
  );
  const context = await browser.newContext();
  await context.addInitScript(() => {
    window.localStorage.setItem('together-language', 'pl');
  });
  const page = await context.newPage();
  page.on('pageerror', (error) => console.log(`  [browser:pageerror] ${error.message}`));

  await runHomeJourney(page, studioBaseUrl);
  await runReadOnlyCommunityJourney(page, studioBaseUrl);
  await runCourseJourney(page, studioBaseUrl);
  await runBoundaryJourney(studioBaseUrl, akademiaBaseUrl);
  await context.close();
  console.log(`\npublic-authz-e2e: PASS (${((Date.now() - startedAt) / 1000).toFixed(1)}s)`);
} catch (error) {
  const message = error instanceof E2eFailure ? error.message : String(error);
  console.error(`\npublic-authz-e2e: FAIL\n${message}`);
  process.exitCode = 1;
} finally {
  if (server) await killServer(server);
  if (browser) await browser.close();
  rmSync(webDistDir, { recursive: true, force: true });
  await dropDatabase(baseDatabaseUrl);
}
