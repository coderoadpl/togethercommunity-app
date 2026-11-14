import type { ChildProcess } from 'node:child_process';
import { rmSync } from 'node:fs';
import { join } from 'node:path';

import { generate } from 'otplib';
import pg from 'pg';
import { chromium, type Browser, type BrowserContext, type Locator, type Page } from 'playwright-core';
import { z } from 'zod';

import { AUTH_POLICY, BETTER_AUTH_TWO_FACTOR_TOTP_PATH } from '#adapters/auth/create-auth.js';
import { AUTH_GOOGLE_CALLBACK_PATH, AUTH_ONE_TAP_CALLBACK_PATH } from '#adapters/auth/e2e-http.js';
import { API_PATHS } from '#core/contract/index.js';
import { SMOKE_TENANT_CREATOR_EMAIL } from '#core/domain/index.js';

import { assertSafeE2eDatabaseReset, resolveE2eDatabaseUrl } from './e2e-config.js';
import {
  createGoogleSigner,
  GOOGLE_FAKE_FAILURE_MARKER,
  GOOGLE_FAKE_SERVER_ENTRY,
  GOOGLE_IDENTITY_SCRIPT_URL,
  googleFakeEnv,
  installGoogleBrowserFake,
  type GoogleBrowserFake,
} from './google-fake.js';
import { signInWithPassword } from './login-flow.js';
import {
  bootServer,
  delay,
  ephemeralPort,
  killServer,
  readServerOutput,
  rootDir,
  run,
  tsxBin,
} from './server-harness.js';

const viteBin = join(rootDir, 'node_modules/.bin/vite');
const webDistDir = join(rootDir, 'dist/web');
const chromeExecutablePath = process.env['PLAYWRIGHT_CHROME_EXECUTABLE_PATH'];
const E2E_DB = 'together_e2e_two_factor';
const baseDatabaseUrl = resolveE2eDatabaseUrl(process.env);
assertSafeE2eDatabaseReset(baseDatabaseUrl, E2E_DB, process.env);
const e2eUrlObject = new URL(baseDatabaseUrl);
e2eUrlObject.pathname = `/${E2E_DB}`;
const e2eDatabaseUrl = e2eUrlObject.toString();
const account = {
  email: SMOKE_TENANT_CREATOR_EMAIL,
  password: 'demo-password-15',
  tenantName: 'Acme Courses',
};
const visible = { state: 'visible', timeout: 15000 } as const;
const twoFactorRateLimitResetMilliseconds = 10_100;
const google = {
  clientId: 'two-factor-e2e-client-id',
  clientSecret: 'two-factor-e2e-client-secret',
  subject: 'two-factor-e2e-google-subject',
  authorizationCode: 'two-factor-e2e-authorization-code',
} as const;
const GOOGLE_RETURN_TO = '/account?tab=security';
const meSchema = z.object({ ok: z.literal(true), data: z.object({ email: z.string() }) });

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
      `Could not prepare the two-factor database "${E2E_DB}". Is the dev Postgres up (pnpm run db:up)?\n${String(cause)}`,
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

// The seed stores a subdomain row for acme, which the auth config answers like a custom domain and so hides
// Google; a workspace created in the product has no such row and resolves through the subdomain alone.
const resolveAcmeBySubdomainOnly = async (databaseUrl: string): Promise<void> => {
  const client = new pg.Client({ connectionString: databaseUrl });
  await client.connect();
  try {
    const removed = await client.query(
      `DELETE FROM tenant_domains WHERE tenant_id = 'tenant-acme' AND kind = 'subdomain'`,
    );
    assert(removed.rowCount === 1, `Expected one seeded acme subdomain row, removed ${String(removed.rowCount)}`);
  } finally {
    await client.end();
  }
};

const buildWeb = async (): Promise<void> => {
  const build = await run(viteBin, ['build', '--config', 'apps/web/vite.config.ts'], {});
  assert(build.code === 0, `Web build failed:\n${build.stdout}${build.stderr}`);
};

