import type { ChildProcess } from 'node:child_process';
import { rmSync } from 'node:fs';
import { join } from 'node:path';

import pg from 'pg';
import { chromium, type Browser } from 'playwright-core';

import { uniqueTestDatabaseName } from '#adapters/db/test-database-name.js';
import {
  API_PATHS,
  devEmailOutputSchema,
  envelopeSchema,
  meOutputSchema,
} from '#core/contract/index.js';
import { SMOKE_TENANT_CREATOR_EMAIL } from '#core/domain/index.js';

import { en } from '../apps/web/src/i18n/en.js';
import { assertSafeE2eDatabaseReset, resolveE2eDatabaseUrl } from './e2e-config.js';
import { signInWithPassword } from './login-flow.js';
import {
  bootServer, delay, ephemeralPort, killServer, rootDir, run, tsxBin,
} from './server-harness.js';

const databaseName = uniqueTestDatabaseName('together_team_admins_e2e');
const baseDatabaseUrl = resolveE2eDatabaseUrl(process.env);
assertSafeE2eDatabaseReset(baseDatabaseUrl, databaseName, process.env);
const databaseUrl = new URL(baseDatabaseUrl);
databaseUrl.pathname = `/${databaseName}`;
const webDistDir = join(rootDir, 'dist', `team-admins-e2e-${process.pid}`);
const chromeExecutablePath = process.env['PLAYWRIGHT_CHROME_EXECUTABLE_PATH'];
const inviteeEmail = 'team-admin-e2e@together.dev';

function assert(condition: boolean, message: string): asserts condition {
  if (!condition) throw new Error(message);
}

const runDatabaseCommand = async (statement: string): Promise<void> => {
  const client = new pg.Client({ connectionString: baseDatabaseUrl });
  try {
    await client.connect();
    await client.query(statement);
  } finally {
    await client.end();
  }
};

const readInvitationLink = async (connectUrl: string, webBaseUrl: string): Promise<string> => {
  const deadline = Date.now() + 10000;
  while (Date.now() < deadline) {
    const response = await fetch(new URL(
      `${API_PATHS.devEmail}?to=${encodeURIComponent(inviteeEmail)}`, connectUrl,
    ));
    assert(response.ok, `Dev email sink failed (HTTP ${response.status})`);
    const envelope = envelopeSchema(devEmailOutputSchema).parse(await response.json());
    assert(envelope.ok, 'Dev email sink returned an error');
    const candidate = envelope.data.email?.text.match(/https?:\/\/\S+/)?.[0];
    if (candidate !== undefined) {
      const url = new URL(candidate);
      assert(url.origin === webBaseUrl, 'Invitation link used the wrong workspace origin');
      assert(url.pathname === '/api/auth/magic-link/verify', 'Invitation did not contain a magic link');
      return candidate;
    }
    await delay(100);
  }
  throw new Error('Invitation email did not reach the dev sink');
};

