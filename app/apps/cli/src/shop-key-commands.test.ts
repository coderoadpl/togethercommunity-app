import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, beforeEach, describe, expect, it, vi, type MockInstance } from 'vitest';

import type * as ClientModule from '#core/client/index.js';
import type { ShopManagementClientOptions } from '#core/client/index.js';
import { EXIT_CODE_BY_ERROR_CODE } from '#core/contract/index.js';
import type { ShipxOrderView, ShipxShipment } from '#core/domain/index.js';

import type { CliConfig, ResolveCliConfigInput } from './config.js';
import { DEFAULT_SHOP_KEY_ENV } from './shop-key-commands.js';

const h = vi.hoisted(() => {
  const state: { fetchImpl: typeof fetch | null; clientOptions: unknown[] } = { fetchImpl: null, clientOptions: [] };
  return state;
});

vi.mock('./config.js', () => ({
  apiOrigin: (apiUrl: string): string => new URL(apiUrl).origin,
  loadConfig: (): CliConfig => ({
    version: 2,
    currentOrigin: 'https://platform.example.test',
    profiles: { 'https://platform.example.test': { token: 'stored-session-token', tenant: 'acme' } },
  }),
  resolveCliConfig: (input: ResolveCliConfigInput) => {
    const apiUrl = input.apiUrl ?? input.config.currentOrigin;
    const origin = new URL(apiUrl).origin;
    const profile = input.config.profiles[origin] ?? { token: null, tenant: null };
    return { apiUrl, origin, originSource: 'stored' as const, profile, tenant: input.tenant ?? profile.tenant };
  },
  saveConfig: (): void => undefined,
  updateOriginProfile: (config: CliConfig): CliConfig => config,
}));

vi.mock('#core/client/index.js', async (importOriginal) => {
  const actual = await importOriginal<typeof ClientModule>();
  return {
    ...actual,
    createShopManagementClient: (options: ShopManagementClientOptions) => {
      h.clientOptions.push(options);
      return actual.createShopManagementClient({ ...options, fetchImpl: async (input, init) => {
        if (h.fetchImpl === null) throw new Error('fetch stub missing');
        return h.fetchImpl(input, init);
      } });
    },
  };
});

const product = {
  id: 'product-1', tenantId: 'acme', type: 'physical', slug: 'printed-handbook', title: 'Printed handbook', description: '',
  coverUrl: null, priceCents: 4990, currency: 'PLN', published: false, visibility: 'listed', deliveryMethod: 'pickup',
  accessItems: [], legacyId: null, createdAt: '2026-11-15T10:00:00.000Z',
};
const price = {
  id: 'price-1', tenantId: 'acme', productId: 'product-1', kind: 'one_time', interval: null, amountCents: 4990, currency: 'PLN',
  active: true, createdAt: '2026-11-15T10:00:00.000Z',
};
const stock = {
  productId: 'product-1', onHand: 4, reserved: 0, available: 4, lowStockThreshold: null, lowStockNotifiedAt: null,
  updatedAt: '2026-11-15T10:00:00.000Z', soldOut: false, low: false,
};

const order = {
  id: 'order-1', tenantId: 'acme', memberId: 'member-1', productId: 'product-1', priceId: null, kind: 'one_time', status: 'paid', mode: 'live',
  amountCents: 6398, currency: 'PLN', provider: 'simulated', providerObjectIds: {}, couponId: null, discountCents: 0, fulfilmentStatus: 'shipped',
  shipment: { carrier: 'other', trackingNumber: 'MANUAL0001', shippedAt: '2026-11-15T10:00:00.000Z', shippedBy: 'owner' },
  createdAt: '2026-11-15T10:00:00.000Z', memberEmail: 'buyer@example.org', memberName: 'Buyer', productTitle: 'Printed handbook', couponCode: null,
};
const shipment: ShipxShipment = {
  shipxShipmentId: '1', status: 'confirmed', environment: 'production', trackingNumber: 'T1', createAttemptedAt: null, boughtAt: null,
  labelFetchedAt: null, createdAt: '2026-11-15T10:00:00.000Z', updatedAt: '2026-11-15T10:00:00.000Z',
};

const shipxOrder: ShipxOrderView = { available: true, reason: null, environment: 'production', service: 'inpost_locker_standard', parcelTemplate: 'medium', shipment };

const shopSettings = {
  name: 'Example Press', logoUrl: null, logoDarkUrl: null, faviconUrl: null, accentColor: null, accentLight: null,
  ogTitle: 'Printed handbooks', ogDescription: null, ogImageUrl: null,
  socialLinks: [], supportEmail: null, supportUrl: null, termsUrl: 'https://brand.example.test/terms', privacyUrl: null,
};

const salesLinkFields = { slug: 'handbook', title: 'Handbook', heading: 'Buy the handbook', productIds: ['product-1'] };
const salesLink = { ...salesLinkFields, id: 'link-1', tenantId: 'acme', revision: 1, createdAt: product.createdAt, updatedAt: product.createdAt };

const orderData = (pathname: string, method: string): unknown => {
  if (pathname === '/api/m2m/shop/orders') return { sources: [], orders: [order], total: 1, page: 1, pageSize: 20 };
  if (pathname.endsWith('/export') || pathname.endsWith('/packing-list')) return { filename: 'orders.csv', mimeType: 'text/csv; charset=utf-8', content: 'order_number\norder-1' };
  if (pathname.endsWith('/discard')) return { discarded: true };
  if (method === 'POST' && pathname.endsWith('/shipx')) return { order, shipment };
  if (pathname.includes('/shipx')) return shipxOrder;
  if (pathname === '/api/m2m/shop/orders/order-1') return { order, invoice: null };
  return { order };
};

const maskedCredential = { maskedPreview: '••••2345', updatedAt: '2026-11-15T10:00:00.000Z' };
const shipxView = {
  sandbox: { configured: true, organizationId: maskedCredential, token: maskedCredential },
  production: { configured: false, organizationId: null, token: null },
  sender: { name: 'Warehouse', company: null, email: 'warehouse@example.test', phone: '600700800', street: 'Garden Street', buildingNumber: '5', city: 'Warsaw', postCode: '00-950' },
};

const integrationData = (pathname: string, method: string, body: unknown): unknown => {
  const parsed: unknown = typeof body === 'string' ? JSON.parse(body) : null;
  const sentKey: unknown = typeof parsed === 'object' && parsed !== null ? Reflect.get(parsed, 'key') : null;
  if (pathname === '/api/m2m/shop/integrations/secrets' && method === 'GET') {
    return { secrets: [{ key: 'ksef.token', ...maskedCredential }], stripeMode: 'live', stripeWebhookUrl: 'https://acme.example.test/api/webhooks/stripe/acme', stripeTestLastEventAt: null };
  }
  if (pathname === '/api/m2m/shop/integrations/secrets') return { secret: { key: typeof sentKey === 'string' ? sentKey : 'unknown', ...maskedCredential } };
  if (method === 'DELETE') return { key: decodeURIComponent(pathname.split('/').at(-1) ?? '') };
  if (pathname.endsWith('/stripe/configure')) return { mode: 'test', webhookUrl: 'https://acme.example.test/api/webhooks/stripe/acme?mode=test' };
  if (pathname.endsWith('/stripe/probe')) return { mode: 'test', checks: [{ resource: 'Webhook Endpoints', permission: 'write', status: 'ok' }], allOk: true, checkedAt: '2026-11-15T10:00:00.000Z' };
  if (pathname.endsWith('/storage/configure')) return { diagnostic: { code: 'storage.available', message: 'Storage is available.' }, secret: { key: 's3.configuration', maskedPreview: '••••', updatedAt: '2026-11-15T10:00:00.000Z' } };
  return shipxView;
};

interface Call { method: string; path: string; search: string; headers: Headers; body: unknown }

let calls: Call[];
let logSpy: MockInstance<typeof console.log>;
let errorSpy: MockInstance<typeof console.error>;

const fetchImpl: typeof fetch = async (input, init) => {
  const url = new URL(typeof input === 'string' ? input : input instanceof URL ? input.href : input.url);
  const method = init?.method ?? 'GET';
  calls.push({ method, path: url.pathname, search: url.search, headers: new Headers(init?.headers), body: typeof init?.body === 'string' ? JSON.parse(init.body) : init?.body ?? null });
  if (url.hostname === 'storage.example.test') return new Response(null, { status: 200 });
  if (url.pathname.startsWith('/api/m2m/shop/image-assets/branding/')) {
    return new Response(JSON.stringify({ ok: true, data: url.pathname.endsWith('/upload')
      ? { key: 'image-asset-candidates/acme/logo/1.png', servePath: '/api/public/assets/logo/1.png', upload: { url: 'https://storage.example.test/candidate?signature=1', headers: { 'content-type': 'image/png' }, expiresAt: '2026-11-15T10:15:00.000Z' } }
      : { url: '/api/public/assets/logo/1.png' } }), { headers: { 'content-type': 'application/json' } });
  }
  if (url.pathname.startsWith('/api/m2m/shop/image-assets/product-cover/')) {
    return Response.json({ ok: true, data: url.pathname.endsWith('/upload')
      ? { key: 'image-asset-candidates/acme/product-cover/1.png', servePath: '/api/public/assets/product-cover/1.png', upload: { url: 'https://storage.example.test/candidate?signature=1', headers: { 'content-type': 'image/png' }, expiresAt: '2026-11-15T10:15:00.000Z' } }
      : { url: '/api/public/assets/product-cover/1.png' } });
  }
  if (url.pathname.startsWith('/api/m2m/shop/image-assets/product-image/')) {
    return Response.json({ ok: true, data: url.pathname.endsWith('/upload')
      ? { key: 'image-asset-candidates/acme/product-image/2.png', servePath: '/api/public/assets/product-image/2.png', upload: { url: 'https://storage.example.test/candidate?signature=2', headers: { 'content-type': 'image/png' }, expiresAt: '2026-11-15T10:15:00.000Z' } }
      : { url: '/api/public/assets/product-image/2.png' } });
  }
  if (url.pathname.startsWith('/api/m2m/shop/sales-links')) {
    return Response.json({ ok: true, data: method === 'DELETE' ? { deleted: true }
      : method === 'GET' && url.pathname === '/api/m2m/shop/sales-links' ? { salesLinks: [salesLink] }
        : { salesLink } });
  }
  if (url.pathname.startsWith('/api/m2m/shop/integrations/')) {
    return Response.json({ ok: true, data: integrationData(url.pathname, method, init?.body) });
  }
  if (url.pathname === '/api/m2m/shop/settings') {
    return new Response(JSON.stringify({ ok: true, data: { settings: shopSettings } }), { headers: { 'content-type': 'application/json' } });
  }
  if (url.pathname.endsWith('/label')) {
    return new Response(new TextEncoder().encode('%PDF-1.4 label'), { headers: { 'content-type': 'application/pdf', 'content-disposition': 'attachment; filename="inpost-T1.pdf"' } });
  }
  if (url.pathname.startsWith('/api/m2m/shop/orders')) {
    return new Response(JSON.stringify({ ok: true, data: orderData(url.pathname, method) }), { headers: { 'content-type': 'application/json' } });
  }
  const data = url.pathname.endsWith('/prices') && method === 'GET' ? { prices: [price] }
    : url.pathname.includes('/prices') ? { price }
      : url.pathname.includes('/stock') ? { stock }
        : url.pathname.endsWith('/delete') ? { deleted: true }
          : method === 'GET' ? { products: [product], stock: [stock] }
            : { product };
  return new Response(JSON.stringify({ ok: true, data }), { headers: { 'content-type': 'application/json' } });
};

const originalArgv = process.argv;

const runPlain = async (...args: string[]): Promise<void> => {
  process.argv = ['node', 'together', ...args];
  vi.resetModules();
  await import('./main.js');
};

const run = (...args: string[]) => runPlain('--json', ...args);

const soleJson = (): unknown => {
  expect(logSpy).toHaveBeenCalledTimes(1);
  return JSON.parse(String(logSpy.mock.calls[0]?.[0]));
};

