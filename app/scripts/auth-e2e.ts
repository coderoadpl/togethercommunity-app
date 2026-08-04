import type { ChildProcess } from 'node:child_process';
import { rmSync } from 'node:fs';
import { join } from 'node:path';

import { generate } from 'otplib';
import pg from 'pg';
import { chromium, type Browser } from 'playwright-core';
import { z } from 'zod';

import { createAuthE2eClient } from '#adapters/auth/e2e-http.js';
import { uniqueTestDatabaseName } from '#adapters/db/test-database-name.js';
import { API_PATHS } from '#core/contract/index.js';

import {
  bootServer,
  delay,
  ephemeralPort,
  killServer,
  rootDir,
  run,
  tsxBin,
} from './server-harness.js';
import { resolveE2eDatabaseUrl } from './e2e-config.js';

const viteBin = join(rootDir, 'node_modules/.bin/vite');
const webDistDir = join(rootDir, 'dist/web');
const chromeExecutablePath = process.env['PLAYWRIGHT_CHROME_EXECUTABLE_PATH'];

const E2E_DB = uniqueTestDatabaseName('together_auth_e2e');
const baseDatabaseUrl = resolveE2eDatabaseUrl(process.env);
const e2eUrlObject = new URL(baseDatabaseUrl);
e2eUrlObject.pathname = `/${E2E_DB}`;
const e2eDatabaseUrl = e2eUrlObject.toString();

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
      `Could not prepare the auth-e2e database "${E2E_DB}". Is the dev Postgres up (pnpm run db:up)?\n${String(cause)}`,
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

const enrollmentSchema = z.object({
  totpURI: z.string(),
  backupCodes: z.array(z.string()),
});
const sessionSchema = z.object({
  user: z.object({ email: z.string(), twoFactorEnabled: z.boolean().nullish() }),
});
const devEmailSchema = z.object({
  ok: z.literal(true),
  data: z.object({ email: z.object({ text: z.string() }).nullable() }),
});

const runPasswordResetPath = async (
  transport: { connectUrl: string; origin: string },
  webBaseUrl: string,
): Promise<void> => {
  const email = 'password-reset-e2e@together.dev';
  const oldPassword = 'old-password';
  const newPassword = 'new-password';
  const auth = createAuthE2eClient(transport);
  const signUp = await auth.signUpEmail({ name: 'Password Reset E2E', email, password: oldPassword });
  assert(signUp.status < 400, `reset sign-up failed (HTTP ${signUp.status}): ${JSON.stringify(signUp.json)}`);
  const priorSession = signUp.token;
  assert(priorSession !== null, 'reset sign-up did not return a session token');

  let browser: Browser | null = null;
  try {
    browser = await chromium.launch(
      chromeExecutablePath
        ? { executablePath: chromeExecutablePath, headless: true }
        : { channel: 'chrome', headless: true },
    );
    const context = await browser.newContext();
    const page = await context.newPage();
    await page.goto(`${webBaseUrl}/forgot-password`, { waitUntil: 'networkidle' });
    await page.getByTestId('forgot-password-email').fill(email);
    await page.getByTestId('forgot-password-submit').click();
    await page.getByTestId('forgot-password-success').waitFor({ state: 'visible', timeout: 15000 });

    let actionUrl = '';
    const deadline = Date.now() + 10000;
    while (Date.now() < deadline && actionUrl === '') {
      const response = await fetch(
        new URL(`${API_PATHS.devEmail}?to=${encodeURIComponent(email)}`, transport.connectUrl),
      );
      const parsed = devEmailSchema.parse(await response.json());
      actionUrl = parsed.data.email?.text.match(/https?:\/\/\S+/)?.[0] ?? '';
      if (actionUrl === '') await delay(100);
    }
    assert(actionUrl !== '', 'reset email did not reach the dev sink');
    assert(new URL(actionUrl).host === new URL(webBaseUrl).host, 'reset provider callback used the wrong host');

    await page.goto(actionUrl, { waitUntil: 'networkidle' });
    await page.getByTestId('reset-password').fill(newPassword);
    await page.getByTestId('reset-password-confirm').fill(newPassword);
    await page.getByTestId('reset-submit').click();
    await page.getByTestId('reset-success').waitFor({ state: 'visible', timeout: 15000 });
    await context.close();
  } finally {
    if (browser) await browser.close();
  }

  const oldSignIn = await auth.signInEmail({ email, password: oldPassword });
  const newSignIn = await auth.signInEmail({ email, password: newPassword });
  const priorSessionResponse = await fetch(new URL(API_PATHS.me, transport.connectUrl), {
    headers: {
      authorization: `Bearer ${priorSession}`,
      origin: transport.origin,
    },
  });
  assert(oldSignIn.status === 401, `old password remained valid after reset (HTTP ${oldSignIn.status})`);
  assert(newSignIn.status < 400, `new password was rejected after reset (HTTP ${newSignIn.status})`);
  assert(
    priorSessionResponse.status === 401,
    `prior session was not unauthorized after reset (HTTP ${priorSessionResponse.status})`,
  );
  console.log('auth-e2e: password reset path OK');
};

