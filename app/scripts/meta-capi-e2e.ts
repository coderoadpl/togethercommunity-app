import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import type { ChildProcess } from 'node:child_process';
import { join } from 'node:path';
import { eq } from 'drizzle-orm';
import { chromium, type Browser } from 'playwright-core';
import { createTestDatabase } from '#adapters/db/test-database-name.js';
import { createMetaCapiRepository } from '#adapters/db/meta-capi.js';
import { createTenantDirectory, createTenantRepository } from '#adapters/db/repositories.js';
import { members, metaCapiConsentEvidence, metaCapiEvents, metaCapiOutbox, orders, products, tenants, user } from '#adapters/db/schema.js';
import { ok } from '#core/domain/index.js';
import { dispatchMetaCapi } from '#core/server/usecases/meta-capi.js';
import { en } from '../apps/web/src/i18n/en.js';
import { metaCapiConfig } from '../apps/web/src/test/meta-capi-fixtures.js';
import { bootServer, ephemeralPort, killServer, rootDir, run } from './server-harness.js';

const database = await createTestDatabase('together_meta_capi_e2e', process.env['DATABASE_URL'] ?? 'postgres://together:together@localhost:48912/together');
let server: ChildProcess | undefined;
let browser: Browser | undefined;
try {
  const now = new Date().toISOString();
  await database.db.insert(tenants).values({ id: 'acme', slug: 'acme', name: 'Acme', createdAt: now,
    analyticsMetaPixelId: '123456789', analyticsMetaCapiEnabled: true, privacyUrl: 'https://example.org/privacy',
    analyticsConsentCookieName: 'marketing-consent',
    analyticsMetaCapiConsentHeading: metaCapiConfig.heading, analyticsMetaCapiConsentBody: metaCapiConfig.body,
    analyticsMetaCapiConsentAcceptLabel: metaCapiConfig.acceptLabel, analyticsMetaCapiConsentDeclineLabel: metaCapiConfig.declineLabel });
  await database.db.insert(user).values({ id: 'buyer', email: 'buyer@example.org', name: 'Buyer' });
  await database.db.insert(members).values({ id: 'buyer', tenantId: 'acme', userId: 'buyer', email: 'buyer@example.org', createdAt: now });
  await database.db.insert(products).values({ id: 'book', tenantId: 'acme', slug: 'book', type: 'digital_download', title: 'Book', description: '', priceCents: 9900, currency: 'PLN', published: true, createdAt: now });
  for (const id of ['decline', 'accept', 'disabled', 'dismiss']) {
    await database.db.insert(orders).values({ id, tenantId: 'acme', memberId: 'buyer', productId: 'book', kind: 'one_time', status: 'paid', mode: 'live',
      amountCents: 9900, currency: 'PLN', provider: 'stripe', providerObjectIds: { checkoutSession: `cs_live_${id}` }, paidAt: now, createdAt: now });
  }
  const build = await run(join(rootDir, 'node_modules/.bin/vite'), ['build', '--config', 'apps/web/vite.config.ts'], {});
  assert.equal(build.code, 0, `Web build failed: ${build.stderr}`);
  const port = await ephemeralPort();
  const origin = `http://acme.localhost:${port}`;
  server = await bootServer({ port, healthUrl: `http://127.0.0.1:${port}/api/health`, env: {
    NODE_ENV: 'test', DATABASE_URL: database.url, APP_BASE_URL: origin, APP_BASE_DOMAIN: 'localhost', WEB_DIST_DIR: 'dist/web', PAYMENT_PROVIDER: 'fake',
  } });
  const executablePath = process.env['PLAYWRIGHT_CHROME_EXECUTABLE_PATH'];
  browser = await chromium.launch(executablePath ? { headless: true, executablePath } : { headless: true, channel: 'chrome' });
  const context = await browser.newContext();
  await context.route('**/*', (route) => new URL(route.request().url()).origin === origin ? route.continue() : route.abort());
  await context.addInitScript(() => { window.localStorage.setItem('together-language', 'en'); });
  await context.addCookies([{ name: '_fbp', value: 'fb.1.123456.987', url: origin }]);
  const page = await context.newPage();
  const visit = async (id: string, prefix = 'checkout') => {
    await page.goto(`${origin}/${prefix}/book?status=success&session_id=cs_live_${id}`, { waitUntil: 'networkidle' });
  };
  const choose = async (label: string) => {
    const response = page.waitForResponse((entry) => entry.url().endsWith('/api/public/meta-capi/consent') && entry.request().method() === 'POST');
    await page.getByRole('button', { name: label, exact: true }).click();
    assert.equal((await response).status(), 200);
    await page.getByRole('dialog').waitFor({ state: 'hidden' });
    await page.getByRole('heading', { name: en.checkout.successTitle, exact: true }).waitFor();
  };
  await visit('decline');
  await page.getByRole('dialog', { name: metaCapiConfig.heading }).waitFor();
  await choose(metaCapiConfig.declineLabel);
  assert.equal((await database.db.select().from(metaCapiOutbox).where(eq(metaCapiOutbox.orderId, 'decline'))).length, 0);
  assert.equal((await database.db.select().from(orders).where(eq(orders.id, 'decline')))[0]?.metaCapiConsent, 'denied');
  await page.reload({ waitUntil: 'networkidle' });
  assert.equal(await page.getByRole('dialog').count(), 0);
  console.log('meta-capi-e2e: decline reveals purchase and creates no outbox row');

  await visit('accept', 'offer');
  await choose(metaCapiConfig.acceptLabel);
  const pending = await database.db.select().from(metaCapiOutbox).where(eq(metaCapiOutbox.orderId, 'accept'));
  assert.equal(pending.length, 1);
  assert.equal(pending[0]?.fbp, 'fb.1.123456.987');
  const evidence = await database.db.select().from(metaCapiConsentEvidence).where(eq(metaCapiConsentEvidence.orderId, 'accept'));
  assert.equal(evidence[0]?.source, 'return-page');
  assert.match(evidence[0]?.textSnapshot ?? '', /Help us improve/);
  let deliveries = 0;
  const dispatched = await dispatchMetaCapi({
    repository: createMetaCapiRepository(database.db, async () => origin), tenants: createTenantRepository(database.db), directory: createTenantDirectory(database.db),
    clock: { nowIso: () => new Date().toISOString() }, hash: { sha256: (value) => createHash('sha256').update(value).digest('hex') },
    secrets: { resolve: async () => ok('local-test-token') },
    gateway: { send: async (_tenantId, input) => {
      deliveries += 1;
      assert.equal(input.payload.event_id, 'accept');
      assert.equal(input.payload.event_name, 'Purchase');
      assert.equal(input.payload.user_data.fbp, 'fb.1.123456.987');
      return { ok: true, fbtraceId: 'local-test-trace' };
    } },
  });
  assert.equal(dispatched.processed, 1);
  assert.equal(deliveries, 1);
  assert.equal((await database.db.select().from(metaCapiEvents).where(eq(metaCapiEvents.orderId, 'accept')))[0]?.status, 'sent');
  assert.equal((await database.db.select().from(metaCapiOutbox).where(eq(metaCapiOutbox.orderId, 'accept'))).length, 0);
  console.log('meta-capi-e2e: acceptance creates one job and dispatcher records sent evidence with a fake gateway');

  await visit('dismiss');
  await page.getByRole('dialog').waitFor();
  await page.keyboard.press('Escape');
  await page.getByRole('dialog').waitFor({ state: 'hidden' });
  await page.reload({ waitUntil: 'networkidle' });
  assert.equal(await page.getByRole('dialog').count(), 0);
  assert.equal((await database.db.select().from(orders).where(eq(orders.id, 'dismiss')))[0]?.metaCapiConsent, 'undecided');

  await database.db.update(tenants).set({ analyticsMetaCapiEnabled: false }).where(eq(tenants.id, 'acme'));
  await visit('disabled');
  await page.getByRole('heading', { name: en.checkout.successTitle, exact: true }).waitFor();
  assert.equal(await page.getByRole('dialog').count(), 0);
  assert.equal((await database.db.select().from(metaCapiOutbox)).length, 0);
  await visit('accept');
  await choose(en.metaCapi.withdraw);
  assert.ok((await database.db.select().from(orders).where(eq(orders.id, 'accept')))[0]?.metaCapiConsentWithdrawnAt);
  assert.equal((await database.db.select().from(metaCapiEvents).where(eq(metaCapiEvents.orderId, 'accept')))[0]?.status, 'sent');
  console.log('meta-capi-e2e: disabled tenant never prompts; guests can still withdraw on the success link');
  await context.close();
  console.log('meta-capi-e2e: PASS');
} finally {
  await browser?.close();
  if (server) await killServer(server);
  await database.close();
}