beforeEach(() => {
  calls = [];
  h.clientOptions = [];
  h.fetchImpl = fetchImpl;
  logSpy = vi.spyOn(console, 'log').mockImplementation(() => undefined);
  errorSpy = vi.spyOn(console, 'error').mockImplementation(() => undefined);
  vi.stubEnv(DEFAULT_SHOP_KEY_ENV, 'shop-secret-from-env');
});

afterEach(() => {
  process.argv = originalArgv;
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
  process.exitCode = 0;
});

describe('shop key CLI', () => {
  it('fails with a validation exit code and no request when the key variable is empty', async () => {
    vi.stubEnv(DEFAULT_SHOP_KEY_ENV, '');
    await run('shop', 'products', 'list');
    expect(soleJson()).toMatchObject({ ok: false, error: { code: 'validation', message: `Environment variable ${DEFAULT_SHOP_KEY_ENV} must hold the shop management key` } });
    expect(process.exitCode).toBe(EXIT_CODE_BY_ERROR_CODE.validation);
    expect(calls).toEqual([]);
  });

  it('shares the shop command with the manifest plan, apply and drift commands', async () => {
    await run('shop', 'plan', '--manifest', '/nonexistent/shop-manifest.json');
    expect(soleJson()).toMatchObject({ ok: false, error: { code: 'validation', message: 'Could not read the manifest file' } });
    expect(calls).toEqual([]);
  });

  it('reads the key from the variable named by --api-key-env', async () => {
    vi.stubEnv('WAREHOUSE_SHOP_KEY', 'warehouse-secret');
    await run('shop', 'stock', 'show', 'product-1', '--api-key-env', 'WAREHOUSE_SHOP_KEY');
    expect(soleJson()).toMatchObject({ ok: true, data: { stock: { onHand: 4 } } });
    expect(calls[0]?.headers.get('x-api-key')).toBe('warehouse-secret');
    expect(calls[0]?.path).toBe('/api/m2m/shop/products/product-1/stock');
  });

  it('creates a product draft with the env key and the selected workspace, never the stored session', async () => {
    await run('shop', 'products', 'create', '--title', 'Printed handbook', '--type', 'physical', '--price', '49.90', '--vat-rate', '5', '--delivery-method', 'shipping');
    expect(soleJson()).toMatchObject({ ok: true, data: { product: { id: 'product-1' } } });
    expect(calls).toHaveLength(1);
    expect(calls[0]).toMatchObject({ method: 'POST', path: '/api/m2m/shop/products' });
    expect(calls[0]?.body).toMatchObject({ title: 'Printed handbook', type: 'physical', priceCents: 4990, vatRate: 5, deliveryMethod: 'shipping' });
    expect(calls[0]?.headers.get('x-api-key')).toBe('shop-secret-from-env');
    expect(calls[0]?.headers.get('x-tenant')).toBe('acme');
    expect(calls[0]?.headers.has('authorization')).toBe(false);
    expect(h.clientOptions).toEqual([{ baseUrl: 'https://platform.example.test', apiKey: 'shop-secret-from-env', tenant: 'acme' }]);
  });

  it('sends --sales-channel on product create and update and refuses an unknown channel before any request', async () => {
    await run('shop', 'products', 'create', '--title', 'Bonus booklet', '--price', '9', '--sales-channel', 'sales_links_only');
    await run('shop', 'products', 'update', 'product-1', '--sales-channel', 'any');
    expect(calls.map(({ path, body }) => ({ path, body }))).toEqual([
      { path: '/api/m2m/shop/products', body: expect.objectContaining({ title: 'Bonus booklet', priceCents: 900, salesChannel: 'sales_links_only' }) },
      { path: '/api/m2m/shop/products/update', body: { id: 'product-1', salesChannel: 'any' } },
    ]);

    calls.length = 0;
    logSpy.mockClear();
    await run('shop', 'products', 'update', 'product-1', '--sales-channel', 'everywhere');
    expect(soleJson()).toMatchObject({ ok: false, error: { code: 'validation' } });
    expect(process.exitCode).toBe(EXIT_CODE_BY_ERROR_CODE.validation);
    expect(calls).toEqual([]);
  });

  it('sends the personalisation file on product create and update, null for --no-personalization, and refuses both flags before any request', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'shop-personalization-'));
    const path = join(directory, 'personalization.json');
    const engraving = { label: 'Add an engraving', inputLabel: 'Engraving text', condition: 'I understand a personalised item is made to my order.' };
    await writeFile(path, JSON.stringify(engraving));
    await run('shop', 'products', 'create', '--title', 'Printed book', '--price', '49', '--type', 'physical', '--personalization-file', path);
    await run('shop', 'products', 'update', 'product-1', '--no-personalization');
    await run('shop', 'products', 'update', 'product-1', '--title', 'Second edition');
    expect(calls.map(({ path: route, body }) => ({ route, body }))).toEqual([
      { route: '/api/m2m/shop/products', body: expect.objectContaining({ personalization: { ...engraving, description: '', maxLength: 200 } }) },
      { route: '/api/m2m/shop/products/update', body: { id: 'product-1', personalization: null } },
      { route: '/api/m2m/shop/products/update', body: { id: 'product-1', title: 'Second edition' } },
    ]);

    calls.length = 0;
    logSpy.mockClear();
    await run('shop', 'products', 'update', 'product-1', '--personalization-file', path, '--no-personalization');
    expect(soleJson()).toMatchObject({ ok: false, error: { code: 'validation', message: 'Provide only one of --personalization-file and --no-personalization' } });
    expect(calls).toEqual([]);
    await rm(directory, { recursive: true, force: true });
  });

  it.each([
    [['shop', 'products', 'create', '--title', 'Both', '--price', '1', '--price-cents', '100'], 'Provide only one of --price and --price-cents'],
    [['shop', 'products', 'create', '--title', 'None'], 'Provide a price with --price (currency units) or --price-cents (integer cents)'],
    [['shop', 'products', 'update', 'product-1', '--cover-url', 'https://cdn.example.test/a.png', '--clear-cover'], 'Provide only one of --cover-url and --clear-cover'],
    [['shop', 'products', 'delete', 'product-1'], 'Product deletion requires --confirm'],
    [['shop', 'prices', 'add', '--product', 'product-1', '--kind', 'one_time'], 'Provide an amount with --price (currency units) or --price-cents (integer cents)'],
  ])('rejects %j before any request', async (args, message) => {
    await run(...args);
    expect(soleJson()).toMatchObject({ ok: false, error: { code: 'validation', message } });
    expect(process.exitCode).toBe(EXIT_CODE_BY_ERROR_CODE.validation);
    expect(calls).toEqual([]);
  });

  it.each([
    [['shop', 'products', 'list'], 'GET', '/api/m2m/shop/products', null],
    [['shop', 'products', 'update', 'product-1', '--title', 'Second edition', '--clear-cover'], 'POST', '/api/m2m/shop/products/update', { id: 'product-1', title: 'Second edition', coverUrl: null }],
    [['shop', 'products', 'publish', 'product-1'], 'POST', '/api/m2m/shop/products/publish', { id: 'product-1' }],
    [['shop', 'products', 'unpublish', 'product-1'], 'POST', '/api/m2m/shop/products/unpublish', { id: 'product-1' }],
    [['shop', 'products', 'delete', 'product-1', '--confirm'], 'POST', '/api/m2m/shop/products/delete', { productId: 'product-1' }],
    [['shop', 'prices', 'list', '--product', 'product-1'], 'GET', '/api/m2m/shop/products/product-1/prices', null],
    [['shop', 'prices', 'add', '--product', 'product-1', '--kind', 'one_time', '--price-cents', '4990'], 'POST', '/api/m2m/shop/products/prices', { productId: 'product-1', kind: 'one_time', amountCents: 4990, currency: 'PLN' }],
    [['shop', 'prices', 'deactivate', 'price-1'], 'POST', '/api/m2m/shop/products/prices/deactivate', { id: 'price-1' }],
    [['shop', 'stock', 'enable', 'product-1', '--on-hand', '4'], 'POST', '/api/m2m/shop/products/stock/enable', { productId: 'product-1', onHand: 4, lowStockThreshold: null }],
    [['shop', 'stock', 'adjust', 'product-1', '--delta', '-1', '--reason', 'damaged'], 'POST', '/api/m2m/shop/products/stock/adjust', { productId: 'product-1', delta: -1, reason: 'damaged' }],
    [['shop', 'stock', 'threshold', 'product-1', '--value', 'none'], 'POST', '/api/m2m/shop/products/stock/threshold', { productId: 'product-1', lowStockThreshold: null }],
  ])('sends %j to the shop route', async (args, method, path, body) => {
    await run(...args);
    expect(soleJson()).toMatchObject({ ok: true });
    expect(calls).toHaveLength(1);
    expect(calls[0]).toMatchObject({ method, path, body });
    expect(calls[0]?.headers.has('authorization')).toBe(false);
  });

  it('passes the refusal a direct-mode key gets for what a product grants through with the forbidden exit code', async () => {
    h.fetchImpl = async (input, init) => {
      await fetchImpl(input, init);
      return Response.json({ ok: false, error: { code: 'forbidden', message: 'product:access:write is not permitted' } }, { status: 403 });
    };
    await run('shop', 'products', 'access', 'product-1', '--course', 'course-1');
    expect(soleJson()).toMatchObject({ ok: false, error: { code: 'forbidden' } });
    expect(process.exitCode).toBe(EXIT_CODE_BY_ERROR_CODE.forbidden);
    expect(calls.map((call) => `${call.method} ${call.path}`)).toEqual(['POST /api/m2m/shop/products/access']);
  });

  it('never prints the key in human output and honours --tenant', async () => {
    process.argv = ['node', 'together', '--tenant', 'studio', 'shop', 'products', 'list'];
    vi.resetModules();
    await import('./main.js');
    const printed = [...logSpy.mock.calls, ...errorSpy.mock.calls].flat().join('\n');
    expect(printed).toContain('Printed handbook');
    expect(printed).not.toContain('shop-secret-from-env');
    expect(calls[0]?.headers.get('x-tenant')).toBe('studio');
    expect(calls[0]?.headers.has('authorization')).toBe(false);
  });
});

