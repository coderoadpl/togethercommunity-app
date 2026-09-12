import type { Locator, Page, Route } from 'playwright-core';
import type { TenantRouting } from '#core/domain/index.js';
import { API_PATHS } from '#core/contract/index.js';
import { waitForPaint } from './visual-browser-setup.js';
import { en } from '../apps/web/src/i18n/en.js';

export const VIEWPORTS = [
  { name: 'desktop', width: 1440, height: 900, scope: 'all' },
  { name: 'mobile', width: 390, height: 844, scope: 'all' },
  { name: 'mobile-375', width: 375, height: 812, scope: 'member-checkout' },
] as const;

export type AuthKind = 'public' | 'member' | 'member-free' | 'creator';
type ViewportName = (typeof VIEWPORTS)[number]['name'];

export interface ScreenSpec {
  name: string;
  auth: AuthKind;
  path: string;
  fixtureName?: string;
  host?: string;
  viewports?: readonly ViewportName[];
  tenantSlug?: string;
  prepare?: (page: Page) => Promise<ScreenPreparation>;
  ready: (page: Page) => Promise<void>;
  settled?: (page: Page) => Promise<void>;
  waitForNetworkIdle?: boolean;
  minBytes?: number;
  fullPage?: boolean;
  isolateCapture?: boolean;
  mask?: (page: Page) => Locator[];
}

interface ScreenPreparation {
  renderingInputsReady: Promise<void>;
  cleanup: () => Promise<void>;
}

export const visible = { state: 'visible', timeout: 20000 } as const;

const DASHBOARD_ASIDE_MIN_WIDTH = 1200;

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

// The count arrives asynchronously, so a shot can otherwise land on a bare bell.
const waitForUnreadBadge = async (page: Page): Promise<void> => {
  await page
    .locator('[data-testid="notification-badge"] .MuiBadge-badge:not(.MuiBadge-invisible)')
    .waitFor(visible);
};

const waitForFixtureCall = async (page: Page, expected: string): Promise<void> => {
  await page.waitForFunction((call) => {
    const raw = document.documentElement.dataset['fixtureCalls'];
    if (raw === undefined) return false;
    const parsed: unknown = JSON.parse(raw);
    return Array.isArray(parsed) && parsed.some((item) => typeof item === 'string' && item === call);
  }, expected, { timeout: visible.timeout });
};

export const domainChecklistRouting = (active: boolean): TenantRouting => {
  const domain = 'courses.example.org';
  return {
    tenantHost: 'workspace.example.org',
    storageCorsOrigins: ['https://workspace.example.org', `https://${domain}`],
    canonicalOrigin: `https://${domain}`,
    customDomainTarget: 'routing.example.org',
    apexDomainsSupported: false,
    canAddCustomDomain: true,
    customDomains: [{
      domain, verified: active, status: active ? 'active' : 'pending-dns',
      lastCheckedAt: null, lastError: null, storageCorsStatus: 'unknown',
      records: [
        { type: 'CNAME', name: domain, value: 'routing.example.org', purpose: 'routing', status: active ? 'verified' : 'pending' },
        { type: 'TXT', name: `_vercel.${domain}`, value: 'vc-domain-verify=courses.example.org,challenge', purpose: 'ownership', status: 'verified' },
      ],
    }],
  };
};

const prepareDomainChecklist = async (page: Page, active: boolean): Promise<ScreenPreparation> => {
  const handler = async (route: Route): Promise<void> => {
    await route.fulfill({ json: { ok: true, data: { routing: domainChecklistRouting(active) } } });
  };
  await page.route('**/api/tenant/routing', handler);
  return {
    renderingInputsReady: Promise.resolve(),
    cleanup: () => page.unroute('**/api/tenant/routing', handler),
  };
};

