import { describe, expect, it, vi } from 'vitest';
import { ok, productSchema, salesLinkOfferSchema, salesLinkSchema, type Product, type ProductPrice } from '#core/domain/index.js';
import type { SalesLinkDeps } from '../sales-link-ports.js';
import { createStockRepositoryFake } from '../testing/stock-fake.js';
import { getPublicSalesLink, listPublicSalesLinks } from './sales-links.js';

const now = '2026-10-08T12:00:00.000Z';
const setup = () => {
  const make = (id: string, group: string | null = 'stand'): Product => productSchema.parse({
    id, tenantId: 'workspace', type: 'physical', slug: id, title: id, variantLabel: id, variantGroup: group,
    description: '', coverUrl: null, priceCents: 1050, currency: 'PLN', published: true,
    accessItems: [], legacyId: null, vatRate: 5, createdAt: now,
  });
  const black = make('black');
  const white = { ...make('white'), title: 'White stand', priceCents: 2160, vatRate: 8 as const,
    compliance: { manufacturerName: 'Example Workshop', manufacturerAddress: 'Example Street 1', manufacturerEmail: 'safety@example.test', modelIdentifier: 'WHITE', safetyWarnings: 'Keep **dry**.' } };
  const guide = make('guide', null);
  const products: Product[] = [black, white, make('red'), guide];
  const prices: ProductPrice[] = products.map((product) => ({ id: `price-${product.id}`, tenantId: 'workspace', productId: product.id,
    amountCents: product.priceCents, currency: 'PLN', kind: 'one_time', interval: null, active: true, createdAt: now }));
  const link = salesLinkSchema.parse({ id: 'link', tenantId: 'workspace', slug: 'stands', title: 'Stands', heading: 'Stands', productIds: ['black', 'guide'], active: true, listed: true, revision: 1, createdAt: now, updatedAt: now });
  const stock = createStockRepositoryFake();
  stock.track('workspace', 'black', 0);
  stock.track('workspace', 'white', 2);
  const listStock = vi.spyOn(stock.repository, 'listByProducts');
  const listPublished = vi.fn(async () => products.filter((product) => product.published && product.tenantId === 'workspace'));
  const deps: SalesLinkDeps = {
    salesLinks: { list: async () => [link], findById: async () => link, findBySlug: async () => link, save: async (_, value) => ok(value), delete: async () => ok(undefined) },
    products: { findByIds: async (_, ids) => products.filter((product) => ids.includes(product.id)), listPublishedByTenant: listPublished },
    prices: { listActiveByProducts: vi.fn(async (_, ids) => prices.filter((price) => ids.includes(price.productId))) },
    tenants: { findSettings: async () => null }, stock: stock.repository, clock: { nowIso: () => now }, ids: { nextId: () => 'id' },
  };
  return { deps, products, prices, link, black, white, guide, listStock, listPublished };
};

it('lists variants in repository creation order with one stock read and suppresses singleton groups', async () => {
  const h = setup();
  const result = await getPublicSalesLink('workspace', h.link.slug, h.deps);
  expect(result).toMatchObject({ ok: true, value: { soldOut: true, lines: [
    { productId: 'black', baseProductId: 'black', variants: [{ productId: 'black', soldOut: true }, { productId: 'white', soldOut: false }, { productId: 'red' }] },
    { productId: 'guide', baseProductId: 'guide', variants: [] },
  ] } });
  expect(h.listStock).toHaveBeenCalledOnce();
  expect(h.listPublished).toHaveBeenCalledExactlyOnceWith('workspace');
});