describe('shop orders CLI', () => {
  it.each([
    [['shop', 'orders', 'list', '--mode', 'live', '--fulfilment', 'to_pack', '--page', '2', '--page-size', '50'], 'GET', '/api/m2m/shop/orders', '?fulfilmentStatus=to_pack&mode=live&page=2&pageSize=50', null],
    [['shop', 'orders', 'export', '--format', 'csv', '--status', 'paid'], 'GET', '/api/m2m/shop/orders/export', '?status=paid&format=csv', null],
    [['shop', 'orders', 'packing-list', '--format', 'csv'], 'GET', '/api/m2m/shop/orders/packing-list', '?format=csv&mode=live', null],
    [['shop', 'orders', 'verify', 'order-1'], 'GET', '/api/m2m/shop/orders/verify/order-1', '', null],
    [['shop', 'orders', 'show', 'order-1'], 'GET', '/api/m2m/shop/orders/order-1', '', null],
    [['shop', 'orders', 'ship', 'order-1', '--carrier', 'other', '--tracking', 'MANUAL0001'], 'POST', '/api/m2m/shop/orders/order-1/ship', '', { orderId: 'order-1', carrier: 'other', trackingNumber: 'MANUAL0001' }],
    [['shop', 'orders', 'issue', 'order-1', 'product-1'], 'POST', '/api/m2m/shop/orders/order-1/lines/product-1/issue', '', { orderId: 'order-1', productId: 'product-1' }],
    [['shop', 'orders', 'issue', 'order-1', 'product-1', '--count', '2'], 'POST', '/api/m2m/shop/orders/order-1/lines/product-1/issue', '', { orderId: 'order-1', productId: 'product-1', count: 2 }],
    [['shop', 'orders', 'shipx', 'show', 'order-1'], 'GET', '/api/m2m/shop/orders/order-1/shipx', '', null],
    [['shop', 'orders', 'shipx', 'create', 'order-1'], 'POST', '/api/m2m/shop/orders/order-1/shipx', '', { markShipped: false }],
    [['shop', 'orders', 'shipx', 'create', 'order-1', '--mark-shipped'], 'POST', '/api/m2m/shop/orders/order-1/shipx', '', { markShipped: true }],
    [['shop', 'orders', 'shipx', 'refresh', 'order-1'], 'POST', '/api/m2m/shop/orders/order-1/shipx/refresh', '', {}],
    [['shop', 'orders', 'shipx', 'discard', 'order-1'], 'POST', '/api/m2m/shop/orders/order-1/shipx/discard', '', {}],
  ])('sends %j to the shop order route with the env key only', async (args, method, path, search, body) => {
    await run(...args);
    expect(soleJson()).toMatchObject({ ok: true });
    expect(calls).toHaveLength(1);
    expect(calls[0]).toMatchObject({ method, path, search, body });
    expect(calls[0]?.headers.get('x-api-key')).toBe('shop-secret-from-env');
    expect(calls[0]?.headers.has('authorization')).toBe(false);
  });

  it('prints label_ready in the plain order list', async () => {
    h.fetchImpl = async () => Response.json({ ok: true, data: {
      orders: [{ ...order, fulfilmentStatus: 'to_pack', shipment: null, label: { carrier: 'inpost', trackingNumber: 'LABEL1234' } }],
      sources: [], total: 1, page: 1, pageSize: 20,
    } });
    await runPlain('shop', 'orders', 'list', '--fulfilment', 'to_pack');
    expect(logSpy).toHaveBeenCalledWith(expect.stringContaining('\tlabel_ready\t'));
  });

  it.each([
    ['to_pack', null, 'label ready; order still to pack: order-1 (inpost LABEL1234)'],
    ['shipped', order.shipment, 'shipped: order-1 (other MANUAL0001); InPost label LABEL1234 was bought as well, reconcile it in Manager Paczek'],
    ['shipped', { ...order.shipment, carrier: 'inpost', trackingNumber: 'LABEL1234' }, 'shipped: order-1 (inpost LABEL1234)'],
    [null, null, 'label bought; order is off the packing list: order-1 (inpost LABEL1234)'],
  ])('describes a bought label for fulfilment status %s', async (fulfilmentStatus, dispatchedShipment, expected) => {
    h.fetchImpl = async () => Response.json({ ok: true, data: { order: { ...order, fulfilmentStatus, shipment: dispatchedShipment }, shipment: { ...shipment, trackingNumber: 'LABEL1234' } } });
    await runPlain('shop', 'orders', 'shipx', 'create', 'order-1');
    expect(logSpy).toHaveBeenCalledWith(expected);
  });

  it('names the connection of the order in the plain ShipX view', async () => {
    process.argv = ['node', 'together', 'shop', 'orders', 'shipx', 'show', 'order-1'];
    vi.resetModules();
    await import('./main.js');
    expect(logSpy).toHaveBeenCalledWith(expect.stringContaining('environment: production'));
  });

  it('writes the label and the packing list to the --out paths', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'shop-orders-cli-'));
    const label = join(directory, 'label.pdf');
    await run('shop', 'orders', 'shipx', 'label', 'order-1', '--out', label);
    expect(soleJson()).toEqual({ ok: true, data: { filename: 'inpost-T1.pdf', contentType: 'application/pdf', bytes: 14, out: label } });
    expect(await readFile(label, 'utf8')).toBe('%PDF-1.4 label');
    expect(calls[0]).toMatchObject({ method: 'POST', path: '/api/m2m/shop/orders/order-1/shipx/label' });

    logSpy.mockClear();
    const packing = join(directory, 'packing.csv');
    await run('shop', 'orders', 'packing-list', '--format', 'csv', '--mode', 'test', '--out', packing);
    expect(soleJson()).toMatchObject({ ok: true, data: { filename: 'orders.csv', out: packing } });
    expect(await readFile(packing, 'utf8')).toBe('order_number\norder-1');
    expect(calls[1]?.search).toBe('?format=csv&mode=test');
    await rm(directory, { recursive: true });
  });

  it('rejects an unknown order mode before any request', async () => {
    await run('shop', 'orders', 'list', '--mode', 'staging');
    expect(soleJson()).toMatchObject({ ok: false, error: { code: 'validation' } });
    expect(calls).toEqual([]);
  });

  it('sends no count when issue has no --count', async () => {
    await run('shop', 'orders', 'issue', 'order-1', 'product-1');
    expect(calls[0]?.body).toEqual({ orderId: 'order-1', productId: 'product-1' });
  });

  it.each([['0'], ['-1'], ['1.5'], ['two']])('rejects issue --count %s before any request', async (count) => {
    await run('shop', 'orders', 'issue', 'order-1', 'product-1', '--count', count);
    expect(soleJson()).toMatchObject({ ok: false, error: { code: 'validation' } });
    expect(calls).toEqual([]);
  });
});

describe('shop settings and branding CLI', () => {
  it('shows the settings with the env key only', async () => {
    await run('shop', 'settings', 'show');
    expect(soleJson()).toEqual({ ok: true, data: { settings: shopSettings } });
    expect(calls).toHaveLength(1);
    expect(calls[0]).toMatchObject({ method: 'GET', path: '/api/m2m/shop/settings' });
    expect(calls[0]?.headers.get('x-api-key')).toBe('shop-secret-from-env');
    expect(calls[0]?.headers.has('authorization')).toBe(false);
  });

  it('sends the settings JSON from a file and from stdin', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'shop-settings-cli-'));
    const file = join(directory, 'settings.json');
    await writeFile(file, JSON.stringify({ termsUrl: 'https://brand.example.test/terms', supportUrl: null }));
    await run('shop', 'settings', 'set', '--json-file', file);
    expect(soleJson()).toMatchObject({ ok: true, data: { settings: { name: 'Example Press' } } });
    expect(calls[0]).toMatchObject({ method: 'POST', path: '/api/m2m/shop/settings', body: { termsUrl: 'https://brand.example.test/terms', supportUrl: null } });

    logSpy.mockClear();
    vi.spyOn(process.stdin, Symbol.asyncIterator).mockImplementation(async function* (): AsyncGenerator<Buffer, undefined> {
      yield Buffer.from('{"privacyUrl":');
      yield Buffer.from('"https://brand.example.test/privacy"}');
      return undefined;
    });
    await run('shop', 'settings', 'set', '--json-file', '-');
    expect(soleJson()).toMatchObject({ ok: true });
    expect(calls[1]).toMatchObject({ method: 'POST', path: '/api/m2m/shop/settings', body: { privacyUrl: 'https://brand.example.test/privacy' } });
    await rm(directory, { recursive: true });
  });

  it.each([
    ['{"analyticsTagId":"G-ABCDEF1234"}'],
    ['{"defaultHomeSpaceId":"space-1"}'],
    ['{"termsUrlTypo":"https://brand.example.test/terms"}'],
    ['not json'],
  ])('rejects the settings file %s before any request', async (content) => {
    const directory = await mkdtemp(join(tmpdir(), 'shop-settings-cli-'));
    const file = join(directory, 'settings.json');
    await writeFile(file, content);
    await run('shop', 'settings', 'set', '--json-file', file);
    expect(soleJson()).toMatchObject({ ok: false, error: { code: 'validation' } });
    expect(process.exitCode).toBe(EXIT_CODE_BY_ERROR_CODE.validation);
    expect(calls).toEqual([]);
    await rm(directory, { recursive: true });
  });

  it('uploads a branding image, PUTs the bytes without the key and completes it', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'shop-branding-cli-'));
    const file = join(directory, 'logo.png');
    await writeFile(file, new Uint8Array([137, 80, 78, 71]));
    await run('shop', 'branding', 'upload', 'logo', file);
    expect(soleJson()).toEqual({ ok: true, data: { url: '/api/public/assets/logo/1.png', field: 'logoUrl' } });
    expect(calls.map((call) => `${call.method} ${call.path}`)).toEqual([
      'POST /api/m2m/shop/image-assets/branding/upload',
      'PUT /candidate',
      'POST /api/m2m/shop/image-assets/branding/complete',
    ]);
    expect(calls[0]?.body).toEqual({ kind: 'logo', fileName: 'logo.png', contentType: 'image/png', sizeBytes: 4 });
    expect(calls[1]?.headers.has('x-api-key')).toBe(false);
    expect(calls[1]?.headers.has('x-tenant')).toBe(false);
    expect(calls[1]?.headers.has('authorization')).toBe(false);
    expect(calls[1]?.headers.get('content-type')).toBe('image/png');
    expect(calls[2]?.body).toEqual({ key: 'image-asset-candidates/acme/logo/1.png' });
    await rm(directory, { recursive: true });
  });

  it.each([
    ['product-cover', 'cover.png'],
    ['logo', 'logo.gif'],
    ['share-image', 'share.svg'],
    ['logo', 'missing.png'],
  ])('rejects a %s upload of %s before any request', async (kind, name) => {
    const directory = await mkdtemp(join(tmpdir(), 'shop-branding-cli-'));
    if (name !== 'missing.png') await writeFile(join(directory, name), '<svg/>');
    await run('shop', 'branding', 'upload', kind, join(directory, name));
    expect(soleJson()).toMatchObject({ ok: false, error: { code: 'validation' } });
    expect(calls).toEqual([]);
    await rm(directory, { recursive: true });
  });
});

describe('shop gallery images CLI', () => {
  it('uploads a gallery image, PUTs the bytes without the key, completes it and prints only its URL', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'shop-images-cli-'));
    try {
      const file = join(directory, 'front.png');
      await writeFile(file, new Uint8Array([137, 80, 78, 71]));
      await run('shop', 'images', 'upload', file);
      expect(soleJson()).toEqual({ ok: true, data: { url: '/api/public/assets/product-image/2.png' } });
      expect(calls.map((call) => `${call.method} ${call.path}`)).toEqual([
        'POST /api/m2m/shop/image-assets/product-image/upload', 'PUT /candidate', 'POST /api/m2m/shop/image-assets/product-image/complete',
      ]);
      expect(calls[0]?.body).toEqual({ kind: 'product-image', fileName: 'front.png', contentType: 'image/png', sizeBytes: 4 });
      expect(calls[1]?.headers.has('x-api-key')).toBe(false);
      expect(calls[1]?.headers.get('content-type')).toBe('image/png');
      expect(calls[2]?.body).toEqual({ key: 'image-asset-candidates/acme/product-image/2.png' });
      expect(calls[0]?.headers.get('x-api-key')).toBe('shop-secret-from-env');

      calls.length = 0;
      logSpy.mockClear();
      process.argv = ['node', 'together', 'shop', 'images', 'upload', file];
      vi.resetModules();
      await import('./main.js');
      expect(logSpy).toHaveBeenCalledExactlyOnceWith('/api/public/assets/product-image/2.png');
    } finally {
      await rm(directory, { recursive: true });
    }
  });

  it.each(['front.gif', 'missing.png'])('refuses %s with the validation exit code before any request', async (name) => {
    const directory = await mkdtemp(join(tmpdir(), 'shop-images-cli-'));
    try {
      if (name !== 'missing.png') await writeFile(join(directory, name), new Uint8Array([71, 73, 70]));
      await run('shop', 'images', 'upload', join(directory, name));
      expect(soleJson()).toMatchObject({ ok: false, error: { code: 'validation' } });
      expect(process.exitCode).toBe(EXIT_CODE_BY_ERROR_CODE.validation);
      expect(calls).toEqual([]);
    } finally {
      await rm(directory, { recursive: true });
    }
  });
});

