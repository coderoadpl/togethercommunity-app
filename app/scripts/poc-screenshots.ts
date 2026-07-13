import { spawn, type ChildProcess } from 'node:child_process';
import { mkdirSync } from 'node:fs';
import { createServer } from 'node:net';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { chromium, type Browser, type BrowserContext, type Page } from 'playwright-core';

import { API_PATHS, TENANT_HEADER, looseEnvelopeSchema, publicOfferOutputSchema } from '@core/contract/index.js';

const rootDir = join(dirname(fileURLToPath(import.meta.url)), '..');
const tsxBin = join(rootDir, 'node_modules/.bin/tsx');
const viteBin = join(rootDir, 'node_modules/.bin/vite');
const webDistDir = join(rootDir, 'dist/web');
const outputDir = join(rootDir, 'tasks/poc-screenshots');

const devDatabaseUrl =
  process.env['DATABASE_URL'] ?? 'postgres://together:together@localhost:48912/together';

const buyerEmail = 'buyer.shots@together.dev';

class ShotsFailure extends Error {}

const fail = (message: string): never => {
  throw new ShotsFailure(message);
};

function assert(condition: boolean, message: string): asserts condition {
  if (!condition) throw new ShotsFailure(message);
}

const delay = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms));

interface Run {
  code: number;
  stdout: string;
  stderr: string;
}

const run = (cmd: string, args: string[], env: NodeJS.ProcessEnv = {}): Promise<Run> =>
  new Promise((resolve) => {
    const child = spawn(cmd, args, { cwd: rootDir, env: { ...process.env, ...env } });
    let stdout = '';
    let stderr = '';
    child.stdout?.on('data', (chunk) => {
      stdout += String(chunk);
    });
    child.stderr?.on('data', (chunk) => {
      stderr += String(chunk);
    });
    child.on('error', (cause) => resolve({ code: 1, stdout, stderr: `${stderr}${String(cause)}` }));
    child.on('close', (code) => resolve({ code: code ?? 0, stdout, stderr }));
  });

const ephemeralPort = (): Promise<number> =>
  new Promise((resolve, reject) => {
    const probe = createServer();
    probe.once('error', reject);
    probe.listen(0, () => {
      const address = probe.address();
      if (address === null || typeof address === 'string') {
        probe.close(() => reject(new Error('Could not allocate an ephemeral port')));
        return;
      }
      const { port } = address;
      probe.close(() => resolve(port));
    });
  });

const prepareDatabase = async (): Promise<void> => {
  const up = await run('docker', ['compose', '-f', 'docker-compose.dev.yml', 'up', '-d']);
  assert(up.code === 0, `docker compose up failed:\n${up.stdout}${up.stderr}`);
  const migrate = await run(tsxBin, ['adapters/db/migrate.ts'], { DATABASE_URL: devDatabaseUrl });
  assert(migrate.code === 0, `Migration failed:\n${migrate.stdout}${migrate.stderr}`);
  const seed = await run(tsxBin, ['adapters/db/seed.ts'], { DATABASE_URL: devDatabaseUrl });
  assert(seed.code === 0, `Seed failed:\n${seed.stdout}${seed.stderr}`);
};

const buildWeb = async (): Promise<void> => {
  const build = await run(viteBin, ['build', '--config', 'apps/web/vite.config.ts']);
  assert(build.code === 0, `Web build failed:\n${build.stdout}${build.stderr}`);
};

const bootServer = async (port: number, appBaseUrl: string, connectUrl: string): Promise<ChildProcess> => {
  const child = spawn(tsxBin, ['apps/server/src/entry.node.ts'], {
    cwd: rootDir,
    detached: true,
    env: {
      ...process.env,
      PORT: String(port),
      DATABASE_URL: devDatabaseUrl,
      APP_BASE_URL: appBaseUrl,
      APP_BASE_DOMAIN: 'localhost',
      WEB_DIST_DIR: webDistDir,
      SIMULATED_PAYMENTS: 'true',
      AUTH_DEV_EXPOSE_MAGIC_LINKS: 'true',
    },
  });
  let logs = '';
  child.stdout?.on('data', (chunk) => {
    logs += String(chunk);
  });
  child.stderr?.on('data', (chunk) => {
    logs += String(chunk);
  });
  let exitInfo: string | null = null;
  child.on('exit', (code, signal) => {
    exitInfo = `code=${String(code)} signal=${String(signal)}`;
  });

  const healthUrl = `${connectUrl}${API_PATHS.health}`;
  const deadline = Date.now() + 20000;
  while (Date.now() < deadline) {
    if (exitInfo !== null) {
      fail(`Server exited before becoming ready (${exitInfo}).\n--- server output ---\n${logs}`);
    }
    try {
      const response = await fetch(healthUrl);
      if (response.ok) return child;
    } catch {
      // not accepting connections yet
    }
    await delay(250);
  }
  throw new ShotsFailure(`Server did not become ready within 20s on port ${port}.\n--- server output ---\n${logs}`);
};

const killServer = async (child: ChildProcess): Promise<void> => {
  if (child.exitCode !== null || child.signalCode !== null) return;
  const { pid } = child;
  const signalGroup = (signal: NodeJS.Signals): void => {
    try {
      if (pid !== undefined) process.kill(-pid, signal);
    } catch {
      child.kill(signal);
    }
  };
  const exited = new Promise<void>((resolve) => child.once('exit', () => resolve()));
  signalGroup('SIGTERM');
  await Promise.race([exited, delay(3000)]);
  if (child.exitCode === null && child.signalCode === null) signalGroup('SIGKILL');
};

