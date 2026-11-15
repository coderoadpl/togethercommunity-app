import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, beforeEach, describe, expect, it, vi, type MockInstance } from 'vitest';

import type * as ClientModule from '#core/client/index.js';
import type { ShopManagementClientOptions } from '#core/client/index.js';
import { EXIT_CODE_BY_ERROR_CODE } from '#core/contract/index.js';

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
const shipment = {
  shipxShipmentId: '1', status: 'confirmed', environment: 'production', trackingNumber: 'T1', createAttemptedAt: null, boughtAt: null,
  labelFetchedAt: null, createdAt: '2026-11-15T10:00:00.000Z', updatedAt: '2026-11-15T10:00:00.000Z',
};

const shopSettings = {
  name: 'Example Press', logoUrl: null, logoDarkUrl: null, faviconUrl: null, accentColor: null, accentLight: null, ogImageUrl: null,
  socialLinks: [], supportEmail: null, supportUrl: null, termsUrl: 'https://brand.example.test/terms', privacyUrl: null,
};

const salesLinkFields = { slug: 'handbook', title: 'Handbook', heading: 'Buy the handbook', productIds: ['product-1'] };
const salesLink = { ...salesLinkFields, id: 'link-1', tenantId: 'acme', revision: 1, createdAt: product.createdAt, updatedAt: product.createdAt };

const orderData = (pathname: string, method: string): unknown => {
  if (pathname === '/api/m2m/shop/orders') return { sources: [], orders: [order], total: 1, page: 1, pageSize: 20 };
  if (pathname.endsWith('/export') || pathname.endsWith('/packing-list')) return { filename: 'orders.csv', mimeType: 'text/csv; charset=utf-8', content: 'order_number\norder-1' };
  if (pathname.endsWith('/discard')) return { discarded: true };
  if (method === 'POST' && pathname.endsWith('/shipx')) return { order, shipment };
  if (pathname.includes('/shipx')) return { available: true, reason: null, service: 'inpost_locker_standard', parcelTemplate: 'medium', shipment };
  if (pathname === '/api/m2m/shop/orders/order-1') return { order, invoice: null };
  return { order };
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
  if (url.pathname.startsWith('/api/m2m/shop/sales-links')) {
    return Response.json({ ok: true, data: method === 'DELETE' ? { deleted: true }
      : method === 'GET' && url.pathname === '/api/m2m/shop/sales-links' ? { salesLinks: [salesLink] }
        : { salesLink } });
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

const run = async (...args: string[]): Promise<void> => {
  process.argv = ['node', 'together', '--json', ...args];
  vi.resetModules();
  await import('./main.js');
};

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
    [['shop', 'orders', 'shipx', 'show', 'order-1'], 'GET', '/api/m2m/shop/orders/order-1/shipx', '', null],
    [['shop', 'orders', 'shipx', 'create', 'order-1'], 'POST', '/api/m2m/shop/orders/order-1/shipx', '', {}],
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
    expect(soleJson()).toEqual({ ok: true, data: { url: '/api/public/assets/logo/1.png' } });
    expect(calls.map((call) => `${call.method} ${call.path}`)).toEqual([
      'POST /api/m2m/shop/image-assets/branding/upload',
      'PUT /candidate',
      'POST /api/m2m/shop/image-assets/branding/complete',
    ]);
    expect(calls[0]?.body).toEqual({ kind: 'logo', fileName: 'logo.png', contentType: 'image/png', sizeBytes: 4 });
    expect(calls[1]?.headers.has('x-api-key')).toBe(false);
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

describe('shop cover and sales-links CLI', () => {
  it('uploads, PUTs, completes and attaches a cover using the environment key only on API calls', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'shop-cover-cli-'));
    try {
      const file = join(directory, 'cover.png');
      await writeFile(file, new Uint8Array([137, 80, 78, 71]));
      await run('shop', 'cover', 'upload', 'product-1', file);
      expect(soleJson()).toMatchObject({ ok: true, data: { product: { id: 'product-1' } } });
      expect(calls.map((call) => `${call.method} ${call.path}`)).toEqual([
        'POST /api/m2m/shop/image-assets/product-cover/upload', 'PUT /candidate',
        'POST /api/m2m/shop/image-assets/product-cover/complete', 'POST /api/m2m/shop/products/update',
      ]);
      expect(calls[0]?.body).toEqual({ kind: 'product-cover', fileName: 'cover.png', contentType: 'image/png', sizeBytes: 4 });
      expect(calls[1]?.headers.has('x-api-key')).toBe(false);
      expect(calls[1]?.headers.has('authorization')).toBe(false);
      expect(calls[1]?.headers.get('content-type')).toBe('image/png');
      expect(calls[3]?.body).toEqual({ id: 'product-1', coverUrl: '/api/public/assets/product-cover/1.png' });
      for (const call of calls.filter((call) => call.path.startsWith('/api/'))) {
        expect(call.headers.get('x-api-key')).toBe('shop-secret-from-env');
        expect(call.headers.has('authorization')).toBe(false);
      }
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
      expect(calls.map((call) => call.path)).toEqual(['/api/m2m/shop/image-assets/product-cover/upload', '/candidate']);
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