describe('shop cover and sales-links CLI', () => {
  it('uploads, PUTs, completes and attaches a cover using the environment key only on API calls', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'shop-cover-cli-'));
    try {
      const file = join(directory, 'cover.png');
      await writeFile(file, new Uint8Array([137, 80, 78, 71]));
      await run('shop', 'cover', 'upload', 'product-1', file);
      expect(soleJson()).toMatchObject({ ok: true, data: { product: { id: 'product-1' } } });
      expect(calls.map((call) => `${call.method} ${call.path}`)).toEqual([
        'GET /api/m2m/shop/products/product-1/prices',
        'POST /api/m2m/shop/image-assets/product-cover/upload', 'PUT /candidate',
        'POST /api/m2m/shop/image-assets/product-cover/complete', 'POST /api/m2m/shop/products/update',
      ]);
      expect(calls[1]?.body).toEqual({ kind: 'product-cover', fileName: 'cover.png', contentType: 'image/png', sizeBytes: 4 });
      expect(calls[2]?.headers.has('x-api-key')).toBe(false);
      expect(calls[2]?.headers.has('x-tenant')).toBe(false);
      expect(calls[2]?.headers.has('authorization')).toBe(false);
      expect(calls[2]?.headers.get('content-type')).toBe('image/png');
      expect(calls[4]?.body).toEqual({ id: 'product-1', coverUrl: '/api/public/assets/product-cover/1.png' });
      for (const call of calls.filter((call) => call.path.startsWith('/api/'))) {
        expect(call.headers.get('x-api-key')).toBe('shop-secret-from-env');
        expect(call.headers.has('authorization')).toBe(false);
      }
    } finally {
      await rm(directory, { recursive: true });
    }
  });

  it('fails with the not_found exit code and uploads nothing when the product is not in the workspace', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'shop-cover-cli-'));
    try {
      const file = join(directory, 'cover.png');
      await writeFile(file, new Uint8Array([137, 80, 78, 71]));
      h.fetchImpl = async (input, init) => {
        if (String(input).endsWith('/products/missing-product/prices')) {
          calls.push({ method: init?.method ?? 'GET', path: new URL(String(input)).pathname, search: '', headers: new Headers(init?.headers), body: null });
          return Response.json({ ok: false, error: { code: 'not_found', message: 'No product "missing-product" in this tenant' } }, { status: 404 });
        }
        return fetchImpl(input, init);
      };
      await run('shop', 'cover', 'upload', 'missing-product', file);
      expect(soleJson()).toMatchObject({ ok: false, error: { code: 'not_found' } });
      expect(process.exitCode).toBe(EXIT_CODE_BY_ERROR_CODE.not_found);
      expect(calls.map((call) => `${call.method} ${call.path}`)).toEqual(['GET /api/m2m/shop/products/missing-product/prices']);
    } finally {
      await rm(directory, { recursive: true });
    }
  });

  it('does not update a product when upload completion fails', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'shop-cover-cli-'));
    try {
      const file = join(directory, 'cover.png');
      await writeFile(file, new Uint8Array([137, 80, 78, 71]));
      h.fetchImpl = async (input, init) => String(input).endsWith('/complete')
        ? Response.json({ ok: false, error: { code: 'validation', message: 'Invalid image signature' } }, { status: 400 })
        : fetchImpl(input, init);
      await run('shop', 'cover', 'upload', 'product-1', file);
      expect(soleJson()).toMatchObject({ ok: false, error: { code: 'validation' } });
      expect(calls.map((call) => call.path)).toEqual(['/api/m2m/shop/products/product-1/prices', '/api/m2m/shop/image-assets/product-cover/upload', '/candidate']);
    } finally {
      await rm(directory, { recursive: true });
    }
  });

  it.each([
    ['list', undefined, 'GET', '/api/m2m/shop/sales-links'],
    ['show', 'link-1', 'GET', '/api/m2m/shop/sales-links/link-1'],
    ['delete', 'link-1', 'DELETE', '/api/m2m/shop/sales-links/link-1'],
  ] as const)('sends sales-links %s with only the environment key', async (command, id, method, path) => {
    await run('shop', 'sales-links', command, ...(id === undefined ? [] : [id]));
    expect(soleJson()).toMatchObject({ ok: true });
    expect(calls).toHaveLength(1);
    expect(calls[0]).toMatchObject({ method, path });
    expect(calls[0]?.headers.get('x-api-key')).toBe('shop-secret-from-env');
    expect(calls[0]?.headers.has('authorization')).toBe(false);
  });

  it.each(['create', 'update'] as const)('sends sales-links %s JSON without inventing a revision', async (command) => {
    const directory = await mkdtemp(join(tmpdir(), 'shop-sales-links-cli-'));
    try {
      const file = join(directory, 'link.json');
      const fields = { ...salesLinkFields, ...(command === 'update' ? { expectedRevision: 7 } : {}) };
      await writeFile(file, JSON.stringify(fields));
      await run('shop', 'sales-links', command, ...(command === 'update' ? ['link-1'] : []), '--json-file', file);
      expect(soleJson()).toMatchObject({ ok: true, data: { salesLink: { id: 'link-1' } } });
      expect(calls).toHaveLength(1);
      expect(calls[0]).toMatchObject({ method: 'POST', path: `/api/m2m/shop/sales-links${command === 'update' ? '/link-1' : ''}` });
      expect(calls[0]?.body).toMatchObject({ ...fields, ...(command === 'update' ? { id: 'link-1' } : {}) });
    } finally {
      await rm(directory, { recursive: true });
    }
  });

  it.each([
    { ...salesLinkFields },
    { ...salesLinkFields, expectedRevision: 0 },
    { ...salesLinkFields, expectedRevision: 1, id: 'foreign-id' },
    { ...salesLinkFields, expectedRevision: 1, unexpected: true },
  ])('rejects an invalid sales-link update before any request: %j', async (fields) => {
    const directory = await mkdtemp(join(tmpdir(), 'shop-sales-links-cli-'));
    try {
      const file = join(directory, 'link.json');
      await writeFile(file, JSON.stringify(fields));
      await run('shop', 'sales-links', 'update', 'link-1', '--json-file', file);
      expect(soleJson()).toMatchObject({ ok: false, error: { code: 'validation' } });
      expect(calls).toEqual([]);
    } finally {
      await rm(directory, { recursive: true });
    }
  });
});

const stdinOf = (text: string) => vi.spyOn(process.stdin, Symbol.asyncIterator).mockImplementation(async function* (): AsyncGenerator<Buffer, undefined> {
  yield Buffer.from(text);
  return undefined;
});

const printedOutput = (): string => [...logSpy.mock.calls, ...errorSpy.mock.calls].flat().join('\n');

describe('shop integrations CLI', () => {
  it('lists the masked secrets with the env key only', async () => {
    await run('shop', 'integrations', 'secrets', 'list');
    expect(soleJson()).toMatchObject({ ok: true, data: { secrets: [{ key: 'ksef.token', maskedPreview: '••••2345' }] } });
    expect(calls[0]).toMatchObject({ method: 'GET', path: '/api/m2m/shop/integrations/secrets' });
    expect(calls[0]?.headers.get('x-api-key')).toBe('shop-secret-from-env');
    expect(calls[0]?.headers.has('authorization')).toBe(false);
  });

  it('sets a credential from --value-env and from stdin and never prints the value', async () => {
    vi.stubEnv('KSEF_TOKEN_VALUE', 'ksef-token-from-env');
    await run('shop', 'integrations', 'secrets', 'set', 'ksef.token', '--value-env', 'KSEF_TOKEN_VALUE');
    expect(soleJson()).toMatchObject({ ok: true, data: { secret: { key: 'ksef.token', maskedPreview: '••••2345' } } });
    expect(calls[0]).toMatchObject({ method: 'POST', path: '/api/m2m/shop/integrations/secrets', body: { key: 'ksef.token', value: 'ksef-token-from-env' } });

    logSpy.mockClear();
    stdinOf('1234563218\n');
    await run('shop', 'integrations', 'secrets', 'set', 'ksef.contextNip');
    expect(soleJson()).toMatchObject({ ok: true });
    expect(calls[1]?.body).toEqual({ key: 'ksef.contextNip', value: '1234563218' });
    expect(printedOutput()).not.toContain('ksef-token-from-env');
    expect(printedOutput()).not.toContain('shop-secret-from-env');
  });

  it.each([
    [['shop', 'integrations', 'secrets', 'set', 'stripe.restrictedKey', '--value-env', 'RAW_VALUE']],
    [['shop', 'integrations', 'secrets', 'set', 's3.configuration', '--value-env', 'RAW_VALUE']],
    [['shop', 'integrations', 'secrets', 'set', 'shipx.token', '--value-env', 'RAW_VALUE']],
    [['shop', 'integrations', 'secrets', 'set', 'shipx.production.token', '--value-env', 'RAW_VALUE']],
    [['shop', 'integrations', 'secrets', 'set', 'shipx.sandbox.organizationId', '--value-env', 'RAW_VALUE']],
    [['shop', 'integrations', 'secrets', 'set', 'ksef.contextNip', '--value-env', 'RAW_VALUE']],
    [['shop', 'integrations', 'secrets', 'set', 'ifirma.username', '--value-env', 'EMPTY_VALUE']],
    [['shop', 'integrations', 'secrets', 'delete', 'stripe.webhookSecret']],
    [['shop', 'integrations', 'stripe', 'configure', '--mode', 'test', '--restricted-key-env', 'EMPTY_VALUE']],
    [['shop', 'integrations', 'stripe', 'probe', '--mode', 'staging']],
    [['shop', 'integrations', 'storage', 'configure', '--provider', 'minio', '--endpoint', 'ftp://storage.example.test', '--region', 'eu', '--bucket', 'assets', '--access-key-id', 'id', '--secret-access-key-env', 'RAW_VALUE']],
    [['shop', 'integrations', 'shipx', 'configure', '--slot', 'production', '--organization-id', 'not-a-number']],
    [['shop', 'integrations', 'shipx', 'configure', '--organization-id', '12345']],
    [['shop', 'integrations', 'shipx', 'configure', '--clear-credentials']],
    [['shop', 'integrations', 'shipx', 'configure', '--slot', 'sandbox']],
    [['shop', 'integrations', 'shipx', 'configure', '--slot', 'staging', '--clear-credentials']],
    [['shop', 'integrations', 'shipx', 'configure', '--environment', 'production', '--clear-credentials']],
    [['shop', 'integrations', 'shipx', 'configure', '--slot', 'production', '--organization-id', '12345', '--clear-credentials']],
    [['shop', 'integrations', 'shipx', 'configure', '--slot', 'sandbox', '--token-env', 'RAW_VALUE', '--token-stdin']],
    [['shop', 'integrations', 'shipx', 'configure', '--slot', 'sandbox', '--sender-json-file', '-', '--token-stdin']],
  ])('rejects %j before any request', async (args) => {
    vi.stubEnv('RAW_VALUE', 'raw-value');
    vi.stubEnv('EMPTY_VALUE', '');
    await run(...args);
    expect(soleJson()).toMatchObject({ ok: false, error: { code: 'validation' } });
    expect(process.exitCode).toBe(EXIT_CODE_BY_ERROR_CODE.validation);
    expect(calls).toEqual([]);
  });

  it.each([
    [['shop', 'integrations', 'secrets', 'delete', 'ifirma.username'], 'DELETE', '/api/m2m/shop/integrations/secrets/ifirma.username', null],
    [['shop', 'integrations', 'stripe', 'probe', '--mode', 'test'], 'POST', '/api/m2m/shop/integrations/stripe/probe', { mode: 'test' }],
    [['shop', 'integrations', 'shipx', 'show'], 'GET', '/api/m2m/shop/integrations/shipx', null],
    [['shop', 'integrations', 'shipx', 'configure', '--slot', 'production', '--clear-credentials'], 'POST', '/api/m2m/shop/integrations/shipx/configure', { production: { clearCredentials: true } }],
    [['shop', 'integrations', 'shipx', 'configure', '--slot', 'sandbox', '--clear-credentials'], 'POST', '/api/m2m/shop/integrations/shipx/configure', { sandbox: { clearCredentials: true } }],
    [['shop', 'integrations', 'shipx', 'configure', '--clear-sender'], 'POST', '/api/m2m/shop/integrations/shipx/configure', { sender: null }],
  ])('sends %j to the integration route', async (args, method, path, body) => {
    await run(...args);
    expect(soleJson()).toMatchObject({ ok: true });
    expect(calls).toHaveLength(1);
    expect(calls[0]).toMatchObject({ method, path, body });
    expect(calls[0]?.headers.has('authorization')).toBe(false);
  });

  it('configures Stripe with the restricted key from the environment or stdin, never from argv', async () => {
    vi.stubEnv('STRIPE_RESTRICTED_KEY', 'rk_test_from_env');
    await run('shop', 'integrations', 'stripe', 'configure', '--mode', 'test', '--restricted-key-env', 'STRIPE_RESTRICTED_KEY');
    expect(soleJson()).toMatchObject({ ok: true, data: { mode: 'test' } });
    expect(calls[0]).toMatchObject({ method: 'POST', path: '/api/m2m/shop/integrations/stripe/configure', body: { mode: 'test', restrictedKey: 'rk_test_from_env' } });

    logSpy.mockClear();
    stdinOf('rk_test_from_stdin\n');
    await run('shop', 'integrations', 'stripe', 'configure', '--mode', 'test');
    expect(soleJson()).toMatchObject({ ok: true });
    expect(calls[1]?.body).toEqual({ mode: 'test', restrictedKey: 'rk_test_from_stdin' });
    expect(printedOutput()).not.toContain('rk_test_from');
  });

  it('configures storage with the secret access key from the environment', async () => {
    vi.stubEnv('STORAGE_SECRET', 'storage-secret-value');
    await run('shop', 'integrations', 'storage', 'configure', '--provider', 'minio', '--endpoint', 'https://storage.example.test',
      '--region', 'eu-central-1', '--bucket', 'assets', '--access-key-id', 'access-id', '--secret-access-key-env', 'STORAGE_SECRET');
    expect(soleJson()).toMatchObject({ ok: true, data: { secret: { key: 's3.configuration' } } });
    expect(calls[0]).toMatchObject({ method: 'POST', path: '/api/m2m/shop/integrations/storage/configure', body: {
      provider: 'minio', endpoint: 'https://storage.example.test', region: 'eu-central-1', bucket: 'assets', accessKeyId: 'access-id', secretAccessKey: 'storage-secret-value',
    } });
    expect(printedOutput()).not.toContain('storage-secret-value');
  });

  it('configures the ShipX sender from a file and the token from the environment', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'shop-shipx-cli-'));
    try {
      const file = join(directory, 'sender.json');
      await writeFile(file, JSON.stringify(shipxView.sender));
      vi.stubEnv('SHIPX_TOKEN', 'shipx-token-from-env');
      await run('shop', 'integrations', 'shipx', 'configure', '--slot', 'sandbox', '--sender-json-file', file, '--organization-id', '12345', '--token-env', 'SHIPX_TOKEN');
      expect(soleJson()).toMatchObject({ ok: true, data: { sandbox: { configured: true } } });
      expect(calls[0]).toMatchObject({ method: 'POST', path: '/api/m2m/shop/integrations/shipx/configure', body: {
        sender: shipxView.sender, sandbox: { organizationId: '12345', token: 'shipx-token-from-env' },
      } });
      expect(printedOutput()).not.toContain('shipx-token-from-env');

      logSpy.mockClear();
      stdinOf('shipx-token-from-stdin\n');
      await run('shop', 'integrations', 'shipx', 'configure', '--slot', 'production', '--token-stdin');
      expect(soleJson()).toMatchObject({ ok: true });
      expect(calls[1]?.body).toEqual({ production: { token: 'shipx-token-from-stdin' } });
      expect(printedOutput()).not.toContain('shipx-token-from-stdin');
    } finally {
      await rm(directory, { recursive: true });
    }
  });
});