const expectAcmeWorkspace = async (page: Page, baseUrl: string): Promise<void> => {
  try {
    await page.waitForURL('**/start', { timeout: 15000 });
    await page.goto(`${baseUrl}/panel`, { waitUntil: 'domcontentloaded' });
  } catch (cause) {
    throw new E2eFailure(`Acme workspace did not reach the member landing at ${page.url()}.\n${String(cause)}`);
  }
  const tenantName = page.getByTestId('tenant-name');
  try {
    await tenantName.waitFor(visible);
  } catch (cause) {
    const alert = await page.getByRole('alert').last().textContent().catch(() => null);
    throw new E2eFailure(
      `Acme workspace did not open at ${page.url()}. alert=${String(alert)}\n${String(cause)}`,
    );
  }
  assert(
    (await tenantName.textContent()) === account.tenantName,
    `Expected the ${account.tenantName} workspace, got ${String(await tenantName.textContent())}`,
  );
};

const signInWithAccountPassword = async (page: Page, baseUrl: string): Promise<void> => {
  await page.goto(`${baseUrl}/login`, { waitUntil: 'domcontentloaded' });
  await signInWithPassword(page, account.email, account.password);
};

const signOut = async (page: Page): Promise<void> => {
  await page.getByTestId('user-menu').click();
  await page.getByTestId('sign-out').click();
  await page.getByTestId('login-email').waitFor(visible);
};

const openSecuritySettings = async (page: Page, baseUrl: string): Promise<void> => {
  await page.goto(`${baseUrl}/panel/settings#security`, { waitUntil: 'domcontentloaded' });
  await page.getByTestId('security-settings').waitFor(visible);
};

const backupCodes = async (page: Page): Promise<string[]> =>
  page.getByTestId('backup-codes').locator('li').allTextContents();

const assertBackupCodeCount = (codes: string[], label: string): void => {
  assert(
    codes.length === AUTH_POLICY.twoFactorBackupCodeCount,
    `${label} returned ${String(codes.length)} backup codes instead of ${String(AUTH_POLICY.twoFactorBackupCodeCount)}`,
  );
};

const currentTotp = async (secret: string): Promise<string> => {
  const periodMilliseconds = AUTH_POLICY.totpPeriodSeconds * 1000;
  const remainingMilliseconds = periodMilliseconds - (Date.now() % periodMilliseconds);
  if (remainingMilliseconds < 5000) await delay(remainingMilliseconds + 100);
  return generate({
    secret,
    digits: AUTH_POLICY.totpDigits,
    period: AUTH_POLICY.totpPeriodSeconds,
  });
};

const fillAndClick = async (input: Locator, value: string, button: Locator): Promise<void> => {
  await input.fill(value);
  await button.click();
};

const expectChallengeRejection = async (page: Page): Promise<void> => {
  await page.getByTestId('two-factor-challenge').getByRole('alert').waitFor(visible);
  await page.getByTestId('two-factor-challenge').waitFor(visible);
};

const runEnrollmentJourney = async (
  page: Page,
  baseUrl: string,
): Promise<{ secret: string; oldBackupCode: string }> => {
  await signInWithAccountPassword(page, baseUrl);
  await expectAcmeWorkspace(page, baseUrl);
  await openSecuritySettings(page, baseUrl);

  await page.getByTestId('enable-2fa-password').fill(account.password);
  await page.getByTestId('enable-2fa').click();
  const uriInput = page.getByTestId('totp-uri');
  await uriInput.waitFor(visible);
  const totpUri = (await uriInput.textContent()) ?? '';
  assert(totpUri.startsWith('otpauth://'), `Enrollment URI was not an otpauth:// URI: ${totpUri}`);

  const totpUrl = new URL(totpUri);
  const secret = totpUrl.searchParams.get('secret');
  const digits = totpUrl.searchParams.get('digits');
  const period = totpUrl.searchParams.get('period');
  assert(secret !== null && secret.length > 0, `Enrollment URI did not contain a secret: ${totpUri}`);
  assert(digits === String(AUTH_POLICY.totpDigits), `Enrollment digits was ${String(digits)}`);
  assert(period === String(AUTH_POLICY.totpPeriodSeconds), `Enrollment period was ${String(period)}`);

  const issuedBackupCodes = await backupCodes(page);
  assertBackupCodeCount(issuedBackupCodes, 'Enrollment');
  const oldBackupCode = issuedBackupCodes[0];
  assert(oldBackupCode !== undefined, 'Enrollment did not return a backup code');

  await fillAndClick(
    page.getByTestId('verify-totp-code'),
    await currentTotp(secret),
    page.getByTestId('verify-totp'),
  );
  await page.locator('[data-testid^="toast-success-"]').first().waitFor(visible);
  console.log('two-factor-e2e: browser enrollment and TOTP verification OK');
  return { secret, oldBackupCode };
};

