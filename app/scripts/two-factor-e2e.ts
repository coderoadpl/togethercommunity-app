import type { ChildProcess } from 'node:child_process';
import { rmSync } from 'node:fs';
import { join } from 'node:path';

import { generate } from 'otplib';
import pg from 'pg';
import { chromium, type Browser, type Locator, type Page } from 'playwright-core';

import { AUTH_POLICY } from '#adapters/auth/create-auth.js';

import { resolveE2eDatabaseUrl } from './e2e-config.js';
import {
  bootServer,
  delay,
  ephemeralPort,
  killServer,
  rootDir,
  run,
  tsxBin,
} from './server-harness.js';

const viteBin = join(rootDir, 'node_modules/.bin/vite');
const webDistDir = join(rootDir, 'dist/web');
const chromeExecutablePath = process.env['PLAYWRIGHT_CHROME_EXECUTABLE_PATH'];
const E2E_DB = 'together_e2e_two_factor';
const baseDatabaseUrl = resolveE2eDatabaseUrl(process.env);
const e2eUrlObject = new URL(baseDatabaseUrl);
e2eUrlObject.pathname = `/${E2E_DB}`;
const e2eDatabaseUrl = e2eUrlObject.toString();
const account = {
  email: 'creator2@together.dev',
  password: 'demo-password-15',
  tenantName: 'Acme Courses',
};
const visible = { state: 'visible', timeout: 15000 } as const;
const twoFactorRateLimitResetMilliseconds = 10_100;

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

const buildWeb = async (): Promise<void> => {
  const build = await run(viteBin, ['build', '--config', 'apps/web/vite.config.ts'], {});
  assert(build.code === 0, `Web build failed:\n${build.stdout}${build.stderr}`);
};

const expectAcmeWorkspace = async (page: Page): Promise<void> => {
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

const signInWithPassword = async (page: Page, baseUrl: string): Promise<void> => {
  await page.goto(`${baseUrl}/login`, { waitUntil: 'domcontentloaded' });
  await page.getByTestId('login-email').fill(account.email);
  await page.getByTestId('login-password').fill(account.password);
  await page.getByTestId('signin-submit').click();
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
  await signInWithPassword(page, baseUrl);
  await expectAcmeWorkspace(page);
  await openSecuritySettings(page, baseUrl);

  await page.getByTestId('enable-2fa-password').fill(account.password);
  await page.getByTestId('enable-2fa').click();
  const uriInput = page.getByTestId('totp-uri');
  await uriInput.waitFor(visible);
  const totpUri = await uriInput.inputValue();
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
  await page.getByTestId('totp-verified').waitFor(visible);
  console.log('two-factor-e2e: browser enrollment and TOTP verification OK');
  return { secret, oldBackupCode };
};

const runProvisionalChallengeJourney = async (
  page: Page,
  baseUrl: string,
  secret: string,
): Promise<void> => {
  await signOut(page);
  await signInWithPassword(page, baseUrl);
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
  await expectAcmeWorkspace(page);
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
  await page.getByTestId('backup-codes-regenerated').waitFor(visible);
  const regeneratedCodes = await backupCodes(page);
  assertBackupCodeCount(regeneratedCodes, 'Regeneration');
  assert(!regeneratedCodes.includes(oldBackupCode), 'Regeneration retained an old backup code');
  const oneTimeCode = regeneratedCodes[0];
  assert(oneTimeCode !== undefined, 'Regeneration did not return a backup code');

  await signOut(page);
  await signInWithPassword(page, baseUrl);
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
  await expectAcmeWorkspace(page);
  console.log('two-factor-e2e: regenerated backup code opened the workspace');

  await signOut(page);
  await signInWithPassword(page, baseUrl);
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
  await expectAcmeWorkspace(page);
  console.log('two-factor-e2e: backup-code regeneration, invalidation, one-time use, and replay rejection OK');
};

const runDisableJourney = async (page: Page, baseUrl: string): Promise<void> => {
  await openSecuritySettings(page, baseUrl);
  await page.getByTestId('enable-2fa-password').fill(account.password);
  await page.getByTestId('disable-2fa').click();
  await page.getByTestId('two-factor-disabled').waitFor(visible);
  assert(await page.getByTestId('backup-codes').count() === 0, 'Backup codes remained visible after disabling 2FA');

  await signOut(page);
  await signInWithPassword(page, baseUrl);
  await expectAcmeWorkspace(page);
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
  console.log('two-factor-e2e: building the web SPA...');
  await buildWeb();

  const port = await ephemeralPort();
  const connectUrl = `http://127.0.0.1:${String(port)}`;
  const acmeBaseUrl = `http://acme.localhost:${String(port)}`;
  console.log(`two-factor-e2e: booting server on port ${String(port)}...`);
  server = await bootServer({
    port,
    healthUrl: `${connectUrl}/api/health`,
    env: {
      DATABASE_URL: e2eDatabaseUrl,
      APP_BASE_URL: acmeBaseUrl,
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
  const context = await browser.newContext({ viewport: { width: 1440, height: 1000 } });
  const page = await context.newPage();
  page.on('pageerror', (error) => console.log(`  [browser:pageerror] ${error.message}`));

  const enrollment = await runEnrollmentJourney(page, acmeBaseUrl);
  await runProvisionalChallengeJourney(page, acmeBaseUrl, enrollment.secret);
  await runBackupCodeJourney(page, acmeBaseUrl, enrollment.secret, enrollment.oldBackupCode);
  await runDisableJourney(page, acmeBaseUrl);
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
