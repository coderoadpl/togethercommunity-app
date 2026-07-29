import type { ChildProcess } from 'node:child_process';
import { rmSync } from 'node:fs';
import { join } from 'node:path';

import pg from 'pg';
import { chromium, type Browser } from 'playwright-core';

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
const E2E_DB = 'together_coupon_e2e';
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
      `Could not prepare the coupon-e2e database "${E2E_DB}". Is the dev Postgres up (npm run db:up)?\n${String(cause)}`,
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

const startedAt = Date.now();
let server: ChildProcess | null = null;
let browser: Browser | null = null;
try {
  console.log('coupon-e2e: preparing isolated database...');
  await setupDatabase(baseDatabaseUrl);
  await migrateAndSeed(e2eDatabaseUrl);
  console.log('coupon-e2e: building the web SPA...');
  await buildWeb();
  const port = await ephemeralPort();
  const connectUrl = `http://127.0.0.1:${port}`;
  const webBaseUrl = `http://studio.localhost:${port}`;
  console.log(`coupon-e2e: booting server on port ${port}...`);
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

  browser = await chromium.launch({ channel: 'chrome', headless: true });
  const context = await browser.newContext();
  await context.addInitScript(() => {
    window.localStorage.setItem('together-language', 'pl');
  });
  const page = await context.newPage();
  await page.goto(`${webBaseUrl}/checkout/product-studio-kurs-101`, {
    waitUntil: 'networkidle',
  });

  assert(
    !(await page.getByTestId('checkout-coupon-input').isVisible()),
    'coupon input was visible before reveal',
  );
  await page.getByTestId('checkout-coupon-reveal').click();
  await page.getByTestId('checkout-coupon-input').waitFor({ state: 'visible', timeout: 15000 });

  await page.getByTestId('checkout-coupon-input').fill('NIE-ISTNIEJE');
  await page.getByTestId('checkout-coupon-apply').click();
  await page.getByTestId('checkout-coupon-error').waitFor({ state: 'visible', timeout: 15000 });
  assert(
    (await page.getByTestId('checkout-coupon-breakdown').count()) === 0,
    'invalid coupon rendered a price breakdown',
  );

  await page.getByTestId('checkout-coupon-input').fill('PARTNER20');
  await page.getByTestId('checkout-coupon-apply').click();
  await page.getByTestId('checkout-coupon-breakdown').waitFor({ state: 'visible', timeout: 15000 });
  assert(
    (await page.getByTestId('checkout-coupon-final').textContent())?.includes('159,20') === true,
    'valid coupon did not render the 159,20 final price',
  );
  assert(
    (await page.getByTestId('checkout-coupon-breakdown').textContent())?.includes('39,80') === true,
    'valid coupon did not render the 39,80 discount',
  );
  assert(
    await page.locator('button[type="submit"]').isVisible(),
    'discounted checkout did not keep the payment affordance visible',
  );

  await page.goto(`${webBaseUrl}/checkout/product-studio-kurs-101?code=PARTNER20`, {
    waitUntil: 'networkidle',
  });
  await page.locator('#checkout-email').fill('buyer@together.dev');
  await page.getByTestId('checkout-coupon-breakdown').waitFor({ state: 'visible', timeout: 15000 });
  assert(
    (await page.getByTestId('checkout-coupon-final').textContent())?.includes('159,20') === true,
    'coupon query parameter did not auto-apply',
  );

  console.log(`\ncoupon-e2e: PASS (${((Date.now() - startedAt) / 1000).toFixed(1)}s)`);
} catch (error) {
  const message = error instanceof E2eFailure ? error.message : String(error);
  console.error(`\ncoupon-e2e: FAIL\n${message}`);
  process.exitCode = 1;
} finally {
  if (server) await killServer(server);
  rmSync(webDistDir, { recursive: true, force: true });
  if (browser) await browser.close();
}