const runProvisionalChallengeJourney = async (
  page: Page,
  baseUrl: string,
  secret: string,
): Promise<void> => {
  await signOut(page);
  await signInWithAccountPassword(page, baseUrl);
  await page.getByTestId('two-factor-challenge').waitFor(visible);

  await fillAndClick(
    page.getByTestId('two-factor-code'),
    'invalid-code',
    page.getByTestId('verify-login-totp'),
  );
  await expectChallengeRejection(page);

  await fillAndClick(
    page.getByTestId('two-factor-code'),
    await currentTotp(secret),
    page.getByTestId('verify-login-totp'),
  );
  await expectAcmeWorkspace(page, baseUrl);
  console.log('two-factor-e2e: provisional login challenge and invalid-code rejection OK');
};

const runBackupCodeJourney = async (
  page: Page,
  baseUrl: string,
  secret: string,
  oldBackupCode: string,
): Promise<void> => {
  await openSecuritySettings(page, baseUrl);
  await page.getByTestId('enable-2fa-password').fill(account.password);
  await page.getByTestId('regenerate-backup-codes').click();
  await page.locator('[data-testid^="toast-success-"]').first().waitFor(visible);
  const regeneratedCodes = await backupCodes(page);
  assertBackupCodeCount(regeneratedCodes, 'Regeneration');
  assert(!regeneratedCodes.includes(oldBackupCode), 'Regeneration retained an old backup code');
  const oneTimeCode = regeneratedCodes[0];
  assert(oneTimeCode !== undefined, 'Regeneration did not return a backup code');

  await signOut(page);
  await signInWithAccountPassword(page, baseUrl);
  await page.getByTestId('two-factor-challenge').waitFor(visible);
  const backupChallengeStartedAt = Date.now();
  await fillAndClick(
    page.getByTestId('two-factor-code'),
    oldBackupCode,
    page.getByTestId('verify-login-backup-code'),
  );
  await expectChallengeRejection(page);
  console.log('two-factor-e2e: regenerated flow rejected an old backup code');
  await fillAndClick(
    page.getByTestId('two-factor-code'),
    oneTimeCode,
    page.getByTestId('verify-login-backup-code'),
  );
  await expectAcmeWorkspace(page, baseUrl);
  console.log('two-factor-e2e: regenerated backup code opened the workspace');

  await signOut(page);
  await signInWithAccountPassword(page, baseUrl);
  await page.getByTestId('two-factor-challenge').waitFor(visible);
  await fillAndClick(
    page.getByTestId('two-factor-code'),
    oneTimeCode,
    page.getByTestId('verify-login-backup-code'),
  );
  await expectChallengeRejection(page);
  console.log('two-factor-e2e: backup-code replay was rejected');
  const resetWait = twoFactorRateLimitResetMilliseconds - (Date.now() - backupChallengeStartedAt);
  if (resetWait > 0) await delay(resetWait);
  await fillAndClick(
    page.getByTestId('two-factor-code'),
    await currentTotp(secret),
    page.getByTestId('verify-login-totp'),
  );
  await expectAcmeWorkspace(page, baseUrl);
  console.log('two-factor-e2e: backup-code regeneration, invalidation, one-time use, and replay rejection OK');
};

const readSignedInEmail = async (context: BrowserContext, baseUrl: string): Promise<string | null> => {
  const response = await context.request.get(`${baseUrl}${API_PATHS.me}`);
  if (response.status() === 401) return null;
  assert(response.status() === 200, `${API_PATHS.me} returned HTTP ${String(response.status())}`);
  return meSchema.parse(await response.json()).data.email;
};

