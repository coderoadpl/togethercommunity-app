import type { Locator, Page, Route } from 'playwright-core';
import type { TenantRouting } from '#core/domain/index.js';
import { API_PATHS } from '#core/contract/index.js';
import { waitForPaint } from './visual-browser-setup.js';

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
  viewports?: readonly ViewportName[];
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

export const visible = { state: 'visible', timeout: 20000 } as const;

const CHECKLIST_DOCK_MIN_WIDTH = 600;

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
    name: 'anon-home-branded',
    auth: 'public',
    tenantSlug: 'akademia',
    path: '/',
    ready: async (page) => {
      await page.getByRole('heading', { name: 'Zajrzyj do środka' }).waitFor(visible);
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
    // Waits target the LAST async element of each screen (waterfall queries),
    // otherwise a shot can land mid-load and produce a flaky golden.
    name: 'start',
    auth: 'member',
    path: '/start',
    ready: async (page) => {
      await page.getByTestId('start-continue-cta').waitFor(visible);
      await page.getByTestId('home-feed-post-post-klub-wyzwanie').waitFor(visible);
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
      await page.getByTestId('sidebar-space-space-studio-klub-js').waitFor(visible);
    },
  },
  {
    name: 'search',
    auth: 'member',
    path: '/search',
    ready: async (page) => {
      await page.getByTestId('search-input').fill('lekcj');
      await page.getByTestId('search-space-space-studio-spolecznosc').waitFor(visible);
      await page.getByTestId('search-lesson-lesson-js-zmienne-1').waitFor(visible);
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
      await page.getByTestId('discussion-composer-open').waitFor(visible);
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
    ready: (page) => page.getByRole('status', { name: 'Otwieranie Twojej platformy…' }).waitFor(visible),
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
      if ((page.viewportSize()?.width ?? 0) >= CHECKLIST_DOCK_MIN_WIDTH) {
        await page.getByTestId('studio-checklist-panel').waitFor(visible);
        await page.getByTestId('onboarding-checklist').waitFor(visible);
      } else {
        await page.getByTestId('studio-checklist-launcher').waitFor(visible);
      }
      await page.getByTestId('dashboard-tile-revenue').waitFor(visible);
      await page.getByTestId('dashboard-member-row').first().waitFor(visible);
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
      await page.getByTestId('redirect-row-redirect-studio-kurs-js').waitFor(visible);
      await page.getByTestId('redirect-row-redirect-studio-oferta').waitFor(visible);
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
    name: 'panel-lesson-attachments',
    auth: 'creator',
    path: '/panel/lessons/lesson-js-zmienne-1',
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
    ready: (page) => page.getByRole('heading', { name: 'Zgody marketingowe' }).waitFor(visible),
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
