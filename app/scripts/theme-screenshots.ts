import { spawn, type ChildProcess } from 'node:child_process';
import { mkdirSync, statSync } from 'node:fs';
import { createServer } from 'node:net';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { chromium, type Browser, type BrowserContext, type Page } from 'playwright-core';

import { API_PATHS } from '#core/contract/index.js';

import { requestMagicLink, signInWithPassword } from './login-flow.js';

const rootDir = join(dirname(fileURLToPath(import.meta.url)), '..');
const tsxBin = join(rootDir, 'node_modules/.bin/tsx');
const viteBin = join(rootDir, 'node_modules/.bin/vite');
const webDistDir = join(rootDir, 'dist/web');
const outputDir = join(rootDir, 'tasks/theme-screenshots');

const languageStorageKey = 'together-language';
const colorSchemeStorageKey = 'together-color-scheme';
const capturedColorSchemes = ['light', 'dark'] as const;
type CapturedColorScheme = (typeof capturedColorSchemes)[number];
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
  colorScheme: CapturedColorScheme,
): Promise<BrowserContext> => {
  const context = await browser.newContext({ viewport, deviceScaleFactor: 2, colorScheme });
  await context.addInitScript(
    ({ languageKey, schemeKey, scheme }) => {
      try {
        window.localStorage.setItem(languageKey, 'en');
        window.localStorage.setItem(schemeKey, scheme);
      } catch {
        // storage disabled — the choice simply won't persist
      }
    },
    {
      languageKey: languageStorageKey,
      schemeKey: colorSchemeStorageKey,
      scheme: colorScheme,
    },
  );
  return context;
};

const captureCreatorPanel = async (
  context: BrowserContext,
  studioBaseUrl: string,
  colorScheme: CapturedColorScheme,
): Promise<void> => {
  const page = await context.newPage();

  await page.goto(`${studioBaseUrl}/login`, { waitUntil: 'load' });
  await signInWithPassword(page, 'creator@together.dev', 'demo-password-15');

  await page.getByTestId('tenant-name').waitFor({ state: 'visible', timeout: 20000 });
  assert(
    (await page.getByTestId('tenant-name').textContent()) === 'Studio Demo',
    `creator sign-in did not open the Studio workspace (${colorScheme})`,
  );
  await page.getByTestId('dashboard-tiles').waitFor({ state: 'visible', timeout: 20000 });
  await page.getByTestId('dashboard-member-row').first().waitFor({ state: 'visible', timeout: 20000 });
  await shoot(page, `${colorScheme}-panel.png`);

  await page.close();
};

const captureCheckout = async (
  context: BrowserContext,
  studioBaseUrl: string,
  colorScheme: CapturedColorScheme,
): Promise<void> => {
  const page = await context.newPage();

  await page.goto(`${studioBaseUrl}/checkout/${checkoutProductId}`, { waitUntil: 'load' });
  await page.getByText('Kurs Together 101').first().waitFor({ state: 'visible', timeout: 20000 });
  await page
    .locator('button[type="submit"]', { hasText: /Pay|Simulate/ })
    .waitFor({ state: 'visible', timeout: 20000 });
  await shoot(page, `${colorScheme}-checkout.png`);

  await page.close();
};

const signInMember = async (page: Page, studioBaseUrl: string, email: string): Promise<void> => {
  await page.goto(`${studioBaseUrl}/login`, { waitUntil: 'load' });
  await requestMagicLink(page, email);
  const sent = page.getByTestId('magic-link-sent');
  await sent.waitFor({ state: 'visible', timeout: 20000 });
  const magicLink = sent.locator('a[href]').first();
  await magicLink.waitFor({ state: 'visible', timeout: 20000 });
  const href = await magicLink.getAttribute('href');
  assert(href !== null && href.length > 0, `login page did not expose a dev magic link for ${email}`);
  await page.goto(href, { waitUntil: 'load' });
  await page.waitForURL('**/my', { timeout: 20000 });
};

const captureDarkLoginStates = async (
  browser: Browser,
  studioBaseUrl: string,
  viewport: { width: number; height: number },
): Promise<void> => {
  const context = await newModeContext(browser, viewport, 'dark');
  const page = await context.newPage();

  await page.goto(`${studioBaseUrl}/login`, { waitUntil: 'load' });
  await page.getByTestId('login-email').waitFor({ state: 'visible', timeout: 20000 });
  await shoot(page, 'dark-login.png');

  await signInWithPassword(page, 'creator@together.dev', 'invalid-password');
  await page.getByRole('alert').last().waitFor({ state: 'visible', timeout: 20000 });
  await shoot(page, 'dark-error-alert.png');

  await context.close();
};

