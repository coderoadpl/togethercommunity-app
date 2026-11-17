import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { z } from 'zod';

import { BETTER_AUTH_PASSWORD_SIGN_IN_PATH, BETTER_AUTH_SIGN_UP_PATH } from '#adapters/auth/create-auth.js';
import { createTestDatabase } from '#adapters/db/test-database-name.js';
import { shopManagementKeyEvents, tenantAdmins, tenants } from '#adapters/db/schema.js';
import {
  API_ROUTES,
  apiKeysShopManagementCreateOutputSchema,
  SHOP_SETTINGS_ROUTES,
  shopSettingsContracts,
} from '#core/contract/index.js';
import { err, notFound, ok, SHOP_MANAGEMENT_KEY_SETTINGS_FIELDS, shopSettingsPatchSchema, shopSettingsSchema } from '#core/domain/index.js';

import { buildApp } from './app.js';
import { createDeps } from './composition.js';
import { envSchema } from './env.js';

const baseUrl = 'http://localhost:48730';
const acmeHost = 'acme.localhost:48730';
const studioHost = 'studio.localhost:48730';
const email = 'shop-settings-owner@example.test';
const password = 'shop-settings-password-15';
const now = '2026-11-15T10:00:00.000Z';
const expiresAt = '2026-11-22T00:00:00.000Z';
const READ = 'shop:settings:read';
const WRITE = 'shop:settings:write';
const storageSecret = JSON.stringify({
  provider: 'minio', endpoint: 'https://storage.example.test', region: 'us-east-1',
  bucket: 'private-assets', accessKeyId: 'key', secretAccessKey: 'secret',
});
const png = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAABAAAAAQCAIAAACQkWg2AAAACXBIWXMAAAPoAAAD6AG1e1JrAAAAGUlEQVQokWMwTptJEmIY1ZA2GkrGwzVpAABIfDIQjwcm5wAAAABJRU5ErkJggg==', 'base64');

let database: Awaited<ReturnType<typeof createTestDatabase>>;
let app: ReturnType<typeof buildApp>;
let ownerToken: string;
const objects = new Map<string, Uint8Array>();

const envelope = <S extends z.ZodTypeAny>(schema: S) => z.object({ ok: z.literal(true), data: schema });
const errorOf = async (response: Response) =>
  z.object({ ok: z.literal(false), error: z.object({ code: z.string(), message: z.string() }) }).parse(await response.json()).error;
const sessionSettingsSchema = envelope(z.object({ settings: z.record(z.unknown()) }));

const ownerRequest = (method: string, path: string, body: unknown, host = acmeHost) => app.request(`${baseUrl}${path}`, {
  method,
  headers: { host, authorization: `Bearer ${ownerToken}`, ...(body === undefined ? {} : { 'content-type': 'application/json' }) },
  ...(body === undefined ? {} : { body: JSON.stringify(body) }),
});

const createShopKeyRecord = async (scopes: string[], host = acmeHost) => {
  const response = await ownerRequest(API_ROUTES.apiKeysShopManagementCreate.method, API_ROUTES.apiKeysShopManagementCreate.path, {
    name: `Shop ${scopes.join(' ')}`, scopes, expiresAt,
  }, host);
  expect(response.status).toBe(200);
  return envelope(apiKeysShopManagementCreateOutputSchema).parse(await response.json()).data;
};

const createShopKey = async (scopes: string[], host = acmeHost) => (await createShopKeyRecord(scopes, host)).secret;

const keyed = (secret: string, method: string, path: string, body?: unknown, host = acmeHost) => app.request(`${baseUrl}${path}`, {
  method,
  headers: { host, 'x-api-key': secret, ...(body === undefined ? {} : { 'content-type': 'application/json' }) },
  ...(body === undefined ? {} : { body: JSON.stringify(body) }),
});

const readSettings = async (secret: string, host = acmeHost) => {
  const response = await keyed(secret, 'GET', SHOP_SETTINGS_ROUTES.getSettings.path, undefined, host);
  expect(response.status).toBe(200);
  return envelope(shopSettingsContracts.getSettings.output).parse(await response.json()).data.settings;
};

const sessionSettings = async (host = acmeHost) => {
  const response = await ownerRequest(API_ROUTES.tenantSettings.method, API_ROUTES.tenantSettings.path, undefined, host);
  expect(response.status).toBe(200);
  return sessionSettingsSchema.parse(await response.json()).data.settings;
};

