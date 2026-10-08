import { beforeEach, describe, expect, it, vi } from 'vitest';
import { ok, productSchema, salesLinkSchema, type Product } from '#core/domain/index.js';
import type { Ctx } from '../context.js';
import type { SalesLinkDeps } from '../sales-link-ports.js';
import { createSalesLink, deleteSalesLink, getPublicSalesLink, getSalesLink, listSalesLinks, updateSalesLink } from './sales-links.js';

const now = '2026-10-08T12:00:00.000Z';
const link = salesLinkSchema.parse({ id: 'link', tenantId: 'workspace', slug: 'collection', title: 'Collection offer', heading: 'Your collection', productIds: ['print', 'digital'], active: true, revision: 1, createdAt: now, updatedAt: now });
const input = { slug: link.slug, title: link.title, heading: link.heading, productIds: link.productIds, active: true };
const products: Product[] = ['print', 'digital'].map((id, index) => productSchema.parse({ id, tenantId: 'workspace', type: index === 0 ? 'physical' : 'digital_download', slug: id, title: index === 0 ? 'Printed item' : 'Digital item', description: '', coverUrl: null, priceCents: index === 0 ? 1050 : 1080, currency: 'PLN', published: true, accessItems: [], legacyId: null, vatRate: index === 0 ? 5 : 8, createdAt: now }));
const ctx: Ctx = { identity: { userId: 'staff', email: 'staff@example.org', name: 'Staff', emailVerified: true, image: null, tenantAccess: 'staff', tenantId: 'workspace', tenantSlug: 'workspace', tenantName: 'Workspace', staffRole: 'owner', memberId: null, memberDisplayName: null, memberBannedAt: null, memberDmOptOutAt: null, memberLanguage: null, memberVideoAutoplay: false } };
const findBySlug = vi.fn<SalesLinkDeps['salesLinks']['findBySlug']>(async () => link);
const findByIds = vi.fn<SalesLinkDeps['products']['findByIds']>(async () => products);
const save = vi.fn<SalesLinkDeps['salesLinks']['save']>(async (_, value) => ok(value));
const deps: SalesLinkDeps = {
  salesLinks: { list: async () => [link], findById: async (tenantId, id) => tenantId === link.tenantId && id === link.id ? link : null, findBySlug, save, delete: async () => ok(undefined) },
  products: { findByIds },
  prices: { listActiveByProducts: async () => products.map((product) => ({ id: `price-${product.id}`, tenantId: 'workspace', productId: product.id, amountCents: product.priceCents, currency: 'PLN', kind: 'one_time', interval: null, active: true, createdAt: now })) },
  tenants: { findSettings: async () => null }, clock: { nowIso: () => now }, ids: { nextId: () => 'new-link' },
};
beforeEach(() => { vi.clearAllMocks(); findBySlug.mockResolvedValue(link); findByIds.mockResolvedValue(products); });
describe('sales links', () => {
  it('preserves product ordering, VAT cents and a fixed bundle total', async () => {
    const result = await getPublicSalesLink('workspace', 'collection', deps);
    expect(result).toMatchObject({ ok: true, value: { totalCents: 2130, currency: 'PLN', lines: [{ productId: 'print', grossCents: 1050, netCents: 1000, vatCents: 50, vatRate: 5 }, { productId: 'digital', grossCents: 1080, netCents: 1000, vatCents: 80, vatRate: 8 }] } });
  });
  it.each([{ active: false }, { validFrom: '2026-10-09T00:00:00.000Z' }, { validTo: now }])('hides unavailable links %j', async (patch) => {
    findBySlug.mockResolvedValue({ ...link, ...patch });
    expect(await getPublicSalesLink('workspace', 'collection', deps)).toMatchObject({ ok: false, error: { code: 'not_found' } });
  });
  it('accepts the inclusive start and an unlisted direct URL', async () => {
    findBySlug.mockResolvedValue({ ...link, validFrom: now, listed: false });
    expect(await getPublicSalesLink('workspace', 'collection', deps)).toMatchObject({ ok: true });
  });
  it('rejects duplicates, inverted windows, foreign products and draft activation', async () => {
    expect(await createSalesLink(ctx, { ...input, productIds: ['print', 'print'] }, deps)).toMatchObject({ ok: false });
    expect(await createSalesLink(ctx, { ...input, validFrom: now, validTo: now }, deps)).toMatchObject({ ok: false });
    findByIds.mockResolvedValue([]);
    expect(await createSalesLink(ctx, input, deps)).toMatchObject({ ok: false });
    findByIds.mockResolvedValue(products.map((product) => ({ ...product, published: false })));
    expect(await createSalesLink(ctx, input, deps)).toMatchObject({ ok: false });
    expect(await getPublicSalesLink('workspace', 'collection', deps)).toMatchObject({ ok: false, error: { code: 'not_found' } });
    expect(save).not.toHaveBeenCalled();
  });
  it('requires one-time prices and resolved VAT before activation', async () => {
    expect(await createSalesLink(ctx, input, { ...deps, prices: { listActiveByProducts: async () => [] } })).toMatchObject({ ok: false });
    findByIds.mockResolvedValue(products.map((product) => ({ ...product, vatRate: null })));
    expect(await createSalesLink(ctx, input, deps)).toMatchObject({ ok: false });
    expect(await createSalesLink(ctx, { ...input, active: false }, deps)).toMatchObject({ ok: true });
  });
  it('saves revisions and uses tenant authorization for all management paths', async () => {
    expect(await createSalesLink(ctx, input, deps)).toMatchObject({ ok: true, value: { salesLink: { revision: 1, listed: false } } });
    expect(await updateSalesLink(ctx, { ...input, id: link.id, expectedRevision: 1 }, deps)).toMatchObject({ ok: true, value: { salesLink: { revision: 2 } } });
    const anonymous: Ctx = { identity: { ...ctx.identity, staffRole: null, memberId: 'member', tenantAccess: 'member' } };
    for (const result of await Promise.all([listSalesLinks(anonymous, deps), getSalesLink(anonymous, { id: link.id }, deps), createSalesLink(anonymous, input, deps), updateSalesLink(anonymous, { ...input, id: link.id, expectedRevision: 1 }, deps), deleteSalesLink(anonymous, { id: link.id }, deps)])) expect(result).toMatchObject({ ok: false });
    expect(await getSalesLink(ctx, { id: 'foreign' }, deps)).toMatchObject({ ok: false, error: { code: 'not_found' } });
  });
  it('renders shared sanitized Markdown for the public description', async () => {
    findBySlug.mockResolvedValue({ ...link, description: '**Included** <script>alert(1)</script>' });
    const result = await getPublicSalesLink('workspace', 'collection', deps);
    expect(result.ok && result.value.descriptionHtml).toContain('<strong>Included</strong>');
    expect(result.ok && result.value.descriptionHtml).not.toContain('<script>');
  });
});