const receipt = {
  id: 'proposal-1', status: 'pending', operation: 'stock.adjust', target: { kind: 'product', id: 'product-1' }, groupId: null,
  createdAt: '2026-11-15T10:00:00.000Z', expiresAt: '2026-12-15T10:00:00.000Z', input: { productId: 'product-1', delta: 5, reason: 'delivery' },
  decisionNote: null, appliedResourceId: null, failureCode: null,
};

const proposalFetch: typeof fetch = async (input, init) => {
  const url = new URL(typeof input === 'string' ? input : input instanceof URL ? input.href : input.url);
  const method = init?.method ?? 'GET';
  calls.push({ method, path: url.pathname, search: url.search, headers: new Headers(init?.headers), body: typeof init?.body === 'string' ? JSON.parse(init.body) : init?.body ?? null });
  if (url.pathname === '/api/m2m/shop/proposals') return Response.json({ ok: true, data: { proposals: [receipt], nextCursor: 'proposal-1' } });
  if (url.pathname.startsWith('/api/m2m/shop/proposals/')) {
    return Response.json({ ok: true, data: { proposal: url.pathname.endsWith('/withdraw') ? { ...receipt, status: 'withdrawn' } : receipt } });
  }
  return Response.json({ ok: true, data: { outcome: 'proposed', proposal: receipt } }, { status: 202 });
};

describe('shop key CLI with a propose-mode key', () => {
  beforeEach(() => { h.fetchImpl = proposalFetch; });

  it.each([
    [['shop', 'products', 'create', '--title', 'Printed handbook', '--price', '49']],
    [['shop', 'products', 'update', 'product-1', '--title', 'Renamed']],
    [['shop', 'products', 'publish', 'product-1']],
    [['shop', 'products', 'unpublish', 'product-1']],
    [['shop', 'products', 'delete', 'product-1', '--confirm']],
    [['shop', 'prices', 'add', '--product', 'product-1', '--kind', 'one_time', '--price-cents', '4900']],
    [['shop', 'prices', 'deactivate', 'price-1']],
    [['shop', 'stock', 'enable', 'product-1', '--on-hand', '3']],
    [['shop', 'stock', 'adjust', 'product-1', '--delta', '5', '--reason', 'delivery']],
    [['shop', 'stock', 'threshold', 'product-1', '--value', '2']],
    [['shop', 'products', 'access', 'product-1', '--course', 'course-1']],
  ])('prints the receipt and exits 0 when %j answers 202', async (args) => {
    await run(...args);
    expect(soleJson()).toEqual({ ok: true, data: { outcome: 'proposed', proposal: receipt } });
    expect(process.exitCode ?? 0).toBe(0);
    expect(calls).toHaveLength(1);
  });

  it.each([
    ['settings', ['shop', 'settings', 'set'], { name: 'Proposed shop' }, 'POST /api/m2m/shop/settings'],
    ['sales-link create', ['shop', 'sales-links', 'create'], salesLinkFields, 'POST /api/m2m/shop/sales-links'],
    ['sales-link update', ['shop', 'sales-links', 'update', 'link-1'], { ...salesLinkFields, expectedRevision: 1 }, 'POST /api/m2m/shop/sales-links/link-1'],
  ])('prints the receipt and exits 0 when the %s write answers 202', async (_label, args, fields, request) => {
    const directory = await mkdtemp(join(tmpdir(), 'shop-proposal-cli-'));
    try {
      const file = join(directory, 'input.json');
      await writeFile(file, JSON.stringify(fields));
      await run(...args, '--json-file', file);
      expect(soleJson()).toEqual({ ok: true, data: { outcome: 'proposed', proposal: receipt } });
      expect(process.exitCode ?? 0).toBe(0);
      expect(calls.map((call) => `${call.method} ${call.path}`)).toEqual([request]);
    } finally {
      await rm(directory, { recursive: true });
    }
  });

  it.each([
    ['whole courses', ['--course', 'course-1', '--course', 'course-2'], [{ level: 'course', courseId: 'course-1' }, { level: 'course', courseId: 'course-2' }]],
    ['a course without some modules', ['--course', 'course-1', '--exclude-module', 'module-2'], [{ level: 'course', courseId: 'course-1', excludedModuleIds: ['module-2'] }]],
    ['modules and lessons of one course', ['--course', 'course-1', '--module', 'module-1', '--lesson', 'lesson-1', '--lesson', 'lesson-2'], [
      { level: 'modules', courseId: 'course-1', moduleIds: ['module-1'] },
      { level: 'lessons', courseId: 'course-1', lessonIds: ['lesson-1', 'lesson-2'] },
    ]],
    ['a list in another shape', ['--access-items', '[{"level":"course","courseId":"course-1"},{"level":"modules","courseId":"course-2","moduleIds":["module-9"]}]'], [
      { level: 'course', courseId: 'course-1' }, { level: 'modules', courseId: 'course-2', moduleIds: ['module-9'] },
    ]],
    ['nothing', ['--clear'], []],
  ])('states the whole new access list of %s in one request', async (_label, flags, accessItems) => {
    await run('shop', 'products', 'access', 'product-1', ...flags);
    expect(calls).toMatchObject([{ method: 'POST', path: '/api/m2m/shop/products/access', body: { id: 'product-1', accessItems } }]);
  });

  it.each([
    ['no list', []],
    ['--clear with a course', ['--clear', '--course', 'course-1']],
    ['a module without a course', ['--module', 'module-1']],
    ['modules of two courses', ['--course', 'course-1', '--course', 'course-2', '--module', 'module-1']],
    ['an excluded module beside a lesson', ['--course', 'course-1', '--exclude-module', 'module-1', '--lesson', 'lesson-1']],
    ['a JSON list beside a flag', ['--access-items', '[]', '--course', 'course-1']],
    ['a JSON item of an unknown level', ['--access-items', '[{"level":"chapter","courseId":"course-1"}]']],
  ])('refuses %s before any request', async (_label, flags) => {
    await run('shop', 'products', 'access', 'product-1', ...flags);
    expect(soleJson()).toMatchObject({ ok: false, error: { code: 'validation' } });
    expect(calls).toEqual([]);
  });

  it('prints the receipt of a proposed sales-link deletion without sending a body', async () => {
    await run('shop', 'sales-links', 'delete', 'link-1');
    expect(soleJson()).toEqual({ ok: true, data: { outcome: 'proposed', proposal: receipt } });
    expect(calls).toMatchObject([{ method: 'DELETE', path: '/api/m2m/shop/sales-links/link-1', body: null }]);
    expect(process.exitCode ?? 0).toBe(0);
  });

  it('prints a readable receipt without --json', async () => {
    process.argv = ['node', 'together', 'shop', 'stock', 'adjust', 'product-1', '--delta', '5', '--reason', 'delivery'];
    vi.resetModules();
    await import('./main.js');
    expect(logSpy).toHaveBeenCalledWith([
      'proposed, waiting for the owner\'s decision:',
      'proposal proposal-1: stock.adjust [pending]',
      'target: product product-1',
      'created: 2026-11-15T10:00:00.000Z',
      'expires: 2026-12-15T10:00:00.000Z',
    ].join('\n'));
    expect(process.exitCode ?? 0).toBe(0);
  });

  it('lists, shows and withdraws the key\'s own proposals with the env key', async () => {
    await run('shop', 'proposals', 'list', '--status', 'pending', '--limit', '5');
    await run('shop', 'proposals', 'show', 'proposal-1');
    await run('shop', 'proposals', 'withdraw', 'proposal-1');
    expect(calls.map((call) => `${call.method} ${call.path}${call.search}`)).toEqual([
      'GET /api/m2m/shop/proposals?status=pending&limit=5',
      'GET /api/m2m/shop/proposals/proposal-1',
      'POST /api/m2m/shop/proposals/proposal-1/withdraw',
    ]);
    for (const call of calls) {
      expect(call.headers.get('x-api-key')).toBe('shop-secret-from-env');
      expect(call.headers.has('authorization')).toBe(false);
    }
    expect(JSON.parse(String(logSpy.mock.calls[2]?.[0]))).toMatchObject({ ok: true, data: { proposal: { status: 'withdrawn' } } });
  });

  it('shows the resource an applied proposal created, so the key can name it in a follow-up proposal', async () => {
    const applied = {
      ...receipt, status: 'applied', operation: 'price.create', input: { productId: 'product-1', kind: 'one_time', amountCents: 4900 },
      appliedResourceId: 'price-9',
    };
    h.fetchImpl = async () => Response.json({ ok: true, data: { proposal: applied } });
    process.argv = ['node', 'together', 'shop', 'proposals', 'show', 'proposal-1'];
    vi.resetModules();
    await import('./main.js');
    expect(logSpy).toHaveBeenCalledWith([
      'proposal proposal-1: price.create [applied]',
      'target: product product-1',
      'created: 2026-11-15T10:00:00.000Z',
      'expires: 2026-12-15T10:00:00.000Z',
      'applied: price price-9',
    ].join('\n'));
  });

  it('refuses an unknown proposal status before any request', async () => {
    await run('shop', 'proposals', 'list', '--status', 'approved');
    expect(soleJson()).toMatchObject({ ok: false, error: { code: 'validation' } });
    expect(calls).toEqual([]);
  });

  it('prints the proposal group column and filters the list by group', async () => {
    h.fetchImpl = async (input, init) => {
      await proposalFetch(input, init);
      return Response.json({ ok: true, data: { proposals: [{ ...receipt, groupId: 'group-1' }], nextCursor: null } });
    };
    process.argv = ['node', 'together', 'shop', 'proposals', 'list', '--group', 'group-1'];
    vi.resetModules();
    await import('./main.js');
    expect(calls.map((call) => `${call.method} ${call.path}${call.search}`)).toEqual(['GET /api/m2m/shop/proposals?groupId=group-1']);
    expect(logSpy).toHaveBeenCalledWith('2026-11-15T10:00:00.000Z\tpending\tstock.adjust\tproduct:product-1\tgroup:group-1\t(proposal-1)');
  });
});

