import { describe, expect, it } from 'vitest';
import { forbidden } from '#core/domain/index.js';
import { applyManifest } from './apply.js';
import { planManifest } from './plan.js';
import { createManifestFake, existingPrice, existingProduct, existingStock, manifestFixture } from './fake-client.js';

const writes = (requests: string[]) => requests.filter((request) => request.startsWith('POST '));
const creationWrites = [
  'POST /api/tenant/settings', 'POST /api/products', 'POST /api/products/prices',
  'POST /api/products/stock/enable', 'POST /api/products/update', 'POST /api/products/publish',
];

describe('shop apply', () => {
  it('performs the plan in order and makes the second run entirely unchanged', async () => {
    const { api, state } = createManifestFake();
    const plan = await planManifest(manifestFixture, () => api);
    const first = await applyManifest(manifestFixture, () => api);
    expect(first.ok).toBe(true);
    if (!first.ok || !plan.ok) throw new Error('Expected a successful apply');
    expect(first.value.shops).toEqual(plan.value.shops);
    expect(first.value.applied.map((entry) => entry.operation)).toEqual(['settings:update', 'product:create', 'price:add', 'stock:enable', 'cover:update', 'publication:publish']);
    expect(writes(state.requests)).toEqual(creationWrites);
    expect(state.settings.invoiceSellerName).toBe('Acme');
    expect(state.products[0]).toMatchObject({ slug: 'paperback', type: 'physical', published: true, coverUrl: 'https://togethercommunity.app/cover.png' });
    expect(state.prices).toHaveLength(1);
    expect(state.stock?.onHand).toBe(20);
    state.requests.length = 0;
    const second = await applyManifest(manifestFixture, () => api);
    expect(second).toMatchObject({ ok: true, value: { applied: [], shops: [{ settings: { change: [] }, products: [{ product: 'unchanged', price: 'unchanged', stock: 'unchanged', cover: 'unchanged', publication: 'unchanged' }] }] } });
    expect(writes(state.requests)).toEqual([]);
    expect(state.prices).toHaveLength(1);
  });

  it('updates by slug, replaces active prices, sets on-hand, clears cover and unpublishes', async () => {
    const { api, state } = createManifestFake();
    state.settings.invoiceSellerName = 'Acme';
    state.products = [existingProduct({ title: 'Old title', published: true, coverUrl: 'https://togethercommunity.app/old.png' })];
    state.prices = [existingPrice({ amountCents: 3900 })];
    state.stock = existingStock(30);
    const input = { ...manifestFixture, shops: [{ workspace: 'acme', products: [{ slug: 'paperback', title: 'New title', price: { amountCents: 5900, currency: 'EUR' }, stock: { onHand: 10 }, coverUrl: null, published: false }] }] };
    const result = await applyManifest(input, () => api);
    expect(result.ok).toBe(true);
    expect(writes(state.requests)).toEqual([
      'POST /api/products/update', 'POST /api/products/prices', 'POST /api/products/prices/deactivate',
      'POST /api/products/stock/adjust', 'POST /api/products/update', 'POST /api/products/unpublish',
    ]);
    expect(state.products[0]).toMatchObject({ id: 'p1', title: 'New title', coverUrl: null, published: false });
    expect(state.prices.filter((price) => price.active)).toMatchObject([{ amountCents: 5900, currency: 'EUR' }]);
    expect(state.stock).toMatchObject({ onHand: 10, reserved: 2 });
    state.requests.length = 0;
    expect(await applyManifest(input, () => api)).toMatchObject({ ok: true, value: { applied: [] } });
    expect(writes(state.requests)).toEqual([]);
  });

  it.each(creationWrites.map((request, index) => ({ path: request.slice(5), index })))('stops on $path and reports exactly the completed prefix', async ({ path, index }) => {
    const { api, state } = createManifestFake();
    state.failure = { path, method: 'POST', error: forbidden('never-echo-this') };
    const result = await applyManifest(manifestFixture, () => api);
    expect(result).toMatchObject({ ok: false, error: { code: 'forbidden' } });
    if (result.ok) throw new Error('Expected failure');
    expect(result.error.details).toMatchObject({ applied: Array.from({ length: index }, () => expect.objectContaining({ workspace: 'acme' })) });
    expect(writes(state.requests)).toEqual(creationWrites.slice(0, index + 1));
    expect(JSON.stringify(result)).not.toContain('never-echo-this');
    expect(JSON.stringify(result)).not.toContain('cover.png');
  });

  it('keeps one matching price and deactivates duplicates without adding another', async () => {
    const { api, state } = createManifestFake();
    state.products = [existingProduct()];
    state.prices = [existingPrice(), existingPrice({ id: 'price2' })];
    expect((await applyManifest(manifestFixture, () => api)).ok).toBe(true);
    expect(writes(state.requests)).not.toContain('POST /api/products/prices');
    expect(state.prices.filter((price) => price.active).map((price) => price.id)).toEqual(['price1']);
  });

  it('resumes from current state after a price retirement failure without duplicating the new price', async () => {
    const { api, state } = createManifestFake();
    state.products = [existingProduct()];
    state.prices = [existingPrice({ amountCents: 100 })];
    state.failure = { path: '/api/products/prices/deactivate', method: 'POST', error: forbidden() };
    expect(await applyManifest(manifestFixture, () => api)).toMatchObject({ ok: false, error: { details: { applied: expect.arrayContaining([expect.objectContaining({ operation: 'price:add' })]) } } });
    expect(state.prices).toHaveLength(2);
    state.failure = null;
    state.requests.length = 0;
    expect((await applyManifest(manifestFixture, () => api)).ok).toBe(true);
    expect(writes(state.requests)).not.toContain('POST /api/products/prices');
    expect(state.prices.filter((price) => price.active)).toHaveLength(1);
  });

  it('does not manage omitted stock and cover or remove unlisted products', async () => {
    const { api, state } = createManifestFake();
    state.products = [existingProduct({ coverUrl: 'https://togethercommunity.app/keep.png' }), existingProduct({ id: 'p2', slug: 'keep' })];
    state.stock = existingStock(10);
    const input = { version: 1, shops: [{ workspace: 'acme', products: [{ slug: 'paperback', title: 'Paperback', price: { amountCents: 4900, currency: 'PLN' }, published: false }] }] };
    expect((await applyManifest(input, () => api)).ok).toBe(true);
    expect(state.products).toHaveLength(2);
    expect(state.products[0]?.coverUrl).toBe('https://togethercommunity.app/keep.png');
    expect(state.stock?.onHand).toBe(10);
    expect(writes(state.requests)).toEqual(['POST /api/products/prices']);
  });

  it('keeps stored values of metadata fields an existing product entry omits and applies defaults only on creation', async () => {
    const { api, state } = createManifestFake();
    state.products = [existingProduct({ title: 'Old title', description: 'Stored description', deliveryMethod: 'shipping', parcelTemplate: 'large' })];
    state.prices = [existingPrice()];
    const entry = (slug: string, title: string) => ({ slug, title, price: { amountCents: 4900, currency: 'PLN' }, published: false });
    const input = { version: 1, shops: [{ workspace: 'acme', products: [entry('paperback', 'New title'), entry('hardback', 'Hardback')] }] };
    const plan = await planManifest(input, () => api);
    expect(plan).toMatchObject({ ok: true, value: { shops: [{ products: [
      { slug: 'paperback', product: 'update', fields: ['title'], managedFields: ['title'] },
      { slug: 'hardback', product: 'create', managedFields: ['title'] },
    ] }] } });
    expect((await applyManifest(input, () => api)).ok).toBe(true);
    expect(state.products[0]).toMatchObject({ title: 'New title', description: 'Stored description', deliveryMethod: 'shipping', parcelTemplate: 'large' });
    expect(state.products[1]).toMatchObject({ slug: 'hardback', description: '', deliveryMethod: 'pickup', parcelTemplate: 'medium' });
    state.requests.length = 0;
    expect(await applyManifest(input, () => api)).toMatchObject({ ok: true, value: { applied: [] } });
    expect(writes(state.requests)).toEqual([]);
  });

  it('finishes all products in each phase before starting the next phase', async () => {
    const { api, state } = createManifestFake();
    const input = { version: 1, shops: [{ workspace: 'acme', products: ['paperback', 'hardback'].map((slug) => ({ slug, title: slug, price: { amountCents: 4900, currency: 'PLN' }, published: true })) }] };
    expect((await applyManifest(input, () => api)).ok).toBe(true);
    expect(writes(state.requests)).toEqual([
      'POST /api/products', 'POST /api/products', 'POST /api/products/prices', 'POST /api/products/prices', 'POST /api/products/publish', 'POST /api/products/publish',
    ]);
  });

  it('stops across workspaces and includes the earlier shop operations in its error', async () => {
    const acme = createManifestFake();
    const studio = createManifestFake('studio');
    const akademia = createManifestFake('akademia');
    studio.state.failure = { path: '/api/tenant/settings', method: 'POST', error: forbidden() };
    const input = { ...manifestFixture, shops: ['acme', 'studio', 'akademia'].map((workspace) => ({ workspace, products: [] })) };
    const result = await applyManifest(input, (slug) => slug === 'studio' ? studio.api : slug === 'akademia' ? akademia.api : acme.api);
    expect(result).toMatchObject({ ok: false, error: { details: { failure: { workspace: 'studio', operation: 'settings:update' }, applied: [{ workspace: 'acme', operation: 'settings:update' }] } } });
    expect(writes(akademia.state.requests)).toEqual([]);
  });

  it('does not mutate any shop if preflight reading fails', async () => {
    const acme = createManifestFake();
    const studio = createManifestFake('studio');
    studio.state.failure = { path: '/api/tenant/settings', error: forbidden() };
    const input = { ...manifestFixture, shops: ['acme', 'studio'].map((workspace) => ({ workspace, products: [] })) };
    expect(await applyManifest(input, (slug) => slug === 'studio' ? studio.api : acme.api)).toMatchObject({ ok: false, error: { details: { applied: [] } } });
    expect(writes(acme.state.requests)).toEqual([]);
  });
});