const expectSignedOutBeforeCode = async (context: BrowserContext, baseUrl: string, label: string): Promise<void> => {
  const cookies = await context.cookies();
  const sessionCookies = cookies.filter((cookie) => cookie.name.endsWith('session_token'));
  assert(
    sessionCookies.length === 0,
    `${label}: a session cookie existed before the TOTP step: ${sessionCookies.map((cookie) => `${cookie.name}@${cookie.domain}`).join(', ')}`,
  );
  const email = await readSignedInEmail(context, baseUrl);
  assert(email === null, `${label}: ${API_PATHS.me} answered as ${String(email)} before the TOTP step`);
  assert(
    cookies.some((cookie) => cookie.name.endsWith('two_factor')),
    `${label}: no two-factor challenge cookie was issued`,
  );
};

const isTwoFactorChallenge = (url: URL): boolean =>
  url.pathname === '/login' && url.searchParams.get('twoFactor') === 'required';

const waitForSignInToSettle = async (page: Page, baseUrl: string, label: string): Promise<void> => {
  const origin = new URL(baseUrl).origin;
  try {
    await page.waitForURL(
      (url) => isTwoFactorChallenge(url) || (url.origin === origin && url.pathname !== '/login'),
      { timeout: 20000 },
    );
  } catch (cause) {
    throw new E2eFailure(`${label}: the browser neither reached the two-factor challenge nor left the login page; it is at ${page.url()}\n${String(cause)}`);
  }
};

const expectChallengeOnOrigin = async (page: Page, baseUrl: string, label: string): Promise<void> => {
  const origin = new URL(baseUrl).origin;
  const challenge = new URL(page.url());
  assert(isTwoFactorChallenge(challenge), `${label}: the browser left the login page without the two-factor challenge: ${page.url()}`);
  assert(challenge.origin === origin, `${label}: the challenge opened on ${challenge.origin} instead of ${origin} (${page.url()})`);
  assert(
    challenge.searchParams.get('returnTo') === GOOGLE_RETURN_TO,
    `${label}: the challenge URL lost the return target ${GOOGLE_RETURN_TO}: ${page.url()}`,
  );
  await page.getByTestId('two-factor-challenge').waitFor(visible);
};

const completeChallengeToReturnTarget = async (
  page: Page,
  context: BrowserContext,
  baseUrl: string,
  secret: string,
  label: string,
): Promise<void> => {
  const origin = new URL(baseUrl).origin;
  await page.getByTestId('two-factor-code').fill(await currentTotp(secret));
  const completion = page.waitForResponse((response) => new URL(response.url()).pathname === BETTER_AUTH_TWO_FACTOR_TOTP_PATH);
  await page.getByTestId('verify-login-totp').click();
  const completed = await completion;
  assert(completed.status() === 200, `${label}: TOTP completion returned HTTP ${String(completed.status())}`);
  const target = new URL(GOOGLE_RETURN_TO, origin);
  try {
    await page.waitForURL(
      (url) => url.origin === origin && url.pathname === target.pathname && url.search === target.search,
      { timeout: 20000 },
    );
  } catch (cause) {
    throw new E2eFailure(`${label}: TOTP completion did not land on ${target.toString()}; it is at ${page.url()}\n${String(cause)}`);
  }
  const email = await readSignedInEmail(context, baseUrl);
  assert(email === account.email, `${label}: after TOTP the session belongs to ${String(email)} instead of ${account.email}`);
};

const expectCleanGoogleFake = (fake: GoogleBrowserFake, server: ChildProcess, label: string): void => {
  assert(fake.failures().length === 0, `${label}: the Google browser fake saw unexpected traffic:\n${fake.failures().join('\n')}`);
  const serverFailures = readServerOutput(server).split('\n').filter((line) => line.includes(GOOGLE_FAKE_FAILURE_MARKER));
  assert(serverFailures.length === 0, `${label}: the server-side Google fake saw unexpected traffic:\n${serverFailures.join('\n')}`);
};

const openGoogleContext = async (browser: Browser, baseUrl: string, { bypassCSP = false } = {}) => {
  const context = await browser.newContext({ viewport: { width: 1440, height: 1000 }, bypassCSP });
  const fake = await installGoogleBrowserFake(context, {
    clientId: google.clientId,
    redirectUri: `${baseUrl}${AUTH_GOOGLE_CALLBACK_PATH}`,
    authorizationCode: google.authorizationCode,
  });
  const page = await context.newPage();
  page.on('pageerror', (error) => console.log(`  [browser:pageerror] ${error.message}`));
  return { context, fake, page };
};