const unsignedUrl = (url: string): string => {
  const parsed = new URL(url);
  parsed.search = '';
  return parsed.toString();
};

const courier = { id: 'courier', label: 'Courier', amountCents: 1500, vatRatePercent: 23, carrier: 'other', pickupPoint: 'none', active: true };
const locker = { id: 'locker', label: 'Parcel locker', amountCents: 1299, vatRatePercent: 23, carrier: 'inpost', pickupPoint: 'inpost_locker', active: true };

beforeAll(async () => {
  database = await createTestDatabase(
    'together_shop_settings_routes_test',
    process.env['DATABASE_URL'] ?? 'postgres://together:together@localhost:48912/postgres',
  );
  const deps = createDeps(envSchema.parse({
    NODE_ENV: 'test', DATABASE_URL: database.url, REALTIME_TRANSPORT: 'in-process',
    APP_BASE_URL: baseUrl, APP_BASE_DOMAIN: 'localhost',
    BETTER_AUTH_SECRET: 'shop-settings-routes-test-secret-at-least-32-characters',
  }), { db: database.db, clock: { nowIso: () => now } });
  app = buildApp({
    ...deps,
    secretResolver: {
      resolve: async (tenantId, key) => key === 's3.configuration' ? ok(storageSecret) : deps.secretResolver.resolve(tenantId, key),
    },
    storage: {
      ...deps.storage,
      head: async ({ url }) => ok({ sizeBytes: objects.get(url)?.byteLength ?? 0 }),
      getObject: async ({ url }) => {
        const bytes = objects.get(url);
        return bytes === undefined ? err(notFound('missing')) : ok(new Uint8Array(bytes));
      },
      putObject: async ({ url, body }) => {
        objects.set(url, new Uint8Array(body));
        return ok(undefined);
      },
      delete: async ({ url }) => {
        objects.delete(url);
        return ok({ deleted: true as const });
      },
    },
  });

  const signup = await app.request(`${baseUrl}${BETTER_AUTH_SIGN_UP_PATH}`, {
    method: 'POST', headers: { 'content-type': 'application/json', origin: baseUrl },
    body: JSON.stringify({ name: 'Shop Settings Owner', email, password }),
  });
  expect(signup.status).toBe(200);
  const ownerId = z.object({ user: z.object({ id: z.string() }) }).parse(await signup.json()).user.id;
  await database.db.execute(`update "user" set email_verified = true where id = '${ownerId}'`);
  for (const tenantId of ['acme', 'studio']) {
    await database.db.insert(tenants).values({ id: tenantId, slug: tenantId, name: 'Workspace', createdAt: now });
    await database.db.insert(tenantAdmins).values({ id: `grant-${tenantId}`, tenantId, userId: ownerId, role: 'owner' });
  }
  const signin = await app.request(`${baseUrl}${BETTER_AUTH_PASSWORD_SIGN_IN_PATH}`, {
    method: 'POST', headers: { 'content-type': 'application/json', origin: baseUrl },
    body: JSON.stringify({ email, password }),
  });
  expect(signin.status).toBe(200);
  ownerToken = z.object({ token: z.string() }).parse(await signin.json()).token;
}, 120_000);

afterAll(async () => { await database?.close(); });