export const SCREENS: readonly ScreenSpec[] = [
  {
    name: 'login',
    auth: 'public',
    path: '/login',
    host: 'localhost',
    ready: (page) => page.getByTestId('login-email').waitFor(visible),
  },
  {
    name: 'login-resolve-error',
    auth: 'public',
    path: '/login',
    fixtureName: 'login',
    viewports: ['mobile'],
    ready: (page) => page.getByTestId('sign-in-methods-unavailable').waitFor(visible),
  },
  {
    name: 'login-tenant',
    auth: 'public',
    path: '/login',
    fixtureName: 'login',
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
    path: '/checkout/product-studio-course-101',
    ready: (page) => page.getByText('Together 101 Course').first().waitFor(visible),
  },
  {
    name: 'marketing-preferences',
    auth: 'public',
    tenantSlug: 'akademia',
    path: '/u/unsubscribe_akademia_visual_123456?lang=en',
    ready: (page) => page.getByTestId('marketing-preferences').waitFor(visible),
  },
  {
    name: 'hosted-legal-document',
    auth: 'public',
    tenantSlug: 'akademia',
    path: '/legal/privacy-policy/v/1?lang=en',
    ready: (page) => page.getByTestId('hosted-legal-document').waitFor(visible),
  },
  {
    name: 'marketing-confirmation-success',
    auth: 'public',
    tenantSlug: 'akademia',
    path: '/marketing/confirm/confirmation_akademia_visual_123456?lang=en',
    ready: (page) => page.getByTestId('marketing-confirmation-success').waitFor(visible),
  },
  {
    name: 'marketing-confirmation-expired',
    auth: 'public',
    tenantSlug: 'akademia',
    path: '/marketing/confirm/expired_confirmation_visual_123456?lang=en',
    ready: (page) => page.getByTestId('marketing-confirmation-expired').waitFor(visible),
  },
  {
    name: 'anon-home-branded',
    auth: 'public',
    tenantSlug: 'akademia',
    path: '/',
    ready: async (page) => {
      await page.getByRole('heading', { name: en.anon.homeTitle }).waitFor(visible);
      await page.getByTestId('tenant-logo').first().waitFor(visible);
    },
  },
  {
    name: 'anon-home-tiles',
    auth: 'public',
    path: '/',
    ready: async (page) => {
      await page.getByTestId('anon-home-feed').waitFor(visible);
      await page.getByTestId('anon-courses').waitFor(visible);
      await page.getByTestId('anon-locked').waitFor(visible);
      await page.getByTestId('course-cover-course-js').waitFor(visible);
    },
    settled: async (page) => {
      await page
        .getByTestId('anon-courses')
        .evaluate((element) => element.scrollIntoView({ block: 'start' }));
    },
  },
  {
    name: 'anon-course',
    auth: 'public',
    path: '/my/courses/course-js',
    ready: async (page) => {
      await page.getByTestId('anon-course-program').waitFor(visible);
      await page.getByTestId('course-cover').waitFor(visible);
    },
  },
  {
    name: 'anon-space',
    auth: 'public',
    path: '/community/space-studio-community',
    fixtureName: 'anon-home-tiles',
    viewports: ['mobile'],
    ready: async (page) => {
      await page.getByTestId('anon-join-cta').waitFor(visible);
      await page.getByTestId('public-space-events-empty').waitFor(visible);
      await page.getByTestId('public-post-body-post-community-hello').waitFor(visible);
    },
  },
  {
    // Waits target the LAST async element of each screen (waterfall queries),
    // otherwise a shot can land mid-load and produce a flaky golden.
    name: 'start',
    auth: 'member',
    path: '/start',
    ready: async (page) => {
      await page.getByTestId('start-continue-cta').waitFor(visible);
      await page.getByTestId('home-feed-post-post-club-challenge').waitFor(visible);
      await page.getByTestId('start-spaces').waitFor(visible);
      await page.getByTestId('start-courses').waitFor(visible);
      await page.getByTestId('start-locked').waitFor(visible);
      await waitForUnreadBadge(page);
    },
  },
  {
    name: 'start-menu-sheet',
    auth: 'member',
    path: '/start',
    viewports: ['mobile'],
    ready: async (page) => {
      await page.getByTestId('member-tab-menu').click();
      await page.getByTestId('member-menu-sheet').waitFor(visible);
      await page.getByTestId('sidebar-course-course-js').waitFor(visible);
      await page.getByTestId('sidebar-space-space-studio-club-js').waitFor(visible);
      // The sheet covers its trigger, so the click position can hover an account action.
      await page.mouse.move(0, 0);
    },
    settled: async (page) => {
      // The opening sheet moves its sign-out row under the menu trigger's pointer position.
      await page.mouse.move(0, 0);
    },
  },
  {
    name: 'search',
    auth: 'member',
    path: '/search',
    ready: async (page) => {
      await page.getByTestId('search-input').fill('lesson');
      await page.getByTestId('search-space-space-studio-community').waitFor(visible);
      await page.getByTestId('search-lesson-lesson-js-variables-1').waitFor(visible);
      await page.getByTestId('search-lesson-lesson-js-dom-1').waitFor(visible);
    },
  },
  {
    name: 'my-courses',
    auth: 'member',
    path: '/my',
    ready: async (page) => {
      await page.getByTestId('course-card-course-js').waitFor(visible);
      await page.getByTestId('course-progress-course-js').waitFor(visible);
      await waitForUnreadBadge(page);
    },
  },
  {
    name: 'course',
    auth: 'member',
    path: '/my/courses/course-js',
    ready: async (page) => {
      await page.getByTestId('progress-percent').waitFor(visible);
      await page.getByTestId('continue-cta').waitFor(visible);
      await page.getByTestId('course-cover').waitFor(visible);
      await page.getByTestId('course-discussion-search').waitFor(visible);
    },
  },
  {
    name: 'course-long-curriculum',
    fixtureName: 'course',
    auth: 'member',
    path: '/my/courses/course-js',
    viewports: ['desktop', 'mobile'],
    fullPage: true,
    ready: async (page) => {
      await page.getByTestId('course-discussion-search').waitFor(visible);
      await page.getByTestId('course-cover').waitFor(visible);
      await waitForUnreadBadge(page);
    },
    settled: async (page) => {
      const desktop = (page.viewportSize()?.width ?? 0) >= 900;
      const sidebar = page.locator('aside').filter({ has: page.getByTestId('course-sidebar') });
      const appBar = page.locator('header').filter({ has: page.getByTestId('shell-breadcrumbs') });
      const viewportHeight = page.viewportSize()?.height ?? 0;
      for (const atBottom of [false, true]) {
        await page.evaluate((bottom) => window.scrollTo(0, bottom ? document.documentElement.scrollHeight : 0), atBottom);
        await waitForPaint(page);
        if (!desktop) continue;
        const bounds = await sidebar.boundingBox();
        const barBounds = await appBar.boundingBox();
        const geometry = await sidebar.evaluate((element) => {
          const style = getComputedStyle(element);
          const ancestors = [];
          for (let node = element.parentElement; node !== null; node = node.parentElement) {
            const ancestorStyle = getComputedStyle(node);
            ancestors.push({ tag: node.tagName, overflowX: ancestorStyle.overflowX, overflowY: ancestorStyle.overflowY });
          }
          return { tag: element.tagName, position: style.position, top: style.top, maxHeight: style.maxHeight, alignSelf: style.alignSelf, overflowY: style.overflowY, scrollY: window.scrollY, ancestors };
        });
        const diagnostic = JSON.stringify({ atBottom, bounds, barBounds, viewportHeight, geometry });
        console.log(`Course sidebar geometry: ${diagnostic}`);
        assert(bounds !== null && barBounds !== null && barBounds.height > 0
          && Math.abs(barBounds.y) < 1
          && Math.abs(bounds.y - barBounds.height) < 1
          && Math.abs(bounds.height - (viewportHeight - barBounds.height)) < 1,
        `Course sidebar must fill the viewport beside the app bar at both scroll positions: ${diagnostic}`);
        assert(geometry.tag === 'ASIDE' && geometry.position === 'sticky' && geometry.alignSelf === 'flex-start'
          && geometry.overflowY === 'auto'
          && Math.abs(Number.parseFloat(geometry.top) - barBounds.height) < 1
          && Math.abs(Number.parseFloat(geometry.maxHeight) - bounds.height) < 1
          && geometry.ancestors.every((ancestor) => ancestor.overflowX === 'visible' && ancestor.overflowY === 'visible'),
        `Course sidebar must stay sticky without ancestor overflow clipping: ${diagnostic}`);
      }
      assert(await page.evaluate(() => window.scrollY > 0), 'Long curriculum must scroll the document');
      if (!desktop) {
        await page.getByTestId('program-button').click();
        await page.getByTestId('course-program-sheet').waitFor(visible);
      }
      const tree = (desktop ? sidebar : page.getByTestId('course-program-sheet')).getByTestId('course-tree-scroll');
      const documentScroll = await page.evaluate(() => window.scrollY);
      const treeScroll = await tree.evaluate((element) => {
        element.scrollTop = element.scrollHeight;
        return { top: element.scrollTop, height: element.clientHeight, scrollHeight: element.scrollHeight, overflowY: getComputedStyle(element).overflowY };
      });
      await waitForPaint(page);
      assert(treeScroll.overflowY === 'auto' && treeScroll.top > 0
        && Math.abs(treeScroll.top + treeScroll.height - treeScroll.scrollHeight) < 1,
      `Long curriculum must scroll to its bottom internally: ${JSON.stringify(treeScroll)}`);
      assert(await page.evaluate(() => window.scrollY) === documentScroll, 'Curriculum scrolling must not scroll the document');
      await tree.evaluate((element) => { element.scrollTop = 0; });
      if (!desktop) {
        await page.keyboard.press('Escape');
        await page.getByTestId('course-program-sheet').waitFor({ state: 'hidden' });
      }
      await page.evaluate(() => window.scrollTo(0, 0));
      await waitForPaint(page);
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
    path: '/my/courses/course-js/lessons/lesson-js-variables-2',
    ready: async (page) => {
      await page.getByTestId('locked-lesson-upsell').waitFor(visible);
      await page.getByTestId('locked-product-price').waitFor(visible);
    },
  },
  {
    name: 'lesson',
    auth: 'member',
    path: '/my/courses/course-js/lessons/lesson-js-variables-1',
    ready: async (page) => {
      await page.getByTestId('member-breadcrumbs').waitFor(visible);
      await page.getByTestId('discussion-composer-input').waitFor(visible);
      await page.getByTestId('author-chip-post-js-variables-q-r2').waitFor(visible);
    },
  },
  {
    name: 'community',
    auth: 'member',
    path: '/community',
    ready: async (page) => {
      await page.getByTestId('space-card-space-studio-community').waitFor(visible);
      await page.getByTestId('space-card-space-studio-club-js').waitFor(visible);
      await waitForUnreadBadge(page);
    },
  },
  {
    name: 'space-feed',
    auth: 'member',
    path: '/community/space-studio-community',
    ready: async (page) => {
      await page.getByTestId('post-body-post-community-hello').waitFor(visible);
      await page.getByTestId('reaction-post-community-hello-👍').waitFor(visible);
      await page.getByTestId('space-follow-toggle').waitFor(visible);
      await waitForUnreadBadge(page);
      await waitForFixtureCall(page, 'markSpaceSeen:[{"spaceId":"space-studio-community"}]');
    },
  },
  {
    name: 'boot-splash',
    auth: 'creator',
    path: '/panel',
    prepare: prepareBootSplash,
    ready: (page) => page.getByRole('status', { name: 'Opening your workspace…' }).waitFor(visible),
    waitForNetworkIdle: false,
    minBytes: 7 * 1024,
  },
  {
    name: 'panel-spaces',
    auth: 'creator',
    path: '/panel/spaces',
    ready: async (page) => {
      await page.getByTestId('space-manage-space-studio-community').waitFor(visible);
      await page.getByTestId('space-manage-space-studio-club-js').waitFor(visible);
    },
  },
  {
    name: 'panel-dashboard',
    auth: 'creator',
    path: '/panel',
    ready: async (page) => {
      const desktop = (page.viewportSize()?.width ?? 0) >= DASHBOARD_ASIDE_MIN_WIDTH;
      if (desktop) {
        await page.getByTestId('studio-checklist-panel').waitFor(visible);
        await page.getByTestId('onboarding-checklist').waitFor(visible);
      } else {
        await page.getByTestId('studio-checklist-launcher').waitFor(visible);
      }
      await page.getByTestId('dashboard-tile-revenue').waitFor(visible);
      await page.getByTestId('dashboard-member-row').first().waitFor(visible);
      if (!desktop) return;
      await page.getByTestId('dashboard-aside').waitFor(visible);
      const manage = page.getByTestId('dashboard-member-row').first().getByRole('button', { name: en.members.manage });
      await manage.waitFor(visible);
      const hit = await manage.evaluate((element) => {
        const rect = element.getBoundingClientRect();
        const top = document.elementFromPoint(rect.left + rect.width / 2, rect.top + rect.height / 2);
        return { clear: top !== null && (element === top || element.contains(top)), topTestId: top instanceof HTMLElement ? top.dataset['testid'] ?? null : null, topTag: top?.tagName ?? null };
      });
      assert(hit.clear, `Dashboard member manage action must not be covered: ${JSON.stringify(hit)}`);
    },
  },
  ...[false, true].map((active): ScreenSpec => ({
    name: active ? 'panel-settings-domains-active' : 'panel-settings-domains',
    auth: 'creator',
    path: '/panel/settings#domains',
    prepare: (page) => prepareDomainChecklist(page, active),
    ready: (page) => page.getByTestId('tenant-domain-courses.example.org').waitFor(visible),
    settled: async (page) => {
      // The initial hash jump can precede font layout and leave stale sticky-layer pixels.
      await page.evaluate(() => window.scrollTo(0, 0));
      await waitForPaint(page);
      await page.locator('#domains').evaluate((element) => element.scrollIntoView({ block: 'start' }));
    },
  })),
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
    name: 'panel-settings-redirects',
    auth: 'creator',
    path: '/panel/settings/redirects',
    ready: async (page) => {
      await page.getByTestId('redirect-row-redirect-studio-course-js').waitFor(visible);
      await page.getByTestId('redirect-row-redirect-studio-offer').waitFor(visible);
    },
  },
  {
    name: 'panel-storage-wizard',
    auth: 'creator',
    path: '/panel/integrations#storage',
    ready: (page) => page.getByTestId('storage-provider-step').waitFor(visible),
    settled: async (page) => {
      await page.getByTestId('storage-wizard').evaluate((element) =>
        element.scrollIntoView({ block: 'start' }),
      );
    },
    // CORS instructions contain the ephemeral authoring origin.
    mask: (page) => [page.locator('[data-testid^="storage-cors-origin-"]'), page.getByTestId('storage-cors-json')],
  },
  {
    name: 'panel-storage-wizard-connection',
    auth: 'creator',
    path: '/panel/integrations#storage',
    fixtureName: 'panel-storage-wizard',
    ready: (page) => page.getByTestId('storage-connection-step').waitFor(visible),
    settled: async (page) => {
      await page.getByTestId('storage-wizard').evaluate((element) =>
        element.scrollIntoView({ block: 'start' }),
      );
    },
    mask: (page) => [page.locator('[data-testid^="storage-cors-origin-"]')],
  },
  {
    name: 'panel-lesson-attachments',
    auth: 'creator',
    path: '/panel/lessons/lesson-js-variables-1',
    ready: (page) => page.getByTestId('lesson-attachments-empty').waitFor(visible),
    settled: async (page) => {
      await page.locator('#block-1-html').evaluate((element) => { element.scrollTop = element.scrollHeight; });
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
    ready: (page) => page.getByText(en.coupons.timeSeries).waitFor(visible),
  },
  {
    name: 'panel-order-detail',
    auth: 'creator',
    path: '/panel/sales/order-studio-active-js',
    ready: (page) => page.getByText('PARTNER20').waitFor(visible),
  },
  {
    name: 'panel-marketing-contacts',
    auth: 'creator',
    path: '/panel/marketing/contacts',
    ready: (page) => page.getByRole('table', { name: en.directory.contactsTitle, exact: true }).waitFor(visible),
  },
  {
    name: 'panel-marketing-lists',
    auth: 'creator',
    path: '/panel/marketing/lists',
    ready: (page) => page.getByRole('table', { name: en.directory.listsTitle, exact: true }).waitFor(visible),
  },
  {
    name: 'panel-marketing-contact-import',
    auth: 'creator',
    path: '/panel/marketing/contacts/import',
    ready: (page) => page.locator('input[type="file"]').waitFor({ state: 'attached', timeout: 20000 }),
  },
  {
    name: 'panel-marketing-campaigns',
    auth: 'creator',
    path: '/panel/marketing/campaigns',
    ready: (page) => page.getByRole('heading', { name: 'Email campaigns' }).waitFor(visible),
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
    ready: (page) => page.getByRole('heading', { name: 'Consent forms' }).waitFor(visible),
  },
  {
    name: 'panel-marketing-documents',
    auth: 'creator',
    path: '/panel/marketing/documents',
    ready: (page) => page.getByRole('heading', { name: 'Legal documents' }).waitFor(visible),
  },
  {
    name: 'panel-marketing-layouts',
    auth: 'creator',
    path: '/panel/marketing/layouts',
    ready: (page) => page.getByRole('heading', { name: en.marketing.layoutsTitle, exact: true }).waitFor(visible),
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
    isolateCapture: true,
    path: '/panel/courses/course-js',
    ready: (page) => page.getByTestId('module-card').first().waitFor(visible),
  },
  {
    name: 'member-detail',
    auth: 'creator',
    path: '/panel/members/member-studio-active',
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
    path: '/panel/members/member-studio-active',
    ready: async (page) => {
      await page.getByRole('tab', { name: 'Emails' }).click();
      await page.getByTestId('member-email-send').first().waitFor(visible);
    },
  },
];

export class VisualFailure extends Error {}

function assert(condition: boolean, message: string): asserts condition {
  if (!condition) throw new VisualFailure(message);
}

export const includesViewport = (screen: ScreenSpec, viewport: (typeof VIEWPORTS)[number]): boolean =>
  (screen.viewports?.includes(viewport.name) ?? true)
  && (viewport.scope === 'all'
    || screen.name === 'checkout'
    || screen.auth === 'member'
    || screen.auth === 'member-free');
