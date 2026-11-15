import { describe, expect, it } from 'vitest';
import { forbidden } from '#core/domain/index.js';
import { applyManifest } from './apply.js';
import { driftManifest } from './drift.js';
import { planManifest } from './plan.js';
import { createManifestFake, existingPrice, existingProduct, existingStock, manifestFixture } from './fake-client.js';

const converged = () => {
  const fake = createManifestFake();
  fake.state.settings.invoiceSellerName = 'Acme';
  fake.state.products = [existingProduct({ published: true, coverUrl: 'https://togethercommunity.app/cover.png' })];
  fake.state.prices = [existingPrice()];
  fake.state.stock = existingStock(20);
  return fake;
};

describe('shop drift', () => {
  it('returns the same diff as plan, without writes, after a company setting changes', async () => {
    const fake = converged();
    const input = { ...manifestFixture, company: { settings: { invoiceSellerName: 'Studio' } } };
    const plan = await planManifest(input, () => fake.api);
    const drift = await driftManifest(input, () => fake.api);
    if (!plan.ok) throw new Error('Expected plan success');
    expect(drift).toEqual({ ok: true, value: { ...plan.value, drifted: true } });
    expect(fake.state.requests.every((request) => request.startsWith('GET '))).toBe(true);
    expect(fake.state.settings.invoiceSellerName).toBe('Acme');
    expect((await applyManifest(input, () => fake.api)).ok).toBe(true);
    expect(await driftManifest(input, () => fake.api)).toMatchObject({ ok: true, value: { drifted: false } });
  });

  it.each(['metadata', 'price', 'duplicate-price', 'stock', 'cover', 'publication'] as const)('detects %s drift read-only', async (kind) => {
    const fake = converged();
    const product = fake.state.products[0];
    const price = fake.state.prices[0];
    if (product === undefined || price === undefined) throw new Error('Expected a converged product and price');
    if (kind === 'metadata') product.title = 'Changed';
    if (kind === 'price') price.amountCents = 100;
    if (kind === 'duplicate-price') fake.state.prices.push(existingPrice({ id: 'price2' }));
    if (kind === 'stock') fake.state.stock = existingStock(5);
    if (kind === 'cover') product.coverUrl = null;
    if (kind === 'publication') product.published = false;
    expect(await driftManifest(manifestFixture, () => fake.api)).toMatchObject({ ok: true, value: { drifted: true } });
    expect(fake.state.requests.every((request) => request.startsWith('GET '))).toBe(true);
  });

  it('detects a missing workspace without needing the operator environment', async () => {
    const fake = createManifestFake();
    fake.state.exists = false;
    const input = { version: 1, shops: [{ workspace: { slug: 'acme', provision: { name: 'Acme', ownerEmail: 'owner@togethercommunity.app' } }, products: [] }] };
    expect(await driftManifest(input, () => fake.api)).toMatchObject({ ok: true, value: { drifted: true } });
    expect(fake.state.requests).toEqual(['GET /api/me']);
  });

  it('ignores unmanaged fields and skipped secret integrations', async () => {
    const fake = createManifestFake();
    fake.state.products = [existingProduct({ title: 'Paperback' })];
    fake.state.prices = [existingPrice()];
    fake.state.stock = existingStock(7);
    const input = { version: 1, company: { integrations: { stripe: { restrictedKeyEnv: 'SHOP_STRIPE_NOT_READ', mode: 'live' } } }, shops: [{ workspace: 'acme', products: [{ slug: 'paperback', title: 'Paperback', price: { amountCents: 4900, currency: 'PLN' }, published: false }] }] };
    expect(await driftManifest(input, () => fake.api)).toMatchObject({ ok: true, value: { drifted: false, shops: [{ integrations: [{ provider: 'stripe', action: 'skipped without --integrations' }] }] } });
    expect(fake.state.requests.every((request) => request.startsWith('GET '))).toBe(true);
  });

  it('preserves API errors rather than reporting them as ordinary drift', async () => {
    const fake = createManifestFake();
    fake.state.failure = { path: '/api/products', error: forbidden('private diagnostic') };
    const result = await driftManifest(manifestFixture, () => fake.api);
    expect(result).toMatchObject({ ok: false, error: { code: 'forbidden' } });
    expect(JSON.stringify(result)).not.toContain('private diagnostic');
  });
});
