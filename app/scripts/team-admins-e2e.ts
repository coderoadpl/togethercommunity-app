import type { ChildProcess } from 'node:child_process';
import { rmSync } from 'node:fs';
import { join } from 'node:path';

import pg from 'pg';
import { chromium, type Browser } from 'playwright-core';

import {
  AUTH_EMAIL_VERIFICATION_PATH, AUTH_MAGIC_LINK_VERIFICATION_PATH, createAuthE2eClient,
} from '#adapters/auth/e2e-http.js';
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
const passwordInviteeEmail = 'team-admin-password-e2e@together.dev';
const verificationInviteeEmail = 'team-admin-verification-e2e@together.dev';

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

const readEmailLink = async (
  connectUrl: string,
  email: string,
  origins: readonly string[],
  path: string,
): Promise<string> => {
  const deadline = Date.now() + 10000;
  while (Date.now() < deadline) {
    const response = await fetch(new URL(
      `${API_PATHS.devEmail}?to=${encodeURIComponent(email)}`, connectUrl,
    ));
    assert(response.ok, `Dev email sink failed (HTTP ${response.status})`);
    const envelope = envelopeSchema(devEmailOutputSchema).parse(await response.json());
    assert(envelope.ok, 'Dev email sink returned an error');
    const candidate = envelope.data.email?.text.match(/https?:\/\/\S+/)?.[0];
    if (candidate !== undefined) {
      const url = new URL(candidate);
      assert(origins.includes(url.origin), 'Email link used an unexpected origin');
      assert(url.pathname === path, `Email did not contain the expected ${path} link`);
      return candidate;
    }
    await delay(100);
  }
  throw new Error(`Email for ${email} did not reach the dev sink`);
};

