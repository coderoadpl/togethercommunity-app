import { spawn, type ChildProcess } from 'node:child_process';
import { mkdirSync, writeFileSync } from 'node:fs';
import { createServer } from 'node:net';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { chromium, type Browser, type BrowserContext, type Page } from 'playwright-core';

import { API_PATHS } from '#core/contract/index.js';

import type { ThemeMode } from '../apps/web/src/theme.js';
import {
  A11Y_CHECK_IDS,
  CONTRAST_SKIP_REASONS,
  type ContrastOutcome,
  type ContrastSkipReason,
  type ImpactValue,
  type RawFinding,
  runContrastChecksInDocument,
  runSemanticChecksInDocument,
  type SemanticOutcome,
} from './a11y-checks.js';

const rootDir = join(dirname(fileURLToPath(import.meta.url)), '..');
const tsxBin = join(rootDir, 'node_modules/.bin/tsx');
const viteBin = join(rootDir, 'node_modules/.bin/vite');
const webDistDir = join(rootDir, 'dist/web');
const outDir = join(rootDir, 'out/a11y');

const languageStorageKey = 'together-language';

const SEED_BASE_TIME = '2026-07-01T12:00:00.000Z';

const THEMES: ThemeMode[] = ['shadcn'];

const FAILING_IMPACTS: ImpactValue[] = ['serious', 'critical'];
const IMPACT_ORDER: ImpactValue[] = ['critical', 'serious', 'moderate', 'minor'];
const PER_RENDER_FLOOR_DERIVATION = {
  verifiedMinimum: { contrast: 1, semantic: 8 },
  ratio: 0.5,
} as const;
const MIN_CONTRAST_RUNS_FLOOR = 1;
const MIN_CONTRAST_RUNS_PER_RENDER = Math.max(
  MIN_CONTRAST_RUNS_FLOOR,
  Math.floor(PER_RENDER_FLOOR_DERIVATION.verifiedMinimum.contrast * PER_RENDER_FLOOR_DERIVATION.ratio),
);
const MIN_SEMANTIC_CHECKS_PER_RENDER = Math.floor(
  PER_RENDER_FLOOR_DERIVATION.verifiedMinimum.semantic * PER_RENDER_FLOOR_DERIVATION.ratio,
);

type AuthKind = 'public' | 'member' | 'member-free' | 'creator';
type ViewportName = 'desktop' | 'mobile';

const VIEWPORTS: Record<ViewportName, { width: number; height: number }> = {
  desktop: { width: 1440, height: 900 },
  mobile: { width: 390, height: 844 },
};

interface ScreenSpec {
  name: string;
  auth: AuthKind;
  path: string;
  viewports: ViewportName[];
  ready: (page: Page) => Promise<void>;
}

const READY_TIMEOUT_MS = 20000;
const visible = { state: 'visible', timeout: READY_TIMEOUT_MS } as const;
const memberViewports: ViewportName[] = ['desktop', 'mobile'];
const desktopOnly: ViewportName[] = ['desktop'];

