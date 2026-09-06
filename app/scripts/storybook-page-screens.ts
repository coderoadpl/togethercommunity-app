import type { Page } from 'playwright-core';
const visible = { state: 'visible', timeout: 20000 } as const;
const CHECKLIST_DOCK_MIN_WIDTH = 600;
const waitForUnreadBadge = async (page: Page): Promise<void> => {
  const width = page.viewportSize()?.width ?? 0;
  if (width >= 900) {
    await page.getByTestId('notification-bell-count').waitFor(visible);
    return;
  }
  await page
    .locator('[data-testid="notification-badge"] .MuiBadge-badge:not(.MuiBadge-invisible)')
    .waitFor(visible);
};

export const pageScreens: { name: string; auth: string; path: string; tenantSlug?: string; viewports?: string[]; ready: (page: Page) => Promise<unknown>; settled?: (page: Page) => Promise<void> }[] = [
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