const runInvitationJourney = async (
  browser: Browser,
  connectUrl: string,
  webBaseUrl: string,
  platformBaseUrl: string,
): Promise<void> => {
  const owner = await browser.newContext();
  const invitee = await browser.newContext();
  const passwordInvitee = await browser.newContext();
  const mailboxOwner = await browser.newContext();
  const verificationInvitee = await browser.newContext();
  const verificationMailboxOwner = await browser.newContext();
  const contexts = [owner, invitee, passwordInvitee, mailboxOwner, verificationInvitee, verificationMailboxOwner];
  for (const context of contexts) {
    await context.addInitScript(() => window.localStorage.setItem('together-language', 'en'));
    await context.route('**/*', async (route) => {
      const url = new URL(route.request().url());
      if ([webBaseUrl, platformBaseUrl].includes(url.origin)) await route.continue();
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
  const invitationLink = await readEmailLink(
    connectUrl, inviteeEmail, [webBaseUrl], AUTH_MAGIC_LINK_VERIFICATION_PATH,
  );

  const page = await invitee.newPage();
  await page.goto(invitationLink, { waitUntil: 'networkidle' });
  await page.waitForURL((url) => url.pathname !== AUTH_MAGIC_LINK_VERIFICATION_PATH, { timeout: 15000 });
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

  for (const [email, mode, passwordContext, mailboxContext] of [
    [passwordInviteeEmail, 'magic-link', passwordInvitee, mailboxOwner],
    [verificationInviteeEmail, 'email-verification', verificationInvitee, verificationMailboxOwner],
  ] as const) {
    const passwordPage = await passwordContext.newPage();
    await passwordPage.goto(`${webBaseUrl}/register`, { waitUntil: 'networkidle' });
    await passwordPage.getByLabel(en.auth.nameLabel, { exact: true }).fill('Verification Invitee');
    await passwordPage.getByLabel(en.auth.emailLabel, { exact: true }).fill(email);
    await passwordPage.getByLabel(en.auth.passwordLabel, { exact: true }).fill('verification-password-15');
    await passwordPage.getByRole('button', { name: en.auth.createAccount, exact: true }).click();
    await passwordPage.getByRole('heading', { name: en.auth.registeredTitle, exact: true }).waitFor({
      state: 'visible', timeout: 15000,
    });
    const unverifiedResponse = await passwordContext.request.get(`${webBaseUrl}${API_PATHS.me}`);
    assert(unverifiedResponse.status() === 200, 'Password sign-up did not create a session');
    const unverified = envelopeSchema(meOutputSchema).parse(await unverifiedResponse.json());
    assert(unverified.ok, 'Password invitee identity returned an error');
    assert(unverified.data.email === email, 'Password sign-up used the wrong user');
    assert(!unverified.data.emailVerified, 'Password invitee was already verified');
    assert(unverified.data.tenant?.staffRole !== 'admin', 'Uninvited user already had administrator access');
    const verificationLink = await readEmailLink(
      connectUrl, email, [webBaseUrl, platformBaseUrl], AUTH_EMAIL_VERIFICATION_PATH,
    );

    await team.getByLabel(en.auth.emailLabel, { exact: true }).fill(email);
    await team.getByRole('button', { name: en.common.add, exact: true }).click();
    const passwordInvitedRow = team.getByRole('row').filter({ hasText: email });
    await passwordInvitedRow.getByText(en.tenantTeam.invitationSent, { exact: true }).waitFor({
      state: 'visible', timeout: 15000,
    });
    const passwordInvitationLink = await readEmailLink(
      connectUrl, email, [webBaseUrl], AUTH_MAGIC_LINK_VERIFICATION_PATH,
    );
    const pendingResponse = await passwordContext.request.get(`${webBaseUrl}${API_PATHS.me}`);
    const pending = envelopeSchema(meOutputSchema).parse(await pendingResponse.json());
    assert(pending.ok && pending.data.tenant?.staffRole !== 'admin', 'Unverified invitation activated early');

    const passwordAuth = createAuthE2eClient({
      connectUrl,
      origin: webBaseUrl,
      headers: { host: new URL(webBaseUrl).host },
    });
    const passwordCredentials = { email, password: 'verification-password-15' };
    const passwordBeforeVerification = await passwordAuth.signInEmail(passwordCredentials);
    assert(passwordBeforeVerification.status === 200, 'Pre-verification password sign-in failed');
    assert(passwordBeforeVerification.token !== null, 'Pre-verification password session was missing');
    const passwordSessionHeaders = { authorization: `Bearer ${passwordBeforeVerification.token}` };
    const passwordSessionResponse = await passwordContext.request.get(`${webBaseUrl}${API_PATHS.me}`, {
      headers: passwordSessionHeaders,
    });
    const passwordSession = envelopeSchema(meOutputSchema).parse(await passwordSessionResponse.json());
    assert(passwordSession.ok && passwordSession.data.tenant?.staffRole !== 'admin',
      'Pre-verification password sign-in activated administrator access');

    const callbackLink = mode === 'magic-link' ? passwordInvitationLink : verificationLink;
    const callbackPage = await mailboxContext.newPage();
    const callbackResponsePromise = callbackPage.waitForResponse((response) => response.url() === callbackLink);
    await callbackPage.goto(callbackLink, { waitUntil: 'networkidle' });
    const callbackResponse = await callbackResponsePromise;
    assert(callbackResponse.status() === 302, `${mode}: verification did not redirect`);
    const signupSessionResponse = await passwordContext.request.get(`${webBaseUrl}${API_PATHS.me}`);
    const oldPasswordSessionResponse = await passwordContext.request.get(`${webBaseUrl}${API_PATHS.me}`, {
      headers: passwordSessionHeaders,
    });
    const passwordAfterVerification = await passwordAuth.signInEmail(passwordCredentials);

    if (mode === 'magic-link') {
      assert(signupSessionResponse.status() === 401, 'Magic link retained the unverified sign-up session');
      assert(oldPasswordSessionResponse.status() === 401, 'Magic link retained the unverified password session');
      assert(passwordAfterVerification.status === 401, 'Magic link retained the unverified password credential');
      assert(passwordAfterVerification.token === null, 'Removed password credential created a new session');
      const verifiedResponse = await mailboxContext.request.get(`${webBaseUrl}${API_PATHS.me}`);
      assert(verifiedResponse.status() === 200, 'Magic-link session could not read tenant identity');
      const verified = envelopeSchema(meOutputSchema).parse(await verifiedResponse.json());
      assert(verified.ok, 'Magic-link invitee identity returned an error');
      assert(verified.data.email === email, 'Magic link signed in the wrong user');
      assert(verified.data.emailVerified, 'Magic link did not verify the email');
      assert(verified.data.tenant?.slug === 'acme', 'Magic link resolved the wrong workspace');
      assert(verified.data.tenant?.staffRole === 'admin', 'Magic link did not activate administrator access');
      assert(verified.data.tenantAccess === 'staff', 'Magic-link invitee did not receive staff access');
      const ownerOnlyResponse = await mailboxContext.request.get(`${webBaseUrl}${API_PATHS.tenantTeam}`);
      assert(ownerOnlyResponse.status() === 403, 'Magic-link administrator received owner-only team access');
    } else {
      assert(signupSessionResponse.status() === 200, 'Email verification revoked the sign-up session');
      assert(oldPasswordSessionResponse.status() === 200, 'Email verification revoked the password session');
      assert(passwordAfterVerification.status === 200, 'Email verification removed the password credential');
      assert(passwordAfterVerification.token !== null, 'Verified password sign-in did not create a session');
      for (const response of [signupSessionResponse, oldPasswordSessionResponse]) {
        const verified = envelopeSchema(meOutputSchema).parse(await response.json());
        assert(verified.ok && verified.data.emailVerified, 'Email verification did not verify the account');
        assert(verified.data.tenant?.staffRole !== 'admin', 'Email verification activated a pending invitation');
      }
      const newPasswordSessionResponse = await passwordContext.request.get(`${webBaseUrl}${API_PATHS.me}`, {
        headers: { authorization: `Bearer ${passwordAfterVerification.token}` },
      });
      const newPasswordSession = envelopeSchema(meOutputSchema).parse(await newPasswordSessionResponse.json());
      assert(newPasswordSession.ok && newPasswordSession.data.tenant?.staffRole !== 'admin',
        'Verified password sign-in activated a pending invitation');
    }
    await ownerPage.reload({ waitUntil: 'networkidle' });
    await passwordInvitedRow.getByText(
      mode === 'magic-link' ? en.tenantTeam.administrator : en.tenantTeam.invitationSent,
      { exact: true },
    ).waitFor({ state: 'visible', timeout: 15000 });
  }
  for (const context of contexts) await context.close();
  console.log('team-admins-e2e: magic-link invitation activation, scoped credential revocation, unchanged email verification and Studio access OK');
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
  const platformBaseUrl = `http://start.localhost:${port}`;
  server = await bootServer({
    port,
    healthUrl: `${connectUrl}/api/health`,
    env: {
      DATABASE_URL: databaseUrl.toString(),
      APP_BASE_URL: platformBaseUrl,
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
  await runInvitationJourney(browser, connectUrl, webBaseUrl, platformBaseUrl);
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
