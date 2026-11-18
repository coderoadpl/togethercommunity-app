import { describe, expect, it, vi } from 'vitest';

import { SHOP_CATALOG_ROUTES } from '#core/contract/index.js';

import { createShopManagementClient } from './http.js';

const { createServer } = process.getBuiltinModule('node:http');

const listen = async (
  server: ReturnType<typeof createServer>,
): Promise<{ baseUrl: string; close: () => Promise<void> }> => {
  await new Promise<void>((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', () => {
      server.off('error', reject);
      resolve();
    });
  });
  const address = server.address();
  if (address === null || typeof address === 'string') throw new Error('Expected a TCP test server');
  return {
    baseUrl: `http://127.0.0.1:${String(address.port)}`,
    close: () => new Promise<void>((resolve, reject) => {
      server.close((error) => error === undefined ? resolve() : reject(error));
    }),
  };
};

const product = {
  id: 'product-1', tenantId: 'acme', type: 'physical', slug: 'printed-handbook', title: 'Printed handbook', description: '',
  coverUrl: null, priceCents: 4900, currency: 'PLN', published: false, visibility: 'listed', deliveryMethod: 'pickup',
  parcelTemplate: 'medium', compliance: null, variantGroup: null, variantLabel: null, accessItems: [], checkoutConsentDefinitionIds: [],
  vatRate: null, vatExemptionBasis: null, legacyId: null, createdAt: '2026-11-15T10:00:00.000Z',
};
const price = {
  id: 'price-1', tenantId: 'acme', productId: 'product-1', kind: 'one_time', interval: null, amountCents: 4900, currency: 'PLN',
  active: true, createdAt: '2026-11-15T10:00:00.000Z',
};
const stock = {
  productId: 'product-1', onHand: 3, reserved: 0, available: 3, lowStockThreshold: null, lowStockNotifiedAt: null,
  updatedAt: '2026-11-15T10:00:00.000Z', soldOut: false, low: false,
};

