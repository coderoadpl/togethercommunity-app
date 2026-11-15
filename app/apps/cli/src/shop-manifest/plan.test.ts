import { describe, expect, it } from 'vitest';
import { forbidden } from '#core/domain/index.js';
import { shopManifestSchema } from '#core/domain/shop-manifest.js';
import { planManifest } from './plan.js';
import { applyManifest } from './apply.js';
import { driftManifest } from './drift.js';
import { createManifestFake, existingPrice, existingProduct, existingStock, manifestFixture } from './fake-client.js';

describe('shop plan', () => {
  it('plans a new catalogue read-only and hides settings values', async () => {
    const { api, state } = createManifestFake();
    const result = await planManifest(manifestFixture, () => api);
    expect(result).toMatchObject({ ok: true, value: { shops: [{ workspace: 'acme', settings: { change: ['invoiceSellerName'] }, products: [{ slug: 'paperback', product: 'create', price: 'add', stock: 'enable', cover: 'update', publication: 'publish', desiredOnHand: 20, desiredPrice: { amountCents: 4900, currency: 'PLN' } }] }] } });
    expect(state.requests.every((request) => request.startsWith('GET '))).toBe(true);
    expect(JSON.stringify(result)).not.toContain('Acme');
    expect(JSON.stringify(result)).not.toContain('cover.png');
  });

  it('reports updates, unchanged fields and retirement of old prices', async () => {
    const { api, state } = createManifestFake();
    state.settings.invoiceSellerName = 'Acme';
    state.products = [existingProduct({ title: 'Old title' })];
    state.prices = [existingPrice({ amountCents: 100 })];
    state.stock = existingStock(10);
    const result = await planManifest(manifestFixture, () => api);
    expect(result).toMatchObject({ ok: true, value: { shops: [{ settings: { change: [], unchanged: ['invoiceSellerName'] }, products: [{ product: 'update', fields: ['title'], price: 'add', deactivatePriceIds: ['price1'], stock: 'adjust' }] }] } });
    expect(state.requests).toContain('GET /api/products/p1/prices');
    expect(state.requests).toContain('GET /api/products/p1/stock');
  });

  it('selects a shop and merges its overrides', async () => {
    const acme = createManifestFake();
    const studio = createManifestFake('studio');
    const input = { ...manifestFixture, shops: [...manifestFixture.shops, { workspace: 'studio', settings: { invoiceSellerName: 'Studio' }, products: [] }] };
    expect(await planManifest(input, (slug) => slug === 'studio' ? studio.api : acme.api, 'studio')).toMatchObject({ ok: true, value: { shops: [{ workspace: 'studio', settings: { change: ['invoiceSellerName'] }, products: [] }] } });
    expect(acme.state.requests).toEqual([]);
    expect(await planManifest(input, () => acme.api, 'akademia')).toMatchObject({ ok: false, error: { code: 'validation' } });
  });

  it('rejects bad manifests before calling a client', async () => {
    const { api, state } = createManifestFake();
    expect(await planManifest({ ...manifestFixture, password: 'never-echo-this' }, () => api)).toMatchObject({ ok: false, error: { code: 'validation' } });
    expect(state.requests).toEqual([]);
    expect(JSON.stringify(await planManifest({ password: 'never-echo-this' }, () => api))).not.toContain('never-echo-this');
  });

  it('refuses a workspace slug longer than a host label before any request', async () => {
    const { api, state } = createManifestFake();
    const label = 'a'.repeat(63);
    expect(shopManifestSchema.safeParse({ version: 1, shops: [{ workspace: label, products: [] }] }).success).toBe(true);
    const result = await planManifest({ version: 1, shops: [{ workspace: `${label}b`, products: [] }] }, () => api);
    expect(result).toMatchObject({ ok: false, error: { code: 'validation', details: { issues: [{ path: ['shops', 0, 'workspace'] }] } } });
    expect(state.requests).toEqual([]);
  });

  it('refuses a mismatched host workspace before reading catalogue data', async () => {
    const { api, state } = createManifestFake('studio');
    expect(await planManifest(manifestFixture, () => api)).toMatchObject({ ok: false, error: { code: 'validation' } });
    expect(state.requests).toEqual(['GET /api/me']);
  });

  it('refuses slug collisions with non-physical products', async () => {
    const { api, state } = createManifestFake();
    state.products = [existingProduct({ type: 'course' })];
    expect(await planManifest(manifestFixture, () => api)).toMatchObject({ ok: false, error: { code: 'validation' } });
  });

  it('rejects contradictory VAT fields that the settings route would normalize away', async () => {
    const { api } = createManifestFake();
    const input = { ...manifestFixture, company: { settings: { invoiceVatMode: 'exempt', invoiceVatRatePercent: 23 } } };
    expect(await planManifest(input, () => api)).toMatchObject({ ok: false, error: { code: 'validation' } });
  });

  it('stops at the first read failure, preserves taxonomy and omits server error values', async () => {
    const { api, state } = createManifestFake();
    state.failure = { path: '/api/tenant/settings', error: forbidden('never-echo-this') };
    const result = await planManifest(manifestFixture, () => api);
    expect(result).toMatchObject({ ok: false, error: { code: 'forbidden', details: { workspace: 'acme', operation: 'settings:read' } } });
    expect(JSON.stringify(result)).not.toContain('never-echo-this');
    expect(state.requests).toEqual(['GET /api/me', 'GET /api/tenant/settings']);
  });

  it.each(['plan', 'apply', 'drift'] as const)('%s refuses a non-convergent product VAT basis before any request', async (command) => {
    const { api, state } = createManifestFake();
    const input = { version: 1, shops: [{ workspace: 'acme', products: [{ slug: 'paperback', title: 'Paperback', vatRate: 'exempt', vatExemptionBasis: null, price: { amountCents: 4900, currency: 'PLN' }, published: true }] }] };
    const run = { plan: planManifest, apply: applyManifest, drift: driftManifest }[command];
    expect(await run(input, () => api)).toMatchObject({ ok: false, error: { code: 'validation', message: expect.stringContaining('omit vatExemptionBasis') } });
    expect(state.requests).toEqual([]);
  });
});