const loginUrlWithReturnTarget = (baseUrl: string): string =>
  `${baseUrl}/login?${new URLSearchParams({ returnTo: GOOGLE_RETURN_TO }).toString()}`;

const runOneTapChallengeJourney = async (
  browser: Browser,
  server: ChildProcess,
  baseUrl: string,
  secret: string,
  oneTapCredential: string,
): Promise<void> => {
  const label = 'One Tap';
  // The login document's script-src blocks Google's script; bypassing it keeps the page branch and the
  // server path covered until the owner decides on that policy (docs/social-google-smoke.md).
  const { context, fake, page } = await openGoogleContext(browser, baseUrl, { bypassCSP: true });
  try {
    fake.armOneTapCredential(oneTapCredential);
    const callback = page.waitForResponse((response) => new URL(response.url()).pathname === AUTH_ONE_TAP_CALLBACK_PATH);
    callback.catch(() => undefined);
    const identityScriptBlocked = new Promise<never>((_resolve, reject) => {
      page.on('requestfailed', (request) => {
        if (request.url() !== GOOGLE_IDENTITY_SCRIPT_URL) return;
        reject(new E2eFailure(
          `${label}: the login page could not load ${GOOGLE_IDENTITY_SCRIPT_URL} (${String(request.failure()?.errorText)}), so the One Tap prompt never ran`,
        ));
      });
    });
    identityScriptBlocked.catch(() => undefined);
    await page.goto(loginUrlWithReturnTarget(baseUrl), { waitUntil: 'domcontentloaded' });
    const answered = await Promise.race([callback, identityScriptBlocked]);
    assert(answered.status() === 200, `${label}: ${AUTH_ONE_TAP_CALLBACK_PATH} returned HTTP ${String(answered.status())}`);
    await waitForSignInToSettle(page, baseUrl, label);
    await expectSignedOutBeforeCode(context, baseUrl, label);
    await expectChallengeOnOrigin(page, baseUrl, label);
    await completeChallengeToReturnTarget(page, context, baseUrl, secret, label);
    assert(fake.served().identityScripts >= 1, `${label}: the page never loaded the Google Identity script`);
    expectCleanGoogleFake(fake, server, label);
    console.log('two-factor-e2e: One Tap sign-in stopped at the challenge on the request origin and continued to the return target OK');
  } finally {
    await context.close();
  }
};

const runGoogleOAuthChallengeJourney = async (
  browser: Browser,
  server: ChildProcess,
  baseUrl: string,
  secret: string,
): Promise<void> => {
  const label = 'Google OAuth';
  const { context, fake, page } = await openGoogleContext(browser, baseUrl);
  try {
    await page.goto(loginUrlWithReturnTarget(baseUrl), { waitUntil: 'domcontentloaded' });
    const callback = page.waitForResponse((response) => new URL(response.url()).pathname === AUTH_GOOGLE_CALLBACK_PATH);
    await page.getByTestId('continue-google').click();
    const answered = await callback;
    assert(answered.status() === 302, `${label}: ${AUTH_GOOGLE_CALLBACK_PATH} returned HTTP ${String(answered.status())}`);
    assert(fake.served().authorizations === 1, `${label}: the authorization endpoint was reached ${String(fake.served().authorizations)} times`);
    await waitForSignInToSettle(page, baseUrl, label);
    await expectSignedOutBeforeCode(context, baseUrl, label);
    await expectChallengeOnOrigin(page, baseUrl, label);
    await completeChallengeToReturnTarget(page, context, baseUrl, secret, label);
    expectCleanGoogleFake(fake, server, label);
    console.log('two-factor-e2e: Google OAuth callback stopped at the challenge on the request origin and continued to the return target OK');
  } finally {
    await context.close();
  }
};