const groupReceipt = (items: unknown[]) => ({
  id: 'group-1', title: 'Spring launch', status: 'open', createdAt: '2026-11-15T10:00:00.000Z', expiresAt: '2026-12-15T10:00:00.000Z', items,
});

const groupFetch: typeof fetch = async (input, init) => {
  const url = new URL(typeof input === 'string' ? input : input instanceof URL ? input.href : input.url);
  const method = init?.method ?? 'GET';
  calls.push({ method, path: url.pathname, search: url.search, headers: new Headers(init?.headers), body: typeof init?.body === 'string' ? JSON.parse(init.body) : init?.body ?? null });
  if (url.pathname.startsWith('/api/m2m/shop/proposals/groups')) {
    const items = url.pathname === '/api/m2m/shop/proposals/groups' ? [] : [receipt];
    return Response.json({ ok: true, data: { group: { ...groupReceipt(items), status: url.pathname.endsWith('/withdraw') ? 'withdrawn' : 'open' } } }, { status: method === 'POST' && items.length === 0 ? 201 : 200 });
  }
  const proposal = { ...receipt, groupId: 'group-1' };
  return Response.json({ ok: true, data: { outcome: 'proposed', proposal, group: groupReceipt([proposal]) } }, { status: 202 });
};

describe('shop key CLI with a proposal group', () => {
  beforeEach(() => { h.fetchImpl = groupFetch; });

  it('creates, shows and withdraws a group of the key', async () => {
    await run('shop', 'proposals', 'group', 'create', '--title', 'Spring launch');
    await run('shop', 'proposals', 'group', 'show', 'group-1');
    await run('shop', 'proposals', 'group', 'withdraw', 'group-1');
    expect(calls.map((call) => `${call.method} ${call.path}`)).toEqual([
      'POST /api/m2m/shop/proposals/groups',
      'GET /api/m2m/shop/proposals/groups/group-1',
      'POST /api/m2m/shop/proposals/groups/group-1/withdraw',
    ]);
    expect(calls[0]?.body).toEqual({ title: 'Spring launch' });
    for (const call of calls) expect(call.headers.get('x-api-key')).toBe('shop-secret-from-env');
    expect(JSON.parse(String(logSpy.mock.calls[2]?.[0]))).toMatchObject({ ok: true, data: { group: { status: 'withdrawn' } } });
  });

  it('refuses an empty group title before any request', async () => {
    await run('shop', 'proposals', 'group', 'create', '--title', '   ');
    expect(soleJson()).toMatchObject({ ok: false, error: { code: 'validation' } });
    expect(calls).toEqual([]);
  });

  it.each([
    [['shop', 'products', 'create', '--title', 'Printed handbook', '--price', '49']],
    [['shop', 'products', 'update', 'product-1', '--title', 'Renamed']],
    [['shop', 'products', 'publish', 'product-1']],
    [['shop', 'products', 'unpublish', 'product-1']],
    [['shop', 'products', 'delete', 'product-1', '--confirm']],
    [['shop', 'prices', 'add', '--product', 'product-1', '--kind', 'one_time', '--price-cents', '4900']],
    [['shop', 'prices', 'deactivate', 'price-1']],
    [['shop', 'stock', 'enable', 'product-1', '--on-hand', '3']],
    [['shop', 'stock', 'adjust', 'product-1', '--delta', '5', '--reason', 'delivery']],
    [['shop', 'stock', 'threshold', 'product-1', '--value', '2']],
    [['shop', 'sales-links', 'delete', 'link-1']],
    [['shop', 'products', 'access', '$proposal:proposal-1', '--course', 'course-1']],
  ])('sends the group header once for %j with --group', async (args) => {
    await run(...args, '--group', 'group-1');
    expect(soleJson()).toMatchObject({ ok: true, data: { outcome: 'proposed', proposal: { groupId: 'group-1' }, group: { id: 'group-1' } } });
    expect(calls).toHaveLength(1);
    expect(calls[0]?.headers.get('x-proposal-group')).toBe('group-1');
  });

  it.each([
    ['settings', ['shop', 'settings', 'set'], { name: 'Proposed shop' }],
    ['sales-link create', ['shop', 'sales-links', 'create'], { ...salesLinkFields, productIds: ['$proposal:proposal-1'] }],
    ['sales-link update', ['shop', 'sales-links', 'update', 'link-1'], { ...salesLinkFields, expectedRevision: 1 }],
  ])('sends the group header for the %s write with --group', async (_label, args, fields) => {
    const directory = await mkdtemp(join(tmpdir(), 'shop-group-cli-'));
    try {
      const file = join(directory, 'input.json');
      await writeFile(file, JSON.stringify(fields));
      await run(...args, '--json-file', file, '--group', 'group-1');
      expect(calls).toHaveLength(1);
      expect(calls[0]?.headers.get('x-proposal-group')).toBe('group-1');
      expect(calls[0]?.body).toMatchObject(fields);
    } finally {
      await rm(directory, { recursive: true });
    }
  });

  it('passes a proposal reference in an id argument through unchanged', async () => {
    await run('shop', 'prices', 'add', '--product', '$proposal:proposal-1', '--kind', 'one_time', '--price-cents', '4900', '--group', 'group-1');
    expect(calls[0]?.body).toMatchObject({ productId: '$proposal:proposal-1' });
    await run('shop', 'products', 'publish', '$proposal:proposal-1', '--group', 'group-1');
    expect(calls[1]?.body).toEqual({ id: '$proposal:proposal-1' });
  });

  it('sends no group header without --group', async () => {
    await run('shop', 'products', 'publish', 'product-1');
    expect(calls[0]?.headers.has('x-proposal-group')).toBe(false);
  });

  it('refuses a malformed group id before any request', async () => {
    await run('shop', 'products', 'publish', 'product-1', '--group', 'not a group');
    expect(soleJson()).toMatchObject({ ok: false, error: { code: 'validation' } });
    expect(calls).toEqual([]);
  });

  it('prints the group of a grouped proposal without --json, and its reference only when the item creates something', async () => {
    process.argv = ['node', 'together', 'shop', 'products', 'publish', 'product-1', '--group', 'group-1'];
    vi.resetModules();
    await import('./main.js');
    const printed = String(logSpy.mock.calls[0]?.[0]);
    expect(printed).toContain('group: Spring launch (group-1), item 1');
    expect(printed).not.toContain('$proposal:');

    logSpy.mockClear();
    const created = { ...receipt, groupId: 'group-1', operation: 'product.create', target: { kind: 'product', id: null } };
    h.fetchImpl = async (input, init) => {
      await groupFetch(input, init);
      return Response.json({ ok: true, data: { outcome: 'proposed', proposal: created, group: groupReceipt([created]) } }, { status: 202 });
    };
    process.argv = ['node', 'together', 'shop', 'products', 'create', '--title', 'Printed handbook', '--price', '49', '--group', 'group-1'];
    vi.resetModules();
    await import('./main.js');
    expect(String(logSpy.mock.calls[0]?.[0])).toContain('refer to what this item creates as $proposal:proposal-1');
  });

  it('shows a reference in the group listing only next to the items that create something', async () => {
    const items = [
      { ...receipt, id: 'proposal-1', groupId: 'group-1', operation: 'product.create', target: { kind: 'product', id: null } },
      { ...receipt, id: 'proposal-2', groupId: 'group-1', operation: 'price.create' },
      { ...receipt, id: 'proposal-3', groupId: 'group-1', operation: 'sales-link.create', target: { kind: 'sales-link', id: null } },
      { ...receipt, id: 'proposal-4', groupId: 'group-1', operation: 'stock.adjust' },
      { ...receipt, id: 'proposal-5', groupId: 'group-1', operation: 'product.publish' },
    ];
    h.fetchImpl = async () => Response.json({ ok: true, data: { group: groupReceipt(items) } });
    process.argv = ['node', 'together', 'shop', 'proposals', 'group', 'show', 'group-1'];
    vi.resetModules();
    await import('./main.js');
    const lines = String(logSpy.mock.calls[0]?.[0]).split('\n').filter((line) => line.startsWith('  '));
    expect(lines.map((line) => line.includes('refer to what it creates as $proposal:'))).toEqual([true, true, true, false, false]);
    expect(lines[0]).toContain('$proposal:proposal-1');
  });
});

const QUARANTINED_DIGEST = 'b'.repeat(64);

const quarantineFetch: typeof fetch = async (input, init) => {
  const url = new URL(typeof input === 'string' ? input : input instanceof URL ? input.href : input.url);
  const method = init?.method ?? 'GET';
  calls.push({ method, path: url.pathname, search: url.search, headers: new Headers(init?.headers), body: typeof init?.body === 'string' ? JSON.parse(init.body) : init?.body ?? null });
  if (url.hostname === 'storage.example.test') return new Response(null, { status: 200 });
  const kind = url.pathname.includes('/branding/') || url.pathname === '/api/m2m/shop/settings' ? 'logo' : 'product-cover';
  if (url.pathname.endsWith('/upload')) {
    return Response.json({ ok: true, data: { key: `image-asset-candidates/acme/${kind}/1.png`, servePath: null, quarantined: true, upload: { url: 'https://storage.example.test/candidate?signature=1', headers: { 'content-type': 'image/png' }, expiresAt: '2026-11-15T10:15:00.000Z' } } });
  }
  if (url.pathname.endsWith('/complete')) return Response.json({ ok: true, data: { url: `/api/public/assets/${kind}/${QUARANTINED_DIGEST}.png`, quarantined: true } });
  if (url.pathname.endsWith('/prices')) return Response.json({ ok: true, data: { prices: [price] } });
  const header = new Headers(init?.headers).get('x-proposal-group');
  const proposal = { ...receipt, operation: kind === 'logo' ? 'settings.update' : 'product.update', groupId: header };
  return Response.json({ ok: true, data: { outcome: 'proposed', proposal, ...(header === null ? {} : { group: groupReceipt([proposal]) }) } }, { status: 202 });
};

