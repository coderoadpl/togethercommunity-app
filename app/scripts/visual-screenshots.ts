import { spawn, type ChildProcess } from 'node:child_process';
import { mkdirSync, rmSync, statSync } from 'node:fs';
import { createServer } from 'node:net';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import {
  chromium,
  type Browser,
  type BrowserContext,
  type Locator,
  type Page,
  type Route,
} from 'playwright-core';

import { API_PATHS } from '#core/contract/index.js';

import type { ThemeMode } from '../apps/web/src/theme.js';
import { comparePng, type PngComparisonFailure } from './visual-png-compare.js';

const rootDir = join(dirname(fileURLToPath(import.meta.url)), '..');
const tsxBin = join(rootDir, 'node_modules/.bin/tsx');
const viteBin = join(rootDir, 'node_modules/.bin/vite');
const webDistDir = join(rootDir, 'dist/web');
const goldenDir = join(rootDir, 'tasks/visual-goldens');
const currentDir = join(rootDir, 'out/visual/current');
const diffDir = join(rootDir, 'out/visual/diff');
const argosDir = join(rootDir, 'out/visual/argos');
const chromeExecutablePath = process.env['PLAYWRIGHT_CHROME_EXECUTABLE_PATH'];
const chromeCdpEndpoint = process.env['PLAYWRIGHT_CHROME_CDP_ENDPOINT'];
const playwrightWsEndpoint = process.env['PLAYWRIGHT_WS_ENDPOINT'];

const updateMode = process.argv.includes('--update');
const argosCaptureMode = process.argv.includes('--argos-capture');
const goldenAuthoringPlatform = 'darwin';

const languageStorageKey = 'together-language';

const SEED_BASE_TIME = '2026-07-01T12:00:00.000Z';
const minPngBytes = 10 * 1024;

const THEMES: ThemeMode[] = ['shadcn'];

const VIEWPORTS = [
  { name: 'desktop', width: 1440, height: 900, scope: 'all' },
  { name: 'mobile', width: 390, height: 844, scope: 'all' },
  { name: 'mobile-375', width: 375, height: 812, scope: 'member-checkout' },
] as const;

type AuthKind = 'public' | 'member' | 'member-free' | 'creator';

interface ScreenSpec {
  name: string;
  auth: AuthKind;
  path: string;
  tenantSlug?: string;
  prepare?: (page: Page) => Promise<ScreenPreparation>;
  ready: (page: Page) => Promise<void>;
  settled?: (page: Page) => Promise<void>;
  waitForNetworkIdle?: boolean;
  minBytes?: number;
  mask?: (page: Page) => Locator[];
}

interface ScreenPreparation {
  renderingInputsReady: Promise<void>;
  cleanup: () => Promise<void>;
}

const visible = { state: 'visible', timeout: 20000 } as const;

const prepareBootSplash = async (page: Page): Promise<ScreenPreparation> => {
  let release = (): void => undefined;
  let complete = (): void => undefined;
  let routed = false;
  const gate = new Promise<void>((resolve) => {
    release = resolve;
  });
  const done = new Promise<void>((resolve) => {
    complete = resolve;
  });
  const handler = async (route: Route): Promise<void> => {
    routed = true;
    try {
      await gate;
      await route.continue().catch(() => undefined);
    } finally {
      complete();
    }
  };

  await page.route('**/api/me', handler);
  const renderingInputsReady = page
    .waitForResponse(
      (response) => new URL(response.url()).pathname === API_PATHS.publicOffer,
      { timeout: visible.timeout },
    )
    .then(async (response) => {
      await response.body();
      assert(response.ok(), `public offer failed with HTTP ${response.status()}`);
    });
  void renderingInputsReady.catch(() => undefined);

  return {
    renderingInputsReady,
    cleanup: async () => {
      release();
      await page.unroute('**/api/me', handler);
      if (routed) await done;
    },
  };
};

