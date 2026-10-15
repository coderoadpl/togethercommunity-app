import pg from 'pg';
import { chromium, type Page } from 'playwright-core';

import { en } from '../apps/web/src/i18n/en.js';
import { restrictBrowserToLocalRequests } from './purchase-welcome-e2e.js';

const sessionId = 'cs_live_analyticsNavigation';
const returnPath = `/checkout/product-js-full?status=success&session_id=${sessionId}`;
const memberPath = '/my/products?from=checkout#purchases';
const marker = '__togetherNavigationMarker';
const prematureMemberRender = 'together.analytics.prematureMemberRender';

function assert(condition: boolean, message: string): asserts condition {
  if (!condition) throw new Error(message);
}

export const prepareCheckoutAnalytics = async (databaseUrl: string): Promise<void> => {
  const client = new pg.Client({ connectionString: databaseUrl });
  await client.connect();
  try {
    await client.query(
      `UPDATE tenants SET analytics_tag_id = $2, analytics_meta_pixel_id = $3,
        analytics_consent_cookie_name = $4, analytics_consent_cookie_value = $5,
        analytics_load_without_consent = false WHERE id = $1`,
      ['tenant-studio', 'G-ANALYTICS1', '123456789012345', 'analytics_consent', '"choice":"granted"'],
    );
    await client.query(
      `INSERT INTO orders (id, tenant_id, member_id, product_id, kind, status, amount_cents,
        currency, provider, provider_object_ids, mode, paid_at, created_at)
       VALUES ($1, $2, $3, $4, 'one_time', 'paid', 39900, 'PLN', 'stripe', $5, 'live', now(), $6)`,
      ['order-analytics-navigation', 'tenant-studio', 'member-studio-active', 'product-js-full',
        JSON.stringify({ checkoutSession: sessionId }), new Date().toISOString()],
    );
  } finally {
    await client.end();
  }
};

const markSuccessDocument = async (page: Page): Promise<void> => {
  await page.getByRole('heading', { name: en.checkout.successTitle }).waitFor({ state: 'visible' });
  await page.waitForFunction((id) =>
    typeof window.gtag === 'function' && typeof window.fbq === 'function' &&
    localStorage.getItem(`together.analytics.purchase.${id}`) === 'true' &&
    localStorage.getItem(`together.analytics.meta-purchase.${id}`) === 'true', sessionId);
  await page.evaluate(({ key, failureKey }) => {
    Object.assign(window, { [key]: true });
    const observer = new MutationObserver(() => {
      if (document.querySelector('[data-testid="member-sidebar"], [data-testid="member-bottom-nav"]')) {
        sessionStorage.setItem(failureKey, 'true');
      }
    });
    observer.observe(document.documentElement, { childList: true, subtree: true });
  }, { key: marker, failureKey: prematureMemberRender });
};

const assertDocumentExit = async (
  page: Page,
  destination: string,
  action: () => Promise<unknown>,
): Promise<void> => {
  const [response] = await Promise.all([
    page.waitForResponse((candidate) => candidate.request().isNavigationRequest() && candidate.url() === destination),
    page.waitForEvent('domcontentloaded'),
    action(),
  ]);
  assert(response.ok(), `analytics navigation document returned HTTP ${response.status()}`);
  assert(await page.evaluate((key) => !(key in window), marker),
    'checkout analytics survived the document exit');
  assert(await page.evaluate((key) => sessionStorage.getItem(key) === null, prematureMemberRender),
    'a member view rendered in the checkout analytics document');
};

export const runCheckoutAnalyticsNavigation = async (webBaseUrl: string): Promise<void> => {
  const chromeExecutablePath = process.env['PLAYWRIGHT_CHROME_EXECUTABLE_PATH'];
  const browser = await chromium.launch(chromeExecutablePath
    ? { executablePath: chromeExecutablePath, headless: true }
    : { channel: 'chrome', headless: true });
  try {
    for (const action of ['sign-in', 'back', 'forward', 'programmatic'] as const) {
      const context = await browser.newContext();
      try {
        await restrictBrowserToLocalRequests(context);
        const vendorRequests = new Set<string>();
        await context.route(/^https:\/\/(www\.googletagmanager\.com\/gtag\/js|connect\.facebook\.net\/en_US\/fbevents\.js)(\?|$)/u, async (route) => {
          vendorRequests.add(new URL(route.request().url()).hostname);
          await route.fulfill({ status: 200, contentType: 'application/javascript', body: '' });
        });
        await context.addCookies([{
          name: 'analytics_consent', value: encodeURIComponent('{"choice":"granted"}'), url: webBaseUrl,
        }]);
        const page = await context.newPage();
        await page.goto(`${webBaseUrl}${returnPath}`, { waitUntil: 'networkidle' });
        await markSuccessDocument(page);
        assert(vendorRequests.has('www.googletagmanager.com') && vendorRequests.has('connect.facebook.net'),
          'both analytics libraries must be requested with the live paid order and consent cookie');

        if (action === 'back' || action === 'forward') {
          // Native methods prepare same-document entries without notifying the application router.
          await page.evaluate(async ({ direction, success, destination }) => {
            const state: unknown = window.history.state;
            if (typeof state !== 'object' || state === null || !('__TSR_index' in state) || typeof state.__TSR_index !== 'number') {
              throw new Error('The application router did not initialize browser history');
            }
            if (direction === 'back') {
              History.prototype.replaceState.call(window.history, { ...state, __TSR_index: state.__TSR_index - 1 }, '', destination);
              History.prototype.pushState.call(window.history, state, '', success);
            } else {
              History.prototype.pushState.call(window.history, { ...state, __TSR_index: state.__TSR_index + 1 }, '', destination);
              await new Promise<void>((resolve) => {
                window.addEventListener('popstate', () => resolve(), { once: true });
                window.history.back();
              });
            }
          }, { direction: action, success: returnPath, destination: memberPath });
        }

        const destination = `${webBaseUrl}${action === 'sign-in' ? '/login' : memberPath}`;
        await assertDocumentExit(page, destination.split('#')[0] ?? destination, async () => {
          if (action === 'sign-in') await page.getByRole('link', { name: en.checkout.goToLogin }).click();
          else if (action === 'back') await page.evaluate(() => window.history.back());
          else if (action === 'forward') await page.evaluate(() => window.history.forward());
          else await page.evaluate(() => {
            const router = self.__TSR_ROUTER__;
            if (router === undefined) throw new Error('The application router is unavailable');
            void router.navigate({ to: '/my/products', search: { from: 'checkout' }, hash: 'purchases' });
          });
        });
        console.log(`checkout-analytics-e2e: ${action} exits through a new document OK`);
      } finally {
        await context.close();
      }
    }
  } finally {
    await browser.close();
  }
};
