import type { ChildProcess } from 'node:child_process';
import { rmSync } from 'node:fs';
import { join } from 'node:path';

import pg from 'pg';
import { chromium, type Browser, type BrowserContext, type Page } from 'playwright-core';

import { API_PATHS, looseEnvelopeSchema } from '#core/contract/index.js';

import { resolveE2eDatabaseUrl } from './e2e-config.js';
import { signInWithPassword } from './login-flow.js';
import { bootServer, ephemeralPort, killServer, rootDir, run, tsxBin } from './server-harness.js';

const viteBin = join(rootDir, 'node_modules/.bin/vite');
const webDistDir = join(rootDir, 'dist/web');
const chromeExecutablePath = process.env['PLAYWRIGHT_CHROME_EXECUTABLE_PATH'];
const E2E_DB = 'together_e2e_impersonation';
const baseDatabaseUrl = resolveE2eDatabaseUrl(process.env);
const e2eUrlObject = new URL(baseDatabaseUrl);
e2eUrlObject.pathname = `/${E2E_DB}`;
const e2eDatabaseUrl = e2eUrlObject.toString();
const visible = { state: 'visible', timeout: 15000 } as const;

const subjectMemberId = 'member-studio-aktywny';
const studioSpaceId = 'space-studio-spolecznosc';
const DM_SENDER = 'Nadawca Prywatny';
const DM_SNIPPET = 'sekret z prywatnej wiadomosci';

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
      `Could not prepare the impersonation database "${E2E_DB}". Is the dev Postgres up (pnpm run db:up)?\n${String(cause)}`,
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

