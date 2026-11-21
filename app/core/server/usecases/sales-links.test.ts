import { beforeEach, describe, expect, it, vi } from 'vitest';
import { ok, productSchema, salesLinkOfferSchema, salesLinkSchema, type Product } from '#core/domain/index.js';
import type { Ctx } from '../context.js';
import type { SalesLinkDeps } from '../sales-link-ports.js';
import { createStockRepositoryFake } from '../testing/stock-fake.js';
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
  products: { findByIds, listPublishedByTenant: async () => products },
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

it('leaves the stored responsible person out of a line whose manufacturer is in the EU', async () => {
  const compliance = {
    manufacturerName: 'Example Workshop', manufacturerAddress: '1 Example Road, Example City', manufacturerEmail: 'safety@example.com', manufacturerOutsideEu: false,
    responsiblePersonName: 'Example EU Representative', responsiblePersonAddress: 'Example Street 1, Warsaw', responsiblePersonEmail: 'eu-rep@example.com',
    modelIdentifier: 'PRINT-1', safetyWarnings: '',
  };
  findByIds.mockResolvedValue(products.map((product) => product.id === 'print' ? { ...product, compliance } : product));
  const result = await getPublicSalesLink('workspace', link.slug, deps);
  if (!result.ok) throw new Error('offer failed');
  expect(Object.keys(result.value.lines[0]?.compliance ?? {}).filter((key) => key.startsWith('responsiblePerson'))).toEqual([]);
  expect(result.value.lines[0]?.compliance).toMatchObject({ manufacturerName: 'Example Workshop', manufacturerOutsideEu: false, modelIdentifier: 'PRINT-1' });
});

it('carries the product safety information of each line with the responsible person and the warnings rendered', async () => {
  const compliance = {
    manufacturerName: 'Example Workshop', manufacturerAddress: '1 Example Road, Example City', manufacturerEmail: 'safety@example.com', manufacturerOutsideEu: true,
    responsiblePersonName: 'Example EU Representative', responsiblePersonAddress: 'Example Street 1, Warsaw', responsiblePersonEmail: 'eu-rep@example.com',
    modelIdentifier: 'PRINT-1', safetyWarnings: 'Keep **dry**.',
  };
  findByIds.mockResolvedValue(products.map((product) => product.id === 'print' ? { ...product, compliance } : product));
  const result = await getPublicSalesLink('workspace', link.slug, deps);
  if (!result.ok) throw new Error('offer failed');
  expect(result.value.lines.map((line) => line.compliance)).toEqual([{ ...compliance, safetyWarningsHtml: '<p>Keep <strong>dry</strong>.</p>\n' }, null]);
});

it('carries the cover of each line so the offer can show the product picture beside its safety information', async () => {
  findByIds.mockResolvedValue(products.map((product) => product.id === 'print' ? { ...product, coverUrl: 'https://cdn.example.com/print.jpg' } : product));
  const result = await getPublicSalesLink('workspace', link.slug, deps);
  if (!result.ok) throw new Error('offer failed');
  expect(result.value.lines.map((line) => line.coverUrl)).toEqual(['https://cdn.example.com/print.jpg', null]);
  expect(salesLinkOfferSchema.parse(result.value).lines.map((line) => line.coverUrl)).toEqual(['https://cdn.example.com/print.jpg', null]);
});

it('carries the personalisation setting of each offer line and parses through the offer schema', async () => {
  const personalization = { label: 'Add an engraving', description: '', inputLabel: 'Engraving text', maxLength: 200, condition: null };
  findByIds.mockResolvedValue(products.map((product) => product.id === 'print' ? { ...product, personalization } : product));
  const result = await getPublicSalesLink('workspace', link.slug, deps);
  if (!result.ok) throw new Error('offer failed');
  expect(result.value.lines.map((line) => line.personalization)).toEqual([personalization, null]);
  expect(salesLinkOfferSchema.parse(result.value).lines.map((line) => line.personalization)).toEqual([personalization, null]);
});

describe('how many sets a buyer can take', () => {
  const offer = async (setUp: (stock: ReturnType<typeof createStockRepositoryFake>) => void) => {
    const stock = createStockRepositoryFake();
    setUp(stock);
    const result = await getPublicSalesLink('workspace', link.slug, { ...deps, stock: stock.repository });
    if (!result.ok) throw new Error('offer failed');
    return { soldOut: result.value.soldOut, available: result.value.available, maxQuantities: result.value.lines.map((line) => line.maxQuantity) };
  };

  it('has no count and one unit per line when no product is tracked', async () => {
    expect(await offer(() => undefined)).toEqual({ soldOut: false, available: null, maxQuantities: [1, 1] });
  });

  it('is the smallest available count over the tracked lines', async () => {
    expect(await offer((stock) => {
      stock.track('workspace', 'print', 7);
      stock.track('workspace', 'digital', 3);
      const held = stock.levels.get('workspace', 'print');
      if (held !== null) held.reserved = 5;
    })).toEqual({ soldOut: false, available: 2, maxQuantities: [1, 1] });
  });

  it('ignores an untracked line', async () => {
    expect(await offer((stock) => stock.track('workspace', 'digital', 4))).toEqual({ soldOut: false, available: 4, maxQuantities: [1, 1] });
  });

  it('is zero and sold out when one tracked line has nothing left', async () => {
    const result = await offer((stock) => {
      stock.track('workspace', 'print', 5);
      stock.track('workspace', 'digital', 0);
    });
    expect(result).toEqual({ soldOut: true, available: 0, maxQuantities: [1, 0] });
  });
});

it('parses an offer recorded before the counts with one unit per line and no set count', () => {
  const recorded = { salesLink: { slug: 'collection', heading: 'Your collection', description: '', validFrom: null, validTo: null }, descriptionHtml: '', currency: 'PLN', totalCents: 1050,
    lines: [{ productId: 'print', name: 'Printed item', type: 'physical', grossCents: 1050, netCents: 1000, vatCents: 50, vatRate: 5, vatExemptionBasis: null }] };
  const parsed = salesLinkOfferSchema.parse(recorded);
  expect({ soldOut: parsed.soldOut, available: parsed.available, maxQuantity: parsed.lines[0]?.maxQuantity }).toEqual({ soldOut: false, available: null, maxQuantity: 1 });
  expect(salesLinkOfferSchema.safeParse({ ...recorded, available: -1 }).success).toBe(false);
  expect(salesLinkOfferSchema.safeParse({ ...recorded, lines: [{ ...recorded.lines[0], maxQuantity: -1 }] }).success).toBe(false);
});
