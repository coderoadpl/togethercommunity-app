import { spawn, type ChildProcess } from 'node:child_process';
import { mkdirSync, statSync } from 'node:fs';
import { createServer } from 'node:net';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import {
  chromium,
  type Browser,
  type BrowserContext,
  type Locator,
  type Page,
} from 'playwright-core';

import { API_PATHS, authConfigOutputSchema, envelopeSchema } from '#core/contract/index.js';

import { SCREENS, VIEWPORTS, includesViewport, visible, VisualFailure, type AuthKind, type ScreenSpec } from './visual-screen-inventory.js';

import type { ThemeMode } from '../apps/web/src/theme.js';
import { visualSeedTime as SEED_BASE_TIME } from './visual-request-policy.js';
import { applyChrome, settlePage, stubNonDeterministicRequests } from './visual-browser-setup.js';
import { requestMagicLink, signInWithPassword } from './login-flow.js';

const rootDir = join(dirname(fileURLToPath(import.meta.url)), '..');
const tsxBin = join(rootDir, 'node_modules/.bin/tsx');
const viteBin = join(rootDir, 'node_modules/.bin/vite');
const webDistDir = join(rootDir, 'dist/web');
const currentDir = join(rootDir, 'out/visual-app/current');
const appScreens = SCREENS.filter((screen) => ['boot-splash', 'login', 'lesson'].includes(screen.name));
const chromeExecutablePath = process.env['PLAYWRIGHT_CHROME_EXECUTABLE_PATH'];
const chromeCdpEndpoint = process.env['PLAYWRIGHT_CHROME_CDP_ENDPOINT'];
const playwrightWsEndpoint = process.env['PLAYWRIGHT_WS_ENDPOINT'];

const minPngBytes = 10 * 1024;

const THEMES: ThemeMode[] = ['shadcn'];

const fail = (message: string): never => {
  throw new VisualFailure(message);
};

