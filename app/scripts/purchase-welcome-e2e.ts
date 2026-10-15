import pg from 'pg';
import { chromium, type BrowserContext } from 'playwright-core';
import { z } from 'zod';

import { API_PATHS, TENANT_HEADER } from '#core/contract/index.js';

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
