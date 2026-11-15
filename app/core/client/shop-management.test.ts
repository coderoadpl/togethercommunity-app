import { describe, expect, it, vi } from 'vitest';

import { SHOP_ASSETS_ROUTES, SHOP_CATALOG_ROUTES, SHOP_ORDER_ROUTES, SHOP_SETTINGS_ROUTES } from '#core/contract/index.js';

import { createShopManagementClient } from './http.js';

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
});

const order = {
  id: 'order-1', tenantId: 'acme', memberId: 'member-1', productId: 'product-1', priceId: null, kind: 'one_time', status: 'paid', mode: 'live',
  amountCents: 6398, currency: 'PLN', provider: 'simulated', providerObjectIds: {}, couponId: null, discountCents: 0,
  createdAt: '2026-11-15T10:00:00.000Z', memberEmail: 'buyer@example.org', memberName: 'Buyer', productTitle: 'Printed handbook', couponCode: null,
};
const shipxView = { available: true, reason: null, service: 'inpost_locker_standard', parcelTemplate: 'medium', shipment: null };
const exportFile = { filename: 'packing-list-acme.csv', mimeType: 'text/csv; charset=utf-8', content: 'order_number' };

describe('shop management client order calls', () => {
  it('sends every order call to its shop route with the query, the key and no session', async () => {
    const seen: { method: string; url: URL; headers: Headers; body: unknown }[] = [];
    const fetchImpl = vi.fn<typeof fetch>(async (input, init) => {
      const url = new URL(typeof input === 'string' ? input : input instanceof URL ? input.href : input.url);
      const method = init?.method ?? 'GET';
      seen.push({ method, url, headers: new Headers(init?.headers), body: typeof init?.body === 'string' ? JSON.parse(init.body) : null });
      if (url.pathname.endsWith('/label')) {
        return new Response(new TextEncoder().encode('%PDF-1.4'), { headers: { 'content-type': 'application/pdf', 'content-disposition': 'attachment; filename="inpost-1.pdf"' } });
      }
      const data = url.pathname === SHOP_ORDER_ROUTES.listOrders.path ? { sources: [], orders: [order], total: 1, page: 1, pageSize: 20 }
        : url.pathname.endsWith('/export') || url.pathname.endsWith('/packing-list') ? exportFile
          : url.pathname.endsWith('/discard') ? { discarded: true }
            : method === 'POST' && url.pathname.endsWith('/shipx') ? { order, shipment: { shipxShipmentId: '1', status: 'confirmed', environment: 'production', trackingNumber: 'T1', createAttemptedAt: null, boughtAt: null, labelFetchedAt: null, createdAt: order.createdAt, updatedAt: order.createdAt } }
              : url.pathname.includes('/shipx') ? shipxView
                : url.pathname === '/api/m2m/shop/orders/order-1' ? { order, invoice: null }
                  : { order };
      return new Response(JSON.stringify({ ok: true, data }), { headers: { 'content-type': 'application/json' } });
    });
    const client = createShopManagementClient({ baseUrl: 'https://platform.example.test', apiKey: 'shop-secret', tenant: 'acme', fetchImpl });

    const results = [
      await client.listOrders({ mode: 'live', page: 2, pageSize: 50 }),
      await client.exportOrders({ format: 'csv', fulfilmentStatus: 'to_pack' }),
      await client.ordersPackingList({ format: 'csv', mode: 'live' }),
      await client.verifyOrder({ reference: 'order-1' }),
      await client.getOrder('order-1'),
      await client.shipOrder({ orderId: 'order-1', carrier: 'other', trackingNumber: 'MANUAL0001' }),
      await client.issueOrderLine({ orderId: 'order-1', productId: 'product-1' }),
      await client.shipxShipment({ orderId: 'order-1' }),
      await client.shipxCreate({ orderId: 'order-1' }),
      await client.shipxRefresh({ orderId: 'order-1' }),
      await client.shipxDiscard({ orderId: 'order-1' }),
      await client.shipxLabel({ orderId: 'order-1' }),
    ];

    expect(results.filter((result) => !result.ok)).toEqual([]);
    expect(seen.map((call) => `${call.method} ${call.url.pathname}`)).toEqual(Object.values(SHOP_ORDER_ROUTES).map((route) =>
      `${route.method} ${route.path.replace(':orderId', 'order-1').replace(':productId', 'product-1').replace(':reference', 'order-1')}`));
    expect(seen[0]?.url.search).toBe('?mode=live&page=2&pageSize=50');
    expect(seen[1]?.url.search).toBe('?format=csv&fulfilmentStatus=to_pack');
    expect(seen[5]?.body).toEqual({ orderId: 'order-1', carrier: 'other', trackingNumber: 'MANUAL0001' });
    expect(results[11]).toMatchObject({ ok: true, value: { filename: 'inpost-1.pdf', contentType: 'application/pdf' } });
    for (const call of seen) {
      expect(call.headers.get('x-api-key')).toBe('shop-secret');
      expect(call.headers.has('authorization')).toBe(false);
      expect(call.headers.has('cookie')).toBe(false);
    }
  });
});

