import type { ChildProcess } from 'node:child_process';
import { request as httpRequest } from 'node:http';
import { rmSync } from 'node:fs';
import { join } from 'node:path';

import pg from 'pg';
import { chromium, type Browser, type BrowserContext } from 'playwright-core';
import { z } from 'zod';

import { uniqueTestDatabaseName } from '#adapters/db/test-database-name.js';

import {
  bootServer,
  ephemeralPort,
  killServer,
  rootDir,
  run,
  tsxBin,
} from './server-harness.js';
import { resolveE2eDatabaseUrl } from './e2e-config.js';
import { signInWithPassword } from './login-flow.js';

const viteBin = join(rootDir, 'node_modules/.bin/vite');
const webDistDir = join(rootDir, 'dist/web');
const chromeExecutablePath = process.env['PLAYWRIGHT_CHROME_EXECUTABLE_PATH'];

const CUSTOM_HOST = 'kurs.coderoad.localhost';
const TENANT_HOST = 'acme.localhost';
const CREATOR_EMAIL = 'creator2@together.dev';
const CREATOR_PASSWORD = 'demo-password-15';

const E2E_DB = uniqueTestDatabaseName('together_custom_domain_e2e');
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
      `Could not prepare the custom-domain-e2e database "${E2E_DB}". Is the dev Postgres up (pnpm run db:up)?\n${String(cause)}`,
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

