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

interface Call { method: string; path: string; headers: Headers; body: unknown }

let calls: Call[];
let logSpy: MockInstance<typeof console.log>;
let errorSpy: MockInstance<typeof console.error>;

const fetchImpl: typeof fetch = async (input, init) => {
  const url = new URL(typeof input === 'string' ? input : input instanceof URL ? input.href : input.url);
  const method = init?.method ?? 'GET';
  calls.push({ method, path: url.pathname, headers: new Headers(init?.headers), body: typeof init?.body === 'string' ? JSON.parse(init.body) : null });
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
