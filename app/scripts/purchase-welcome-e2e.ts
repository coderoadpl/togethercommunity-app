import pg from 'pg';
import { chromium, type BrowserContext } from 'playwright-core';
import { z } from 'zod';

import { API_PATHS, TENANT_HEADER } from '#core/contract/index.js';

import { en } from '../apps/web/src/i18n/en.js';
import { signInWithPassword } from './login-flow.js';
import { delay } from './server-harness.js';

const purchases = [
  { productId: 'product-download-workbook', path: '/my/course/product-download-workbook' },
  { productId: 'product-js-full', path: '/start' },
] as const;

const emailSchema = z.object({
  ok: z.literal(true),
  data: z.object({ email: z.object({ text: z.string() }).nullable() }),
});

function assert(condition: boolean, message: string): asserts condition {
  if (!condition) throw new Error(message);
}

export const restrictBrowserToLocalRequests = async (context: BrowserContext): Promise<void> => {
  await context.route('**/*', async (route) => {
    const hostname = new URL(route.request().url()).hostname;
    if (hostname === '127.0.0.1' || hostname === 'localhost' || hostname.endsWith('.localhost')) {
      await route.continue();
    } else {
      await route.abort('blockedbyclient');
    }
  });
};

export const prepareWelcomePurchases = async (databaseUrl: string): Promise<void> => {
  const client = new pg.Client({ connectionString: databaseUrl });
  await client.connect();
  try {
    await client.query(
      'UPDATE products SET price_cents = 0 WHERE tenant_id = $1 AND id = ANY($2::text[])',
      ['tenant-studio', purchases.map((purchase) => purchase.productId)],
    );
  } finally {
    await client.end();
  }
};

export const prepareAttributionPurchase = async (databaseUrl: string): Promise<void> => {
  const client = new pg.Client({ connectionString: databaseUrl });
  await client.connect();
  try {
    await client.query(
      `UPDATE tenants SET terms_url = $2, privacy_url = $3 WHERE id = $1`,
      ['tenant-studio', 'http://studio.localhost/terms', 'http://studio.localhost/privacy'],
    );
    await client.query(
      `INSERT INTO products (id, tenant_id, slug, title, description, price_cents, vat_rate,
        currency, published, checkout_consent_definition_ids, created_at)
       VALUES ($1, $2, 'attribution', 'Attribution workbook', '', 0, '23', 'PLN', true, $3, $4)`,
      ['product-attribution', 'tenant-studio', JSON.stringify(['consent-definition-studio-news']), new Date().toISOString()],
    );
    await client.query(
      `INSERT INTO product_prices (id, tenant_id, product_id, kind, amount_cents, currency, active, created_at)
       VALUES ('price-attribution', 'tenant-studio', 'product-attribution', 'one_time', 0, 'PLN', true, $1)`,
      [new Date().toISOString()],
    );
    await client.query(
      `INSERT INTO sales_links (id, tenant_id, slug, title, heading, description, product_ids,
        active, listed, revision, created_at, updated_at)
       VALUES ('sales-link-attribution', 'tenant-studio', 'attribution', 'Attribution workbook',
        'Attribution workbook', '', $1, true, true, 1, now(), now())`,
      [JSON.stringify(['product-attribution'])],
    );
    await client.query(
      `INSERT INTO tenant_redirects (id, tenant_id, from_path, target_kind, target_path, origin)
       VALUES ('redirect-attribution', 'tenant-studio', '/link/attribution', 'path', '/offer/attribution', 'manual')`,
    );
  } finally {
    await client.end();
  }
};