const attachCustomDomain = async (databaseUrl: string): Promise<void> => {
  const client = new pg.Client({ connectionString: databaseUrl });
  await client.connect();
  try {
    await client.query(
      `INSERT INTO tenant_domains (id, tenant_id, domain, kind, verified)
       VALUES ($1, $2, $3, 'custom', true)
       ON CONFLICT (domain) DO UPDATE SET verified = true`,
      ['domain-acme-custom', 'tenant-acme', CUSTOM_HOST],
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

const launchBrowser = (): Promise<Browser> => chromium.launch(
  chromeExecutablePath
    ? { executablePath: chromeExecutablePath, headless: true }
    : { channel: 'chrome', headless: true },
);

const sessionCookies = async (context: BrowserContext) =>
  (await context.cookies()).filter((cookie) => cookie.name.endsWith('session_token'));

const runCustomHostSignIn = async (customBaseUrl: string, tenantBaseUrl: string): Promise<void> => {
  let browser: Browser | null = null;
  try {
    browser = await launchBrowser();
    const context = await browser.newContext();
    const page = await context.newPage();

    await page.goto(`${customBaseUrl}/login`, { waitUntil: 'networkidle' });
    await signInWithPassword(page, CREATOR_EMAIL, CREATOR_PASSWORD);
    await page.getByTestId('tenant-name').waitFor({ state: 'visible', timeout: 20000 });
    assert(
      (await page.getByTestId('tenant-name').textContent()) === 'Acme Courses',
      'the custom domain did not open the Acme workspace',
    );

    const cookies = await sessionCookies(context);
    assert(cookies.length === 1, `expected one session cookie, saw ${cookies.length}`);
    assert(
      cookies[0]?.domain === CUSTOM_HOST,
      `session cookie escaped the custom host: ${String(cookies[0]?.domain)}`,
    );

    await page.goto(`${tenantBaseUrl}/panel`, { waitUntil: 'networkidle' });
    await page.getByTestId('login-email').waitFor({ state: 'visible', timeout: 20000 });
    console.log('custom-domain-e2e: password sign-in scoped to the custom host OK');
    await context.close();
  } finally {
    if (browser) await browser.close();
  }
};

const runCustomHostPasskey = async (customBaseUrl: string): Promise<void> => {
  let browser: Browser | null = null;
  try {
    browser = await launchBrowser();
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

    await page.goto(`${customBaseUrl}/login`, { waitUntil: 'networkidle' });
    await signInWithPassword(page, CREATOR_EMAIL, CREATOR_PASSWORD);
    await page.getByTestId('tenant-name').waitFor({ state: 'visible', timeout: 20000 });

    await page.getByTestId('section-settings').click();
    await page.getByRole('tab', { name: 'Bezpieczeństwo' }).click();
    await page.waitForURL(/#security$/);
    await page.getByTestId('passkey-name').fill('Custom Domain Passkey');
    await page.getByTestId('passkey-proof-password').fill(CREATOR_PASSWORD);
    await page.getByTestId('add-passkey').click();
    try {
      await page.getByTestId('passkey-added').waitFor({ state: 'visible', timeout: 20000 });
    } catch (cause) {
      const alert = await page.getByRole('alert').first().textContent().catch(() => null);
      throw new E2eFailure(
        `passkey registration on the custom host did not confirm. alert=${String(alert)}\n${String(cause)}`,
      );
    }

    await page.getByTestId('user-menu').click();
    await page.getByTestId('sign-out').click();
    await page.getByTestId('signin-passkey').waitFor({ state: 'visible', timeout: 20000 });
    await page.getByTestId('signin-passkey').click();
    await page.getByTestId('tenant-name').waitFor({ state: 'visible', timeout: 20000 });
    assert(
      (await page.getByTestId('tenant-name').textContent()) === 'Acme Courses',
      'passkey sign-in on the custom host did not open the Acme workspace',
    );
    console.log('custom-domain-e2e: passkey ceremony on the custom host OK');
    await context.close();
  } finally {
    if (browser) await browser.close();
  }
};

const SELF_SERVE_HOST = 'sklep.coderoad.example';

const readDomainRow = async (
  databaseUrl: string,
  domain: string,
): Promise<{ verified: boolean; provider: string; kind: string } | null> => {
  const client = new pg.Client({ connectionString: databaseUrl });
  await client.connect();
  try {
    const result = await client.query<{ verified: boolean; provider: string; kind: string }>(
      'SELECT verified, provider, kind FROM tenant_domains WHERE domain = $1',
      [domain],
    );
    return result.rows[0] ?? null;
  } finally {
    await client.end();
  }
};

const verifyDomainRow = async (databaseUrl: string, domain: string): Promise<void> => {
  const client = new pg.Client({ connectionString: databaseUrl });
  await client.connect();
  try {
    await client.query(
      'UPDATE tenant_domains SET verified = true, verified_at = now() WHERE domain = $1',
      [domain],
    );
  } finally {
    await client.end();
  }
};

/** Node's fetch drops a custom Host header, and the domain has no DNS record. */
const getWithHost = (connectUrl: string, path: string, host: string): Promise<string> =>
  new Promise((resolve, reject) => {
    const target = new URL(path, connectUrl);
    const request = httpRequest(
      { hostname: target.hostname, port: target.port, path: target.pathname, headers: { host } },
      (response) => {
        let body = '';
        response.setEncoding('utf8');
        response.on('data', (chunk: string) => {
          body += chunk;
        });
        response.on('end', () => resolve(body));
      },
    );
    request.on('error', reject);
    request.end();
  });

const resolveTenantThroughHost = async (
  connectUrl: string,
  host: string,
): Promise<string | null> => {
  const body = await getWithHost(connectUrl, '/api/public/offer', host);
  const parsed = z
    .object({ ok: z.literal(true), data: z.object({ tenant: z.object({ name: z.string() }) }) })
    .safeParse(JSON.parse(body));
  return parsed.success ? parsed.data.data.tenant.name : null;
};

const runSelfServeAdd = async (input: {
  tenantBaseUrl: string;
  connectUrl: string;
  databaseUrl: string;
}): Promise<void> => {
  let browser: Browser | null = null;
  try {
    browser = await launchBrowser();
    const context = await browser.newContext();
    const page = await context.newPage();
    await page.goto(`${input.tenantBaseUrl}/login`, { waitUntil: 'networkidle' });
    await signInWithPassword(page, CREATOR_EMAIL, CREATOR_PASSWORD);
    await page.getByTestId('tenant-name').waitFor({ state: 'visible', timeout: 20000 });
    await page.goto(`${input.tenantBaseUrl}/panel/settings#company`, { waitUntil: 'networkidle' });

    await page.getByTestId('tenant-domain-input').fill('sklep.acme.localhost');
    await page.getByTestId('tenant-domain-add').click();
    await page.getByTestId('tenant-domain-error').waitFor({ state: 'visible', timeout: 20000 });
    assert(
      await readDomainRow(input.databaseUrl, 'sklep.acme.localhost') === null,
      'the platform base domain was accepted as a custom domain',
    );
    console.log('custom-domain-e2e: self-serve add refused a platform subdomain OK');

    await page.getByTestId('tenant-domain-input').fill(SELF_SERVE_HOST);
    await page.getByTestId('tenant-domain-add').click();
    const row = page.getByTestId(`tenant-domain-${SELF_SERVE_HOST}`);
    await row.waitFor({ state: 'visible', timeout: 20000 });
    assert(
      (await row.textContent())?.includes('Czeka na DNS') === true,
      'a self-serve domain did not land in the pending state',
    );

    const pending = await readDomainRow(input.databaseUrl, SELF_SERVE_HOST);
    assert(
      pending?.verified === false && pending.provider === 'manual' && pending.kind === 'custom',
      `manual mode stored an unexpected row: ${JSON.stringify(pending)}`,
    );
    console.log('custom-domain-e2e: self-serve add stored a pending manual row OK');

    await verifyDomainRow(input.databaseUrl, SELF_SERVE_HOST);
    await page.reload({ waitUntil: 'networkidle' });
    await page.getByTestId(`tenant-domain-status-${SELF_SERVE_HOST}`).waitFor({
      state: 'visible',
      timeout: 20000,
    });
    assert(
      (await page.getByTestId(`tenant-domain-status-${SELF_SERVE_HOST}`).textContent()) === 'Działa',
      'the Studio did not show the operator-verified domain as active',
    );

    const resolved = await resolveTenantThroughHost(input.connectUrl, SELF_SERVE_HOST);
    assert(
      resolved === 'Acme Courses',
      `the self-serve host did not resolve the Acme workspace: ${String(resolved)}`,
    );
    console.log('custom-domain-e2e: operator flip made the self-serve host resolve OK');

    await page.goto(`${input.tenantBaseUrl}/panel/settings#company`, { waitUntil: 'networkidle' });
    page.once('dialog', (dialog) => void dialog.accept());
    await page.getByTestId(`tenant-domain-remove-${SELF_SERVE_HOST}`).click();
    await row.waitFor({ state: 'detached', timeout: 20000 });
    assert(
      await readDomainRow(input.databaseUrl, SELF_SERVE_HOST) === null,
      'removing the domain left its row behind',
    );
    console.log('custom-domain-e2e: self-serve removal deleted the row OK');
    await context.close();
  } finally {
    if (browser) await browser.close();
  }
};

const runStudioDomainStatus = async (tenantBaseUrl: string): Promise<void> => {
  let browser: Browser | null = null;
  try {
    browser = await launchBrowser();
    const context = await browser.newContext();
    const page = await context.newPage();
    await page.goto(`${tenantBaseUrl}/login`, { waitUntil: 'networkidle' });
    await signInWithPassword(page, CREATOR_EMAIL, CREATOR_PASSWORD);
    await page.getByTestId('tenant-name').waitFor({ state: 'visible', timeout: 20000 });
    await page.goto(`${tenantBaseUrl}/panel/settings#company`, { waitUntil: 'networkidle' });
    const row = page.getByTestId(`tenant-domain-${CUSTOM_HOST}`);
    await row.waitFor({ state: 'visible', timeout: 20000 });
    assert(
      (await row.textContent())?.includes(CUSTOM_HOST) === true,
      'the settings page did not list the custom domain',
    );
    console.log('custom-domain-e2e: studio domain status OK');
    await context.close();
  } finally {
    if (browser) await browser.close();
  }
};

const startedAt = Date.now();
let server: ChildProcess | null = null;
try {
  console.log('custom-domain-e2e: preparing isolated database...');
  await setupDatabase(baseDatabaseUrl);
  await migrateAndSeed(e2eDatabaseUrl);
  await attachCustomDomain(e2eDatabaseUrl);
  console.log('custom-domain-e2e: building the web SPA...');
  await buildWeb();
  const port = await ephemeralPort();
  const connectUrl = `http://127.0.0.1:${port}`;
  const tenantBaseUrl = `http://${TENANT_HOST}:${port}`;
  const customBaseUrl = `http://${CUSTOM_HOST}:${port}`;
  console.log(`custom-domain-e2e: booting server on port ${port}...`);
  server = await bootServer({
    port,
    healthUrl: `${connectUrl}/api/health`,
    env: {
      DATABASE_URL: e2eDatabaseUrl,
      APP_BASE_URL: tenantBaseUrl,
      APP_BASE_DOMAIN: 'localhost',
      WEB_DIST_DIR: 'dist/web',
      AUTH_DEV_EXPOSE_MAGIC_LINKS: 'true',
      EMAIL_PROVIDER: 'dev',
      SIMULATED_PAYMENTS: 'true',
    },
  });
  await runCustomHostSignIn(customBaseUrl, tenantBaseUrl);
  await runCustomHostPasskey(customBaseUrl);
  await runStudioDomainStatus(tenantBaseUrl);
  await runSelfServeAdd({ tenantBaseUrl, connectUrl, databaseUrl: e2eDatabaseUrl });
  console.log(`\ncustom-domain-e2e: PASS (${((Date.now() - startedAt) / 1000).toFixed(1)}s)`);
} catch (error) {
  const message = error instanceof E2eFailure ? error.message : String(error);
  console.error(`\ncustom-domain-e2e: FAIL\n${message}`);
  process.exitCode = 1;
} finally {
  if (server) await killServer(server);
  rmSync(webDistDir, { recursive: true, force: true });
  await dropDatabase(baseDatabaseUrl);
}
