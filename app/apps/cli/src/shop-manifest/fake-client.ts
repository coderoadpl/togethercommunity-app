import { z } from 'zod';
import { createApiClient } from '#core/client/index.js';
import { newProductSchema, newProductPriceSchema, productPriceSchema, productSchema, productStockSchema, tenantSettingsSchema, updateProductInputSchema, updateTenantSettingsInputSchema, enableStockTrackingInputSchema, adjustStockInputSchema, type AppError, type Product, type ProductPrice, type ProductStock, type TenantSettings } from '#core/domain/index.js';

export const manifestFixture = {
  version: 1,
  company: { settings: { invoiceSellerName: 'Acme' } },
  shops: [{ workspace: 'acme', products: [{ slug: 'paperback', title: 'Paperback', type: 'physical', price: { amountCents: 4900, currency: 'PLN' }, stock: { onHand: 20 }, coverUrl: 'https://togethercommunity.app/cover.png', published: true }] }],
};

export const existingProduct = (overrides: Partial<Product> = {}): Product => productSchema.parse({
  id: 'p1', tenantId: 't1', type: 'physical', slug: 'paperback', title: 'Paperback', description: '',
  coverUrl: null, priceCents: 4900, currency: 'PLN', published: false, accessItems: [], legacyId: null,
  createdAt: '2026-01-01T00:00:00Z', ...overrides,
});
export const existingPrice = (overrides: Partial<ProductPrice> = {}): ProductPrice => productPriceSchema.parse({
  id: 'price1', tenantId: 't1', productId: 'p1', kind: 'one_time', interval: null,
  amountCents: 4900, currency: 'PLN', active: true, createdAt: '2026-01-01T00:00:00Z', ...overrides,
});
export const existingStock = (onHand: number): ProductStock => productStockSchema.parse({
  productId: 'p1', onHand, reserved: 2, available: Math.max(0, onHand - 2), low: false, soldOut: false,
  lowStockThreshold: null, lowStockNotifiedAt: null, updatedAt: '2026-01-01T00:00:00Z',
});

export const createManifestFake = (workspace = 'acme') => {
  const state: {
    exists: boolean; settings: TenantSettings; products: Product[]; prices: ProductPrice[]; stock: ProductStock | null;
    requests: string[]; failure: { path: string; method?: string; error: AppError } | null;
  } = {
    settings: tenantSettingsSchema.parse({ name: 'Acme', billingPortalUrl: null, bunnyStreamLibraryId: null }),
    exists: true, products: [], prices: [], stock: null, requests: [], failure: null,
  };
  const api = createApiClient({
    baseUrl: 'https://togethercommunity.app',
    fetchImpl: async (input, init) => {
      const path = new URL(String(input)).pathname;
      state.requests.push(`${init?.method ?? 'GET'} ${path}`);
      const send = (data: unknown) => new Response(JSON.stringify({ ok: true, data }), { headers: { 'content-type': 'application/json' } });
      if (state.failure?.path === path && (state.failure.method === undefined || state.failure.method === init?.method)) return new Response(JSON.stringify({ ok: false, error: state.failure.error }), { status: 403, headers: { 'content-type': 'application/json' } });
      if (!state.exists) return Response.json({ ok: false, error: { code: 'tenant_not_found', message: 'Unknown tenant' } }, { status: 404 });
      if (init?.method === 'POST') {
        const body: unknown = JSON.parse(z.string().parse(init.body));
        if (path === '/api/tenant/settings') {
          state.settings = tenantSettingsSchema.parse({ ...state.settings, ...updateTenantSettingsInputSchema.parse(body) });
          return send({ settings: state.settings });
        }
        if (path === '/api/products') {
          const fields = newProductSchema.parse(body);
          const product = existingProduct({ ...fields, id: `p${state.products.length + 1}`, slug: fields.slug ?? 'paperback' });
          state.products.push(product);
          return send({ product });
        }
        if (path === '/api/products/update') {
          const fields = updateProductInputSchema.parse(body);
          const product = state.products.find((product) => product.id === fields.id);
          if (!product) throw new Error('Missing fake product');
          Object.assign(product, fields);
          return send({ product });
        }
        if (path === '/api/products/prices') {
          const fields = newProductPriceSchema.parse(body);
          const price = existingPrice({ ...fields, id: `price${state.prices.length + 1}`, interval: null });
          state.prices.push(price);
          return send({ price });
        }
        if (path === '/api/products/prices/deactivate') {
          const { id } = z.object({ id: z.string() }).parse(body);
          const price = state.prices.find((price) => price.id === id);
          if (!price) throw new Error('Missing fake price');
          price.active = false;
          return send({ price });
        }
        if (path === '/api/products/stock/enable') {
          const fields = enableStockTrackingInputSchema.parse(body);
          state.stock = { ...existingStock(fields.onHand), productId: fields.productId, reserved: 0, available: fields.onHand };
          return send({ stock: state.stock });
        }
        if (path === '/api/products/stock/adjust') {
          const fields = adjustStockInputSchema.parse(body);
          if (!state.stock) throw new Error('Missing fake stock');
          state.stock = existingStock(state.stock.onHand + fields.delta);
          return send({ stock: state.stock });
        }
        if (path === '/api/products/publish' || path === '/api/products/unpublish') {
          const { id } = z.object({ id: z.string() }).parse(body);
          const product = state.products.find((product) => product.id === id);
          if (!product) throw new Error('Missing fake product');
          product.published = path === '/api/products/publish';
          return send({ product });
        }
        throw new Error(`Unexpected fake mutation: ${path}`);
      }
      if (path === '/api/me') return send({ userId: 'u1', email: 'owner@togethercommunity.app', name: 'Owner', emailVerified: true, tenant: { id: 't1', slug: workspace, name: 'Acme', staffRole: 'owner', memberId: null, banned: false } });
      if (path === '/api/tenant/settings') return send({ settings: state.settings });
      if (path === '/api/products') return send({ products: state.products });
      if (path.endsWith('/prices')) return send({ prices: state.prices.filter((price) => path === `/api/products/${price.productId}/prices`) });
      if (path.endsWith('/stock')) return send({ stock: state.stock });
      throw new Error(`Unexpected fake request: ${path}`);
    },
  });
  return { api, state };
};
