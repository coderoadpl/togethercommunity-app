import { describe, expect, it } from 'vitest';
import { productSchema } from './product.js';
import { productPriceSchema } from './commerce.js';
import { productStockSchema } from './stock.js';
import { diffManifestProduct, diffShopSettings, effectiveShopSettings, manifestValuesEqual, shopManifestProductSchema, shopManifestSchema } from './shop-manifest.js';

const productInput = { slug: 'paperback', title: 'Paperback', price: { amountCents: 4900, currency: 'PLN' }, published: true };
const manifest = { version: 1, shops: [{ workspace: 'acme', products: [productInput] }] };
const current = {
  product: productSchema.parse({ id: 'p1', tenantId: 't1', type: 'physical', slug: 'paperback', title: 'Paperback', description: '', coverUrl: null, priceCents: 100, currency: 'EUR', published: true, accessItems: [], legacyId: null, createdAt: '2026-01-01T00:00:00Z' }),
  prices: [productPriceSchema.parse({ id: 'price1', tenantId: 't1', productId: 'p1', kind: 'one_time', interval: null, amountCents: 4900, currency: 'PLN', active: true, createdAt: '2026-01-01T00:00:00Z' })],
  stock: productStockSchema.parse({ productId: 'p1', onHand: 10, reserved: 2, available: 8, low: false, soldOut: false, lowStockThreshold: null, lowStockNotifiedAt: null, updatedAt: '2026-01-01T00:00:00Z' }),
};

describe('shop manifest v1', () => {
  it('parses a physical catalogue and rejects other versions and types', () => {
    expect(shopManifestSchema.parse(manifest).shops[0]?.products[0]?.type).toBe('physical');
    expect(shopManifestSchema.safeParse({ ...manifest, version: 2 }).success).toBe(false);
    expect(shopManifestProductSchema.safeParse({ ...productInput, type: 'course' }).success).toBe(false);
  });

  it.each([
    { ...manifest, secrets: {} },
    { ...manifest, company: { settings: { stripeSecretKey: 'forbidden' } } },
    { ...manifest, shops: [{ ...manifest.shops[0], provisioning: {} }] },
    { ...manifest, shops: [{ workspace: 'acme', products: [{ ...productInput, price: { ...productInput.price, token: 'forbidden' } }] }] },
    { ...manifest, company: { settings: { checkoutAppearance: { password: 'forbidden' } } } },
    { ...manifest, company: { settings: { socialLinks: [{ label: 'Acme', url: 'https://togethercommunity.app', token: 'forbidden' }] } } },
    { ...manifest, company: { settings: { shippingRates: [{ id: 'courier', label: 'Courier', amountCents: 1000, carrier: 'other', pickupPoint: 'none', active: true, token: 'forbidden' }] } } },
    { ...manifest, company: { settings: { shippingRates: [{ id: 'courier', label: 'Courier', amountCents: 1000, carrier: 'other', pickupPoint: 'none', active: true, deliveryEstimateDays: { min: 1, max: 2, token: 'forbidden' } }] } } },
  ])('rejects unknown keys at every object boundary', (input) => {
    expect(shopManifestSchema.safeParse(input).success).toBe(false);
  });

  it('rejects duplicate workspaces and product slugs', () => {
    expect(shopManifestSchema.safeParse({ ...manifest, shops: [...manifest.shops, ...manifest.shops] }).success).toBe(false);
    expect(shopManifestSchema.safeParse({ ...manifest, shops: [{ workspace: 'acme', products: [productInput, productInput] }] }).success).toBe(false);
  });

  it('accepts provisioning only inside a strict workspace object and deduplicates its slug', () => {
    const workspace = { slug: 'acme', provision: { name: 'Acme', ownerEmail: 'owner@togethercommunity.app' } };
    expect(shopManifestSchema.safeParse({ version: 1, shops: [{ workspace, products: [] }] }).success).toBe(true);
    expect(shopManifestSchema.safeParse({ version: 1, shops: [{ workspace, products: [] }, { workspace: 'acme', products: [] }] }).success).toBe(false);
    for (const provision of [{ name: 'Acme', ownerEmail: 'invalid' }, { ...workspace.provision, secret: 'forbidden' }]) {
      expect(shopManifestSchema.safeParse({ version: 1, shops: [{ workspace: { ...workspace, provision }, products: [] }] }).success).toBe(false);
    }
  });

  it.each([-1, 1.5, 1_000_001])('rejects invalid stock %s', (onHand) => {
    expect(shopManifestProductSchema.safeParse({ ...productInput, stock: { onHand } }).success).toBe(false);
  });

  it('merges company fields recursively, replaces arrays, and respects explicit null', () => {
    const company = { invoiceSellerName: 'Acme', termsUrl: 'https://togethercommunity.app/terms', socialLinks: [{ label: 'Acme', url: 'https://togethercommunity.app' }], checkoutAppearance: { displayName: 'Company', buttonColor: '#123456' } };
    expect(effectiveShopSettings(company, { termsUrl: null, socialLinks: [], checkoutAppearance: { displayName: 'Shop' } })).toEqual({
      invoiceSellerName: 'Acme', termsUrl: null, socialLinks: [], checkoutAppearance: { displayName: 'Shop', buttonColor: '#123456' },
    });
    expect(company.termsUrl).not.toBeNull();
  });

  it('compares objects independently of key order, preserving array order', () => {
    expect(manifestValuesEqual({ a: 1, b: 2 }, { b: 2, a: 1 })).toBe(true);
    expect(manifestValuesEqual([1, 2], [2, 1])).toBe(false);
    expect(diffShopSettings({ invoiceSellerName: 'Acme', shippingRates: [] }, { invoiceSellerName: 'Acme', shippingRates: [1] })).toEqual({ changes: { shippingRates: [] }, unchanged: ['invoiceSellerName'] });
  });

  it('diffs creation and does not confuse a base price with a sellable price', () => {
    const desired = shopManifestProductSchema.parse(productInput);
    expect(diffManifestProduct(desired, null)).toMatchObject({ product: 'create', price: 'add', stock: 'unmanaged', cover: 'unmanaged', publication: 'publish' });
    expect(diffManifestProduct(desired, { ...current, prices: [] }).price).toBe('add');
    expect(diffManifestProduct(desired, current)).toMatchObject({ product: 'unchanged', price: 'unchanged', publication: 'unchanged' });
  });

  it('diffs metadata, active prices, on-hand rather than available, cover and publication', () => {
    const desired = shopManifestProductSchema.parse({ ...productInput, title: 'New title', price: { amountCents: 5900, currency: 'EUR' }, stock: { onHand: 10 }, coverUrl: 'https://togethercommunity.app/cover.png', published: false });
    expect(diffManifestProduct(desired, current)).toMatchObject({ product: 'update', fields: ['title'], price: 'add', deactivatePriceIds: ['price1'], stock: 'unchanged', cover: 'update', publication: 'unpublish' });
    expect(diffManifestProduct({ ...desired, stock: { onHand: 5 } }, current).stock).toBe('adjust');
    expect(diffManifestProduct(desired, { ...current, stock: null }).stock).toBe('enable');
  });

  it('keeps one matching active non-imported price and retires alternatives', () => {
    const desired = shopManifestProductSchema.parse(productInput);
    expect(diffManifestProduct(desired, { ...current, prices: [...current.prices, { ...current.prices[0]!, id: 'price2' }] }).deactivatePriceIds).toEqual(['price2']);
    expect(diffManifestProduct(desired, { ...current, prices: current.prices.map((price) => ({ ...price, imported: true })) }).price).toBe('add');
  });
});
