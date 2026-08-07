import { randomBytes } from 'node:crypto';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import pg from 'pg';
import { chromium, type Browser } from 'playwright-core';
import { z } from 'zod';

import { uniqueTestDatabaseName } from '#adapters/db/test-database-name.js';

import { delay, ephemeralPort, rootDir, run, tsxBin } from './server-harness.js';

const PROBE_DB = uniqueTestDatabaseName('together_quickstart');
const baseDatabaseUrl =
  process.env['DATABASE_URL'] ??
  'postgres://together:together@localhost:48912/together';
const probeUrl = new URL(baseDatabaseUrl);
probeUrl.pathname = `/${PROBE_DB}`;
const probeDatabaseUrl = probeUrl.toString();
const cloneToPanelBudgetMs = 15 * 60_000;

class QuickstartFailure extends Error {}

function assert(condition: boolean, message: string): asserts condition {
  if (!condition) throw new QuickstartFailure(message);
}

const compose = async (
  cloneApp: string,
  project: string,
  args: string[],
): Promise<{ code: number; stdout: string; stderr: string }> =>
  run('docker', ['compose', '--project-name', project, ...args], {}, cloneApp);

const composeLogs = async (cloneApp: string, project: string): Promise<string> => {
  const result = await compose(cloneApp, project, ['logs', '--no-color', '--tail', '200']);
  return `${result.stdout}${result.stderr}`;
};

const recreateDatabase = async (): Promise<void> => {
  const client = new pg.Client({ connectionString: baseDatabaseUrl });
  try {
    await client.connect();
    await client.query(`DROP DATABASE IF EXISTS ${PROBE_DB} WITH (FORCE)`);
    await client.query(`CREATE DATABASE ${PROBE_DB}`);
  } catch (cause) {
    throw new QuickstartFailure(
      `Could not prepare "${PROBE_DB}". Is Postgres running (pnpm run db:up)?\n${String(cause)}`,
    );
  } finally {
    await client.end();
  }
};

const dropDatabase = async (): Promise<void> => {
  const client = new pg.Client({ connectionString: baseDatabaseUrl });
  await client.connect();
  try {
    await client.query(`DROP DATABASE IF EXISTS ${PROBE_DB} WITH (FORCE)`);
  } finally {
    await client.end();
  }
};

const runDatabaseScript = async (script: string): Promise<void> => {
  const result = await run(tsxBin, [script], { DATABASE_URL: probeDatabaseUrl });
  assert(result.code === 0, `${script} failed\n${result.stdout}${result.stderr}`);
};

const tableSchema = z.array(z.object({ table_name: z.string() }));
const countSchema = z.array(z.object({ count: z.coerce.number().int().nonnegative() })).length(1);

const readCounts = async (): Promise<Record<string, number>> => {
  const client = new pg.Client({ connectionString: probeDatabaseUrl });
  await client.connect();
  try {
    const tables = tableSchema.parse(
      (
        await client.query(
          "SELECT table_name FROM information_schema.tables WHERE table_schema = 'public' AND table_type = 'BASE TABLE' ORDER BY table_name",
        )
      ).rows,
    );
    const counts: Record<string, number> = {};
    for (const { table_name: table } of tables) {
      const rows = countSchema.parse(
        (await client.query(`SELECT count(*) AS count FROM ${pg.escapeIdentifier(table)}`)).rows,
      );
      counts[table] = rows[0]?.count ?? 0;
    }
    return counts;
  } finally {
    await client.end();
  }
};

