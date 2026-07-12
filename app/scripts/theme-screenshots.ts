import { spawn, type ChildProcess } from 'node:child_process';
import { mkdirSync, statSync } from 'node:fs';
import { createServer } from 'node:net';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { chromium, type Browser, type BrowserContext, type Page } from 'playwright-core';

import { API_PATHS } from '@core/contract/index.js';

import { MODES, type ThemeMode } from '../apps/web/src/theme.js';

const rootDir = join(dirname(fileURLToPath(import.meta.url)), '..');
const tsxBin = join(rootDir, 'node_modules/.bin/tsx');
const viteBin = join(rootDir, 'node_modules/.bin/vite');
const webDistDir = join(rootDir, 'dist/web');
const outputDir = join(rootDir, 'tasks/theme-screenshots');

const themeStorageKey = 'together-theme-mode';
const checkoutProductId = 'product-studio-kurs-101';
const minPngBytes = 20 * 1024;

const devDatabaseUrl =
  process.env['DATABASE_URL'] ?? 'postgres://together:together@localhost:48912/together';

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

const shoot = async (page: Page, name: string): Promise<void> => {
  await delay(600);
  const path = join(outputDir, name);
  await page.screenshot({ path, animations: 'disabled' });
  const { size } = statSync(path);
  assert(size > minPngBytes, `${name} is only ${size} bytes (expected > ${minPngBytes})`);
};

const newModeContext = async (
  browser: Browser,
  viewport: { width: number; height: number },
  mode: ThemeMode,
): Promise<BrowserContext> => {
  const context = await browser.newContext({ viewport, deviceScaleFactor: 2 });
  await context.addInitScript(
    ([key, value]) => {
      try {
        window.localStorage.setItem(key, value);
      } catch {
        // storage disabled — the choice simply won't persist
      }
    },
    [themeStorageKey, mode] as const,
  );
  return context;
};

const captureCreatorPanel = async (context: BrowserContext, studioBaseUrl: string, mode: ThemeMode): Promise<void> => {
  const page = await context.newPage();

  await page.goto(`${studioBaseUrl}/login`, { waitUntil: 'load' });
  await page.getByTestId('login-email').waitFor({ state: 'visible', timeout: 20000 });
  await page.getByTestId('login-email').fill('creator@together.dev');
  await page.getByTestId('login-password').fill('demo1234');
  await page.getByTestId('signin-submit').click();

  await page.getByTestId('tenant-name').waitFor({ state: 'visible', timeout: 20000 });
  assert(
    (await page.getByTestId('tenant-name').textContent()) === 'Studio Demo',
    `creator sign-in did not open the Studio workspace (${mode})`,
  );
  await page.getByText('Kurs Together 101').first().waitFor({ state: 'visible', timeout: 20000 });
  await shoot(page, `${mode}-panel.png`);

  await page.close();
};

const captureCheckout = async (context: BrowserContext, studioBaseUrl: string, mode: ThemeMode): Promise<void> => {
  const page = await context.newPage();

  await page.goto(`${studioBaseUrl}/checkout/${checkoutProductId}`, { waitUntil: 'load' });
  await page.getByText('Kurs Together 101').first().waitFor({ state: 'visible', timeout: 20000 });
  await page
    .getByRole('button', { name: 'Simulate payment (dev)' })
    .waitFor({ state: 'visible', timeout: 20000 });
  await shoot(page, `${mode}-checkout.png`);

  await page.close();
};

const startedAt = Date.now();
let server: ChildProcess | null = null;
let browser: Browser | null = null;

try {
  mkdirSync(outputDir, { recursive: true });
  console.log('shots:themes: preparing the dev database...');
  await prepareDatabase();
  console.log('shots:themes: building the web SPA...');
  await buildWeb();

  const port = await ephemeralPort();
  const connectUrl = `http://127.0.0.1:${port}`;
  const studioBaseUrl = `http://studio.localhost:${port}`;
  console.log(`shots:themes: booting server on port ${port}...`);
  server = await bootServer(port, studioBaseUrl, connectUrl);

  browser = await chromium.launch({ channel: 'chrome', headless: true });
  const viewport = { width: 1440, height: 900 };

  for (const { id: mode, label } of MODES) {
    console.log(`shots:themes: capturing ${label} (${mode})...`);

    const panelContext = await newModeContext(browser, viewport, mode);
    await captureCreatorPanel(panelContext, studioBaseUrl, mode);
    await panelContext.close();

    const checkoutContext = await newModeContext(browser, viewport, mode);
    await captureCheckout(checkoutContext, studioBaseUrl, mode);
    await checkoutContext.close();
  }

  console.log(`\nshots:themes: PASS (${((Date.now() - startedAt) / 1000).toFixed(1)}s) -> ${outputDir}`);
} catch (error) {
  const message = error instanceof ShotsFailure ? error.message : String(error);
  console.error(`\nshots:themes: FAIL\n${message}`);
  process.exitCode = 1;
} finally {
  if (browser) await browser.close();
  if (server) await killServer(server);
}