const SCREENS: ScreenSpec[] = [
  {
    name: 'login',
    auth: 'public',
    path: '/login',
    viewports: memberViewports,
    ready: (page) => page.getByTestId('login-email').waitFor(visible),
  },
  {
    name: 'checkout-multiprice',
    auth: 'public',
    path: '/checkout/product-club',
    viewports: memberViewports,
    ready: async (page) => {
      await page.getByText('Klub Studio — subskrypcja').first().waitFor(visible);
      await page.locator('#checkout-price-choice').waitFor(visible);
    },
  },
  {
    name: 'my-courses',
    auth: 'member',
    path: '/my',
    viewports: memberViewports,
    ready: async (page) => {
      await page.getByTestId('course-card-course-js').waitFor(visible);
      await page.getByTestId('course-progress-course-js').waitFor(visible);
    },
  },
  {
    name: 'course',
    auth: 'member',
    path: '/my/courses/course-js',
    viewports: memberViewports,
    ready: async (page) => {
      await page.getByTestId('course-tree').first().waitFor(visible);
      await page.getByText('Przejdź do pierwszej lekcji').waitFor(visible);
    },
  },
  {
    name: 'lesson',
    auth: 'member',
    path: '/my/courses/course-js/lessons/lesson-js-zmienne-1',
    viewports: memberViewports,
    ready: async (page) => {
      await page.getByLabel('breadcrumb').waitFor(visible);
      await page.getByTestId('discussion-composer').waitFor(visible);
    },
  },
  {
    name: 'my-products',
    auth: 'member',
    path: '/my/products',
    viewports: memberViewports,
    ready: (page) => page.getByTestId('my-product-product-js-full').waitFor(visible),
  },
  {
    name: 'account',
    auth: 'member',
    path: '/account',
    viewports: memberViewports,
    ready: (page) => page.getByTestId('account-email').waitFor(visible),
  },
  {
    name: 'panel-dashboard',
    auth: 'creator',
    path: '/panel',
    viewports: desktopOnly,
    ready: async (page) => {
      await page.getByTestId('dashboard-tiles').waitFor(visible);
      await page.getByTestId('dashboard-member-row').first().waitFor(visible);
    },
  },
  {
    name: 'panel-products',
    auth: 'creator',
    path: '/panel/products',
    viewports: desktopOnly,
    ready: (page) => page.getByTestId('product-row').first().waitFor(visible),
  },
  {
    name: 'panel-product-editor',
    auth: 'creator',
    path: '/panel/products/product-studio-kurs-101',
    viewports: desktopOnly,
    ready: (page) => page.getByTestId('prices-section').waitFor(visible),
  },
  {
    name: 'panel-course-detail',
    auth: 'creator',
    path: '/panel/courses/course-js',
    viewports: desktopOnly,
    ready: (page) => page.getByTestId('module-card').first().waitFor(visible),
  },
  {
    name: 'panel-members',
    auth: 'creator',
    path: '/panel/members',
    viewports: desktopOnly,
    ready: (page) => page.getByTestId('member-row').first().waitFor(visible),
  },
  {
    name: 'panel-member-detail',
    auth: 'creator',
    path: '/panel/members/member-studio-aktywny',
    viewports: desktopOnly,
    ready: (page) => page.getByTestId('grant-row').first().waitFor(visible),
  },
  {
    name: 'panel-sales',
    auth: 'creator',
    path: '/panel/sales',
    viewports: desktopOnly,
    ready: (page) => page.getByTestId('sales-list').waitFor(visible),
  },
  {
    name: 'panel-integrations',
    auth: 'creator',
    path: '/panel/integrations',
    viewports: desktopOnly,
    ready: (page) => page.getByTestId('bunny-test-connection').waitFor(visible),
  },
  {
    name: 'panel-settings',
    auth: 'creator',
    path: '/panel/settings',
    viewports: desktopOnly,
    ready: (page) => page.getByTestId('add-passkey').waitFor(visible),
  },
];

class ScanFailure extends Error {}

const fail = (message: string): never => {
  throw new ScanFailure(message);
};