it('uses the unique active price for offer amounts and currency after repricing', async () => {
  const prices = (await deps.prices.listActiveByProducts('workspace', link.productIds)).map((price) => ({ ...price, amountCents: price.amountCents + 1000, currency: 'EUR' }));
  const current = { ...deps, prices: { listActiveByProducts: async () => prices } };
  expect(await createSalesLink(ctx, input, current)).toMatchObject({ ok: true });
  expect(await getPublicSalesLink('workspace', link.slug, current)).toMatchObject({ ok: true, value: { totalCents: 4130, currency: 'EUR', lines: [{ grossCents: 2050 }, { grossCents: 2080 }] } });
});

it.each(['missing', 'ambiguous', 'imported', 'inactive', 'currency'])('rejects activation and hides offers with invalid prices: %s', async (reason) => {
  const prices = await deps.prices.listActiveByProducts('workspace', link.productIds);
  const first = prices[0];
  if (first === undefined) throw new Error('Missing price fixture');
  const invalid = reason === 'missing' ? prices.slice(1) : reason === 'ambiguous' ? [...prices, { ...first, id: 'other-price' }]
    : prices.map((price) => price.id !== first.id ? price : { ...price, ...(reason === 'imported' ? { imported: true } : reason === 'inactive' ? { active: false } : { currency: 'EUR' }) });
  const current = { ...deps, prices: { listActiveByProducts: async () => invalid } };
  expect(await createSalesLink(ctx, input, current)).toMatchObject({ ok: false });
  expect(await getPublicSalesLink('workspace', link.slug, current)).toMatchObject({ ok: false, error: { code: 'not_found' } });
});

it('exposes only public sales-link fields', async () => {
  const result = await getPublicSalesLink('workspace', link.slug, deps);
  expect(result.ok && result.value.salesLink).toEqual({ slug: link.slug, heading: link.heading, description: link.description, validFrom: null, validTo: null });
});
