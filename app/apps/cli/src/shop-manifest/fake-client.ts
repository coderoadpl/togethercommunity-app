import { createApiClient } from '#core/client/index.js';
import { productPriceSchema, productSchema, productStockSchema, tenantSettingsSchema, type AppError, type Product, type ProductPrice, type ProductStock, type TenantSettings } from '#core/domain/index.js';

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
    settings: TenantSettings; products: Product[]; prices: ProductPrice[]; stock: ProductStock | null;
    requests: string[]; failure: { path: string; error: AppError } | null;
  } = {
    settings: tenantSettingsSchema.parse({ name: 'Acme', billingPortalUrl: null, bunnyStreamLibraryId: null }),
    products: [], prices: [], stock: null, requests: [], failure: null,
  };
  const api = createApiClient({
    baseUrl: 'https://togethercommunity.app',
    fetchImpl: async (input, init) => {
      const path = new URL(String(input)).pathname;
      state.requests.push(`${init?.method ?? 'GET'} ${path}`);
      const send = (data: unknown) => new Response(JSON.stringify({ ok: true, data }), { headers: { 'content-type': 'application/json' } });
      if (state.failure?.path === path) return new Response(JSON.stringify({ ok: false, error: state.failure.error }), { status: 403, headers: { 'content-type': 'application/json' } });
      if (path === '/api/me') return send({ userId: 'u1', email: 'owner@togethercommunity.app', name: 'Owner', emailVerified: true, tenant: { id: 't1', slug: workspace, name: 'Acme', staffRole: 'owner', memberId: null, banned: false } });
      if (path === '/api/tenant/settings') return send({ settings: state.settings });
      if (path === '/api/products') return send({ products: state.products });
      if (path.endsWith('/prices')) return send({ prices: state.prices });
      if (path.endsWith('/stock')) return send({ stock: state.stock });
      throw new Error(`Unexpected fake request: ${path}`);
    },
  });
  return { api, state };
};
