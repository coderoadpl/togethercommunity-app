import assert from 'node:assert/strict';
import { createHash, randomBytes } from 'node:crypto';
import type { ChildProcess } from 'node:child_process';
import { join } from 'node:path';
import { eq } from 'drizzle-orm';
import { chromium, type Browser } from 'playwright-core';
import { createSecretCrypto } from '#adapters/crypto/secret-crypto.js';
import { createTestDatabase } from '#adapters/db/test-database-name.js';
import { createMetaCapiRepository } from '#adapters/db/meta-capi.js';
import { createTenantDirectory, createTenantRepository, createTenantSecretRepository } from '#adapters/db/repositories.js';
import { members, metaCapiConsentEvidence, metaCapiEvents, metaCapiOutbox, orders, products, tenants, user } from '#adapters/db/schema.js';
import { createApiClient } from '#core/client/index.js';
import { metaCapiDefaultCopy as englishCopy } from '#core/domain/meta-capi-copy.en.js';
import { metaCapiDefaultCopy as polishCopy } from '#core/domain/meta-capi-copy.pl.js';
import { ok } from '#core/domain/index.js';
import { dispatchMetaCapi } from '#core/server/usecases/meta-capi.js';
import { en } from '../apps/web/src/i18n/en.js';
import { bootServer, ephemeralPort, killServer, rootDir, run } from './server-harness.js';