function assert(condition: boolean, message: string): asserts condition {
  if (!condition) throw new ScanFailure(message);
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

const devDatabaseUrl =
  process.env['DATABASE_URL'] ?? 'postgres://together:together@localhost:48912/together';

const prepareDatabase = async (): Promise<void> => {
  const up = await run('docker', ['compose', '-f', 'docker-compose.dev.yml', 'up', '-d']);
  assert(up.code === 0, `docker compose up failed:\n${up.stdout}${up.stderr}`);
  const migrate = await run(tsxBin, ['adapters/db/migrate.ts'], { DATABASE_URL: devDatabaseUrl });
  assert(migrate.code === 0, `Migration failed:\n${migrate.stdout}${migrate.stderr}`);
  const seed = await run(tsxBin, ['adapters/db/seed.ts'], {
    DATABASE_URL: devDatabaseUrl,
    SEED_BASE_TIME,
  });
  assert(seed.code === 0, `Seed failed:\n${seed.stdout}${seed.stderr}`);
};

const buildWeb = async (): Promise<void> => {
  const build = await run(viteBin, ['build', '--config', 'apps/web/vite.config.ts']);
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
  const deadline = Date.now() + READY_TIMEOUT_MS;
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
  throw new ScanFailure(
    `Server did not become ready within ${String(READY_TIMEOUT_MS / 1000)}s on port ${port}.\n--- server output ---\n${logs}`,
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

const isLocalHost = (hostname: string): boolean =>
  hostname === 'localhost' || hostname === '127.0.0.1' || hostname.endsWith('.localhost');

const defineEsbuildNameHelper = async (context: BrowserContext): Promise<void> => {
  await context.addInitScript({
    content: 'globalThis.__name = globalThis.__name ?? ((target) => target);',
  });
};

const stubNonDeterministicRequests = async (context: BrowserContext): Promise<void> => {
  await context.route('**/*', (route) => {
    const url = new URL(route.request().url());
    if (url.pathname === '/api/student/progress/last-viewed') return route.abort();
    if (isLocalHost(url.hostname)) return route.continue();
    return route.abort();
  });
};

const applyChrome = async (context: BrowserContext): Promise<void> => {
  await context.addInitScript(
    (langKey) => {
      try {
        window.localStorage.setItem(langKey, 'pl');
      } catch {
        // storage disabled — the choice simply won't persist
      }
    },
    languageStorageKey,
  );
};

const signInCreator = async (page: Page, studioBaseUrl: string): Promise<void> => {
  await page.goto(`${studioBaseUrl}/login`, { waitUntil: 'load' });
  await page.getByTestId('login-email').waitFor(visible);
  await page.getByTestId('login-email').fill('creator@together.dev');
  await page.getByTestId('login-password').fill('demo-password-15');
  await page.getByTestId('signin-submit').click();
  await page.getByTestId('tenant-name').waitFor(visible);
};

const signInMagicLink = (email: string) => async (page: Page, studioBaseUrl: string): Promise<void> => {
  await page.goto(`${studioBaseUrl}/login`, { waitUntil: 'load' });
  await page.locator('#magic-link-email').waitFor(visible);
  await page.locator('#magic-link-email').fill(email);
  await page.getByRole('button', { name: 'Wyślij mi magiczny link' }).click();
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
  const context = await browser.newContext({ viewport: VIEWPORTS.desktop });
  await applyChrome(context);
  const page = await context.newPage();
  await signIn(page, studioBaseUrl);
  const state = await context.storageState();
  await context.close();
  return state;
};

interface FindingRecord extends RawFinding {
  theme: ThemeMode;
  screen: string;
  viewport: ViewportName;
}

interface RenderCoverage {
  theme: ThemeMode;
  screen: string;
  viewport: ViewportName;
  semanticChecked: number;
  contrastChecked: number;
}

const impactRank = (impact: ImpactValue): number => {
  const index = IMPACT_ORDER.indexOf(impact);
  return index === -1 ? IMPACT_ORDER.length : index;
};

const runSemanticChecks = (page: Page): Promise<SemanticOutcome> =>
  page.evaluate<SemanticOutcome>(runSemanticChecksInDocument);

const runContrastChecks = (page: Page): Promise<ContrastOutcome> =>
  page.evaluate<ContrastOutcome>(runContrastChecksInDocument);

const startedAt = Date.now();
let server: ChildProcess | null = null;
let browser: Browser | null = null;

try {
  mkdirSync(outDir, { recursive: true });

  console.log(`a11y: preparing the dev database (SEED_BASE_TIME=${SEED_BASE_TIME})...`);
  await prepareDatabase();
  console.log('a11y: building the web SPA...');
  await buildWeb();

  const port = await ephemeralPort();
  const connectUrl = `http://127.0.0.1:${port}`;
  const studioBaseUrl = `http://studio.localhost:${port}`;
  console.log(`a11y: booting server on port ${port}...`);
  server = await bootServer(port, studioBaseUrl, connectUrl);

  browser = await chromium.launch({ channel: 'chrome', headless: true });

  console.log('a11y: signing in the member and creator fixtures...');
  const memberState = await bootstrapAuthState(
    browser,
    studioBaseUrl,
    signInMagicLink('kursant.aktywny@together.dev'),
  );
  const freeMemberState = await bootstrapAuthState(
    browser,
    studioBaseUrl,
    signInMagicLink('free@together.dev'),
  );
  const creatorState = await bootstrapAuthState(browser, studioBaseUrl, signInCreator);
  const stateFor = (auth: AuthKind): StorageState | undefined => {
    if (auth === 'member') return memberState;
    if (auth === 'member-free') return freeMemberState;
    if (auth === 'creator') return creatorState;
    return undefined;
  };

  const records: FindingRecord[] = [];
  const renderCoverage: RenderCoverage[] = [];
  let scanned = 0;
  let semanticChecked = 0;
  let contrastChecked = 0;
  let contrastSkipped = 0;
  const contrastSkippedByReason: Record<ContrastSkipReason, number> = {
    background: 0,
    clipped: 0,
    disabled: 0,
    'form-option': 0,
    placeholder: 0,
    'pseudo-element': 0,
    'text-fill': 0,
    'text-shadow': 0,
    transparency: 0,
  };

  for (const theme of THEMES) {
    for (const viewportName of ['desktop', 'mobile'] satisfies ViewportName[]) {
      for (const auth of ['public', 'member', 'member-free', 'creator'] satisfies AuthKind[]) {
        const screens = SCREENS.filter(
          (screen) => screen.auth === auth && screen.viewports.includes(viewportName),
        );
        if (screens.length === 0) continue;
        const storageState = stateFor(auth);
        const context = await browser.newContext({
          viewport: VIEWPORTS[viewportName],
          deviceScaleFactor: 1,
          ...(storageState === undefined ? {} : { storageState }),
        });
        await applyChrome(context);
        await defineEsbuildNameHelper(context);
        await stubNonDeterministicRequests(context);
        const page = await context.newPage();

        for (const screen of screens) {
          await page.goto(`${studioBaseUrl}${screen.path}`, { waitUntil: 'load' });
          await screen.ready(page);
          await delay(600);
          const semantic = await runSemanticChecks(page);
          const contrast = await runContrastChecks(page);
          const findings = [...semantic.findings, ...contrast.findings];
          scanned += 1;
          semanticChecked += semantic.checked;
          contrastChecked += contrast.checked;
          contrastSkipped += contrast.skipped;
          renderCoverage.push({
            theme,
            screen: screen.name,
            viewport: viewportName,
            semanticChecked: semantic.checked,
            contrastChecked: contrast.checked,
          });
          for (const reason of CONTRAST_SKIP_REASONS) {
            contrastSkippedByReason[reason] += contrast.skippedByReason[reason];
          }
          for (const finding of findings) {
            records.push({
              ...finding,
              theme,
              screen: screen.name,
              viewport: viewportName,
            });
          }
        }

        await context.close();
      }
    }
    console.log(`a11y: scanned theme ${theme}`);
  }

  const byRule = new Map<
    string,
    {
      rule: string;
      impact: ImpactValue;
      themes: Set<string>;
      screens: Set<string>;
      viewports: Set<string>;
      occurrences: number;
    }
  >();
  for (const record of records) {
    const existing = byRule.get(record.rule);
    if (existing === undefined) {
      byRule.set(record.rule, {
        rule: record.rule,
        impact: record.impact,
        themes: new Set([record.theme]),
        screens: new Set([record.screen]),
        viewports: new Set([record.viewport]),
        occurrences: 1,
      });
      continue;
    }
    if (impactRank(record.impact) < impactRank(existing.impact)) existing.impact = record.impact;
    existing.themes.add(record.theme);
    existing.screens.add(record.screen);
    existing.viewports.add(record.viewport);
    existing.occurrences += 1;
  }

  const ruleSummary = [...byRule.values()].sort(
    (a, b) => impactRank(a.impact) - impactRank(b.impact) || b.occurrences - a.occurrences,
  );

  const failing = records.filter((record) => FAILING_IMPACTS.includes(record.impact));
  const contrastRuns = contrastChecked + contrastSkipped;
  const contrastSkippedPercent =
    contrastRuns === 0 ? 0 : Math.round((contrastSkipped / contrastRuns) * 1000) / 10;
  assert(scanned > 0, 'Accessibility scan completed without scanning any screen renders.');
  const contrastFloorFailures = renderCoverage.filter(
    (render) => render.contrastChecked < MIN_CONTRAST_RUNS_PER_RENDER,
  );
  const semanticFloorFailures = renderCoverage.filter(
    (render) => render.semanticChecked < MIN_SEMANTIC_CHECKS_PER_RENDER,
  );
  const minimumContrastChecked = Math.min(...renderCoverage.map((render) => render.contrastChecked));
  const minimumSemanticChecked = Math.min(...renderCoverage.map((render) => render.semanticChecked));

  const jsonReport = {
    generatedAt: new Date().toISOString(),
    seedBaseTime: SEED_BASE_TIME,
    themes: THEMES,
    checks: A11Y_CHECK_IDS,
    screensScanned: scanned,
    semanticChecked,
    contrastChecked,
    contrastSkipped,
    contrastRuns,
    contrastSkippedPercent,
    contrastSkippedByReason,
    coverageFloors: {
      contrastCheckedPerRender: MIN_CONTRAST_RUNS_PER_RENDER,
      semanticCheckedPerRender: MIN_SEMANTIC_CHECKS_PER_RENDER,
    },
    minimumContrastCheckedPerRender: minimumContrastChecked,
    minimumSemanticCheckedPerRender: minimumSemanticChecked,
    floorFailures: {
      contrast: contrastFloorFailures,
      semantic: semanticFloorFailures,
    },
    renderCoverage,
    totalFindings: records.length,
    failingFindings: failing.length,
    rules: ruleSummary.map((rule) => ({
      rule: rule.rule,
      impact: rule.impact,
      occurrences: rule.occurrences,
      themes: [...rule.themes].sort(),
      screens: [...rule.screens].sort(),
      viewports: [...rule.viewports].sort(),
    })),
    records,
  };
  writeFileSync(join(outDir, 'a11y-report.json'), `${JSON.stringify(jsonReport, null, 2)}\n`);

  const mdLines: string[] = [];
  mdLines.push('# In-house accessibility scan — raw aggregate');
  mdLines.push('');
  mdLines.push(`Generated: ${jsonReport.generatedAt}`);
  mdLines.push('');
  mdLines.push(
    `Scanned ${String(scanned)} screen renders (${String(THEMES.length)} themes; member screens at desktop 1440 + mobile 390, panel screens at desktop 1440).`,
  );
  mdLines.push('');
  mdLines.push(
    'Checks: image alternatives, accessible control names, main and region landmarks, heading order, table-header names, and WCAG AA text contrast.',
  );
  mdLines.push('');
  mdLines.push(
    `Semantic checks: ${String(semanticChecked)} candidates inspected.`,
  );
  mdLines.push('');
  mdLines.push(
    `Contrast: ${String(contrastChecked)} of ${String(contrastRuns)} text runs measured; ${String(contrastSkipped)} skipped (${String(contrastSkippedPercent)}%).`,
  );
  mdLines.push('');
  mdLines.push(
    `Contrast skips by reason: ${Object.entries(contrastSkippedByReason)
      .map(([reason, count]) => `${reason}=${String(count)}`)
      .join(', ')}.`,
  );
  mdLines.push('');
  mdLines.push(
    `Per-render floors: contrast >= ${String(MIN_CONTRAST_RUNS_PER_RENDER)} measured text runs (observed minimum ${String(minimumContrastChecked)}); semantic >= ${String(MIN_SEMANTIC_CHECKS_PER_RENDER)} candidates (observed minimum ${String(minimumSemanticChecked)}).`,
  );
  mdLines.push('');
  const floorFailures = renderCoverage.filter(
    (render) =>
      render.contrastChecked < MIN_CONTRAST_RUNS_PER_RENDER ||
      render.semanticChecked < MIN_SEMANTIC_CHECKS_PER_RENDER,
  );
  if (floorFailures.length > 0) {
    mdLines.push('| Floor failure | Theme | Screen | Viewport | Contrast | Semantic |');
    mdLines.push('| --- | --- | --- | --- | --- | --- |');
    for (const render of floorFailures) {
      const failedChecks = [
        ...(render.contrastChecked < MIN_CONTRAST_RUNS_PER_RENDER ? ['contrast'] : []),
        ...(render.semanticChecked < MIN_SEMANTIC_CHECKS_PER_RENDER ? ['semantic'] : []),
      ].join(', ');
      mdLines.push(
        `| ${failedChecks} | ${render.theme} | ${render.screen} | ${render.viewport} | ${String(render.contrastChecked)} | ${String(render.semanticChecked)} |`,
      );
    }
    mdLines.push('');
  }
  if (ruleSummary.length === 0) {
    mdLines.push('No findings. Clean pass.');
  } else {
    mdLines.push('| Rule | Impact | Occurrences | Themes | Screens | Viewports |');
    mdLines.push('| --- | --- | --- | --- | --- | --- |');
    for (const rule of ruleSummary) {
      const themes =
        rule.themes.size === THEMES.length ? 'all' : [...rule.themes].sort().join(', ');
      mdLines.push(
        `| ${rule.rule} | ${rule.impact} | ${String(rule.occurrences)} | ${themes} | ${[...rule.screens].sort().join(', ')} | ${[...rule.viewports].sort().join(', ')} |`,
      );
    }
  }
  mdLines.push('');
  writeFileSync(join(outDir, 'a11y-report.md'), `${mdLines.join('\n')}\n`);

  const describeFloorFailures = (renders: RenderCoverage[]): string =>
    renders
      .map(
        (render) =>
          `${render.theme}/${render.screen}/${render.viewport} (contrast=${String(render.contrastChecked)}, semantic=${String(render.semanticChecked)})`,
      )
      .join(', ');
  assert(
    contrastFloorFailures.length === 0,
    `Contrast inspected fewer than ${String(MIN_CONTRAST_RUNS_PER_RENDER)} text runs in: ${describeFloorFailures(contrastFloorFailures)}.`,
  );
  assert(
    semanticFloorFailures.length === 0,
    `Semantic checks inspected fewer than ${String(MIN_SEMANTIC_CHECKS_PER_RENDER)} candidates in: ${describeFloorFailures(semanticFloorFailures)}.`,
  );

  const seconds = ((Date.now() - startedAt) / 1000).toFixed(1);
  console.log('');
  if (ruleSummary.length === 0) {
    console.log(`a11y: PASS (${seconds}s) — ${String(scanned)} renders, 0 findings`);
  } else {
    console.log(`a11y: ${String(scanned)} renders scanned in ${seconds}s`);
    console.log(
      `a11y: ${String(records.length)} total findings across ${String(ruleSummary.length)} rules:\n`,
    );
    for (const rule of ruleSummary) {
      const scope =
        rule.themes.size === THEMES.length ? 'all themes' : `${String(rule.themes.size)} themes`;
      console.log(
        `  [${rule.impact}] ${rule.rule} — ${String(rule.occurrences)}x (${scope}; screens: ${[...rule.screens].sort().join(', ')})`,
      );
    }
    console.log('');
    if (failing.length > 0) {
      console.error(
        `a11y: FAIL — ${String(failing.length)} serious/critical finding(s) remain. See ${join(outDir, 'a11y-report.json')}`,
      );
      process.exitCode = 1;
    } else {
      console.log(
        `a11y: PASS — no serious/critical findings (moderate/minor only). Report: ${join(outDir, 'a11y-report.md')}`,
      );
    }
  }
} catch (error) {
  const message = error instanceof ScanFailure ? error.message : String(error);
  console.error(`\na11y: FAIL\n${message}`);
  process.exitCode = 1;
} finally {
  if (browser) await browser.close();
  if (server) await killServer(server);
}