// The unread badge lives on the header bell on sm+ and on the bottom
// tab-bar bell on xs (decision D4) — wait on the instance this viewport
// actually shows, otherwise a shot can land before the async count arrives.
const waitForUnreadBadge = async (page: Page): Promise<void> => {
  const width = page.viewportSize()?.width ?? 0;
  const bellTestId = width < 600 ? 'notification-tab' : 'notification-bell';
  await page
    .locator(`[data-testid="${bellTestId}"] .MuiBadge-badge:not(.MuiBadge-invisible)`)
    .waitFor(visible);
};

const SCREENS: ScreenSpec[] = [
  {
    name: 'login',
    auth: 'public',
    path: '/login',
    ready: (page) => page.getByTestId('login-email').waitFor(visible),
  },
  {
    name: 'forgot-password',
    auth: 'public',
    path: '/forgot-password',
    ready: (page) => page.getByTestId('forgot-password-email').waitFor(visible),
  },
  {
    name: 'reset-password',
    auth: 'public',
    path: '/reset-password?token=visual-reset-token',
    ready: (page) => page.getByTestId('reset-password').waitFor(visible),
  },
  {
    name: 'reset-password-invalid',
    auth: 'public',
    path: '/reset-password?error=INVALID_TOKEN',
    ready: (page) => page.getByTestId('reset-invalid-token').waitFor(visible),
  },
  {
    name: 'checkout',
    auth: 'public',
    path: '/checkout/product-studio-kurs-101',
    ready: (page) => page.getByText('Kurs Together 101').first().waitFor(visible),
  },
  {
    name: 'marketing-preferences',
    auth: 'public',
    tenantSlug: 'akademia',
    path: '/u/unsubscribe_akademia_visual_123456?lang=pl',
    ready: (page) => page.getByTestId('marketing-preferences').waitFor(visible),
  },
  {
    name: 'hosted-legal-document',
    auth: 'public',
    tenantSlug: 'akademia',
    path: '/legal/polityka-prywatnosci/v/1?lang=pl',
    ready: (page) => page.getByTestId('hosted-legal-document').waitFor(visible),
  },
  {
    name: 'marketing-confirmation-success',
    auth: 'public',
    tenantSlug: 'akademia',
    path: '/marketing/confirm/confirmation_akademia_visual_123456?lang=pl',
    ready: (page) => page.getByTestId('marketing-confirmation-success').waitFor(visible),
  },
  {
    name: 'marketing-confirmation-expired',
    auth: 'public',
    tenantSlug: 'akademia',
    path: '/marketing/confirm/expired_confirmation_visual_123456?lang=pl',
    ready: (page) => page.getByTestId('marketing-confirmation-expired').waitFor(visible),
  },
  {
    // Waits target the LAST async element of each screen (waterfall queries),
    // otherwise a shot can land mid-load and produce a flaky golden.
    name: 'my-courses',
    auth: 'member',
    path: '/my',
    ready: async (page) => {
      const seededCourseCard = page.locator('a[href="/my/courses/course-js"]');
      await seededCourseCard.waitFor(visible);
      await seededCourseCard.getByTestId('completion-course-js').waitFor(visible);
      await waitForUnreadBadge(page);
    },
  },
  {
    name: 'course',
    auth: 'member',
    path: '/my/courses/course-js',
    ready: async (page) => {
      await page.getByTestId('course-tree').waitFor(visible);
      await page.getByText('Przejdź do pierwszej lekcji').waitFor(visible);
    },
  },
  {
    name: 'my-products',
    auth: 'member',
    path: '/my/products',
    ready: async (page) => {
      await page.getByTestId('my-product-product-js-full').waitFor(visible);
      await page.getByTestId('download-download-asset-workbook').waitFor(visible);
    },
  },
  {
    name: 'product-stub',
    auth: 'member',
    path: '/my/course/product-js-full',
    ready: (page) => page.getByTestId('product-course-links').waitFor(visible),
  },
  {
    name: 'account',
    auth: 'member',
    path: '/account',
    ready: (page) => page.getByTestId('account-email').waitFor(visible),
  },
  {
    name: 'course-not-found',
    auth: 'member',
    path: '/my/courses/course-does-not-exist',
    ready: (page) => page.locator('[data-state="not-found"]').waitFor(visible),
  },
  {
    name: 'lesson-locked',
    auth: 'member-free',
    path: '/my/courses/course-js/lessons/lesson-js-zmienne-2',
    ready: async (page) => {
      await page.getByTestId('locked-lesson-upsell').waitFor(visible);
      await page.getByTestId('locked-product-price').waitFor(visible);
    },
  },
  {
    name: 'lesson',
    auth: 'member',
    path: '/my/courses/course-js/lessons/lesson-js-zmienne-1',
    ready: async (page) => {
      await page.getByTestId('member-breadcrumbs').waitFor(visible);
      await page.getByTestId('discussion-composer').waitFor(visible);
      await page.getByTestId('author-chip-post-js-zmienne-q-r2').waitFor(visible);
    },
  },
  {
    name: 'community',
    auth: 'member',
    path: '/community',
    ready: async (page) => {
      await page.getByTestId('space-card-space-studio-spolecznosc').waitFor(visible);
      await page.getByTestId('space-card-space-studio-klub-js').waitFor(visible);
      await waitForUnreadBadge(page);
    },
  },
  {
    name: 'space-feed',
    auth: 'member',
    path: '/community/space-studio-spolecznosc',
    ready: async (page) => {
      await page.getByTestId('post-body-post-spolecznosc-hello').waitFor(visible);
      await page.getByTestId('reaction-post-spolecznosc-hello-👍').waitFor(visible);
      await page.getByTestId('space-follow-toggle').waitFor(visible);
      await waitForUnreadBadge(page);
    },
  },
  {
    name: 'boot-splash',
    auth: 'creator',
    path: '/panel',
    prepare: prepareBootSplash,
    ready: (page) => page.getByRole('status', { name: 'Otwieranie panelu twórcy' }).waitFor(visible),
    waitForNetworkIdle: false,
    minBytes: 7 * 1024,
  },
  {
    name: 'panel-spaces',
    auth: 'creator',
    path: '/panel/spaces',
    ready: async (page) => {
      await page.getByTestId('space-manage-space-studio-spolecznosc').waitFor(visible);
      await page.getByTestId('space-manage-space-studio-klub-js').waitFor(visible);
    },
  },
  {
    name: 'panel-dashboard',
    auth: 'creator',
    path: '/panel',
    ready: async (page) => {
      await page.getByTestId('onboarding-checklist').waitFor(visible);
      await page.getByTestId('dashboard-tile-revenue').waitFor(visible);
      await page.getByTestId('dashboard-member-row').first().waitFor(visible);
    },
  },
  {
    name: 'panel-settings-security',
    auth: 'creator',
    path: '/panel/settings#security',
    ready: (page) => page.getByTestId('security-reset-password').waitFor(visible),
    settled: async (page) => {
      await page
        .getByTestId('security-settings')
        .evaluate((element) => element.scrollIntoView({ block: 'start' }));
    },
  },
  {
    name: 'panel-storage-wizard',
    auth: 'creator',
    path: '/panel/integrations',
    ready: (page) => page.getByTestId('storage-provider-step').waitFor(visible),
    settled: async (page) => {
      await page.getByTestId('storage-wizard').evaluate((element) =>
        element.scrollIntoView({ block: 'start' }),
      );
    },
  },
  {
    name: 'panel-lesson-attachments',
    auth: 'creator',
    path: '/panel/lessons/lesson-js-zmienne-1',
    ready: (page) => page.getByTestId('lesson-attachments-empty').waitFor(visible),
    settled: async (page) => {
      await page.getByTestId('lesson-attachments-editor').evaluate((element) =>
        element.scrollIntoView({ block: 'start' }),
      );
    },
  },
  {
    name: 'panel-products',
    auth: 'creator',
    path: '/panel/products',
    ready: (page) => page.getByTestId('product-row').first().waitFor(visible),
  },
  {
    name: 'panel-product-downloads',
    auth: 'creator',
    path: '/panel/products/product-download-workbook',
    ready: (page) => page.getByTestId('product-download-assets').waitFor(visible),
    settled: async (page) => {
      await page.getByTestId('product-download-assets').evaluate((element) =>
        element.scrollIntoView({ block: 'start' }),
      );
    },
  },
  {
    name: 'panel-coupons',
    auth: 'creator',
    path: '/panel/sales/coupons',
    ready: (page) => page.getByTestId('coupon-row').first().waitFor(visible),
  },
  {
    name: 'panel-coupon-create',
    auth: 'creator',
    path: '/panel/sales/coupons/new',
    ready: (page) => page.locator('#coupon-code').waitFor(visible),
  },
  {
    name: 'panel-coupon-detail',
    auth: 'creator',
    path: '/panel/sales/coupons/coupon-studio-partner20',
    ready: (page) => page.getByText('Aktywność w czasie').waitFor(visible),
  },
  {
    name: 'panel-order-detail',
    auth: 'creator',
    path: '/panel/sales/order-studio-aktywny-js',
    ready: (page) => page.getByText('PARTNER20').waitFor(visible),
  },
  {
    name: 'panel-marketing-campaigns',
    auth: 'creator',
    path: '/panel/marketing/campaigns',
    ready: (page) => page.getByRole('heading', { name: 'Kampanie e-mail' }).waitFor(visible),
  },
  {
    name: 'panel-marketing-activity',
    auth: 'creator',
    path: '/panel/marketing/activity',
    ready: (page) => page.getByTestId('scheduler-activity-row').first().waitFor(visible),
  },
  {
    name: 'panel-marketing-activity-detail',
    auth: 'creator',
    path: '/panel/marketing/activity/scheduler-run-studio-outbox',
    ready: (page) => page.getByText('SES rejected one message').last().waitFor(visible),
  },
  {
    name: 'panel-marketing-sends',
    auth: 'creator',
    path: '/panel/marketing/sends',
    ready: (page) => page.getByTestId('email-send-row').first().waitFor(visible),
  },
  {
    name: 'panel-marketing-send-detail',
    auth: 'creator',
    path: '/panel/marketing/sends/marketing/send-studio-marketing',
    ready: (page) => page.getByTestId('email-event').last().waitFor(visible),
  },
  {
    name: 'panel-marketing-consents',
    auth: 'creator',
    path: '/panel/marketing/consents',
    ready: (page) => page.getByRole('heading', { name: 'Kreator zgód' }).waitFor(visible),
  },
  {
    name: 'panel-marketing-documents',
    auth: 'creator',
    path: '/panel/marketing/documents',
    ready: (page) => page.getByRole('heading', { name: 'Dokumenty prawne' }).waitFor(visible),
  },
  {
    name: 'panel-marketing-layouts',
    auth: 'creator',
    path: '/panel/marketing/layouts',
    ready: (page) => page.getByRole('heading', { name: 'Układy e-mail' }).waitFor(visible),
  },
  {
    name: 'panel-integrations-email',
    auth: 'creator',
    path: '/panel/integrations#email',
    ready: (page) => page.getByTestId('marketing-readiness').waitFor(visible),
  },
  {
    name: 'panel-course',
    auth: 'creator',
    path: '/panel/courses/course-js',
    ready: (page) => page.getByTestId('module-card').first().waitFor(visible),
  },
  {
    name: 'member-detail',
    auth: 'creator',
    path: '/panel/members/member-studio-aktywny',
    ready: async (page) => {
      await page.getByTestId('member-purchase-row').first().waitFor(visible);
      await page.getByTestId('member-subscription-row').first().waitFor(visible);
      await page.getByTestId('member-timeline-row').first().waitFor(visible);
      await page.getByTestId('grant-row').first().waitFor(visible);
      await page.getByTestId('learning-summary-row').first().waitFor(visible);
    },
  },
  {
    name: 'member-email-timeline',
    auth: 'creator',
    path: '/panel/members/member-studio-aktywny',
    ready: async (page) => {
      await page.getByRole('tab', { name: 'E-maile' }).click();
      await page.getByTestId('member-email-send').first().waitFor(visible);
    },
  },
];