const runTotpPath = async (transport: { connectUrl: string; origin: string }): Promise<void> => {
  const email = 'totp-e2e@together.dev';
  const password = 'demo1234!';
  const auth = createAuthE2eClient(transport);

  const signUp = await auth.signUpEmail({ name: 'TOTP E2E', email, password });
  assert(signUp.status < 400, `sign-up failed (HTTP ${signUp.status}): ${JSON.stringify(signUp.json)}`);
  const token = signUp.token;
  assert(token !== null, 'sign-up did not return a session token');

  const enable = await auth.enableTwoFactor(token, password);
  assert(enable.status < 400, `two-factor enable failed (HTTP ${enable.status}): ${JSON.stringify(enable.json)}`);
  const enrollment = enrollmentSchema.parse(enable.json);

  const totpParams = new URL(enrollment.totpURI).searchParams;
  const secret = totpParams.get('secret');
  assert(secret !== null && secret.length > 0, `totpURI did not contain a secret: ${enrollment.totpURI}`);
  assert(enrollment.backupCodes.length > 0, 'two-factor enable returned no backup codes');

  const code = await generate({
    secret,
    digits: Number(totpParams.get('digits') ?? '6'),
    period: Number(totpParams.get('period') ?? '30'),
  });
  const verify = await auth.verifyTotp(token, code);
  assert(verify.status < 400, `verify-totp failed (HTTP ${verify.status}): ${JSON.stringify(verify.json)}`);

  const sessionToken = verify.token ?? token;
  const session = await auth.getSession(sessionToken);
  assert(session.status < 400, `get-session failed (HTTP ${session.status}): ${JSON.stringify(session.json)}`);
  const parsed = sessionSchema.parse(session.json);
  assert(parsed.user.email === email, `session resolved the wrong user: ${parsed.user.email}`);
  console.log('auth-e2e: TOTP path OK');
};

const runPasskeyPath = async (webBaseUrl: string): Promise<void> => {
  let browser: Browser | null = null;
  try {
    browser = await chromium.launch(
      chromeExecutablePath
        ? { executablePath: chromeExecutablePath, headless: true }
        : { channel: 'chrome', headless: true },
    );
    const context = await browser.newContext();
    const page = await context.newPage();
    page.on('pageerror', (error) => console.log(`  [browser:pageerror] ${error.message}`));
    const cdp = await context.newCDPSession(page);
    await cdp.send('WebAuthn.enable');
    await cdp.send('WebAuthn.addVirtualAuthenticator', {
      options: {
        protocol: 'ctap2',
        transport: 'internal',
        hasResidentKey: true,
        hasUserVerification: true,
        isUserVerified: true,
        automaticPresenceSimulation: true,
      },
    });

    await page.goto(`${webBaseUrl}/login`, { waitUntil: 'networkidle' });
    await page.getByTestId('login-email').fill('creator2@together.dev');
    await page.getByTestId('login-password').fill('demo1234');
    await page.getByTestId('signin-submit').click();
    await page.getByTestId('tenant-name').waitFor({ state: 'visible', timeout: 15000 });
    assert(
      (await page.getByTestId('tenant-name').textContent()) === 'Acme Courses',
      'password sign-in did not open the Acme workspace',
    );

    await page.getByTestId('section-settings').click();
    await page.getByTestId('passkey-name').fill('E2E Passkey');
    await page.getByTestId('passkey-proof-password').fill('demo1234');
    await page.getByTestId('add-passkey').click();
    try {
      await page.getByTestId('passkey-added').waitFor({ state: 'visible', timeout: 15000 });
    } catch (cause) {
      const alert = await page.getByRole('alert').first().textContent().catch(() => null);
      throw new E2eFailure(`passkey registration did not confirm. alert=${String(alert)}\n${String(cause)}`);
    }

    await page.getByTestId('user-menu').click();
    await page.getByTestId('sign-out').click();
    await page.getByTestId('signin-passkey').waitFor({ state: 'visible', timeout: 15000 });

    await page.getByTestId('signin-passkey').click();
    await page.getByTestId('tenant-name').waitFor({ state: 'visible', timeout: 15000 });
    assert(
      (await page.getByTestId('tenant-name').textContent()) === 'Acme Courses',
      'passkey sign-in did not open the Acme workspace',
    );
    console.log('auth-e2e: passkey path OK');
  } finally {
    if (browser) await browser.close();
  }
};

const startedAt = Date.now();
let server: ChildProcess | null = null;
try {
  console.log('auth-e2e: preparing isolated database...');
  await setupDatabase(baseDatabaseUrl);
  await migrateAndSeed(e2eDatabaseUrl);
  console.log('auth-e2e: building the web SPA...');
  await buildWeb();
  const port = await ephemeralPort();
  const connectUrl = `http://127.0.0.1:${port}`;
  const webBaseUrl = `http://acme.localhost:${port}`;
  console.log(`auth-e2e: booting server on port ${port}...`);
  server = await bootServer({
    port,
    healthUrl: `${connectUrl}/api/health`,
    env: {
      DATABASE_URL: e2eDatabaseUrl,
      APP_BASE_URL: webBaseUrl,
      APP_BASE_DOMAIN: 'localhost',
      WEB_DIST_DIR: 'dist/web',
      AUTH_DEV_EXPOSE_MAGIC_LINKS: 'true',
      EMAIL_PROVIDER: 'dev',
      SIMULATED_PAYMENTS: 'true',
    },
  });
  await runPasswordResetPath({ connectUrl, origin: webBaseUrl }, webBaseUrl);
  await runTotpPath({ connectUrl, origin: webBaseUrl });
  await runPasskeyPath(webBaseUrl);
  console.log(`\nauth-e2e: PASS (${((Date.now() - startedAt) / 1000).toFixed(1)}s)`);
} catch (error) {
  const message = error instanceof E2eFailure ? error.message : String(error);
  console.error(`\nauth-e2e: FAIL\n${message}`);
  process.exitCode = 1;
} finally {
  if (server) await killServer(server);
  rmSync(webDistDir, { recursive: true, force: true });
  await dropDatabase(baseDatabaseUrl);
}