export const runAttributionPurchase = async (webBaseUrl: string): Promise<void> => {
  const chromeExecutablePath = process.env['PLAYWRIGHT_CHROME_EXECUTABLE_PATH'];
  const browser = await chromium.launch(chromeExecutablePath
    ? { executablePath: chromeExecutablePath, headless: true }
    : { channel: 'chrome', headless: true });
  try {
    const context = await browser.newContext();
    await restrictBrowserToLocalRequests(context);
    await context.addInitScript(() => window.localStorage.setItem('together-language', 'en'));
    const page = await context.newPage();
    await page.goto(`${webBaseUrl}/link/attribution?utm_source=meta&utm_medium=paid&fbclid=X`, { waitUntil: 'networkidle' });
    const checkoutUrl = new URL(page.url());
    assert(checkoutUrl.pathname === '/offer/attribution' && checkoutUrl.searchParams.get('checkout') === 'together',
      'the short link did not reach the consent-aware sales-link checkout');
    assert(checkoutUrl.searchParams.get('utm_source') === 'meta' && checkoutUrl.searchParams.get('fbclid') === 'X',
      'the checkout redirect lost campaign parameters');
    await page.locator('#checkout-email').fill('attribution-buyer@together.dev');
    await page.getByTestId('terms-consent').getByRole('checkbox').check();
    await page.getByTestId('checkout-pay-cta').click();
    await page.getByRole('heading', { name: en.checkout.successTitle }).waitFor({ state: 'visible', timeout: 15000 });
    await page.goto(`${webBaseUrl}/login`, { waitUntil: 'networkidle' });
    await signInWithPassword(page, 'creator@together.dev', 'demo-password-15');
    await page.waitForURL('**/start', { timeout: 15000 });
    await page.goto(`${webBaseUrl}/panel/sales`, { waitUntil: 'networkidle' });
    const orderRow = page.getByRole('row').filter({ hasText: 'attribution-buyer@together.dev' });
    await orderRow.waitFor({ state: 'visible', timeout: 15000 });
    assert((await orderRow.textContent())?.includes('meta / paid') === true,
      'the purchased order did not show its campaign source in Studio');
    await orderRow.locator('a[href*="/panel/sales/"]').first().click();
    await page.getByRole('heading', { name: 'Source', exact: true }).waitFor({ state: 'visible', timeout: 15000 });
    await page.getByText('meta / paid', { exact: true }).waitFor({ state: 'visible', timeout: 15000 });
    await page.getByText('X', { exact: true }).waitFor({ state: 'visible', timeout: 15000 });
    console.log('purchase-welcome-e2e: short-link campaign survives purchase and Studio order detail OK');
    await context.close();
  } finally {
    await browser.close();
  }
};

export const runWelcomePurchases = async (input: {
  connectUrl: string;
  webBaseUrl: string;
  canonicalOrigin: string;
  actionOrigin?: string;
  verify?: (context: BrowserContext, link: string) => Promise<string>;
}): Promise<void> => {
  const chromeExecutablePath = process.env['PLAYWRIGHT_CHROME_EXECUTABLE_PATH'];
  const browser = await chromium.launch(chromeExecutablePath
    ? { executablePath: chromeExecutablePath, headless: true }
    : { channel: 'chrome', headless: true });
  try {
    for (const purchase of purchases) {
      const email = `welcome-${purchase.productId}@together.dev`;
      const response = await fetch(new URL(API_PATHS.checkoutSession, input.connectUrl), {
        method: 'POST',
        headers: { 'content-type': 'application/json', [TENANT_HEADER]: 'studio', origin: input.webBaseUrl },
        body: JSON.stringify({ productId: purchase.productId, email, termsAccepted: true, language: 'en' }),
      });
      assert(response.ok, `welcome checkout failed (HTTP ${response.status}): ${await response.text()}`);
      let link = '';
      const deadline = Date.now() + 15000;
      while (link === '' && Date.now() < deadline) {
        const delivered = await fetch(new URL(`${API_PATHS.devEmail}?to=${encodeURIComponent(email)}`, input.connectUrl));
        const parsed = emailSchema.parse(await delivered.json());
        link = parsed.data.email?.text.match(/https?:\/\/\S+/g)?.find((candidate) =>
          new URL(candidate).searchParams.has('callbackURL')) ?? '';
        if (link === '') await delay(100);
      }
      assert(link !== '', `no purchase welcome email arrived for ${purchase.productId}`);
      const actionUrl = new URL(link);
      assert(actionUrl.origin === (input.actionOrigin ?? input.canonicalOrigin), `welcome link used the wrong origin: ${actionUrl.origin}`);
      assert(actionUrl.searchParams.get('callbackURL') === `${input.canonicalOrigin}${purchase.path}`,
        `welcome link used the wrong callback for ${purchase.productId}`);

      const context = await browser.newContext();
      try {
        await restrictBrowserToLocalRequests(context);
        const page = await context.newPage();
        const destination = input.verify === undefined ? link : await input.verify(context, link);
        await page.goto(destination, { waitUntil: 'networkidle' });
        await page.waitForURL(`${input.webBaseUrl}${purchase.path}`, { timeout: 15000 });
        if (purchase.productId === 'product-download-workbook') {
          const downloads = page.getByTestId(`product-downloads-${purchase.productId}`);
          await downloads.waitFor({ state: 'visible', timeout: 15000 });
          const download = downloads.getByTestId('download-download-asset-workbook-v2');
          assert(await download.isVisible(), 'the freshly signed-in buyer cannot see the purchased download');
          assert((await download.textContent())?.includes('workbook-creator.pdf') === true,
            'the download list did not render the purchased file');
          assert((await download.getAttribute('href'))?.includes('download-asset-workbook-v2') === true,
            'the purchased file did not have a download URL');
        } else {
          await page.getByTestId('start-courses').waitFor({ state: 'visible', timeout: 15000 });
        }
        console.log(`purchase-welcome-e2e: ${input.canonicalOrigin}${purchase.path} OK`);
      } finally {
        await context.close();
      }
    }
  } finally {
    await browser.close();
  }
};