describe('shop image CLI with a propose-mode key', () => {
  let directory: string;
  let file: string;
  beforeEach(async () => {
    h.fetchImpl = quarantineFetch;
    directory = await mkdtemp(join(tmpdir(), 'shop-quarantine-cli-'));
    file = join(directory, 'image.png');
    await writeFile(file, new Uint8Array([137, 80, 78, 71]));
  });
  afterEach(async () => { await rm(directory, { recursive: true }); });

  const coverPath = `/api/public/assets/product-cover/${QUARANTINED_DIGEST}.png`;
  const logoPath = `/api/public/assets/logo/${QUARANTINED_DIGEST}.png`;

  it('uploads a cover into quarantine and proposes attaching it, in the group named by --group', async () => {
    await run('shop', 'cover', 'upload', 'product-1', file, '--group', 'group-1');
    expect(soleJson()).toMatchObject({
      ok: true,
      data: { outcome: 'proposed', proposal: { operation: 'product.update', groupId: 'group-1' }, image: { url: coverPath, quarantined: true } },
    });
    expect(calls.map((call) => `${call.method} ${call.path}`)).toEqual([
      'GET /api/m2m/shop/products/product-1/prices',
      'POST /api/m2m/shop/image-assets/product-cover/upload', 'PUT /candidate',
      'POST /api/m2m/shop/image-assets/product-cover/complete', 'POST /api/m2m/shop/products/update',
    ]);
    expect(calls[4]?.body).toEqual({ id: 'product-1', coverUrl: coverPath });
    expect(calls[4]?.headers.get('x-proposal-group')).toBe('group-1');
    for (const call of calls.slice(0, 4)) expect(call.headers.has('x-proposal-group')).toBe(false);
  });

  it('skips the product check for a product an earlier item of the group creates', async () => {
    await run('shop', 'cover', 'upload', '$proposal:proposal-1', file, '--group', 'group-1');
    expect(calls.map((call) => call.path)).not.toContain('/api/m2m/shop/products/$proposal:proposal-1/prices');
    expect(calls.at(-1)?.body).toEqual({ id: '$proposal:proposal-1', coverUrl: coverPath });
  });

  it('checks a $proposal: reference like any product id when no group is given, before anything is uploaded', async () => {
    h.fetchImpl = async (input, init) => {
      const url = new URL(typeof input === 'string' ? input : input instanceof URL ? input.href : input.url);
      if (url.pathname.endsWith('/prices')) {
        calls.push({ method: init?.method ?? 'GET', path: url.pathname, search: url.search, headers: new Headers(init?.headers), body: null });
        return Response.json({ ok: false, error: { code: 'not_found', message: 'Product not found' } }, { status: 404 });
      }
      return quarantineFetch(input, init);
    };
    await run('shop', 'cover', 'upload', '$proposal:proposal-1', file);
    expect(soleJson()).toMatchObject({ ok: false, error: { code: 'not_found' } });
    expect(calls).toHaveLength(1);
    expect(calls[0]?.path.endsWith('/prices')).toBe(true);
  });

  it('prints the receipt and that the image stays private until approval without --json', async () => {
    process.argv = ['node', 'together', 'shop', 'cover', 'upload', 'product-1', file];
    vi.resetModules();
    await import('./main.js');
    const printed = String(logSpy.mock.calls[0]?.[0]);
    expect(printed).toContain('proposed, waiting for the owner\'s decision:');
    expect(printed).toContain('proposal proposal-1: product.update [pending]');
    expect(printed).toContain(`image: ${coverPath} (private until the owner approves this proposal; published at this address on approval)`);
  });

  it('prints a quarantined branding image with the settings command that proposes it', async () => {
    process.argv = ['node', 'together', 'shop', 'branding', 'upload', 'logo', file];
    vi.resetModules();
    await import('./main.js');
    expect(logSpy).toHaveBeenCalledWith([
      logoPath,
      `quarantined: private until the owner approves a proposal that sets it; propose it with --attach on this command, or with: echo '{"logoUrl":"${logoPath}"}' | together shop settings set --json-file -`,
    ].join('\n'));
    expect(calls.map((call) => `${call.method} ${call.path}`)).not.toContain('POST /api/m2m/shop/settings');
  });

  it('proposes the settings change for the uploaded branding image with --attach', async () => {
    await run('shop', 'branding', 'upload', 'logo', file, '--attach', '--group', 'group-1');
    expect(soleJson()).toMatchObject({
      ok: true,
      data: { outcome: 'proposed', proposal: { operation: 'settings.update', groupId: 'group-1' }, image: { url: logoPath, quarantined: true } },
    });
    expect(calls.at(-1)).toMatchObject({ method: 'POST', path: '/api/m2m/shop/settings', body: { logoUrl: logoPath } });
    expect(calls.at(-1)?.headers.get('x-proposal-group')).toBe('group-1');
  });
});

const stagedFile = {
  id: 'staged-1', fileName: 'workbook.pdf', contentType: 'application/pdf', sizeBytes: 9, sha256: 'b'.repeat(64), copiedFrom: null,
  createdAt: '2026-11-15T10:00:00.000Z', expiresAt: '2026-11-22T10:00:00.000Z',
};
const stagedCopy = { ...stagedFile, id: 'staged-2', sha256: null, copiedFrom: { productId: 'product-1', assetId: 'asset-1', versionNumber: 2 } };
const downloadAsset = {
  id: 'staged-1', lineageId: 'staged-1', versionNumber: 1, versionNote: null, supersededAt: null, productId: 'product-1', fileName: 'workbook.pdf',
  contentType: 'application/pdf', sizeBytes: 9, status: 'ready', createdAt: '2026-11-15T10:00:00.000Z', personalisationSizeExceeded: false,
};
const fileReceipt = (operation: string, groupId: string | null) => ({
  ...receipt, operation, groupId, target: { kind: 'product', id: 'product-1' }, input: { productId: 'product-1', stagedFileId: 'staged-1' },
});

const fileAnswer = (method: string, path: string): unknown => {
  if (path === '/api/m2m/shop/downloads/upload') {
    return { upload: { id: 'upload-1', url: 'https://storage.example.test/candidate?signature=1', headers: { 'content-type': 'application/pdf', 'content-length': '9' }, expiresAt: '2026-11-15T10:15:00.000Z' } };
  }
  if (path === '/api/m2m/shop/downloads/complete') return { file: stagedFile };
  if (path === '/api/m2m/shop/downloads/copy') return { file: stagedCopy };
  if (path === '/api/m2m/shop/downloads/staged') return { files: [stagedFile, stagedCopy] };
  if (path.startsWith('/api/m2m/shop/downloads/staged/')) return { discarded: true };
  if (method === 'GET') {
    return {
      assets: [
        downloadAsset,
        { ...downloadAsset, id: 'asset-0', supersededAt: '2026-11-15T11:00:00.000Z' },
        { ...downloadAsset, id: 'asset-1', lineageId: 'asset-1' },
        { ...downloadAsset, id: 'asset-pending', lineageId: 'asset-pending', status: 'pending' },
      ],
      personalisationMaxBytes: 52428800,
    };
  }
  if (path.endsWith('/remove')) return { deleted: true };
  return { asset: path.endsWith('/replace') ? { ...downloadAsset, versionNumber: 2 } : downloadAsset };
};

const fileFetch: typeof fetch = async (input, init) => {
  const url = new URL(typeof input === 'string' ? input : input instanceof URL ? input.href : input.url);
  const method = init?.method ?? 'GET';
  if (!url.pathname.startsWith('/api/m2m/shop/downloads') && !url.pathname.includes('/downloads')) return fetchImpl(input, init);
  calls.push({ method, path: url.pathname, search: url.search, headers: new Headers(init?.headers), body: typeof init?.body === 'string' ? JSON.parse(init.body) : init?.body ?? null });
  return Response.json({ ok: true, data: fileAnswer(method, url.pathname) });
};

const withPdf = async (test: (file: string) => Promise<void>): Promise<void> => {
  const directory = await mkdtemp(join(tmpdir(), 'shop-files-cli-'));
  try {
    const file = join(directory, 'workbook.pdf');
    await writeFile(file, '%PDF-1.7\n');
    await test(file);
  } finally {
    await rm(directory, { recursive: true });
  }
};

const printedErrorMessage = (printed: unknown): string => {
  const error: unknown = typeof printed === 'object' && printed !== null ? Reflect.get(printed, 'error') : undefined;
  const message: unknown = typeof error === 'object' && error !== null ? Reflect.get(error, 'message') : undefined;
  return typeof message === 'string' ? message : '';
};

const failingAt = (path: string, status: number, error: Record<string, unknown>): typeof fetch => async (input, init) => {
  const url = new URL(typeof input === 'string' ? input : input instanceof URL ? input.href : input.url);
  if (url.pathname !== path) return fileFetch(input, init);
  calls.push({ method: init?.method ?? 'GET', path: url.pathname, search: '', headers: new Headers(init?.headers), body: typeof init?.body === 'string' ? JSON.parse(init.body) : null });
  return Response.json({ ok: false, error }, { status });
};