const runInvitationJourney = async (
  browser: Browser,
  connectUrl: string,
  webBaseUrl: string,
): Promise<void> => {
  const owner = await browser.newContext();
  const invitee = await browser.newContext();
  for (const context of [owner, invitee]) {
    await context.addInitScript(() => window.localStorage.setItem('together-language', 'en'));
    await context.route('**/*', async (route) => {
      const url = new URL(route.request().url());
      if (url.origin === webBaseUrl) await route.continue();
      else await route.abort();
    });
  }
  const ownerPage = await owner.newPage();
  await ownerPage.goto(`${webBaseUrl}/login`, { waitUntil: 'networkidle' });
  await signInWithPassword(ownerPage, SMOKE_TENANT_CREATOR_EMAIL, 'demo-password-15');
  await ownerPage.waitForURL('**/start', { timeout: 15000 });
  await ownerPage.goto(`${webBaseUrl}/panel/settings#team`, { waitUntil: 'networkidle' });
  const team = ownerPage.getByTestId('team-settings');
  await team.waitFor({ state: 'visible', timeout: 15000 });
  await team.getByLabel(en.auth.emailLabel, { exact: true }).fill(inviteeEmail);
  await team.getByRole('button', { name: en.common.add, exact: true }).click();
  const invitedRow = team.getByRole('row').filter({ hasText: inviteeEmail });
  await invitedRow.getByText(en.tenantTeam.invitationSent, { exact: true }).waitFor({
    state: 'visible', timeout: 15000,
  });
  const invitationLink = await readInvitationLink(connectUrl, webBaseUrl);

  const page = await invitee.newPage();
  await page.goto(invitationLink, { waitUntil: 'networkidle' });
  await page.waitForURL((url) => !url.pathname.startsWith('/api/auth/'), { timeout: 15000 });
  const meResponse = await invitee.request.get(`${webBaseUrl}${API_PATHS.me}`);
  assert(meResponse.status() === 200, `Invitee session failed (HTTP ${meResponse.status()})`);
  const me = envelopeSchema(meOutputSchema).parse(await meResponse.json());
  assert(me.ok, 'Invitee identity returned an error');
  assert(me.data.email === inviteeEmail, 'Magic link signed in the wrong user');
  assert(me.data.tenant?.slug === 'acme', 'Magic link resolved the wrong workspace');
  assert(me.data.tenant?.staffRole === 'admin', 'Invitation did not activate administrator access');
  assert(me.data.tenantAccess === 'staff', 'Invitee did not receive staff access');

  await page.goto(`${webBaseUrl}/panel`, { waitUntil: 'networkidle' });
  await page.getByTestId('tenant-name').waitFor({ state: 'visible', timeout: 15000 });
  await page.getByTestId('section-sales').click();
  await page.getByTestId('sales-list').waitFor({ state: 'visible', timeout: 15000 });
  const ownerOnly = await invitee.request.get(`${webBaseUrl}${API_PATHS.tenantTeam}`);
  assert(ownerOnly.status() === 403, 'Administrator received owner-only team access');

  await ownerPage.reload({ waitUntil: 'networkidle' });
  await invitedRow.getByText(en.tenantTeam.administrator, { exact: true }).waitFor({
    state: 'visible', timeout: 15000,
  });
  await invitee.close();
  await owner.close();
  console.log('team-admins-e2e: invitation, magic-link activation and Studio administrator access OK');
};

const startedAt = Date.now();
let server: ChildProcess | null = null;
let browser: Browser | null = null;
let databaseCreated = false;
try {
  console.log('team-admins-e2e: preparing isolated database...');
  await runDatabaseCommand(`CREATE DATABASE ${pg.escapeIdentifier(databaseName)}`);
  databaseCreated = true;
  for (const script of ['adapters/db/migrate.ts', 'adapters/db/seed.ts']) {
    const result = await run(tsxBin, [script], { DATABASE_URL: databaseUrl.toString() });
    assert(result.code === 0, `${script} failed:\n${result.stdout}${result.stderr}`);
  }
  console.log('team-admins-e2e: building the web SPA...');
  const build = await run(join(rootDir, 'node_modules/.bin/vite'), [
    'build', '--config', 'apps/web/vite.config.ts', '--outDir', webDistDir,
  ]);
  assert(build.code === 0, `Web build failed:\n${build.stdout}${build.stderr}`);
  const port = await ephemeralPort();
  const connectUrl = `http://127.0.0.1:${port}`;
  const webBaseUrl = `http://acme.localhost:${port}`;
  server = await bootServer({
    port,
    healthUrl: `${connectUrl}/api/health`,
    env: {
      DATABASE_URL: databaseUrl.toString(),
      APP_BASE_URL: webBaseUrl,
      APP_BASE_DOMAIN: 'localhost',
      WEB_DIST_DIR: webDistDir,
      AUTH_DEV_EXPOSE_MAGIC_LINKS: 'true',
      EMAIL_PROVIDER: 'dev',
      SIMULATED_PAYMENTS: 'true',
    },
  });
  browser = await chromium.launch(chromeExecutablePath
    ? { executablePath: chromeExecutablePath, headless: true }
    : { channel: 'chrome', headless: true });
  await runInvitationJourney(browser, connectUrl, webBaseUrl);
  console.log(`team-admins-e2e: PASS (${((Date.now() - startedAt) / 1000).toFixed(1)}s)`);
} catch (error) {
  console.error(`team-admins-e2e: FAIL\n${String(error)}`);
  process.exitCode = 1;
} finally {
  if (browser) await browser.close();
  if (server) await killServer(server);
  rmSync(webDistDir, { recursive: true, force: true });
  if (databaseCreated) {
    await runDatabaseCommand(`DROP DATABASE ${pg.escapeIdentifier(databaseName)} WITH (FORCE)`);
  }
}
