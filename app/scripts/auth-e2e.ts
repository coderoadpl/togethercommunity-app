import type { ChildProcess } from 'node:child_process';
import { rmSync } from 'node:fs';
import { join } from 'node:path';

import { generate } from 'otplib';
import pg from 'pg';
import { chromium, type Browser } from 'playwright-core';
import { z } from 'zod';

import { createAuthE2eClient } from '#adapters/auth/e2e-http.js';

import {
  bootServer,
  ephemeralPort,
  killServer,
  rootDir,
  run,
  tsxBin,
} from './server-harness.js';
import { resolveAuthE2eDatabaseUrl } from './auth-e2e-config.js';

const viteBin = join(rootDir, 'node_modules/.bin/vite');
const webDistDir = join(rootDir, 'dist/web');

const E2E_DB = 'together_auth_e2e';
const baseDatabaseUrl = resolveAuthE2eDatabaseUrl(process.env);
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
    browser = await chromium.launch({ channel: 'chrome', headless: true });
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
    },
  });
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
}