class VisualFailure extends Error {}

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

const placeholderPng = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAA8AAAAIcCAYAAAA5Xcd7AAALcUlEQVR4Ae3BAQGAAAwCMKR/zPfQHrLtubs3AAAA8HMNAAAADGgAAABgQAMAAAADGgAAABjQAAAAwIAGAAAABjQAAAAwoAEAAIABDQAAAAxoAAAAYEADAAAAAxoAAAAY0AAAAMCABgAAAAY0AAAAMKABAACAAQ0AAAAMaAAAAGBAAwAAAAMaAAAAGNAAAADAgAYAAAAGNAAAADCgAQAAgAENAAAADGgAAABgQAMAAAADGgAAABjQAAAAwIAGAAAABjQAAAAwoAEAAIABDQAAAAxoAAAAYEADAAAAAxoAAAAY0AAAAMCABgAAAAY0AAAAMKABAACAAQ0AAAAMaAAAAGBAAwAAAAMaAAAAGNAAAADAgAYAAAAGNAAAADCgAQAAgAENAAAADGgAAABgQAMAAAADGgAAABjQAAAAwIAGAAAABjQAAAAwoAEAAIABDQAAAAxoAAAAYEADAAAAAxoAAAAY0AAAAMCABgAAAAY0AAAAMKABAACAAQ0AAAAMaAAAAGBAAwAAAAMaAAAAGNAAAADAgAYAAAAGNAAAADCgAQAAgAENAAAADGgAAABgQAMAAAADGgAAABjQAAAAwIAGAAAABjQAAAAwoAEAAIABDQAAAAxoAAAAYEADAAAAAxoAAAAY0AAAAMCABgAAAAY0AAAAMKABAACAAQ0AAAAMaAAAAGBAAwAAAAMaAAAAGNAAAADAgAYAAAAGNAAAADCgAQAAgAENAAAADGgAAABgQAMAAAADGgAAABjQAAAAwIAGAAAABjQAAAAwoAEAAIABDQAAAAxoAAAAYEADAAAAAxoAAAAY0AAAAMCABgAAAAY0AAAAMKABAACAAQ0AAAAMaAAAAGBAAwAAAAMaAAAAGNAAAADAgAYAAAAGNAAAADCgAQAAgAENAAAADGgAAABgQAMAAAADGgAAABjQAAAAwIAGAAAABjQAAAAwoAEAAIABDQAAAAxoAAAAYEADAAAAAxoAAAAY0AAAAMCABgAAAAY0AAAAMKABAACAAQ0AAAAMaAAAAGBAAwAAAAMaAAAAGNAAAADAgAYAAAAGNAAAADCgAQAAgAENAAAADGgAAABgQAMAAAADGgAAABjQAAAAwIAGAAAABjQAAAAwoAEAAIABDQAAAAxoAAAAYEADAAAAAxoAAAAY0AAAAMCABgAAAAY0AAAAMKABAACAAQ0AAAAMaAAAAGBAAwAAAAMaAAAAGNAAAADAgAYAAAAGNAAAADCgAQAAgAENAAAADGgAAABgQAMAAAADGgAAABjQAAAAwIAGAAAABjQAAAAwoAEAAIABDQAAAAxoAAAAYEADAAAAAxoAAAAY0AAAAMCABgAAAAY0AAAAMKABAACAAQ0AAAAMaAAAAGBAAwAAAAMaAAAAGNAAAADAgAYAAAAGNAAAADCgAQAAgAENAAAADGgAAABgQAMAAAADGgAAABjQAAAAwIAGAAAABjQAAAAwoAEAAIABDQAAAAxoAAAAYEADAAAAAxoAAAAY0AAAAMCABgAAAAY0AAAAMKABAACAAQ0AAAAMaAAAAGBAAwAAAAMaAAAAGNAAAADAgAYAAAAGNAAAADCgAQAAgAENAAAADGgAAABgQAMAAAADGgAAABjQAAAAwIAGAAAABjQAAAAwoAEAAIABDQAAAAxoAAAAYEADAAAAAxoAAAAY0AAAAMCABgAAAAY0AAAAMKABAACAAQ0AAAAMaAAAAGBAAwAAAAMaAAAAGNAAAADAgAYAAAAGNAAAADCgAQAAgAENAAAADGgAAABgQAMAAAADGgAAABjQAAAAwIAGAAAABjQAAAAwoAEAAIABDQAAAAxoAAAAYEADAAAAAxoAAAAY0AAAAMCABgAAAAY0AAAAMKABAACAAQ0AAAAMaAAAAGBAAwAAAAMaAAAAGNAAAADAgAYAAAAGNAAAADCgAQAAgAENAAAADGgAAABgQAMAAAADGgAAABjQAAAAwIAGAAAABjQAAAAwoAEAAIABDQAAAAxoAAAAYEADAAAAAxoAAAAY0AAAAMCABgAAAAY0AAAAMKABAACAAQ0AAAAMaAAAAGBAAwAAAAMaAAAAGNAAAADAgAYAAAAGNAAAADCgAQAAgAENAAAADGgAAABgQAMAAAADGgAAABjQAAAAwIAGAAAABjQAAAAwoAEAAIABDQAAAAxoAAAAYEADAAAAAxoAAAAY0AAAAMCABgAAAAY0AAAAMKABAACAAQ0AAAAMaAAAAGBAAwAAAAMaAAAAGNAAAADAgAYAAAAGNAAAADCgAQAAgAENAAAADGgAAABgQAMAAAADGgAAABjQAAAAwIAGAAAABjQAAAAwoAEAAIABDQAAAAxoAAAAYEADAAAAAxoAAAAY0AAAAMCABgAAAAY0AAAAMKABAACAAQ0AAAAMaAAAAGBAAwAAAAMaAAAAGNAAAADAgAYAAAAGNAAAADCgAQAAgAENAAAADGgAAABgQAMAAAADGgAAABjQAAAAwIAGAAAABjQAAAAwoAEAAIABDQAAAAxoAAAAYEADAAAAAxoAAAAY0AAAAMCABgAAAAY0AAAAMKABAACAAQ0AAAAMaAAAAGBAAwAAAAMaAAAAGNAAAADAgAYAAAAGNAAAADCgAQAAgAENAAAADGgAAABgQAMAAAADGgAAABjQAAAAwIAGAAAABjQAAAAwoAEAAIABDQAAAAxoAAAAYEADAAAAAxoAAAAY0AAAAMCABgAAAAY0AAAAMKABAACAAQ0AAAAMaAAAAGBAAwAAAAMaAAAAGNAAAADAgAYAAAAGNAAAADCgAQAAgAENAAAADGgAAABgQAMAAAADGgAAABjQAAAAwIAGAAAABjQAAAAwoAEAAIABDQAAAAxoAAAAYEADAAAAAxoAAAAY0AAAAMCABgAAAAY0AAAAMKABAACAAQ0AAAAMaAAAAGBAAwAAAAMaAAAAGNAAAADAgAYAAAAGNAAAADCgAQAAgAENAAAADGgAAABgQAMAAAADGgAAABjQAAAAwIAGAAAABjQAAAAwoAEAAIABDQAAAAxoAAAAYEADAAAAAxoAAAAY0AAAAMCABgAAAAY0AAAAMKABAACAAQ0AAAAMaAAAAGBAAwAAAAMaAAAAGNAAAADAgAYAAAAGNAAAADCgAQAAgAENAAAADGgAAABgQAMAAAADGgAAABjQAAAAwIAGAAAABjQAAAAwoAEAAIABDQAAAAxoAAAAYEADAAAAAxoAAAAY0AAAAMCABgAAAAY0AAAAMKABAACAAQ0AAAAMaAAAAGBAAwAAAAMaAAAAGNAAAADAgAYAAAAGNAAAADCgAQAAgAENAAAADGgAAABgQAMAAAADGgAAABjQAAAAwIAGAAAABjQAAAAwoAEAAIABDQAAAAxoAAAAYEADAAAAAxoAAAAY0AAAAMCABgAAAAY0AAAAMKABAACAAQ0AAAAMaAAAAGBAAwAAAAMaAAAAGNAAAADAgAYAAAAGNAAAADCgAQAAgAENAAAADGgAAABgQAMAAAADGgAAABjQAAAAwIAGAAAABjQAAAAwoAEAAIABDQAAAAxoAAAAYEADAAAAAxoAAAAY0AAAAMCABgAAAAY0AAAAMKABAACAAQ0AAAAMaAAAAGBAAwAAAAMaAAAAGNAAAADAgAYAAAAGNAAAADCgAQAAgAENAAAADGgAAABgQAMAAAADGgAAABjQAAAAwIAGAAAABjQAAAAwoAEAAIABDQAAAAxoAAAAYEADAAAAAxoAAAAY0AAAAMCABgAAAAY0AAAAMKABAACAAQ0AAAAMaAAAAGBAAwAAAAMaAAAAGNAAAADAgAYAAAAGNAAAADCgAQAAgAENAAAADGgAAABgQAMAAAADGgAAABjQAAAAwIAGAAAABjQAAAAwoAEAAIABDQAAAAxoAAAAYEADAAAAAz4BuQfjJzaLiAAAAABJRU5ErkJggg==',
  'base64',
);