const verifyRepeatableSeed = async (): Promise<void> => {
  console.log('quickstart:probe: checking repeatable seed...');
  await recreateDatabase();
  await runDatabaseScript('adapters/db/migrate.ts');
  await runDatabaseScript('adapters/db/seed.ts');
  const seededCounts = await readCounts();
  assert(
    (seededCounts['tenants'] ?? 0) > 0 &&
      (seededCounts['user'] ?? 0) > 0 &&
      (seededCounts['products'] ?? 0) > 0,
    `Fresh seed did not create the documented demo data\n${JSON.stringify(seededCounts)}`,
  );
  await runDatabaseScript('adapters/db/seed.ts');
  const repeatedCounts = await readCounts();
  assert(
    JSON.stringify(repeatedCounts) === JSON.stringify(seededCounts),
    `Repeated seed changed row counts\nbefore=${JSON.stringify(seededCounts)}\nafter=${JSON.stringify(repeatedCounts)}`,
  );
};

const waitForReady = async (url: string, cloneApp: string, project: string): Promise<void> => {
  const deadline = Date.now() + 10 * 60_000;
  while (Date.now() < deadline) {
    try {
      const response = await fetch(`${url}/api/health/ready`);
      if (response.ok) return;
    } catch {
      await delay(500);
      continue;
    }
    await delay(500);
  }
  throw new QuickstartFailure(`Compose stack did not become ready\n${await composeLogs(cloneApp, project)}`);
};

const createEnvironment = (httpPort: number, httpsPort: number, project: string): string => {
  const hex = (): string => randomBytes(32).toString('hex');
  return [
    'NODE_ENV=production',
    'APP_ENV=staging',
    `APP_BASE_URL=http://localhost:${String(httpPort)}`,
    'APP_BASE_DOMAIN=',
    'TENANT_CREATION=open',
    `BETTER_AUTH_SECRET=${hex()}`,
    'AUTH_TRUSTED_PROXY_HEADER=x-forwarded-for',
    `SECRETS_MASTER_KEY=${randomBytes(32).toString('base64')}`,
    'SECURE_COOKIES=false',
    'PAYMENT_PROVIDER=fake',
    'KSEF_ENVIRONMENT=production',
    'SIMULATED_PAYMENTS=false',
    'AUTH_DEV_EXPOSE_MAGIC_LINKS=false',
    'EMAIL_PROVIDER=dev',
    `EMAIL_DISPATCH_SECRET=${hex()}`,
    `MARKETING_TICK_SECRET=${hex()}`,
    `CRON_SECRET=${hex()}`,
    'NOTIFY_EMAIL=false',
    'POSTGRES_USER=together',
    `POSTGRES_PASSWORD=${hex()}`,
    'POSTGRES_DB=together',
    `SELF_HOST_HTTP_PORT=${String(httpPort)}`,
    `SELF_HOST_HTTPS_PORT=${String(httpsPort)}`,
    `COMPOSE_PROJECT_NAME=${project}`,
    '',
  ].join('\n');
};

const driveFirstRun = async (baseUrl: string): Promise<void> => {
  let browser: Browser | null = null;
  try {
    const chromeExecutablePath = process.env['PLAYWRIGHT_CHROME_EXECUTABLE_PATH'];
    browser = await chromium.launch(
      chromeExecutablePath
        ? { executablePath: chromeExecutablePath, headless: true }
        : { channel: 'chrome', headless: true },
    );
    const page = await browser.newPage();
    await page.goto(`${baseUrl}/register`, { waitUntil: 'networkidle' });
    await page.locator('#register-name').fill('Probe Owner');
    await page.locator('#register-email').fill('owner@probe.together');
    await page.locator('#register-password').fill('probe-password-2026');
    await page.locator('button[type="submit"]').click();
    await page.locator('#tenant-name').waitFor({ state: 'visible', timeout: 30_000 });
    await page.locator('#tenant-name').fill('Probe Community');
    await page.locator('#tenant-slug').fill('probe-community');
    await page.locator('button[type="submit"]').click();
    await page.getByTestId('onboarding-checklist').waitFor({ state: 'visible', timeout: 30_000 });
    assert(
      (await page.getByTestId('tenant-name').textContent()) === 'Probe Community',
      'First-run owner reached a panel for the wrong tenant',
    );
    assert(new URL(page.url()).pathname === '/panel', `First run ended on ${page.url()}, not /panel`);
  } finally {
    if (browser !== null) await browser.close();
  }
};