const shopSettings = {
  name: 'Example Press', defaultLanguage: 'en', logoUrl: null, logoDarkUrl: null, faviconUrl: null, accentColor: null, accentLight: null,
  ogImageUrl: null, socialLinks: [], supportEmail: null, supportUrl: null, termsUrl: 'https://brand.example.test/terms', privacyUrl: null,
  shippingRates: [],
};

describe('shop management client settings calls', () => {
  it('reads and writes settings and uploads a branding image with the key on the API calls only', async () => {
    const seen: { method: string; url: URL; headers: Headers; body: unknown }[] = [];
    const fetchImpl = vi.fn<typeof fetch>(async (input, init) => {
      const url = new URL(typeof input === 'string' ? input : input instanceof URL ? input.href : input.url);
      const method = init?.method ?? 'GET';
      seen.push({ method, url, headers: new Headers(init?.headers), body: typeof init?.body === 'string' ? JSON.parse(init.body) : init?.body ?? null });
      if (url.hostname === 'storage.example.test') return new Response(null, { status: 200 });
      const data = url.pathname === SHOP_SETTINGS_ROUTES.brandingAssetUpload.path
        ? { key: 'image-asset-candidates/acme/logo/1.png', servePath: '/api/public/assets/logo/1.png', upload: { url: 'https://storage.example.test/candidate?signature=1', headers: { 'content-type': 'image/png' }, expiresAt: '2026-11-15T10:15:00.000Z' } }
        : url.pathname === SHOP_SETTINGS_ROUTES.brandingAssetComplete.path ? { url: '/api/public/assets/logo/1.png' }
          : { settings: shopSettings };
      return new Response(JSON.stringify({ ok: true, data }), { headers: { 'content-type': 'application/json' } });
    });
    const client = createShopManagementClient({ baseUrl: 'https://platform.example.test', apiKey: 'shop-secret', tenant: 'acme', fetchImpl });
    const bytes = new Uint8Array([137, 80, 78, 71]);

    const results = [
      await client.getSettings(),
      await client.updateSettings({ termsUrl: 'https://brand.example.test/terms', supportUrl: null }),
      await client.uploadBrandingAsset({ kind: 'logo', fileName: 'logo.png', contentType: 'image/png', sizeBytes: bytes.byteLength, body: bytes }),
    ];

    expect(results.filter((result) => !result.ok)).toEqual([]);
    expect(results[2]).toEqual({ ok: true, value: { url: '/api/public/assets/logo/1.png' } });
    expect(seen.map((call) => `${call.method} ${call.url.origin}${call.url.pathname}`)).toEqual([
      `GET https://platform.example.test${SHOP_SETTINGS_ROUTES.getSettings.path}`,
      `POST https://platform.example.test${SHOP_SETTINGS_ROUTES.updateSettings.path}`,
      `POST https://platform.example.test${SHOP_SETTINGS_ROUTES.brandingAssetUpload.path}`,
      'PUT https://storage.example.test/candidate',
      `POST https://platform.example.test${SHOP_SETTINGS_ROUTES.brandingAssetComplete.path}`,
    ]);
    expect(seen[1]?.body).toEqual({ termsUrl: 'https://brand.example.test/terms', supportUrl: null });
    expect(seen[2]?.body).toEqual({ kind: 'logo', fileName: 'logo.png', contentType: 'image/png', sizeBytes: 4 });
    expect(seen[4]?.body).toEqual({ key: 'image-asset-candidates/acme/logo/1.png' });
    expect(seen[3]?.headers.get('content-type')).toBe('image/png');
    expect(seen[3]?.headers.has('x-api-key')).toBe(false);
    for (const call of seen.filter((entry) => entry.url.hostname === 'platform.example.test')) {
      expect(call.headers.get('x-api-key')).toBe('shop-secret');
      expect(call.headers.get('x-tenant')).toBe('acme');
      expect(call.headers.has('authorization')).toBe(false);
    }
  });
});

const salesLinkFields = { slug: 'handbook', title: 'Handbook', heading: 'Buy the handbook', productIds: ['product-1'] };
const salesLink = { ...salesLinkFields, id: 'link/1', tenantId: 'acme', revision: 1, createdAt: product.createdAt, updatedAt: product.createdAt };