describe('shop settings routes with a shop management key', () => {
  it('sets seller, legal, VAT, shipping and brand fields and reads back only the allow-listed fields', async () => {
    const secret = await createShopKey([READ, WRITE]);
    const patch = {
      name: 'Example Press',
      defaultLanguage: 'en',
      logoUrl: 'https://cdn.example.test/logo.png',
      logoDarkUrl: '/api/public/assets/logo-dark/00000000-0000-4000-8000-000000000002.png',
      faviconUrl: 'https://cdn.example.test/favicon.ico',
      accentColor: '#112233',
      accentLight: '#445566',
      ogImageUrl: 'https://cdn.example.test/share.png',
      socialLinks: [{ label: 'Blog', url: 'https://blog.example.test' }],
      checkoutAppearance: { displayName: 'Example Press', buttonColor: '#112233', borderStyle: 'rounded' },
      supportEmail: 'help@example.test',
      supportUrl: 'https://brand.example.test/help',
      termsUrl: 'https://brand.example.test/terms',
      privacyUrl: 'https://brand.example.test/privacy',
      invoiceSellerName: 'Example Press Ltd',
      invoiceSellerAddress: 'Garden Street 5, 00-950 Warsaw',
      invoiceVatMode: 'rate',
      invoiceVatRatePercent: 5,
      invoicingProvider: 'ifirma',
      autoIssueInvoices: true,
      autoIssueInvoiceScope: 'all',
      ksefSubmissionMode: 'manual',
      shippingRates: [courier, locker],
      inpostGeowidgetToken: 'public-geowidget-token',
    };
    const written = await keyed(secret, 'POST', SHOP_SETTINGS_ROUTES.updateSettings.path, patch);
    expect(written.status).toBe(200);
    const returned = envelope(shopSettingsContracts.updateSettings.output).parse(await written.json()).data.settings;
    expect(returned).toMatchObject(patch);

    const read = await keyed(secret, 'GET', SHOP_SETTINGS_ROUTES.getSettings.path);
    const body = z.object({ data: z.object({ settings: z.record(z.unknown()) }) }).parse(await read.json());
    expect(Object.keys(body.data.settings).toSorted()).toEqual(Object.keys(shopSettingsSchema.shape).toSorted());
    expect(body.data.settings).toMatchObject(patch);
    expect(body.data.settings).not.toHaveProperty('analyticsTagId');
    expect(body.data.settings).not.toHaveProperty('defaultHomeSpaceId');
    expect(await sessionSettings()).toMatchObject(patch);
  });

  it('keeps omitted fields, clears a field with null and changes nothing for an empty body', async () => {
    const secret = await createShopKey([READ, WRITE]);
    const before = await readSettings(secret);
    expect(before.supportUrl).not.toBeNull();

    const cleared = await keyed(secret, 'POST', SHOP_SETTINGS_ROUTES.updateSettings.path, { supportUrl: null, termsUrl: '' });
    expect(cleared.status).toBe(200);
    expect(await readSettings(secret)).toEqual({ ...before, supportUrl: null, termsUrl: null });

    const empty = await keyed(secret, 'POST', SHOP_SETTINGS_ROUTES.updateSettings.path, {});
    expect(empty.status).toBe(200);
    expect(await readSettings(secret)).toEqual({ ...before, supportUrl: null, termsUrl: null });

    const restored = await keyed(secret, 'POST', SHOP_SETTINGS_ROUTES.updateSettings.path, { supportUrl: before.supportUrl, termsUrl: before.termsUrl });
    expect(restored.status).toBe(200);
    expect(await readSettings(secret)).toEqual(before);
  });

  it('sets, reads back and clears the Open Graph title and description', async () => {
    const secret = await createShopKey([READ, WRITE]);
    const og = { ogTitle: 'Printed handbooks', ogDescription: 'Handbooks printed and shipped from Warsaw.' };
    const written = await keyed(secret, 'POST', SHOP_SETTINGS_ROUTES.updateSettings.path, og);
    expect(written.status).toBe(200);
    expect(envelope(shopSettingsContracts.updateSettings.output).parse(await written.json()).data.settings).toMatchObject(og);
    expect(await readSettings(secret)).toMatchObject(og);
    expect(await sessionSettings()).toMatchObject(og);

    const tooLong = await keyed(secret, 'POST', SHOP_SETTINGS_ROUTES.updateSettings.path, { ogTitle: 'x'.repeat(71) });
    expect(tooLong.status).toBe(400);

    const cleared = await keyed(secret, 'POST', SHOP_SETTINGS_ROUTES.updateSettings.path, { ogTitle: null, ogDescription: '' });
    expect(cleared.status).toBe(200);
    expect(await readSettings(secret)).toMatchObject({ ogTitle: null, ogDescription: null });
  });

  it('rejects an unknown field inside a nested settings object and keeps the stored configuration', async () => {
    const secret = await createShopKey([READ, WRITE]);
    const configured = await keyed(secret, 'POST', SHOP_SETTINGS_ROUTES.updateSettings.path, {
      checkoutAppearance: { backgroundColor: '#112233' },
      socialLinks: [{ label: 'Blog', url: 'https://brand.example.test/blog' }],
      shippingRates: [courier],
    });
    expect(configured.status).toBe(200);
    const before = await readSettings(secret);
    expect(before.checkoutAppearance).toMatchObject({ backgroundColor: '#112233' });

    for (const body of [
      { checkoutAppearance: { backgoundColor: '#445566' } },
      { socialLinks: [{ label: 'Blog', url: 'https://brand.example.test/blog', target: '_blank' }] },
      { shippingRates: [{ ...courier, amountCent: 1600 }] },
    ]) {
      const response = await keyed(secret, 'POST', SHOP_SETTINGS_ROUTES.updateSettings.path, body);
      expect(response.status, JSON.stringify(body)).toBe(400);
      expect((await errorOf(response)).code).toBe('validation');
    }
    expect(await readSettings(secret)).toEqual(before);

    const branding = await keyed(secret, 'POST', SHOP_SETTINGS_ROUTES.brandingAssetUpload.path, {
      kind: 'logo', fileName: 'logo.png', contentType: 'image/png', sizeBytes: png.byteLength, width: 512,
    });
    expect(branding.status).toBe(400);
    expect((await errorOf(branding)).code).toBe('validation');
  });

  it('updates an allow-listed field through the settings grant and answers 400 for an unknown top-level field', async () => {
    expect(Object.keys(shopSettingsPatchSchema.shape).toSorted())
      .toEqual(Object.keys(SHOP_MANAGEMENT_KEY_SETTINGS_FIELDS).toSorted());
    const secret = await createShopKey([READ, WRITE]);

    const allowed = await keyed(secret, 'POST', SHOP_SETTINGS_ROUTES.updateSettings.path, { supportEmail: 'orders@example.test' });
    expect(allowed.status).toBe(200);
    const before = await readSettings(secret);
    expect(before.supportEmail).toBe('orders@example.test');

    const unknown = await keyed(secret, 'POST', SHOP_SETTINGS_ROUTES.updateSettings.path, {
      supportEmail: 'other@example.test', analyticsTagId: 'G-ABCDEF1234',
    });
    expect(unknown.status).toBe(400);
    expect((await errorOf(unknown)).code).toBe('validation');
    expect(await readSettings(secret)).toEqual(before);
    expect(await sessionSettings()).not.toMatchObject({ analyticsTagId: 'G-ABCDEF1234' });
  });

  it('answers 400 to checkout return origins from a key with the settings write scope and writes nothing', async () => {
    expect(Object.keys(shopSettingsPatchSchema.shape)).not.toContain('checkoutReturnOrigins');
    const secret = await createShopKey([READ, WRITE]);
    const before = await readSettings(secret);
    const sessionBefore = await sessionSettings();

    for (const body of [
      { checkoutReturnOrigins: ['https://shop.example.test'] },
      { supportEmail: 'returns@example.test', checkoutReturnOrigins: ['https://shop.example.test'] },
    ]) {
      const response = await keyed(secret, 'POST', SHOP_SETTINGS_ROUTES.updateSettings.path, body);
      expect(response.status, JSON.stringify(body)).toBe(400);
      expect((await errorOf(response)).code).toBe('validation');
    }
    expect(await readSettings(secret)).toEqual(before);
    expect(await sessionSettings()).toEqual(sessionBefore);
  });

  it('keeps VAT coherent through the reused settings update', async () => {
    const secret = await createShopKey([READ, WRITE]);
    const missing = await keyed(secret, 'POST', SHOP_SETTINGS_ROUTES.updateSettings.path, { invoiceVatMode: 'exempt' });
    expect(missing.status).toBe(422);
    expect((await errorOf(missing)).code).toBe('invoice_exemption_basis_missing');
    expect(await readSettings(secret)).toMatchObject({ invoiceVatMode: 'rate', invoiceVatRatePercent: 5 });

    const exempt = await keyed(secret, 'POST', SHOP_SETTINGS_ROUTES.updateSettings.path, {
      invoiceVatMode: 'exempt', invoiceExemptionBasisKind: 'art_113_1', invoiceExemptionBasis: 'Art. 113 ust. 1',
    });
    expect(exempt.status).toBe(200);
    expect(await readSettings(secret)).toMatchObject({ invoiceVatMode: 'exempt', invoiceVatRatePercent: null, invoiceExemptionBasisKind: 'art_113_1' });

    const rate = await keyed(secret, 'POST', SHOP_SETTINGS_ROUTES.updateSettings.path, { invoiceVatMode: 'rate', invoiceVatRatePercent: 5 });
    expect(rate.status).toBe(200);
    expect(await readSettings(secret)).toMatchObject({ invoiceVatMode: 'rate', invoiceVatRatePercent: 5, invoiceExemptionBasisKind: null, invoiceExemptionBasis: null });
  });

  it.each([
    ['a team field', { team: [{ email: 'intruder@example.test', role: 'owner' }] }],
    ['an analytics policy field', { analyticsTagId: 'G-ABCDEF1234' }],
    ['the analytics consent bypass', { analyticsLoadWithoutConsent: true }],
    ['a public home field', { defaultHomeSpaceId: 'space-1' }],
    ['a video setting', { videoAutoplayDefault: true }],
    ['the sign-in notice', { signInNotice: { enabled: true, text: 'Hello' } }],
    ['an unknown key', { termsUrlTypo: 'https://brand.example.test/terms' }],
    ['an unknown key next to an allowed field', { privacyUrl: 'https://brand.example.test/new-privacy', billingPortalUrl: 'https://billing.example.test' }],
    ['null on a field that cannot be cleared', { name: null }],
  ])('rejects %s with validation and persists nothing', async (_label, body) => {
    const secret = await createShopKey([READ, WRITE]);
    const shopBefore = await readSettings(secret);
    const sessionBefore = await sessionSettings();
    const response = await keyed(secret, 'POST', SHOP_SETTINGS_ROUTES.updateSettings.path, body);
    expect(response.status).toBe(400);
    expect((await errorOf(response)).code).toBe('validation');
    expect(await readSettings(secret)).toEqual(shopBefore);
    expect(await sessionSettings()).toEqual(sessionBefore);
  });

  it('serves the settings read under the issuer staff identity to a read-only key and refuses its writes', async () => {
    const secret = await createShopKey([READ]);
    expect((await readSettings(secret)).name).toBe('Example Press');
    for (const [path, body] of [
      [SHOP_SETTINGS_ROUTES.updateSettings.path, { name: 'Renamed by a read key' }],
      [SHOP_SETTINGS_ROUTES.brandingAssetUpload.path, { kind: 'logo', fileName: 'logo.png', contentType: 'image/png', sizeBytes: png.byteLength }],
      [SHOP_SETTINGS_ROUTES.brandingAssetComplete.path, { key: 'image-asset-candidates/acme/logo/00000000-0000-4000-8000-000000000003.png' }],
    ] as const) {
      const response = await keyed(secret, 'POST', path, body);
      expect(response.status, path).toBe(403);
      expect(await errorOf(response), path).toEqual({ code: 'forbidden', message: `${WRITE} is not permitted` });
    }
    expect((await readSettings(secret)).name).toBe('Example Press');
  });

  it('refuses catalog and order keys on every settings route', async () => {
    const catalog = await createShopKey(['shop:catalog:read', 'shop:catalog:write']);
    const orders = await createShopKey(['shop:orders:read', 'shop:fulfilment:write']);
    for (const secret of [catalog, orders]) {
      const read = await keyed(secret, 'GET', SHOP_SETTINGS_ROUTES.getSettings.path);
      expect(read.status).toBe(403);
      expect(await errorOf(read)).toEqual({ code: 'forbidden', message: `${READ} is not permitted` });
      for (const path of [SHOP_SETTINGS_ROUTES.updateSettings.path, SHOP_SETTINGS_ROUTES.brandingAssetUpload.path, SHOP_SETTINGS_ROUTES.brandingAssetComplete.path]) {
        const response = await keyed(secret, 'POST', path, { name: 'Renamed by another key' });
        expect(response.status, path).toBe(403);
        expect(await errorOf(response), path).toEqual({ code: 'forbidden', message: `${WRITE} is not permitted` });
      }
    }
    expect((await sessionSettings()).name).toBe('Example Press');
  });

  it('keeps the session settings and branding routes closed to a settings key', async () => {
    const secret = await createShopKey([READ, WRITE]);
    for (const [method, path, body] of [
      [API_ROUTES.tenantSettings.method, API_ROUTES.tenantSettings.path, undefined],
      [API_ROUTES.tenantSettingsUpdate.method, API_ROUTES.tenantSettingsUpdate.path, { name: 'Renamed on the session route' }],
      [API_ROUTES.tenantSettingsUpdate.method, API_ROUTES.tenantSettingsUpdate.path, { analyticsTagId: 'G-ABCDEF1234' }],
      [API_ROUTES.brandingAssetUpload.method, API_ROUTES.brandingAssetUpload.path, { kind: 'logo', fileName: 'logo.png', contentType: 'image/png', sizeBytes: png.byteLength }],
    ] as const) {
      const response = await keyed(secret, method, path, body);
      expect(response.status, path).toBe(401);
    }
    expect(await sessionSettings()).toMatchObject({ name: 'Example Press' });
    expect(await sessionSettings()).not.toHaveProperty('analyticsTagId', 'G-ABCDEF1234');
  });

  it('uploads and publishes a workspace logo and denies another workspace candidate on complete', async () => {
    const secret = await createShopKey([READ, WRITE]);
    const upload = await keyed(secret, 'POST', SHOP_SETTINGS_ROUTES.brandingAssetUpload.path, {
      kind: 'logo', fileName: 'logo.png', contentType: 'image/png', sizeBytes: png.byteLength,
    });
    expect(upload.status).toBe(200);
    const started = envelope(shopSettingsContracts.brandingAssetUpload.output).parse(await upload.json()).data;
    expect(started.key).toMatch(/^image-asset-candidates\/acme\/logo\/[0-9a-f-]{36}\.png$/u);
    expect(started.upload.headers).toEqual({ 'content-type': 'image/png' });
    objects.set(unsignedUrl(started.upload.url), new Uint8Array(png));

    const studio = await createShopKey([READ, WRITE], studioHost);
    const studioUpload = await keyed(studio, 'POST', SHOP_SETTINGS_ROUTES.brandingAssetUpload.path, {
      kind: 'logo', fileName: 'logo.png', contentType: 'image/png', sizeBytes: png.byteLength,
    }, studioHost);
    const studioStarted = envelope(shopSettingsContracts.brandingAssetUpload.output).parse(await studioUpload.json()).data;
    const studioCandidate = unsignedUrl(studioStarted.upload.url);
    objects.set(studioCandidate, new Uint8Array(png));

    const foreign = await keyed(secret, 'POST', SHOP_SETTINGS_ROUTES.brandingAssetComplete.path, { key: studioStarted.key });
    expect(foreign.status).toBe(404);
    expect((await errorOf(foreign)).code).toBe('not_found');
    expect(objects.has(studioCandidate)).toBe(true);

    const productCover = await keyed(secret, 'POST', SHOP_SETTINGS_ROUTES.brandingAssetUpload.path, {
      kind: 'product-cover', fileName: 'cover.png', contentType: 'image/png', sizeBytes: png.byteLength,
    });
    expect(productCover.status).toBe(400);
    expect((await errorOf(productCover)).code).toBe('validation');

    const complete = await keyed(secret, 'POST', SHOP_SETTINGS_ROUTES.brandingAssetComplete.path, { key: started.key });
    expect(complete.status).toBe(200);
    const published = envelope(shopSettingsContracts.brandingAssetComplete.output).parse(await complete.json()).data.url;
    expect(published).toBe(started.servePath);
    expect(objects.has(unsignedUrl(started.upload.url))).toBe(false);

    const applied = await keyed(secret, 'POST', SHOP_SETTINGS_ROUTES.updateSettings.path, { logoUrl: published });
    expect(applied.status).toBe(200);
    expect((await readSettings(secret)).logoUrl).toBe(published);
  });
});

