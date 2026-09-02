import type { ChildProcess } from 'node:child_process';
import { rmSync } from 'node:fs';
import { join } from 'node:path';

import pg from 'pg';
import { chromium, type Browser, type BrowserContext, type Locator, type Page } from 'playwright-core';

import { resolveE2eDatabaseUrl } from './e2e-config.js';
import { requestMagicLink } from './login-flow.js';
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
const E2E_DB = 'together_e2e_member_shell';
const baseDatabaseUrl = resolveE2eDatabaseUrl(process.env);
const e2eUrlObject = new URL(baseDatabaseUrl);
e2eUrlObject.pathname = `/${E2E_DB}`;
const e2eDatabaseUrl = e2eUrlObject.toString();
const visible = { state: 'visible', timeout: 15000 } as const;

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
      `Could not prepare the member-shell database "${E2E_DB}". Is the dev Postgres up (pnpm run db:up)?\n${String(cause)}`,
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

const migrateAndSeed = async (databaseUrl: string): Promise<void> => {
  const migrate = await run(tsxBin, ['adapters/db/migrate.ts'], { DATABASE_URL: databaseUrl });
  assert(migrate.code === 0, `Migration failed:\n${migrate.stdout}${migrate.stderr}`);
  const seed = await run(tsxBin, ['adapters/db/seed.ts'], { DATABASE_URL: databaseUrl });
  assert(seed.code === 0, `Seed failed:\n${seed.stdout}${seed.stderr}`);
};

const buildWeb = async (): Promise<void> => {
  const build = await run(viteBin, ['build', '--config', 'apps/web/vite.config.ts'], {});
  assert(build.code === 0, `Web build failed:\n${build.stdout}${build.stderr}`);
};

const setEnglish = async (context: BrowserContext): Promise<void> => {
  await context.addInitScript(() => {
    window.localStorage.setItem('together-language', 'en');
  });
};