const temporaryDirectory = mkdtempSync(join(tmpdir(), 'together-clone-to-panel-'));
const cloneRoot = join(temporaryDirectory, 'together');
const cloneApp = join(cloneRoot, 'app');
const project = `together-probe-${String(process.pid)}-${randomBytes(4).toString('hex')}`;
let composeStarted = false;
let databaseCreated = false;

try {
  databaseCreated = true;
  await verifyRepeatableSeed();

  const startedAt = Date.now();
  const repositoryRoot = join(rootDir, '..');
  const headResult = await run('git', ['rev-parse', '--verify', 'HEAD^{commit}'], {}, repositoryRoot);
  const headSha = process.env['GITHUB_SHA'] ?? headResult.stdout.trim();
  assert(headResult.code === 0 && /^[0-9a-f]{40}$/.test(headSha), 'Quickstart probe could not resolve the current commit SHA');
  const commitResult = await run('git', ['cat-file', '-e', `${headSha}^{commit}`], {}, repositoryRoot);
  assert(commitResult.code === 0, `Quickstart probe cannot read commit ${headSha}`);

  console.log(`quickstart:probe: cloning commit ${headSha.slice(0, 12)}...`);
  const clone = await run(
    'git',
    ['clone', '--local', '--no-hardlinks', '--no-checkout', repositoryRoot, cloneRoot],
    {},
    temporaryDirectory,
  );
  assert(clone.code === 0, `Clean clone failed\n${clone.stdout}${clone.stderr}`);
  const checkout = await run('git', ['checkout', '--detach', headSha], {}, cloneRoot);
  assert(checkout.code === 0, `Clean clone checkout failed\n${checkout.stdout}${checkout.stderr}`);

  const [httpPort, httpsPort] = await Promise.all([ephemeralPort(), ephemeralPort()]);
  assert(httpPort !== httpsPort, 'Could not allocate distinct self-host ports');
  writeFileSync(join(cloneApp, '.env'), createEnvironment(httpPort, httpsPort, project), { mode: 0o600 });

  console.log('quickstart:probe: building the production image...');
  const build = await compose(cloneApp, project, ['build']);
  assert(build.code === 0, `docker compose build failed\n${build.stdout}${build.stderr}`);

  console.log('quickstart:probe: running docker compose up...');
  const up = await compose(cloneApp, project, ['up', '-d']);
  composeStarted = true;
  assert(up.code === 0, `docker compose up failed\n${up.stdout}${up.stderr}`);

  const baseUrl = `http://localhost:${String(httpPort)}`;
  await waitForReady(baseUrl, cloneApp, project);
  console.log('quickstart:probe: completing first-run setup in the browser...');
  await driveFirstRun(baseUrl);

  const elapsedMs = Date.now() - startedAt;
  assert(elapsedMs < cloneToPanelBudgetMs, `Clone-to-panel exceeded 900 s (${(elapsedMs / 1000).toFixed(1)} s)`);
  console.log(`quickstart:probe: PASS (${(elapsedMs / 1000).toFixed(1)}s clone-to-panel)`);
} catch (error) {
  const message = error instanceof Error ? error.stack ?? error.message : String(error);
  if (composeStarted) console.error(await composeLogs(cloneApp, project));
  console.error(`quickstart:probe: FAIL\n${message}`);
  process.exitCode = 1;
} finally {
  if (composeStarted) {
    const down = await compose(cloneApp, project, ['down', '-v', '--remove-orphans', '--rmi', 'local']);
    if (down.code !== 0) {
      console.error(`quickstart:probe: cleanup failed\n${down.stdout}${down.stderr}`);
      process.exitCode = 1;
    }
  }
  if (databaseCreated) {
    await dropDatabase().catch((cause) => {
      console.error(`quickstart:probe: database cleanup failed\n${String(cause)}`);
      process.exitCode = 1;
    });
  }
  rmSync(temporaryDirectory, { recursive: true, force: true });
}