describe('shop management key history of keyed settings writes', () => {
  it('writes one row per settings and branding write that reaches its handler, with the route template and no resource', async () => {
    const { apiKey, secret } = await createShopKeyRecord([READ, WRITE]);
    const updated = await keyed(secret, 'POST', SHOP_SETTINGS_ROUTES.updateSettings.path, { supportUrl: null });
    const upload = await keyed(secret, 'POST', SHOP_SETTINGS_ROUTES.brandingAssetUpload.path, {
      kind: 'logo', fileName: 'history.png', contentType: 'image/png', sizeBytes: png.byteLength,
    });
    const started = envelope(shopSettingsContracts.brandingAssetUpload.output).parse(await upload.json()).data;
    objects.set(unsignedUrl(started.upload.url), new Uint8Array(png));
    const completed = await keyed(secret, 'POST', SHOP_SETTINGS_ROUTES.brandingAssetComplete.path, { key: started.key });
    expect([updated.status, upload.status, completed.status]).toEqual([200, 200, 200]);

    const rows = (await database.db.select().from(shopManagementKeyEvents))
      .filter((event) => event.apiKeyId === apiKey.id && event.kind === 'request')
      .map(({ method, route, resourceId }) => ({ method, route, resourceId }))
      .toSorted((left, right) => (left.route ?? '').localeCompare(right.route ?? ''));
    expect(rows).toEqual([
      SHOP_SETTINGS_ROUTES.brandingAssetComplete.path,
      SHOP_SETTINGS_ROUTES.brandingAssetUpload.path,
      SHOP_SETTINGS_ROUTES.updateSettings.path,
    ].map((route) => ({ method: 'POST', route, resourceId: null })));
    expect(JSON.stringify(rows)).not.toContain(started.upload.url);
  });
});
