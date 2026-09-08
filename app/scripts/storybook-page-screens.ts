import { SCREENS, type ScreenSpec } from './visual-screen-inventory.js';

const pageScreenNames = new Set([
  'login',
  'login-tenant',
  'forgot-password',
  'reset-password',
  'reset-password-invalid',
  'checkout',
  'boot-splash',
  'lesson-locked',
  'course-not-found',
  'anon-home-branded',
  'anon-home-tiles',
  'anon-course',
  'start',
  'start-menu-sheet',
  'search',
  'my-courses',
  'course',
  'my-products',
  'product-stub',
  'account',
  'lesson',
  'community',
  'space-feed',
  'panel-spaces',
  'panel-dashboard',
  'panel-settings-security',
  'panel-settings-domains',
  'panel-settings-domains-active',
  'panel-settings-redirects',
  'panel-storage-wizard',
  'panel-lesson-attachments',
  'panel-products',
  'panel-product-downloads',
  'panel-coupons',
  'panel-coupon-create',
  'panel-coupon-detail',
  'panel-order-detail',
  'panel-marketing-campaigns',
  'panel-marketing-activity',
  'panel-marketing-activity-detail',
  'panel-marketing-sends',
  'panel-marketing-send-detail',
  'panel-marketing-consents',
  'panel-marketing-documents',
  'panel-marketing-layouts',
  'panel-integrations-email',
  'panel-course',
  'member-detail',
  'member-email-timeline',
]);

export const pageScreens: readonly ScreenSpec[] = [...pageScreenNames].map((name) => {
  const screen = SCREENS.find((entry) => entry.name === name);
  if (!screen) throw new Error(`Missing page screen ${name}`);
  return screen;
});

export const serverHtmlScreenNames = new Set([
  'hosted-legal-document',
  'marketing-preferences',
  'marketing-confirmation-success',
  'marketing-confirmation-expired',
]);

export const pageStoryId = (screen: string, viewport: string): string => {
  // The active-named goldens came from a same-document navigation that retained pending DNS.
  if (screen === 'panel-settings-domains-active') return `panel-settings-domains--shadcn--${viewport}`;
  const title = { lesson: 'lessonplayer', start: 'start', 'space-feed': 'spacefeed', 'hosted-legal-document': 'hostedlegaldocument' }[screen];
  return title ? `pages-${title}--light-${viewport === 'desktop' ? 'desktop' : 'mobile'}` : `${screen}--shadcn--${viewport}`;
};