const captureDarkCreatorStates = async (
  browser: Browser,
  studioBaseUrl: string,
  viewport: { width: number; height: number },
): Promise<void> => {
  const context = await newModeContext(browser, viewport, 'dark');
  const page = await context.newPage();

  await page.goto(`${studioBaseUrl}/login`, { waitUntil: 'load' });
  await signInWithPassword(page, 'creator@together.dev', 'demo-password-15');
  await page.getByTestId('tenant-name').waitFor({ state: 'visible', timeout: 20000 });

  const coursesNav = page.getByTestId('section-courses');
  await coursesNav.click();
  await page.waitForURL('**/panel/courses', { timeout: 20000 });
  await page.getByTestId('course-row').first().waitFor({ state: 'visible', timeout: 20000 });
  assert((await coursesNav.getAttribute('aria-current')) === 'page', 'courses navigation item is not selected');
  await page.getByTestId('section-products').hover();
  await shoot(page, 'dark-panel-sidebar.png');

  await page.getByTestId('user-menu').hover();
  await page.getByRole('tooltip').waitFor({ state: 'visible', timeout: 20000 });
  await shoot(page, 'dark-tooltip.png');

  await page.getByTestId('section-spaces').click();
  await page.waitForURL('**/panel/spaces', { timeout: 20000 });
  await page.getByTestId('space-archive-space-studio-spolecznosc').waitFor({ state: 'visible', timeout: 20000 });
  await page.getByTestId('space-archive-space-studio-spolecznosc').click();
  await page.getByRole('dialog').waitFor({ state: 'visible', timeout: 20000 });
  await shoot(page, 'dark-dialog.png');

  await context.close();
};

const captureDarkMemberStates = async (
  browser: Browser,
  studioBaseUrl: string,
  viewport: { width: number; height: number },
): Promise<void> => {
  const context = await newModeContext(browser, viewport, 'dark');
  const page = await context.newPage();

  await signInMember(page, studioBaseUrl, 'kursant.aktywny@together.dev');
  await page.getByTestId('course-card-course-js').waitFor({ state: 'visible', timeout: 20000 });
  await shoot(page, 'dark-member-course-grid.png');

  await page.goto(`${studioBaseUrl}/my/courses/course-js/lessons/lesson-js-zmienne-1`, { waitUntil: 'load' });
  await page.getByTestId('lesson-block-0').waitFor({ state: 'visible', timeout: 20000 });
  await shoot(page, 'dark-lesson-page.png');

  await page.setViewportSize({ width: viewport.width, height: 1400 });
  const discussion = page.getByTestId('discussion-section');
  await discussion.waitFor({ state: 'visible', timeout: 20000 });
  await page.getByTestId('discussion-thread-post-js-zmienne-q').waitFor({ state: 'visible', timeout: 20000 });
  const bounds = await discussion.boundingBox();
  if (bounds !== null) {
    await page.evaluate((top) => window.scrollTo(0, Math.max(0, top - 24)), bounds.y);
  }
  await shoot(page, 'dark-discussion-thread.png');

  await context.close();
};

const captureDarkWarningChip = async (
  browser: Browser,
  studioBaseUrl: string,
  viewport: { width: number; height: number },
): Promise<void> => {
  const context = await newModeContext(browser, viewport, 'dark');
  const page = await context.newPage();

  await signInMember(page, studioBaseUrl, 'kursant.wygasly@together.dev');
  await page.goto(`${studioBaseUrl}/my/products`, { waitUntil: 'load' });
  const warningChip = page.getByTestId('grant-status-product-js-full');
  await warningChip.waitFor({ state: 'visible', timeout: 20000 });
  await warningChip.scrollIntoViewIfNeeded();
  await shoot(page, 'dark-warning-chip.png');

  await context.close();
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

  for (const colorScheme of capturedColorSchemes) {
    console.log(`shots:themes: capturing Shadcn (${colorScheme})...`);

    const panelContext = await newModeContext(browser, viewport, colorScheme);
    await captureCreatorPanel(panelContext, studioBaseUrl, colorScheme);
    await panelContext.close();

    const checkoutContext = await newModeContext(browser, viewport, colorScheme);
    await captureCheckout(checkoutContext, studioBaseUrl, colorScheme);
    await checkoutContext.close();
  }

  console.log('shots:themes: capturing verification surfaces (dark)...');
  await captureDarkLoginStates(browser, studioBaseUrl, viewport);
  await captureDarkCreatorStates(browser, studioBaseUrl, viewport);
  await captureDarkMemberStates(browser, studioBaseUrl, viewport);
  await captureDarkWarningChip(browser, studioBaseUrl, viewport);

  console.log(`\nshots:themes: PASS (${((Date.now() - startedAt) / 1000).toFixed(1)}s) -> ${outputDir}`);
} catch (error) {
  const message = error instanceof ShotsFailure ? error.message : String(error);
  console.error(`\nshots:themes: FAIL\n${message}`);
  process.exitCode = 1;
} finally {
  if (browser) await browser.close();
  if (server) await killServer(server);
}