const seedDmNotification = async (databaseUrl: string): Promise<number> => {
  const client = new pg.Client({ connectionString: databaseUrl });
  await client.connect();
  try {
    const subject = await client.query<{ tenant_id: string; user_id: string }>(
      'select tenant_id, user_id from members where id = $1',
      [subjectMemberId],
    );
    const row = subject.rows[0];
    assert(row !== undefined, `Seed has no member "${subjectMemberId}".`);
    await client.query(
      `insert into notifications (id, tenant_id, recipient_user_id, kind, payload, source_key, read_at, created_at)
       values ($1, $2, $3, 'dm-message', $4::jsonb, null, null, $5)`,
      [
        'notification-e2e-dm',
        row.tenant_id,
        row.user_id,
        JSON.stringify({
          rootPostId: 'dm-e2e',
          postId: 'dm-e2e',
          contextKind: 'dm',
          contextId: 'conversation-e2e',
          courseId: null,
          eventId: null,
          lessonName: DM_SENDER,
          authorDisplay: DM_SENDER,
          authorAvatarUrl: null,
          snippet: DM_SNIPPET,
        }),
        new Date().toISOString(),
      ],
    );
    const unread = await client.query<{ count: string }>(
      `select count(*) as count from notifications
       where tenant_id = $1 and recipient_user_id = $2 and read_at is null and kind <> 'dm-message'`,
      [row.tenant_id, row.user_id],
    );
    return Number(unread.rows[0]?.count ?? '0');
  } finally {
    await client.end();
  }
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

interface BrowserResponse {
  status: number;
  raw: string;
}

const browserRequest = async (
  page: Page,
  path: string,
  init: { method?: string; body?: string } = {},
): Promise<BrowserResponse> =>
  page.evaluate(
    async ({ requestPath, requestInit }) => {
      const response = await fetch(requestPath, {
        ...requestInit,
        credentials: 'same-origin',
        headers: requestInit.body === undefined ? {} : { 'content-type': 'application/json' },
      });
      return { status: response.status, raw: await response.text() };
    },
    { requestPath: path, requestInit: init },
  );

const assertRejected = async (
  page: Page,
  path: string,
  label: string,
  init: { method?: string; body?: string } = {},
): Promise<void> => {
  const response = await browserRequest(page, path, init);
  assert(response.status === 403, `${label}: expected HTTP 403, got ${String(response.status)}.\n${response.raw}`);
  const envelope = looseEnvelopeSchema.parse(JSON.parse(response.raw));
  assert(
    !envelope.ok && envelope.error.code === 'impersonation_read_only',
    `${label}: expected the impersonation_read_only code.\n${response.raw}`,
  );
};

const signInCreator = async (page: Page, baseUrl: string): Promise<void> => {
  await page.goto(`${baseUrl}/login`, { waitUntil: 'domcontentloaded' });
  await signInWithPassword(page, 'creator@together.dev', 'demo-password-15');
  await page.getByTestId('tenant-name').waitFor(visible);
};

const enterMemberView = async (page: Page, baseUrl: string): Promise<void> => {
  await page.goto(`${baseUrl}/panel/members/${subjectMemberId}`, { waitUntil: 'domcontentloaded' });
  await page.getByTestId('member-view-as').waitFor(visible);
  await page.getByTestId('member-view-as').click();
  await page.getByTestId('member-view-as-dialog').waitFor(visible);
  await page.getByTestId('member-view-as-reason').fill('E2E support check');
  await page.getByTestId('member-view-as-confirm').click();
  await page.waitForURL('**/start', { timeout: 20000 });
  console.log('impersonation-e2e: entered the member view from the Studio profile OK');
};

const watchRefusedRequests = (page: Page): string[] => {
  const refused: string[] = [];
  page.on('response', (response) => {
    const url = new URL(response.url());
    if (response.status() === 403 && url.pathname.startsWith('/api/')) {
      refused.push(`${response.request().method()} ${url.pathname}`);
    }
  });
  return refused;
};

const runReadOnlyJourney = async (
  page: Page,
  baseUrl: string,
  expectedUnread: number,
): Promise<void> => {
  const refused = watchRefusedRequests(page);
  const banner = page.getByTestId('impersonation-banner');
  await banner.waitFor(visible);
  const bannerText = (await banner.textContent())?.trim() ?? '';
  assert(bannerText.includes('Viewing as'), `Banner did not name the impersonated member: "${bannerText}"`);

  await page.getByTestId('start-continue').waitFor(visible);
  await page.goto(`${baseUrl}/my/courses/course-js`, { waitUntil: 'domcontentloaded' });
  await page.getByTestId('impersonation-banner').waitFor(visible);

  await page.getByTestId('continue-cta').click();
  await page.getByTestId('lesson-block-0').waitFor(visible);
  assert(
    await page.locator('.MuiAlert-colorError').count() === 0,
    'The lesson player raised an error alert while viewing as a member',
  );

  await page.goto(`${baseUrl}/community/${studioSpaceId}`, { waitUntil: 'domcontentloaded' });
  await page.getByTestId('impersonation-banner').waitFor(visible);
  assert(
    await page.getByTestId('space-composer').count() === 0,
    'The space composer stayed visible while viewing as a member',
  );
  assert(
    await page.getByTestId('sidebar-messages').count() === 0,
    'The direct-message entry point stayed visible while viewing as a member',
  );
  assert(
    await page.locator('[data-testid^="start-message-"]').count() === 0,
    'The "message the author" entry point stayed visible on the space feed while viewing as a member',
  );

  await page.goto(`${baseUrl}/account`, { waitUntil: 'domcontentloaded' });
  await page.getByTestId('impersonation-banner').waitFor(visible);
  await page.getByTestId('account-email').waitFor(visible);
  assert(
    await page.getByTestId('account-dm-privacy').count() === 0,
    'The direct-message privacy switch stayed visible while viewing as a member',
  );
  assert(
    await page.getByTestId('account-data-export').count() === 0,
    'The personal-data export stayed offered while viewing as a member',
  );
  assert(
    refused.length === 0,
    `The member pages fired requests the guard refused while viewing as a member: ${refused.join(', ')}`,
  );
  console.log('impersonation-e2e: read-only member pages render without write affordances OK');

  await assertRejected(
    page,
    API_PATHS.memberDataExport,
    'personal-data export under impersonation',
  );
  await assertRejected(page, API_PATHS.postsCreate, 'post creation under impersonation', {
    method: 'POST',
    body: JSON.stringify({ contextKind: 'space', contextId: studioSpaceId, body: 'E2E must not post' }),
  });
  await assertRejected(page, API_PATHS.messagesList, 'direct-message list under impersonation');
  await assertRejected(page, API_PATHS.messagesUnread, 'direct-message unread count under impersonation');
  console.log('impersonation-e2e: mutations and direct messages rejected server-side OK');

  const notifications = await browserRequest(page, API_PATHS.notifications);
  assert(
    !notifications.raw.includes('dm-message') && !notifications.raw.includes(DM_SNIPPET),
    `A direct-message notification leaked into the bell while viewing as a member:\n${notifications.raw}`,
  );
  const unread = await browserRequest(page, API_PATHS.notificationsUnread);
  assert(
    unread.raw.includes(`"unread":${String(expectedUnread)}`),
    `The unread badge counted a direct-message notification while viewing as a member:\n${unread.raw}`,
  );

  await page.goto(`${baseUrl}/notifications`, { waitUntil: 'domcontentloaded' });
  await page.getByTestId('impersonation-banner').waitFor(visible);
  const notificationsPage = (await page.locator('body').textContent()) ?? '';
  assert(
    !notificationsPage.includes(DM_SNIPPET) && !notificationsPage.includes(DM_SENDER),
    'The notifications page rendered direct-message content while viewing as a member',
  );
  console.log('impersonation-e2e: direct-message notifications hidden from list and count OK');
};

const leaveMemberView = async (page: Page, baseUrl: string): Promise<void> => {
  await page.getByTestId('impersonation-exit').click();
  await page.waitForURL('**/panel/members', { timeout: 20000 });
  assert(
    await page.getByTestId('impersonation-banner').count() === 0,
    'The impersonation banner survived the exit',
  );

  const log = page.getByTestId('impersonation-log');
  await log.waitFor(visible);
  const entries = (await log.textContent())?.trim() ?? '';
  assert(entries.includes('Started'), `Audit log is missing the start entry: "${entries}"`);
  assert(entries.includes('Ended'), `Audit log is missing the exit entry: "${entries}"`);
  assert(entries.includes('E2E support check'), `Audit log dropped the reason: "${entries}"`);

  await page.goto(`${baseUrl}/panel/members/${subjectMemberId}`, { waitUntil: 'domcontentloaded' });
  await page.getByTestId('member-view-as').waitFor(visible);
  console.log('impersonation-e2e: exit restores the Studio session and writes the audit trail OK');
};

const startedAt = Date.now();
let server: ChildProcess | null = null;
let browser: Browser | null = null;

try {
  console.log('impersonation-e2e: preparing isolated database...');
  await setupDatabase(baseDatabaseUrl);
  await migrateAndSeed(e2eDatabaseUrl);
  const expectedUnread = await seedDmNotification(e2eDatabaseUrl);
  console.log('impersonation-e2e: building the web SPA...');
  await buildWeb();

  const port = await ephemeralPort();
  const connectUrl = `http://127.0.0.1:${port}`;
  const studioBaseUrl = `http://studio.localhost:${port}`;
  console.log(`impersonation-e2e: booting server on port ${String(port)}...`);
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
  const context = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  await setEnglish(context);
  const page = await context.newPage();
  page.on('pageerror', (error) => console.log(`  [browser:pageerror] ${error.message}`));

  await signInCreator(page, studioBaseUrl);
  await enterMemberView(page, studioBaseUrl);
  await runReadOnlyJourney(page, studioBaseUrl, expectedUnread);
  await leaveMemberView(page, studioBaseUrl);
  await context.close();
  console.log(`\nimpersonation-e2e: PASS (${((Date.now() - startedAt) / 1000).toFixed(1)}s)`);
} catch (error) {
  const message = error instanceof E2eFailure ? error.message : String(error);
  console.error(`\nimpersonation-e2e: FAIL\n${message}`);
  process.exitCode = 1;
} finally {
  if (server) await killServer(server);
  if (browser) await browser.close();
  rmSync(webDistDir, { recursive: true, force: true });
  await dropDatabase(baseDatabaseUrl);
}