describe('shop management client asset calls', () => {
  it('sends sales-link operations to keyed routes with encoded ids and keeps expectedRevision', async () => {
    const seen: { method: string; path: string; headers: Headers; body: unknown }[] = [];
    const fetchImpl = vi.fn<typeof fetch>(async (input, init) => {
      const url = new URL(String(input));
      const method = init?.method ?? 'GET';
      seen.push({ method, path: url.pathname, headers: new Headers(init?.headers), body: typeof init?.body === 'string' ? JSON.parse(init.body) : null });
      const data = method === 'DELETE' ? { deleted: true }
        : method === 'GET' && url.pathname === SHOP_ASSETS_ROUTES.listSalesLinks.path ? { salesLinks: [salesLink] }
          : { salesLink };
      return Response.json({ ok: true, data });
    });
    const client = createShopManagementClient({ baseUrl: 'https://platform.example.test', apiKey: 'shop-secret', tenant: 'acme', fetchImpl });
    const results = [
      await client.listSalesLinks(),
      await client.createSalesLink(salesLinkFields),
      await client.getSalesLink({ id: 'link/1' }),
      await client.updateSalesLink({ ...salesLinkFields, id: 'link/1', expectedRevision: 1 }),
      await client.deleteSalesLink({ id: 'link/1' }),
    ];
    expect(results.every((result) => result.ok)).toBe(true);
    expect(seen.map((call) => `${call.method} ${call.path}`)).toEqual([
      'GET /api/m2m/shop/sales-links', 'POST /api/m2m/shop/sales-links',
      'GET /api/m2m/shop/sales-links/link%2F1', 'POST /api/m2m/shop/sales-links/link%2F1', 'DELETE /api/m2m/shop/sales-links/link%2F1',
    ]);
    expect(seen[3]?.body).toEqual({ ...salesLinkFields, id: 'link/1', expectedRevision: 1 });
    expect(seen[4]?.body).toBe(null);
    for (const call of seen) {
      expect(call.headers.get('x-api-key')).toBe('shop-secret');
      expect(call.headers.get('x-tenant')).toBe('acme');
      expect(call.headers.has('authorization')).toBe(false);
      expect(call.headers.has('cookie')).toBe(false);
    }
  });

  it('uploads a cover with credentials only on API requests, then completes it', async () => {
    const seen: { method: string; path: string; headers: Headers; body: unknown }[] = [];
    const bytes = new Uint8Array([137, 80, 78, 71]);
    const fetchImpl = vi.fn<typeof fetch>(async (input, init) => {
      const url = new URL(String(input));
      seen.push({ method: init?.method ?? 'GET', path: url.pathname, headers: new Headers(init?.headers), body: typeof init?.body === 'string' ? JSON.parse(init.body) : init?.body });
      if (url.hostname === 'storage.example.test') return new Response(null);
      return Response.json({ ok: true, data: url.pathname.endsWith('/upload')
        ? { key: 'image-asset-candidates/acme/product-cover/1.png', servePath: '/api/public/assets/product-cover/1.png', upload: { url: 'https://storage.example.test/candidate?signature=1', headers: { 'content-type': 'image/png' }, expiresAt: '2026-11-15T10:15:00.000Z' } }
        : { url: '/api/public/assets/product-cover/1.png' } });
    });
    const client = createShopManagementClient({ baseUrl: 'https://platform.example.test', apiKey: 'shop-secret', tenant: 'acme', fetchImpl });
    const result = await client.uploadProductCover({ kind: 'product-cover', fileName: 'cover.png', contentType: 'image/png', sizeBytes: bytes.byteLength, body: bytes });
    expect(result).toEqual({ ok: true, value: { url: '/api/public/assets/product-cover/1.png' } });
    expect(seen.map((call) => `${call.method} ${call.path}`)).toEqual([
      `POST ${SHOP_ASSETS_ROUTES.productCoverUpload.path}`, 'PUT /candidate', `POST ${SHOP_ASSETS_ROUTES.productCoverComplete.path}`,
    ]);
    expect(seen[0]?.body).toEqual({ kind: 'product-cover', fileName: 'cover.png', contentType: 'image/png', sizeBytes: 4 });
    expect(seen[1]?.body).toBe(bytes);
    expect(seen[1]?.headers.get('content-type')).toBe('image/png');
    expect(seen[1]?.headers.has('x-api-key')).toBe(false);
    expect(seen[1]?.headers.has('x-tenant')).toBe(false);
    expect(seen[1]?.headers.has('authorization')).toBe(false);
    expect(seen[2]?.body).toEqual({ key: 'image-asset-candidates/acme/product-cover/1.png' });
    for (const call of [seen[0], seen[2]]) expect(call?.headers.get('x-api-key')).toBe('shop-secret');
  });

  it('does not complete an upload rejected by storage', async () => {
    const fetchImpl = vi.fn<typeof fetch>(async (_input, init) => init?.method === 'PUT'
      ? new Response(null, { status: 403 })
      : Response.json({ ok: true, data: { key: 'image-asset-candidates/acme/product-cover/1.png', servePath: '/api/public/assets/product-cover/1.png', upload: { url: 'https://storage.example.test/candidate', headers: {}, expiresAt: '2026-11-15T10:15:00.000Z' } } }));
    const client = createShopManagementClient({ baseUrl: 'https://platform.example.test', apiKey: 'shop-secret', fetchImpl });
    expect(await client.uploadProductCover({ kind: 'product-cover', fileName: 'cover.png', contentType: 'image/png', sizeBytes: 4, body: new Uint8Array(4) })).toMatchObject({ ok: false, error: { code: 'internal' } });
    expect(fetchImpl).toHaveBeenCalledTimes(2);
  });
});