const isLocalHost = (hostname: string): boolean =>
  hostname === 'localhost' || hostname === '127.0.0.1' || hostname.endsWith('.localhost');

const stubNonDeterministicRequests = async (context: BrowserContext): Promise<void> => {
  await context.route('**/*', (route) => {
    const url = new URL(route.request().url());
    // Last-viewed tracking would mutate the seeded demo progress and change
    // what later captures render; the mutation's failure is silent in the UI.
    if (url.pathname === '/api/student/progress/last-viewed') return route.abort();
    if (isLocalHost(url.hostname)) return route.continue();
    if (route.request().resourceType() === 'image') {
      return route.fulfill({ contentType: 'image/png', body: placeholderPng });
    }
    return route.abort();
  });
};

const applyChrome = async (context: BrowserContext): Promise<void> => {
  await context.addInitScript(
    (langKey) => {
      Object.defineProperty(window, 'EventSource', { configurable: true, value: undefined });
      try {
        window.localStorage.setItem(langKey, 'pl');
      } catch {
        // storage disabled — the choice simply won't persist
      }
    },
    languageStorageKey,
  );
};

const settlePage = async (page: Page, waitForNetworkIdle = true): Promise<void> => {
  if (waitForNetworkIdle) await page.waitForLoadState('networkidle');
  await page.evaluate(async () => {
    await document.fonts.ready;
  });
  await page.addStyleTag({
    content: `
      *, *::before, *::after {
        animation: none !important;
        transition: none !important;
        caret-color: transparent !important;
      }
    `,
  });
  await page.evaluate(
    () =>
      new Promise<void>((resolve) => {
        requestAnimationFrame(() => requestAnimationFrame(() => resolve()));
      }),
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

const signInMember = async (page: Page, studioBaseUrl: string): Promise<void> => {
  await page.goto(`${studioBaseUrl}/login`, { waitUntil: 'load' });
  await page.locator('#magic-link-email').waitFor(visible);
  await page.locator('#magic-link-email').fill('kursant.aktywny@together.dev');
  await page.getByRole('button', { name: 'Wyślij mi magiczny link' }).click();
  const magicLink = page.getByRole('link', { name: 'Otwórz magiczny link' });
  await magicLink.waitFor(visible);
  const href = await magicLink.getAttribute('href');
  assert(href !== null && href.length > 0, 'login page did not expose a dev magic link');
  await page.goto(href, { waitUntil: 'load' });
  await page.waitForURL('**/my', { timeout: 20000 });
};

const signInFreeMember = async (page: Page, studioBaseUrl: string): Promise<void> => {
  await page.goto(`${studioBaseUrl}/login`, { waitUntil: 'load' });
  await page.locator('#magic-link-email').waitFor(visible);
  await page.locator('#magic-link-email').fill('free@together.dev');
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
  if (updateMode && argosCaptureMode) {
    fail('Golden authoring and Argos capture modes cannot run together.');
  }

  if (updateMode && process.platform !== goldenAuthoringPlatform) {
    fail(
      `Baseline authoring requires ${goldenAuthoringPlatform}; current platform is ${process.platform}.`,
    );
  }

  if (argosCaptureMode) {
    rmSync(argosDir, { recursive: true, force: true });
    mkdirSync(argosDir, { recursive: true });
  } else {
    mkdirSync(goldenDir, { recursive: true });
    mkdirSync(currentDir, { recursive: true });
    mkdirSync(diffDir, { recursive: true });
  }

  console.log(`visual: preparing the dev database (SEED_BASE_TIME=${SEED_BASE_TIME})...`);
  await prepareDatabase();
  console.log('visual: building the web SPA...');
  await buildWeb();

  const port = await ephemeralPort();
  const connectUrl = `http://127.0.0.1:${port}`;
  const studioBaseUrl = `http://studio.localhost:${port}`;
  console.log(`visual: booting server on port ${port}...`);
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

  console.log('visual: signing in the member and creator fixtures...');
  const memberState = await bootstrapAuthState(browser, studioBaseUrl, signInMember);
  const freeMemberState = await bootstrapAuthState(browser, studioBaseUrl, signInFreeMember);
  const creatorState = await bootstrapAuthState(browser, studioBaseUrl, signInCreator);
  const stateFor = (auth: AuthKind): StorageState | undefined => {
    if (auth === 'member') return memberState;
    if (auth === 'member-free') return freeMemberState;
    if (auth === 'creator') return creatorState;
    return undefined;
  };

  const failures: PngComparisonFailure[] = [];
  let captured = 0;

  for (const theme of THEMES) {
    for (const viewport of VIEWPORTS) {
      for (const auth of ['public', 'member', 'member-free', 'creator'] satisfies AuthKind[]) {
        const screens = SCREENS.filter((screen) =>
          screen.auth === auth
          && (viewport.scope === 'all'
            || screen.name === 'checkout'
            || screen.auth === 'member'
            || screen.auth === 'member-free'),
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
            await page.goto(screenUrl(studioBaseUrl, screen), { waitUntil: 'load' });
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
            const shotPath = join(
              argosCaptureMode ? argosDir : updateMode ? goldenDir : currentDir,
              file,
            );
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
            if (!updateMode && !argosCaptureMode) {
              const failure = comparePng({
                file,
                baselinePath: join(goldenDir, file),
                currentPath: shotPath,
                diffPath: join(diffDir, file),
                missingBaselineReason:
                  'baseline missing — run `pnpm run visual:update` and review it',
              });
              if (failure !== null) failures.push(failure);
            }
          } finally {
            if (preparation !== undefined) await preparation.cleanup();
          }
        }

        await context.close();
      }
    }
    console.log(`visual: captured ${theme} (${captured} screenshots)`);
  }

  const seconds = ((Date.now() - startedAt) / 1000).toFixed(1);
  if (argosCaptureMode) {
    console.log(
      `\nvisual:argos-capture: DONE (${seconds}s) — ${captured} screenshots written to ${argosDir}`,
    );
  } else if (updateMode) {
    console.log(`\nvisual:update: PASS (${seconds}s) — ${captured} baseline images written to ${goldenDir}`);
    console.log('Review the baseline diffs and commit them with the change that caused them.');
  } else if (failures.length > 0) {
    console.error(`\nvisual: FAIL — ${failures.length}/${captured} screenshots differ from the baseline:\n`);
    for (const failure of failures) {
      console.error(`  ✗ ${failure.file}\n    ${failure.reason}`);
    }
    console.error(
      '\nIntended change? Run `pnpm run visual:update`, review the baseline diffs and commit them.\nUnintended? That is a visual regression — fix it.',
    );
    process.exitCode = 1;
  } else {
    console.log(`\nvisual: PASS (${seconds}s) — ${captured} screenshots match the baseline`);
  }
} catch (error) {
  const message = error instanceof VisualFailure ? error.message : String(error);
  console.error(`\nvisual: FAIL\n${message}`);
  process.exitCode = 1;
} finally {
  if (browser) await browser.close();
  if (server) await killServer(server);
}