const publishedProductId = async (connectUrl: string): Promise<string> => {
  const response = await fetch(`${connectUrl}${API_PATHS.publicOffer}`, {
    headers: { [TENANT_HEADER]: 'studio' },
  });
  assert(response.ok, `public offer request failed with HTTP ${response.status}`);
  const parsed = looseEnvelopeSchema.parse(await response.json());
  assert(parsed.ok, 'public offer returned an error envelope');
  const offer = publicOfferOutputSchema.parse(parsed.data);
  const product = offer.products[0];
  if (!product) return fail('studio tenant has no published product to check out');
  return product.id;
};

const shoot = async (page: Page, name: string): Promise<void> => {
  await delay(500);
  await page.screenshot({ path: join(outputDir, name), animations: 'disabled' });
};

const captureCreatorPanel = async (context: BrowserContext, studioBaseUrl: string): Promise<void> => {
  const page = await context.newPage();

  await page.goto(`${studioBaseUrl}/login`, { waitUntil: 'load' });
  await page.getByTestId('login-email').waitFor({ state: 'visible', timeout: 20000 });
  await shoot(page, '01-login.png');

  await page.getByTestId('login-email').fill('creator@together.dev');
  await page.getByTestId('login-password').fill('demo1234');
  await page.getByTestId('signin-submit').click();

  await page.getByTestId('tenant-name').waitFor({ state: 'visible', timeout: 20000 });
  assert(
    (await page.getByTestId('tenant-name').textContent()) === 'Studio Demo',
    'creator sign-in did not open the Studio workspace',
  );
  await page.getByText('Kurs Together 101').first().waitFor({ state: 'visible', timeout: 20000 });
  await shoot(page, '02-creator-panel-products.png');

  await page.getByTestId('section-members').click();
  await page.getByTestId('export-csv').waitFor({ state: 'visible', timeout: 20000 });
  await page.getByTestId('export-json').waitFor({ state: 'visible', timeout: 20000 });
  await page.getByText('student1@together.dev').first().waitFor({ state: 'visible', timeout: 20000 });
  await shoot(page, '03-creator-panel-members.png');

  await page.close();
};

const captureBuyerJourney = async (
  context: BrowserContext,
  studioBaseUrl: string,
  productId: string,
): Promise<void> => {
  const page = await context.newPage();

  await page.goto(`${studioBaseUrl}/checkout/${productId}`, { waitUntil: 'load' });
  await page.getByText('Kurs Together 101').first().waitFor({ state: 'visible', timeout: 20000 });
  const simulateButton = page.getByRole('button', { name: 'Simulate payment (dev)' });
  await simulateButton.waitFor({ state: 'visible', timeout: 20000 });
  await shoot(page, '04-checkout.png');

  await page.getByLabel('email').fill(buyerEmail);
  await simulateButton.click();

  await page.getByText('You have access').waitFor({ state: 'visible', timeout: 20000 });
  const magicLink = page.getByRole('link', { name: 'Open your course' });
  await magicLink.waitFor({ state: 'visible', timeout: 20000 });
  const magicLinkUrl = await magicLink.getAttribute('href');
  assert(magicLinkUrl !== null && magicLinkUrl.length > 0, 'success state did not expose a magic link');
  await shoot(page, '05-checkout-success.png');

  await magicLink.click();
  await page.waitForURL('**/my', { timeout: 20000 });
  await page.goto(`${studioBaseUrl}/my/products`, { waitUntil: 'load' });
  await page.getByRole('heading', { name: 'My products' }).waitFor({ state: 'visible', timeout: 20000 });
  await page.getByText('Kurs Together 101').first().waitFor({ state: 'visible', timeout: 20000 });
  await shoot(page, '06-member-my-products.png');

  await page.goto(`${studioBaseUrl}/my/course/${productId}`, { waitUntil: 'load' });
  await page.getByText('Course content coming soon').waitFor({ state: 'visible', timeout: 20000 });
  await shoot(page, '07-member-course-stub.png');

  await page.close();
};

const startedAt = Date.now();
let server: ChildProcess | null = null;
let browser: Browser | null = null;

try {
  mkdirSync(outputDir, { recursive: true });
  console.log('shots:poc: preparing the dev database...');
  await prepareDatabase();
  console.log('shots:poc: building the web SPA...');
  await buildWeb();

  const port = await ephemeralPort();
  const connectUrl = `http://127.0.0.1:${port}`;
  const studioBaseUrl = `http://studio.localhost:${port}`;
  console.log(`shots:poc: booting server on port ${port}...`);
  server = await bootServer(port, studioBaseUrl, connectUrl);

  const productId = await publishedProductId(connectUrl);
  console.log(`shots:poc: checking out product ${productId}`);

  browser = await chromium.launch({ channel: 'chrome', headless: true });
  const viewport = { width: 1440, height: 900 };

  const pinEnglish = async (context: BrowserContext): Promise<BrowserContext> => {
    await context.addInitScript(() => {
      try {
        window.localStorage.setItem('together-language', 'en');
      } catch {
        // storage disabled — the choice simply won't persist
      }
    });
    return context;
  };

  const creatorContext = await pinEnglish(await browser.newContext({ viewport, deviceScaleFactor: 2 }));
  await captureCreatorPanel(creatorContext, studioBaseUrl);
  await creatorContext.close();

  const buyerContext = await pinEnglish(await browser.newContext({ viewport, deviceScaleFactor: 2 }));
  await captureBuyerJourney(buyerContext, studioBaseUrl, productId);
  await buyerContext.close();

  console.log(`\nshots:poc: PASS (${((Date.now() - startedAt) / 1000).toFixed(1)}s) -> ${outputDir}`);
} catch (error) {
  const message = error instanceof ShotsFailure ? error.message : String(error);
  console.error(`\nshots:poc: FAIL\n${message}`);
  process.exitCode = 1;
} finally {
  if (browser) await browser.close();
  if (server) await killServer(server);
}