const signInMember = async (page: Page, baseUrl: string): Promise<void> => {
  await page.goto(`${baseUrl}/login`, { waitUntil: 'domcontentloaded' });
  await requestMagicLink(page, 'kursant.aktywny@together.dev');
  const sent = page.getByTestId('magic-link-sent');
  await sent.waitFor(visible);
  const link = sent.locator('a[href]').first();
  await link.waitFor(visible);
  const href = await link.getAttribute('href');
  assert(href !== null && href.length > 0, 'No development magic link was exposed for the member');
  await page.goto(href, { waitUntil: 'domcontentloaded' });
  await page.waitForURL(/\/(?:my|start)(?:[/?#]|$)/, { timeout: 15000 });
};

const assertHref = async (locator: Locator, expected: string, label: string): Promise<void> => {
  const href = await locator.getAttribute('href');
  assert(href === expected, `${label}: expected href ${expected}, got ${String(href)}`);
};

const assertText = async (locator: Locator, expected: string, label: string): Promise<void> => {
  const content = (await locator.textContent())?.trim() ?? '';
  assert(content.includes(expected), `${label}: expected text containing "${expected}", got "${content}"`);
};

const assertSelected = async (locator: Locator, label: string): Promise<void> => {
  const classes = await locator.getAttribute('class');
  assert(classes?.includes('Mui-selected') === true, `${label}: expected the row to be selected`);
};

const runMobileStartAndSearchJourney = async (page: Page, baseUrl: string): Promise<void> => {
  await page.goto(`${baseUrl}/start`, { waitUntil: 'domcontentloaded' });
  const continueCard = page.getByTestId('start-continue');
  await continueCard.waitFor(visible);

  const bottomNav = page.getByTestId('member-bottom-nav');
  await bottomNav.waitFor(visible);
  const tabs = bottomNav.locator(':scope > *');
  assert(await tabs.count() === 3, `Mobile bottom navigation contained ${String(await tabs.count())} tabs instead of 3`);
  await assertHref(page.getByTestId('member-tab-start'), '/start', 'Start tab');
  await assertHref(page.getByTestId('member-tab-search'), '/search', 'Search tab');
  assert(await page.getByTestId('member-tab-menu').count() === 1, 'Menu tab was missing');

  const continueCta = page.getByTestId('start-continue-cta');
  await assertHref(
    continueCta,
    '/my/courses/course-js/lessons/lesson-js-funkcje-1',
    'Start continue CTA',
  );
  await assertText(page.getByTestId('course-progress-course-js'), '25%', 'Course progress');
  await assertHref(
    page.getByTestId('locked-space-cta-space-studio-klub-react'),
    '/checkout/product-react-full',
    'Locked React space CTA',
  );

  await page.getByTestId('member-tab-search').click();
  await page.waitForURL('**/search');
  const searchInput = page.getByTestId('search-input');
  await searchInput.waitFor(visible);
  await searchInput.fill('konsol');
  await page.getByTestId('search-hit-post-js-zmienne-tip').waitFor(visible);
  console.log('member-shell-e2e: mobile Start, sales surface, and search journey OK');
};

const runMobileMenuJourney = async (page: Page): Promise<void> => {
  await page.getByTestId('member-tab-menu').click();
  const sheet = page.getByTestId('member-menu-sheet');
  await sheet.waitFor(visible);

  assert(await sheet.getByTestId('sidebar-start').count() === 0, 'Menu sheet repeated the Start tab-bar destination');
  assert(await sheet.getByTestId('sidebar-search').count() === 0, 'Menu sheet repeated the Search tab-bar destination');
  await assertHref(
    sheet.getByTestId('sidebar-space-space-studio-spolecznosc'),
    '/community/space-studio-spolecznosc',
    'Menu space row',
  );
  await assertHref(
    sheet.getByTestId('sidebar-course-course-js'),
    '/my/courses/course-js',
    'Menu course row',
  );
  await assertHref(
    sheet.getByTestId('sidebar-locked-space-studio-klub-react'),
    '/checkout/product-react-full',
    'Menu locked-space row',
  );
  await assertHref(sheet.getByTestId('sidebar-products'), '/my/products', 'Menu products row');
  await assertHref(sheet.getByTestId('sidebar-messages'), '/messages', 'Menu messages row');
  await assertHref(sheet.getByTestId('sidebar-account'), '/account', 'Menu account row');
  await assertHref(sheet.getByTestId('member-identity'), '/account', 'Menu identity row');
  assert(await sheet.getByTestId('notification-nav').count() === 0, 'Menu sheet duplicated the notification row');

  await sheet.getByTestId('sidebar-products').click();
  await page.waitForURL('**/my/products');
  await sheet.waitFor({ state: 'detached', timeout: 15000 });

  await page.getByTestId('member-tab-start').click();
  await page.waitForURL('**/start');
  await page.getByTestId('start-continue').waitFor(visible);
  console.log('member-shell-e2e: unified mobile Menu sheet journey OK');
};

const runCourseSidebarJourney = async (page: Page): Promise<void> => {
  await page.getByTestId('start-continue-cta').click();
  await page.waitForURL('**/my/courses/course-js/lessons/lesson-js-funkcje-1');
  await page.getByTestId('program-button').waitFor(visible);
  await page.getByTestId('member-bottom-nav').waitFor(visible);

  await page.getByTestId('program-button').click();
  const sheet = page.getByTestId('course-program-sheet');
  await sheet.waitFor(visible);
  const courseSidebar = sheet.getByTestId('course-sidebar');
  await courseSidebar.waitFor(visible);
  await assertSelected(
    courseSidebar.getByTestId('lesson-button-lesson-js-funkcje-1'),
    'First lesson in Program sheet',
  );

  await courseSidebar.getByTestId('lesson-button-lesson-js-funkcje-2').click();
  await page.waitForURL('**/my/courses/course-js/lessons/lesson-js-funkcje-2');
  await sheet.waitFor({ state: 'detached', timeout: 15000 });
  await page.getByTestId('program-button').click();
  const reopened = page.getByTestId('course-program-sheet');
  await reopened.waitFor(visible);
  await assertSelected(
    reopened.getByTestId('lesson-button-lesson-js-funkcje-2'),
    'Second lesson in reopened Program sheet',
  );
  await reopened.getByTestId('course-program-sheet-close').click();
  await reopened.waitFor({ state: 'detached', timeout: 15000 });
  console.log('member-shell-e2e: mobile course Program sheet journey OK');
};

const runDesktopSwapJourney = async (page: Page): Promise<void> => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.getByTestId('member-bottom-nav').waitFor({ state: 'detached', timeout: 15000 });
  await page.getByTestId('program-button').waitFor({ state: 'detached', timeout: 15000 });

  const courseSidebar = page.getByTestId('course-sidebar');
  await courseSidebar.waitFor(visible);
  await assertSelected(
    courseSidebar.getByTestId('lesson-button-lesson-js-funkcje-2'),
    'Second lesson in desktop course sidebar',
  );
  await courseSidebar.getByTestId('course-sidebar-back').click();
  await page.waitForURL('**/start');

  const memberSidebar = page.getByTestId('member-sidebar');
  await memberSidebar.waitFor(visible);
  assert(
    await memberSidebar.getByTestId('sidebar-start').getAttribute('aria-current') === 'page',
    'Desktop Start row was not active after leaving the course sidebar',
  );
  assert(await page.getByTestId('member-bottom-nav').count() === 0, 'Desktop retained the mobile bottom navigation');
  assert(await page.getByTestId('program-button').count() === 0, 'Desktop retained the mobile Program button');
  console.log('member-shell-e2e: desktop sidebar swap and return journey OK');
};

const startedAt = Date.now();
let server: ChildProcess | null = null;
let browser: Browser | null = null;

try {
  console.log('member-shell-e2e: preparing isolated database...');
  await setupDatabase(baseDatabaseUrl);
  await migrateAndSeed(e2eDatabaseUrl);
  console.log('member-shell-e2e: building the web SPA...');
  await buildWeb();

  const port = await ephemeralPort();
  const connectUrl = `http://127.0.0.1:${port}`;
  const studioBaseUrl = `http://studio.localhost:${port}`;
  console.log(`member-shell-e2e: booting server on port ${String(port)}...`);
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
  const context = await browser.newContext({ viewport: { width: 390, height: 844 } });
  await setEnglish(context);
  const page = await context.newPage();
  page.on('pageerror', (error) => console.log(`  [browser:pageerror] ${error.message}`));

  await signInMember(page, studioBaseUrl);
  await runMobileStartAndSearchJourney(page, studioBaseUrl);
  await runMobileMenuJourney(page);
  await runCourseSidebarJourney(page);
  await runDesktopSwapJourney(page);
  await context.close();
  console.log(`\nmember-shell-e2e: PASS (${((Date.now() - startedAt) / 1000).toFixed(1)}s)`);
} catch (error) {
  const message = error instanceof E2eFailure ? error.message : String(error);
  console.error(`\nmember-shell-e2e: FAIL\n${message}`);
  process.exitCode = 1;
} finally {
  if (server) await killServer(server);
  if (browser) await browser.close();
  rmSync(webDistDir, { recursive: true, force: true });
  await dropDatabase(baseDatabaseUrl);
}