function assert(condition: boolean, message: string): asserts condition {
  if (!condition) throw new VisualFailure(message);
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

const managedDatabaseUrl = 'postgres://together:together@localhost:48912/together';
const devDatabaseUrl =
  process.env['E2E_DATABASE_URL'] ??
  process.env['DATABASE_URL'] ??
  managedDatabaseUrl;
const managesPostgres = process.env['E2E_DATABASE_URL'] === undefined;

const prepareDatabase = async (): Promise<void> => {
  if (managesPostgres) {
    const up = await run('docker', ['compose', '-f', 'docker-compose.dev.yml', 'up', '-d']);
    assert(up.code === 0, `docker compose up failed:\n${up.stdout}${up.stderr}`);
  }
  const migrate = await run(tsxBin, ['adapters/db/migrate.ts'], { DATABASE_URL: devDatabaseUrl });
  assert(migrate.code === 0, `Migration failed:\n${migrate.stdout}${migrate.stderr}`);
  const seed = await run(tsxBin, ['adapters/db/reseed.ts'], {
    DATABASE_URL: devDatabaseUrl,
    SEED_BASE_TIME,
  });
  assert(seed.code === 0, `Reseed failed:\n${seed.stdout}${seed.stderr}`);
};

const buildWeb = async (): Promise<void> => {
  const build = await run(
    viteBin,
    ['build', '--config', 'apps/web/vite.config.ts'],
    { APP_COMMIT_SHA: '' },
  );
  assert(build.code === 0, `Web build failed:\n${build.stdout}${build.stderr}`);
};

const bootServer = async (
  port: number,
  appBaseUrl: string,
  connectUrl: string,
): Promise<ChildProcess> => {
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
      TOGETHER_VISUAL_CLOCK: SEED_BASE_TIME,
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
  throw new VisualFailure(
    `Server did not become ready within 20s on port ${port}.\n--- server output ---\n${logs}`,
  );
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

const signInCreator = async (page: Page, studioBaseUrl: string): Promise<void> => {
  await page.goto(`${studioBaseUrl}/login`, { waitUntil: 'load' });
  await signInWithPassword(page, 'creator@together.dev', 'demo-password-15');
  await page.getByTestId('tenant-name').waitFor(visible);
};

const signInMember = async (page: Page, studioBaseUrl: string): Promise<void> => {
  await page.goto(`${studioBaseUrl}/login`, { waitUntil: 'load' });
  await requestMagicLink(page, 'kursant.aktywny@together.dev');
  const magicLink = page.getByRole('link', { name: 'Otwórz magiczny link' });
  await magicLink.waitFor(visible);
  const href = await magicLink.getAttribute('href');
  assert(href !== null && href.length > 0, 'login page did not expose a dev magic link');
  await page.goto(href, { waitUntil: 'load' });
  await page.waitForURL('**/my', { timeout: 20000 });
};

type StorageState = Awaited<ReturnType<BrowserContext['storageState']>>;

const bootstrapAuthState = async (
  browser: Browser,
  studioBaseUrl: string,
  signIn: (page: Page, baseUrl: string) => Promise<void>,
): Promise<StorageState> => {
  const context = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  await applyChrome(context);
  const page = await context.newPage();
  await signIn(page, studioBaseUrl);
  const state = await context.storageState();
  await context.close();
  return state;
};

const screenUrl = (studioBaseUrl: string, screen: ScreenSpec): string => {
  if (screen.tenantSlug === undefined) return `${studioBaseUrl}${screen.path}`;
  const url = new URL(studioBaseUrl);
  url.hostname = `${screen.tenantSlug}.localhost`;
  return `${url.origin}${screen.path}`;
};

const stableMasks = (page: Page, screen: ScreenSpec): Locator[] => screen.mask?.(page) ?? [];

const startedAt = Date.now();
let server: ChildProcess | null = null;
let browser: Browser | null = null;

try {
  mkdirSync(currentDir, { recursive: true });

  console.log(`visual:app: preparing the dev database (SEED_BASE_TIME=${SEED_BASE_TIME})...`);
  await prepareDatabase();
  console.log('visual:app: building the web SPA...');
  await buildWeb();

  const port = await ephemeralPort();
  const connectUrl = `http://127.0.0.1:${port}`;
  const studioBaseUrl = `http://studio.localhost:${port}`;
  console.log(`visual:app: booting server on port ${port}...`);
  server = await bootServer(port, studioBaseUrl, connectUrl);

  browser = playwrightWsEndpoint !== undefined
    ? await chromium.connect(playwrightWsEndpoint, { exposeNetwork: '<loopback>' })
    : chromeCdpEndpoint === undefined
      ? await chromium.launch(
          chromeExecutablePath
            ? { executablePath: chromeExecutablePath, headless: true }
            : { channel: 'chrome', headless: true },
        )
      : await chromium.connectOverCDP(chromeCdpEndpoint);

  console.log('visual:app: signing in the member and creator fixtures...');
  const memberState = await bootstrapAuthState(browser, studioBaseUrl, signInMember);
  const creatorState = await bootstrapAuthState(browser, studioBaseUrl, signInCreator);
  const stateFor = (auth: AuthKind): StorageState | undefined => {
    if (auth === 'member') return memberState;
    if (auth === 'creator') return creatorState;
    return undefined;
  };

  let captured = 0;

  for (const theme of THEMES) {
    for (const viewport of VIEWPORTS) {
      for (const auth of ['public', 'member', 'creator'] satisfies AuthKind[]) {
        const screens = appScreens.filter((screen) =>
          screen.auth === auth
          && includesViewport(screen, viewport),
        );
        const storageState = stateFor(auth);
        const context = await browser.newContext({
          viewport: { width: viewport.width, height: viewport.height },
          deviceScaleFactor: 1,
          colorScheme: 'light',
          locale: 'pl-PL',
          timezoneId: 'UTC',
          reducedMotion: 'reduce',
          ...(storageState === undefined ? {} : { storageState }),
        });
        await applyChrome(context);
        await stubNonDeterministicRequests(context);
        const page = await context.newPage();
        await page.clock.setFixedTime(new Date(SEED_BASE_TIME));

        for (const screen of screens) {
          const file = `${screen.name}--${theme}--${viewport.name}.png`;
          const preparation = screen.prepare === undefined ? undefined : await screen.prepare(page);
          try {
            const authConfig = screen.name === 'login'
              ? page.waitForResponse((response) => new URL(response.url()).pathname === API_PATHS.authConfig)
              : undefined;
            const response = await page.goto(screenUrl(studioBaseUrl, screen), { waitUntil: 'load' });
            assert(response?.ok() === true, `${screen.name}: document did not load`);
            if (authConfig) {
              const configResponse = await authConfig;
              assert(configResponse.ok(), 'Live auth config did not load');
              const config = envelopeSchema(authConfigOutputSchema).parse(await configResponse.json());
              assert(config.ok && config.data.exposeMagicLinks && config.data.passkeysEnabled, 'Seeded auth methods must be enabled');
            }
            if (screen.name === 'lesson') {
              const policy = response?.headers()['content-security-policy'] ?? '';
              assert(policy.includes('frame-src https:') && /script-src [^;]*'nonce-[^']+'/.test(policy), 'Lesson document is missing its media or script nonce policy');
              await page.getByTestId('lesson-embed').waitFor(visible);
              const source = await page.getByTestId('lesson-embed').getAttribute('src');
              assert(source !== null && new URL(source).protocol === 'https:', 'Lesson media must use an HTTPS embed');
            }
            await screen.ready(page);
            await preparation?.renderingInputsReady;
            await settlePage(page, screen.waitForNetworkIdle ?? true);
            if (screen.settled) {
              await screen.settled(page);
              await page.evaluate(
                () =>
                  new Promise<void>((resolve) => {
                    requestAnimationFrame(() => requestAnimationFrame(() => resolve()));
                  }),
              );
            }
            const shotPath = join(currentDir, file);
            await page.screenshot({
              path: shotPath,
              animations: 'disabled',
              caret: 'hide',
              scale: 'css',
              mask: stableMasks(page, screen),
            });
            const { size } = statSync(shotPath);
            const minBytes = screen.minBytes ?? minPngBytes;
            assert(size > minBytes, `${file} is only ${size} bytes (expected > ${minBytes})`);
            captured += 1;
          } finally {
            if (preparation !== undefined) {
              await preparation.cleanup();
              await page.getByRole('status', { name: 'Otwieranie panelu twórcy' }).waitFor({ state: 'hidden', timeout: 20000 });
              await page.getByTestId('dashboard-tile-revenue').waitFor(visible);
            }
          }
        }

        await context.close();
      }
    }
    console.log(`visual:app: captured ${theme} (${captured} screenshots)`);
  }

  const seconds = ((Date.now() - startedAt) / 1000).toFixed(1);
  console.log(`\nvisual:app: PASS (${seconds}s) — ${captured} live captures verified`);
} catch (error) {
  const message = error instanceof VisualFailure ? error.message : String(error);
  console.error(`\nvisual:app: FAIL\n${message}`);
  process.exitCode = 1;
} finally {
  if (browser) await browser.close();
  if (server) await killServer(server);
}