const runDisableJourney = async (page: Page, baseUrl: string): Promise<void> => {
  await openSecuritySettings(page, baseUrl);
  await page.getByTestId('enable-2fa-password').fill(account.password);
  await page.getByTestId('disable-2fa').click();
  await page.locator('[data-testid^="toast-success-"]').first().waitFor(visible);
  assert(await page.getByTestId('backup-codes').count() === 0, 'Backup codes remained visible after disabling 2FA');

  await signOut(page);
  await signInWithAccountPassword(page, baseUrl);
  await expectAcmeWorkspace(page, baseUrl);
  assert(
    await page.getByTestId('two-factor-challenge').count() === 0,
    'Password login still showed a two-factor challenge after disabling 2FA',
  );
  console.log('two-factor-e2e: disable flow and challenge-free subsequent login OK');
};

const startedAt = Date.now();
let server: ChildProcess | null = null;
let browser: Browser | null = null;

try {
  console.log('two-factor-e2e: preparing isolated database...');
  await setupDatabase(baseDatabaseUrl);
  await migrateAndSeed(e2eDatabaseUrl);
  await resolveAcmeBySubdomainOnly(e2eDatabaseUrl);
  console.log('two-factor-e2e: building the web SPA...');
  await buildWeb();

  const port = await ephemeralPort();
  const connectUrl = `http://127.0.0.1:${String(port)}`;
  const acmeBaseUrl = `http://acme.localhost:${String(port)}`;
  const googleSigner = createGoogleSigner(google.clientId);
  const googleIdentity = { subject: google.subject, email: account.email, name: 'Acme Creator' };
  console.log(`two-factor-e2e: booting server on port ${String(port)}...`);
  server = await bootServer({
    port,
    healthUrl: `${connectUrl}/api/health`,
    entry: GOOGLE_FAKE_SERVER_ENTRY,
    env: {
      DATABASE_URL: e2eDatabaseUrl,
      APP_BASE_URL: acmeBaseUrl,
      APP_BASE_DOMAIN: 'localhost',
      WEB_DIST_DIR: 'dist/web',
      AUTH_DEV_EXPOSE_MAGIC_LINKS: 'true',
      EMAIL_PROVIDER: 'dev',
      SIMULATED_PAYMENTS: 'true',
      GOOGLE_CLIENT_ID: google.clientId,
      GOOGLE_CLIENT_SECRET: google.clientSecret,
      ...googleFakeEnv({
        clientId: google.clientId,
        clientSecret: google.clientSecret,
        redirectUri: `${acmeBaseUrl}${AUTH_GOOGLE_CALLBACK_PATH}`,
        jwk: googleSigner.jwk,
        idTokensByCode: { [google.authorizationCode]: googleSigner.idToken(googleIdentity) },
      }),
    },
  });

  browser = await chromium.launch(
    chromeExecutablePath
      ? { executablePath: chromeExecutablePath, headless: true }
      : { channel: 'chrome', headless: true },
  );
  const { context, fake: passwordJourneyGoogleFake, page } = await openGoogleContext(browser, acmeBaseUrl);

  const enrollment = await runEnrollmentJourney(page, acmeBaseUrl);
  await runProvisionalChallengeJourney(page, acmeBaseUrl, enrollment.secret);
  await runBackupCodeJourney(page, acmeBaseUrl, enrollment.secret, enrollment.oldBackupCode);
  await runOneTapChallengeJourney(browser, server, acmeBaseUrl, enrollment.secret, googleSigner.idToken(googleIdentity));
  await runGoogleOAuthChallengeJourney(browser, server, acmeBaseUrl, enrollment.secret);
  await runDisableJourney(page, acmeBaseUrl);
  expectCleanGoogleFake(passwordJourneyGoogleFake, server, 'password journeys');
  await context.close();
  console.log(`\ntwo-factor-e2e: PASS (${((Date.now() - startedAt) / 1000).toFixed(1)}s)`);
} catch (error) {
  const message = error instanceof E2eFailure ? error.message : String(error);
  console.error(`\ntwo-factor-e2e: FAIL\n${message}`);
  process.exitCode = 1;
} finally {
  if (server) await killServer(server);
  if (browser) await browser.close();
  rmSync(webDistDir, { recursive: true, force: true });
  await dropDatabase(baseDatabaseUrl);
}