describe('shop management client', () => {
  it('sends every catalog call to its shop route with only the key and workspace headers', async () => {
    const seen: { method: string; url: string; headers: Headers; body: unknown }[] = [];
    const fetchImpl = vi.fn<typeof fetch>(async (input, init) => {
      const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;
      seen.push({ method: init?.method ?? 'GET', url, headers: new Headers(init?.headers), body: typeof init?.body === 'string' ? JSON.parse(init.body) : null });
      const data = url.endsWith('/products') && init?.method === 'GET'
        ? { products: [product], stock: [stock] }
        : url.endsWith('/prices') && init?.method === 'GET' ? { prices: [price] }
          : url.includes('/prices') ? { price }
            : url.includes('/stock') ? { stock }
              : url.endsWith('/delete') ? { deleted: true }
                : { product };
      return new Response(JSON.stringify({ ok: true, data }), { headers: { 'content-type': 'application/json' } });
    });
    const client = createShopManagementClient({ baseUrl: 'https://platform.example.test', apiKey: 'shop-secret', tenant: 'acme', fetchImpl });

    const results = [
      await client.listProducts(),
      await client.createProduct({ title: 'Printed handbook', type: 'physical', priceCents: 4900 }),
      await client.updateProduct({ id: 'product-1', title: 'Printed handbook' }),
      await client.publishProduct({ id: 'product-1' }),
      await client.unpublishProduct({ id: 'product-1' }),
      await client.deleteProductDraft({ productId: 'product-1' }),
      await client.listProductPrices('product/1'),
      await client.createProductPrice({ productId: 'product-1', kind: 'one_time', amountCents: 4900 }),
      await client.deactivateProductPrice({ id: 'price-1' }),
      await client.getProductStock('product-1'),
      await client.enableProductStock({ productId: 'product-1', onHand: 3, lowStockThreshold: null }),
      await client.adjustProductStock({ productId: 'product-1', delta: 1, reason: 'delivery' }),
      await client.setProductStockThreshold({ productId: 'product-1', lowStockThreshold: 1 }),
    ];

    expect(results.filter((result) => !result.ok)).toEqual([]);
    expect(seen.map((call) => `${call.method} ${new URL(call.url).pathname}`)).toEqual(Object.values(SHOP_CATALOG_ROUTES).map((route) =>
      `${route.method} ${route.path.replace(':productId', route.method === 'GET' && route.path.includes('/prices') ? 'product%2F1' : 'product-1')}`));
    for (const call of seen) {
      expect(call.headers.get('x-api-key')).toBe('shop-secret');
      expect(call.headers.get('x-tenant')).toBe('acme');
      expect(call.headers.has('authorization')).toBe(false);
      expect(call.headers.has('cookie')).toBe(false);
    }
    expect(seen[5]?.body).toEqual({ productId: 'product-1' });
    expect(seen[3]?.body).toEqual({ id: 'product-1' });
  });

  it('omits the workspace header when no workspace is selected and surfaces the error envelope', async () => {
    const fetchImpl = vi.fn<typeof fetch>(async () => new Response(
      JSON.stringify({ ok: false, error: { code: 'forbidden', message: 'shop:catalog:write is not permitted' } }),
      { status: 403, headers: { 'content-type': 'application/json' } },
    ));
    const client = createShopManagementClient({ baseUrl: 'https://acme.example.test', apiKey: 'shop-secret', fetchImpl });
    expect(await client.publishProduct({ id: 'product-1' })).toEqual({
      ok: false, error: { code: 'forbidden', message: 'shop:catalog:write is not permitted' },
    });
    const headers = new Headers(fetchImpl.mock.calls[0]?.[1]?.headers);
    expect(headers.has('x-tenant')).toBe(false);
    expect(headers.has('authorization')).toBe(false);
  });

  it.each([302, 307])('refuses a %i redirect to another origin on every method without sending the key there', async (status) => {
    const targetKeys: Array<string | undefined> = [];
    const target = await listen(createServer((request, response) => {
      const key = request.headers['x-api-key'];
      targetKeys.push(typeof key === 'string' ? key : undefined);
      response.writeHead(200, { 'content-type': 'application/json' });
      response.end(JSON.stringify({ ok: true, data: { products: [], stock: [] } }));
    }));
    const sourceMethods: string[] = [];
    const source = await listen(createServer((request, response) => {
      sourceMethods.push(request.method ?? '');
      response.writeHead(status, { location: `${target.baseUrl}/collected` });
      response.end();
    }));
    try {
      const client = createShopManagementClient({ baseUrl: source.baseUrl, apiKey: 'shop-secret', tenant: 'acme' });
      const results = [
        await client.listProducts(),
        await client.createProduct({ title: 'Printed handbook', type: 'physical', priceCents: 4900 }),
        await client.getProductStock('product-1'),
        await client.deleteProductDraft({ productId: 'product-1' }),
      ];
      expect(results).toEqual([
        { ok: false, error: { code: 'internal', message: `Shop management request to ${SHOP_CATALOG_ROUTES.listProducts.path} refused a redirect` } },
        { ok: false, error: { code: 'internal', message: `Shop management request to ${SHOP_CATALOG_ROUTES.createProduct.path} refused a redirect` } },
        { ok: false, error: { code: 'internal', message: 'Shop management request to /api/m2m/shop/products/product-1/stock refused a redirect' } },
        { ok: false, error: { code: 'internal', message: `Shop management request to ${SHOP_CATALOG_ROUTES.deleteProductDraft.path} refused a redirect` } },
      ]);
      expect(sourceMethods).toEqual(['GET', 'POST', 'GET', 'POST']);
      expect(targetKeys).toEqual([]);
      expect(JSON.stringify(results)).not.toContain('shop-secret');
    } finally {
      await source.close();
      await target.close();
    }
  });

  it('refuses a same-origin redirect too', async () => {
    const paths: string[] = [];
    const server = await listen(createServer((request, response) => {
      paths.push(request.url ?? '');
      if (request.url === '/elsewhere') {
        response.writeHead(200, { 'content-type': 'application/json' });
        response.end(JSON.stringify({ ok: true, data: { products: [], stock: [] } }));
        return;
      }
      response.writeHead(307, { location: '/elsewhere' });
      response.end();
    }));
    try {
      const client = createShopManagementClient({ baseUrl: server.baseUrl, apiKey: 'shop-secret' });
      expect(await client.listProducts()).toMatchObject({ ok: false, error: { code: 'internal' } });
      expect(paths).toEqual([SHOP_CATALOG_ROUTES.listProducts.path]);
    } finally {
      await server.close();
    }
  });
});