it('prices, taxes and renders compliance from the chosen available sibling instead of the sold-out base', async () => {
  const h = setup();
  const result = await getPublicSalesLink('workspace', h.link.slug, h.deps, [{ productId: 'black', variantProductId: 'white' }]);
  expect(result).toMatchObject({ ok: true, value: { soldOut: false, totalCents: 3210, currency: 'PLN', lines: [
    { productId: 'white', baseProductId: 'black', name: 'White stand', deliveryMethod: 'pickup', netCents: 2000, vatCents: 160, vatRate: 8, grossCents: 2160,
      compliance: { modelIdentifier: 'WHITE', safetyWarningsHtml: '<p>Keep <strong>dry</strong>.</p>\n' } }, { productId: 'guide' },
  ] } });
  if (!result.ok) throw new Error(result.error.message);
  expect(salesLinkOfferSchema.safeParse(result.value).success).toBe(true);
  expect(h.listStock).toHaveBeenCalledOnce();
});

describe('eligible public siblings', () => {
  it.each(['ambiguous', 'currency', 'membership', 'type', 'delivery', 'vat', 'unpublished', 'imported', 'inactive', 'group', 'tenant'])('excludes %s and ignores its selection', async (reason) => {
    const h = setup();
    const candidate = h.white;
    const candidatePrice = h.prices[1];
    if (candidatePrice === undefined) throw new Error('Missing candidate price');
    if (reason === 'ambiguous') h.prices.push({ ...candidatePrice, id: 'second' });
    if (reason === 'currency') h.prices.forEach((price) => { if (price.productId === candidate.id) price.currency = 'EUR'; });
    if (reason === 'imported') h.prices.forEach((price) => { if (price.productId === candidate.id) price.imported = true; });
    if (reason === 'inactive') h.prices.forEach((price) => { if (price.productId === candidate.id) price.active = false; });
    const patch: Partial<Product> = reason === 'membership' ? { type: 'membership' } : reason === 'type' ? { type: 'course' }
      : reason === 'delivery' ? { deliveryMethod: 'shipping' } : reason === 'vat' ? { vatRate: null } : reason === 'unpublished' ? { published: false }
      : reason === 'group' ? { variantGroup: 'other' } : reason === 'tenant' ? { tenantId: 'foreign' } : {};
    Object.assign(candidate, patch);
    const result = await getPublicSalesLink('workspace', h.link.slug, h.deps, [{ productId: 'black', variantProductId: 'white' }]);
    expect(result.ok && result.value.lines[0]?.productId).toBe('black');
    expect(result.ok && result.value.lines[0]?.variants.map((variant) => variant.productId)).toEqual(['black', 'red']);
  });
});

it('ignores unknown bases and repeated pairs, preserving the first valid selection', async () => {
  const h = setup();
  const result = await getPublicSalesLink('workspace', h.link.slug, h.deps, [
    { productId: 'missing', variantProductId: 'red' }, { productId: 'black', variantProductId: 'white' }, { productId: 'black', variantProductId: 'red' },
  ]);
  expect(result.ok && result.value.lines.map((line) => line.productId)).toEqual(['white', 'guide']);
});

it('rejects duplicate final products leniently but permits a simultaneous two-line exchange', async () => {
  const h = setup();
  h.link.productIds = ['black', 'white'];
  const duplicate = await getPublicSalesLink('workspace', h.link.slug, h.deps, [{ productId: 'black', variantProductId: 'white' }]);
  expect(duplicate.ok && duplicate.value.lines.map((line) => line.productId)).toEqual(['black', 'white']);
  const exchange = await getPublicSalesLink('workspace', h.link.slug, h.deps, [{ productId: 'black', variantProductId: 'white' }, { productId: 'white', variantProductId: 'black' }]);
  expect(exchange.ok && exchange.value.lines.map((line) => line.productId)).toEqual(['white', 'black']);
});

it('does not load siblings for public listings and suppresses a group with one eligible product', async () => {
  const h = setup();
  expect(await listPublicSalesLinks('workspace', h.deps)).toMatchObject([{ totalCents: 2100 }]);
  expect(h.listPublished).not.toHaveBeenCalled();
  h.white.published = false;
  h.products.splice(2, 1);
  const result = await getPublicSalesLink('workspace', h.link.slug, h.deps);
  expect(result.ok && result.value.lines[0]?.variants).toEqual([]);
});