describe('shop files CLI', () => {
  beforeEach(() => { h.fetchImpl = fileFetch; });

  it('checks the product, stages the file with a streamed PUT that carries no key, completes it and attaches it with the note', async () => {
    await withPdf(async (file) => {
      await run('shop', 'files', 'upload', 'product-1', file, '--note', 'First edition');
      expect(soleJson()).toEqual({ ok: true, data: { outcome: 'applied', asset: downloadAsset, staged: stagedFile } });
      expect(calls.map((call) => `${call.method} ${call.path}`)).toEqual([
        'GET /api/m2m/shop/products/product-1/downloads',
        'POST /api/m2m/shop/downloads/upload', 'PUT /candidate', 'POST /api/m2m/shop/downloads/complete',
        'POST /api/m2m/shop/products/downloads',
      ]);
      expect(calls[1]?.body).toEqual({ fileName: 'workbook.pdf', contentType: 'application/pdf', sizeBytes: 9 });
      expect(calls[2]?.body).toBeInstanceOf(Blob);
      expect(calls[2]?.headers.get('content-length')).toBe('9');
      for (const header of ['x-api-key', 'x-tenant', 'authorization']) expect(calls[2]?.headers.has(header)).toBe(false);
      expect(calls[3]?.body).toEqual({ uploadId: 'upload-1' });
      expect(calls[4]?.body).toEqual({ productId: 'product-1', stagedFileId: 'staged-1', versionNote: 'First edition' });
      for (const call of calls.filter((entry) => entry.path.startsWith('/api/'))) expect(call.headers.get('x-api-key')).toBe('shop-secret-from-env');
    });
  });

  it('attaches the upload as the next version of the file named by --replaces', async () => {
    await withPdf(async (file) => {
      await run('shop', 'files', 'upload', 'product-1', file, '--replaces', 'asset-1');
      expect(soleJson()).toMatchObject({ ok: true, data: { asset: { versionNumber: 2 } } });
      expect(calls.at(-1)).toMatchObject({ method: 'POST', path: '/api/m2m/shop/products/downloads/replace', body: { productId: 'product-1', replacesAssetId: 'asset-1', stagedFileId: 'staged-1' } });
    });
  });

  it('uploads nothing when the product is not in the workspace or the file type is not allowed', async () => {
    await withPdf(async (file) => {
      h.fetchImpl = failingAt('/api/m2m/shop/products/missing-product/downloads', 404, { code: 'not_found', message: 'No product "missing-product" in this tenant' });
      await run('shop', 'files', 'upload', 'missing-product', file);
      expect(soleJson()).toMatchObject({ ok: false, error: { code: 'not_found' } });
      expect(process.exitCode).toBe(EXIT_CODE_BY_ERROR_CODE.not_found);
      expect(calls.map((call) => call.path)).toEqual(['/api/m2m/shop/products/missing-product/downloads']);
    });
    logSpy.mockClear();
    calls = [];
    await run('shop', 'files', 'upload', 'product-1', 'notes.txt');
    expect(soleJson()).toMatchObject({ ok: false, error: { code: 'validation' } });
    expect(calls).toEqual([]);
  });

  it.each([
    [['--replaces', 'asset-unknown'], 'not_found', 'Replacement file "asset-unknown" not found on this product; nothing was uploaded', ['/api/m2m/shop/products/product-1/downloads']],
    [['--replaces', 'asset-pending'], 'validation', 'Only ready files can be replaced; "asset-pending" is pending and nothing was uploaded', ['/api/m2m/shop/products/product-1/downloads']],
    [['--note', 'n'.repeat(501)], 'validation', '', []],
  ])('refuses %j before anything is uploaded', async (options, code, message, paths) => {
    await withPdf(async (file) => {
      await run('shop', 'files', 'upload', 'product-1', file, ...options);
      const printed = soleJson();
      expect(printed).toMatchObject({ ok: false, error: { code } });
      if (message !== '') expect(printedErrorMessage(printed)).toBe(message);
      expect(calls.map((call) => call.path)).toEqual(paths);
      expect(calls.filter((call) => call.method === 'PUT')).toEqual([]);
    });
  });

  it('sends a trimmed note of up to 500 characters', async () => {
    await withPdf(async (file) => {
      await run('shop', 'files', 'upload', 'product-1', file, '--note', ` ${'n'.repeat(500)} `);
      expect(soleJson()).toMatchObject({ ok: true });
      expect(calls.at(-1)?.body).toEqual({ productId: 'product-1', stagedFileId: 'staged-1', versionNote: 'n'.repeat(500) });
    });
  });

  it('explains a staging cap and never attaches a file that was not staged', async () => {
    await withPdf(async (file) => {
      h.fetchImpl = failingAt('/api/m2m/shop/downloads/upload', 409, {
        code: 'conflict', message: 'This key already holds 20 staged or uploading files', details: { changeProposalCap: 'key_staged_files' },
      });
      await run('shop', 'files', 'upload', 'product-1', file);
      const printed = soleJson();
      expect(printed).toMatchObject({ ok: false, error: { code: 'conflict' } });
      expect(printedErrorMessage(printed)).toContain('This key already holds 20 staged or uploading files');
      expect(printedErrorMessage(printed)).toContain('together shop files discard <id>');
      expect(calls.map((call) => call.path)).toEqual(['/api/m2m/shop/products/product-1/downloads', '/api/m2m/shop/downloads/upload']);
    });
  });

  it('names the staged file and how to check its state when the attach is refused, without claiming it is still staged', async () => {
    await withPdf(async (file) => {
      h.fetchImpl = failingAt('/api/m2m/shop/products/downloads', 409, {
        code: 'conflict', message: 'This product already has 100 files', details: { changeProposalCap: 'product_files' },
      });
      await run('shop', 'files', 'upload', 'product-1', file);
      const message = printedErrorMessage(soleJson());
      expect(message).toContain('remove a file of the product first');
      expect(message).not.toContain('stays staged');
      expect(message).toContain('staged-1');
      expect(message).toContain('together shop files list product-1');
      expect(message).toContain('together shop files staged');
      expect(message).toContain('together shop proposals list');
      expect(message).toContain('the sweep may remove it from 7 days after it was staged');
    });
  });

  it('does not claim the file is still staged when the server answers that the staged file is gone', async () => {
    await withPdf(async (file) => {
      h.fetchImpl = failingAt('/api/m2m/shop/products/downloads', 404, { code: 'not_found', message: 'The staged file does not exist' });
      await run('shop', 'files', 'upload', 'product-1', file);
      const message = printedErrorMessage(soleJson());
      expect(message).not.toContain('stays staged');
      expect(message).not.toContain('until it is discarded');
      expect(message).toContain('together shop files staged');
    });
  });

  it('does not claim the file is still staged when the attach answer was lost after the server may have attached it', async () => {
    await withPdf(async (file) => {
      h.fetchImpl = async (input, init) => {
        const url = new URL(typeof input === 'string' ? input : input instanceof URL ? input.href : input.url);
        if (url.pathname !== '/api/m2m/shop/products/downloads') return fileFetch(input, init);
        calls.push({ method: init?.method ?? 'GET', path: url.pathname, search: '', headers: new Headers(init?.headers), body: null });
        throw new TypeError('socket hang up');
      };
      await run('shop', 'files', 'upload', 'product-1', file);
      const message = printedErrorMessage(soleJson());
      expect(message).not.toContain('stays staged');
      expect(message).toContain('staged-1');
      expect(message).toContain('together shop files list product-1');
      expect(message).toContain('together shop files staged');
    });
  });

  it('says that a file a pending proposal holds is not deleted after its 7 days', async () => {
    await withPdf(async (file) => {
      h.fetchImpl = failingAt('/api/m2m/shop/downloads/upload', 409, {
        code: 'conflict', message: 'The workspace staging budget is full', details: { changeProposalCap: 'workspace_staged_bytes' },
      });
      await run('shop', 'files', 'upload', 'product-1', file);
      expect(printedErrorMessage(soleJson())).toContain('a staged file that no pending proposal holds is deleted 7 days after it was staged');
    });
  });

  it('copies a file on the server after checking the target product and attaches the copy there', async () => {
    await run('shop', 'files', 'copy', 'product-1', 'asset-1', 'product-2');
    expect(soleJson()).toEqual({ ok: true, data: { outcome: 'applied', asset: downloadAsset, staged: stagedCopy } });
    expect(calls.map((call) => `${call.method} ${call.path}`)).toEqual([
      'GET /api/m2m/shop/products/product-2/downloads', 'POST /api/m2m/shop/downloads/copy', 'POST /api/m2m/shop/products/downloads',
    ]);
    expect(calls[1]?.body).toEqual({ productId: 'product-1', assetId: 'asset-1' });
    expect(calls[2]?.body).toEqual({ productId: 'product-2', stagedFileId: 'staged-2' });
  });

  it.each([
    [['list', 'product-1'], 'GET /api/m2m/shop/products/product-1/downloads'],
    [['remove', 'product-1', 'asset-1'], 'POST /api/m2m/shop/products/downloads/remove'],
    [['staged'], 'GET /api/m2m/shop/downloads/staged'],
    [['discard', 'staged-1'], 'DELETE /api/m2m/shop/downloads/staged/staged-1'],
  ])('sends shop files %j as one keyed request', async (args, request) => {
    await run('shop', 'files', ...args);
    expect(soleJson()).toMatchObject({ ok: true });
    expect(calls.map((call) => `${call.method} ${call.path}`)).toEqual([request]);
  });

  it('prints the source of a staged copy and never a fingerprint for it without --json', async () => {
    process.argv = ['node', 'together', 'shop', 'files', 'staged'];
    vi.resetModules();
    await import('./main.js');
    const printed = String(logSpy.mock.calls[0]?.[0]);
    expect(printed.split('\n')).toEqual([
      `- workbook.pdf  application/pdf  9 bytes  sha256 ${'b'.repeat(64)}  expires 2026-11-22T10:00:00.000Z  (staged-1)`,
      '- workbook.pdf  application/pdf  9 bytes  copy of file asset-1 version 2 of product product-1  expires 2026-11-22T10:00:00.000Z  (staged-2)',
    ]);
  });
});

const proposingFileFetch: typeof fetch = async (input, init) => {
  const url = new URL(typeof input === 'string' ? input : input instanceof URL ? input.href : input.url);
  const method = init?.method ?? 'GET';
  const operation = url.pathname === '/api/m2m/shop/products/downloads' ? 'download.add'
    : url.pathname === '/api/m2m/shop/products/downloads/replace' ? 'download.replace'
      : url.pathname === '/api/m2m/shop/products/downloads/remove' ? 'download.remove' : null;
  if (operation === null || method !== 'POST') return fileFetch(input, init);
  const headers = new Headers(init?.headers);
  calls.push({ method, path: url.pathname, search: url.search, headers, body: typeof init?.body === 'string' ? JSON.parse(init.body) : null });
  const group = headers.get('x-proposal-group');
  const proposal = fileReceipt(operation, group);
  return Response.json({ ok: true, data: { outcome: 'proposed', proposal, ...(group === null ? {} : { group: groupReceipt([proposal]) }) } }, { status: 202 });
};

describe('shop files CLI with a propose-mode key', () => {
  beforeEach(() => { h.fetchImpl = proposingFileFetch; });

  it('stages the file, proposes the attachment in the group without checking a product an earlier item creates, and says the file stays private', async () => {
    await withPdf(async (file) => {
      process.argv = ['node', 'together', 'shop', 'files', 'upload', '$proposal:proposal-0', file, '--group', 'group-1'];
      vi.resetModules();
      await import('./main.js');
      const printed = String(logSpy.mock.calls[0]?.[0]);
      expect(printed).toContain('proposed, waiting for the owner\'s decision:');
      expect(printed).toContain('proposal proposal-1: download.add [pending]');
      expect(printed).toContain(`file: workbook.pdf  application/pdf  9 bytes  sha256 ${'b'.repeat(64)}  kept while the proposal is pending  (staged-1)`);
      expect(printed).not.toContain('expires 2026-11-22T10:00:00.000Z');
      expect(printed).toContain('the file stays private until the owner approves this proposal; nothing reaches buyers before that');
      expect(calls.map((call) => `${call.method} ${call.path}`)).toEqual([
        'POST /api/m2m/shop/downloads/upload', 'PUT /candidate', 'POST /api/m2m/shop/downloads/complete', 'POST /api/m2m/shop/products/downloads',
      ]);
      expect(calls.at(-1)?.body).toEqual({ productId: '$proposal:proposal-0', stagedFileId: 'staged-1' });
      expect(calls.at(-1)?.headers.get('x-proposal-group')).toBe('group-1');
      for (const call of calls.slice(0, 3)) expect(call.headers.has('x-proposal-group')).toBe(false);
    });
  });

  it('checks the product before a replacement and proposes it with the staged file', async () => {
    await withPdf(async (file) => {
      await run('shop', 'files', 'upload', 'product-1', file, '--replaces', 'asset-1');
      expect(soleJson()).toMatchObject({ ok: true, data: { outcome: 'proposed', proposal: { operation: 'download.replace' }, staged: stagedFile } });
      expect(calls.map((call) => call.path)[0]).toBe('/api/m2m/shop/products/product-1/downloads');
      expect(calls.at(-1)?.body).toEqual({ productId: 'product-1', replacesAssetId: 'asset-1', stagedFileId: 'staged-1' });
    });
  });

  it('proposes the attachment of a server-side copy and the removal of a file, each in the named group', async () => {
    await run('shop', 'files', 'copy', 'product-1', 'asset-1', 'product-2', '--group', 'group-1');
    expect(soleJson()).toMatchObject({ ok: true, data: { outcome: 'proposed', proposal: { operation: 'download.add', groupId: 'group-1' }, staged: stagedCopy } });
    expect(calls.at(-1)?.headers.get('x-proposal-group')).toBe('group-1');
    logSpy.mockClear();
    calls = [];
    process.argv = ['node', 'together', 'shop', 'files', 'copy', 'product-1', 'asset-1', 'product-2'];
    vi.resetModules();
    await import('./main.js');
    const printed = String(logSpy.mock.calls[0]?.[0]);
    expect(printed).toContain('file: workbook.pdf  application/pdf  9 bytes  copy of file asset-1 version 2 of product product-1  kept while the proposal is pending  (staged-2)');
    expect(printed).not.toContain('expires 2026-11-22T10:00:00.000Z');
    logSpy.mockClear();
    calls = [];
    await run('shop', 'files', 'remove', 'product-1', 'asset-1', '--group', 'group-1');
    expect(soleJson()).toMatchObject({ ok: true, data: { outcome: 'proposed', proposal: { operation: 'download.remove', groupId: 'group-1' } } });
    expect(calls.map((call) => `${call.method} ${call.path}`)).toEqual(['POST /api/m2m/shop/products/downloads/remove']);
    expect(calls[0]?.headers.get('x-proposal-group')).toBe('group-1');
  });

  it('refuses an invalid --group before any request', async () => {
    await withPdf(async (file) => {
      await run('shop', 'files', 'upload', 'product-1', file, '--group', 'not a group');
      expect(soleJson()).toMatchObject({ ok: false, error: { code: 'validation' } });
      expect(calls).toEqual([]);
    });
  });
});