const database = await createTestDatabase('together_meta_capi_e2e', process.env['DATABASE_URL'] ?? process.env['E2E_DATABASE_URL'] ?? 'postgres://together:together@localhost:48912/together');
let server: ChildProcess | undefined;
let browser: Browser | undefined;
try {
  const now = new Date().toISOString();
  await database.db.insert(tenants).values({ id: 'acme', slug: 'acme', name: 'Acme', createdAt: now,
    analyticsMetaPixelId: '123456789', analyticsMetaCapiEnabled: true, privacyUrl: 'https://example.org/privacy',
    analyticsConsentCookieName: 'marketing-consent' });
  const secretsMasterKey = randomBytes(32).toString('base64');
  await createTenantSecretRepository(database.db).upsert('acme', { id: 'meta-capi-token', tenantId: 'acme', key: 'analyticsMetaCapiAccessToken',
    ...createSecretCrypto(secretsMasterKey).encrypt('local-test-token'), maskedPreview: 'configured', updatedAt: now });
  await database.db.insert(user).values({ id: 'buyer', email: 'buyer@example.org', name: 'Buyer' });
  await database.db.insert(members).values({ id: 'buyer', tenantId: 'acme', userId: 'buyer', email: 'buyer@example.org', createdAt: now });
  await database.db.insert(products).values({ id: 'book', tenantId: 'acme', slug: 'book', type: 'digital_download', title: 'Book', description: '', priceCents: 9900, currency: 'PLN', published: true, createdAt: now });
  for (const id of ['decline', 'accept', 'disabled', 'dismiss', 'polish']) {
    await database.db.insert(orders).values({ id, tenantId: 'acme', memberId: 'buyer', productId: 'book', kind: 'one_time', status: 'paid', mode: 'live',
      amountCents: 9900, currency: 'PLN', provider: 'stripe', providerObjectIds: { checkoutSession: `cs_live_${id}` }, paidAt: now, createdAt: now });
  }
  const build = await run(join(rootDir, 'node_modules/.bin/vite'), ['build', '--config', 'apps/web/vite.config.ts'], {});
  assert.equal(build.code, 0, `Web build failed: ${build.stderr}`);
  const port = await ephemeralPort();
  const origin = `http://acme.localhost:${port}`;
  server = await bootServer({ port, healthUrl: `http://127.0.0.1:${port}/api/health`, env: {
    NODE_ENV: 'test', DATABASE_URL: database.url, APP_BASE_URL: origin, APP_BASE_DOMAIN: 'localhost', WEB_DIST_DIR: 'dist/web', PAYMENT_PROVIDER: 'fake',
    SECRETS_MASTER_KEY: secretsMasterKey,
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
  await page.getByRole('dialog', { name: englishCopy.heading }).waitFor();
  await choose(englishCopy.declineLabel);
  assert.equal((await database.db.select().from(metaCapiOutbox).where(eq(metaCapiOutbox.orderId, 'decline'))).length, 0);
  assert.equal((await database.db.select().from(orders).where(eq(orders.id, 'decline')))[0]?.metaCapiConsent, 'denied');
  await page.reload({ waitUntil: 'networkidle' });
  assert.equal(await page.getByRole('dialog').count(), 0);
  console.log('meta-capi-e2e: decline reveals purchase and creates no outbox row');

  await visit('accept', 'offer');
  await choose(englishCopy.acceptLabel);
  const pending = await database.db.select().from(metaCapiOutbox).where(eq(metaCapiOutbox.orderId, 'accept'));
  assert.equal(pending.length, 1);
  assert.equal(pending[0]?.fbp, 'fb.1.123456.987');
  const evidence = await database.db.select().from(metaCapiConsentEvidence).where(eq(metaCapiConsentEvidence.orderId, 'accept'));
  assert.equal(evidence[0]?.source, 'return-page');
  const englishSnapshot = JSON.stringify({ ...englishCopy, privacyUrl: 'https://example.org/privacy' });
  assert.equal(evidence[0]?.textSnapshot, englishSnapshot);
  assert.equal(evidence[0]?.textVersion, createHash('sha256').update(englishSnapshot).digest('hex'));
  let deliveries = 0;
  const dispatched = await dispatchMetaCapi({
    repository: createMetaCapiRepository(database.db, (connection) => ({ tenants: createTenantRepository(connection),
      secrets: { resolve: async () => ok('local-test-token') }, resolveOrigin: async () => origin })),
    tenants: createTenantRepository(database.db), directory: createTenantDirectory(database.db),
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

  const api = createApiClient({ baseUrl: 'http://127.0.0.1:' + String(port), headers: () => ({ 'X-Tenant': 'acme' }) });
  const status = await api.publicCheckoutSessionStatus('cs_live_dismiss', undefined, 'en');
  assert.ok(status.ok && status.value.metaCapi);
  if (!status.ok || !status.value.metaCapi) throw new Error('Missing consent config');
  const qr = (await database.db.select().from(orders).where(eq(orders.id, 'dismiss')))[0]?.verificationToken;
  assert.ok(qr);
  for (const decision of ['granted', 'denied'] as const) {
    const result = await api.publicMetaCapiConsent({ orderToken: qr, decision, textVersion: status.value.metaCapi.textVersion });
    assert.ok(!result.ok && result.error.code === 'validation');
  }
  const switched = await api.publicCheckoutSessionStatus('cs_live_polish', undefined, 'pl');
  assert.ok(switched.ok && switched.value.metaCapi?.heading === polishCopy.heading);
  const stale = await api.publicMetaCapiConsent({ sessionId: 'cs_live_polish', decision: 'granted', locale: 'pl', textVersion: status.value.metaCapi.textVersion });
  assert.ok(!stale.ok && stale.error.code === 'validation');
  const polishContext = await browser.newContext();
  await polishContext.route('**/*', (route) => new URL(route.request().url()).origin === origin ? route.continue() : route.abort());
  await polishContext.addInitScript(() => { window.localStorage.setItem('together-language', 'pl'); });
  const polishPage = await polishContext.newPage();
  await polishPage.goto(origin + '/checkout/book?status=success&session_id=cs_live_polish', { waitUntil: 'networkidle' });
  await polishPage.getByRole('dialog', { name: polishCopy.heading }).waitFor();
  const polishResponse = polishPage.waitForResponse((entry) => entry.url().endsWith('/api/public/meta-capi/consent') && entry.request().method() === 'POST');
  await polishPage.getByRole('button', { name: polishCopy.declineLabel, exact: true }).click();
  assert.equal((await polishResponse).status(), 200);
  const polishEvidence = (await database.db.select().from(metaCapiConsentEvidence).where(eq(metaCapiConsentEvidence.orderId, 'polish')))[0];
  const polishSnapshot = JSON.stringify({ ...polishCopy, privacyUrl: 'https://example.org/privacy' });
  assert.equal(polishEvidence?.textSnapshot, polishSnapshot);
  assert.equal(polishEvidence?.textVersion, createHash('sha256').update(polishSnapshot).digest('hex'));
  await polishContext.close();
  console.log('meta-capi-e2e: locale defaults match stored evidence; QR grants and stale locale versions are rejected');

  await database.db.update(tenants).set({ analyticsMetaCapiEnabled: false }).where(eq(tenants.id, 'acme'));
  await visit('disabled');
  await page.getByRole('heading', { name: en.checkout.successTitle, exact: true }).waitFor();
  assert.equal(await page.getByRole('dialog').count(), 0);
  assert.equal((await database.db.select().from(metaCapiOutbox)).length, 0);
  await visit('accept');
  await page.getByRole('heading', { name: en.checkout.successTitle, exact: true }).waitFor();
  assert.equal(await page.getByRole('button', { name: en.metaCapi.withdraw, exact: true }).count(), 0);
  await database.db.update(tenants).set({ analyticsMetaCapiEnabled: true }).where(eq(tenants.id, 'acme'));
  await visit('accept');
  await choose(en.metaCapi.withdraw);
  assert.ok((await database.db.select().from(orders).where(eq(orders.id, 'accept')))[0]?.metaCapiConsentWithdrawnAt);
  assert.equal((await database.db.select().from(metaCapiEvents).where(eq(metaCapiEvents.orderId, 'accept')))[0]?.status, 'sent');
  console.log('meta-capi-e2e: disabled tenant never prompts or exposes CAPI state; guests withdraw on the success link');
  await context.close();
  console.log('meta-capi-e2e: PASS');
} finally {
  await browser?.close();
  if (server) await killServer(server);
  await database.close();
}
