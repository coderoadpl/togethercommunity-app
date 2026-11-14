import { err, productVariants, publicProductStock, firstSoldOutProductId, ok, notFound, validation, salesLinkInputSchema, salesLinkUpdateSchema, salesLinkAvailable, resolveProductVat, splitProductGross, type SalesLink, type Product, type ProductPrice, type Result, type AppError, type SalesLinkVariantSelection } from '#core/domain/index.js';
import { authorizeRequiredTenant } from '../authorize.js';
import type { Ctx } from '../context.js';
import type { SalesLinkDeps } from '../sales-link-ports.js';
import { renderPostContent } from '../post-content.js';
import { resolveSalesLinkPrices, salesLinkVariantEligible, selectSalesLinkVariants } from './checkout-selection.js';
import { toPublicCompliance } from './public-offer.js';

const validatedProducts = async (tenantId: string, link: Pick<SalesLink, 'productIds' | 'active'>, deps: SalesLinkDeps): Promise<Result<{ products: Product[]; prices: ProductPrice[] }, AppError>> => {
  const found = await deps.products.findByIds(tenantId, link.productIds);
  const products = link.productIds.flatMap((id) => found.filter((product) => product.id === id));
  if (products.length !== link.productIds.length) return err(validation('Every sales-link product must belong to this workspace'));
  if (products.some((product) => product.type === 'membership')) return err(validation('Subscriptions cannot be included in a sales link'));
  let prices: ProductPrice[] = [];
  if (link.active) {
    if (products.some((product) => !product.published)) return err(validation('Publish every product before activating the sales link'));
    const resolved = resolveSalesLinkPrices(products, await deps.prices.listActiveByProducts(tenantId, link.productIds));
    if (!resolved.ok) return resolved;
    prices = resolved.value;
    const settings = await deps.tenants.findSettings(tenantId);
    if (products.some((product) => resolveProductVat(product, settings) === null)) return err(validation('Configure a VAT rate for every sales-link product'));
  }
  return ok({ products, prices });
};

export const listSalesLinks = async (ctx: Ctx, deps: SalesLinkDeps) => {
  const tenant = authorizeRequiredTenant(ctx, 'product:read');
  return tenant.ok ? ok({ salesLinks: await deps.salesLinks.list(tenant.value) }) : tenant;
};
export const getSalesLink = async (ctx: Ctx, input: { id: string }, deps: SalesLinkDeps) => {
  const tenant = authorizeRequiredTenant(ctx, 'product:read');
  if (!tenant.ok) return tenant;
  const salesLink = await deps.salesLinks.findById(tenant.value, input.id);
  return salesLink === null ? err(notFound('Sales link was not found')) : ok({ salesLink });
};
export const createSalesLink = async (ctx: Ctx, input: unknown, deps: SalesLinkDeps) => {
  const tenant = authorizeRequiredTenant(ctx, 'product:write');
  if (!tenant.ok) return tenant;
  const parsed = salesLinkInputSchema.safeParse(input);
  if (!parsed.success) return err(validation('Invalid sales link', parsed.error.flatten()));
  const products = await validatedProducts(tenant.value, parsed.data, deps);
  if (!products.ok) return products;
  const now = deps.clock.nowIso();
  const saved = await deps.salesLinks.save(tenant.value, { ...parsed.data, id: deps.ids.nextId(), tenantId: tenant.value, revision: 1, createdAt: now, updatedAt: now }, null);
  return saved.ok ? ok({ salesLink: saved.value }) : saved;
};
export const updateSalesLink = async (ctx: Ctx, input: unknown, deps: SalesLinkDeps) => {
  const tenant = authorizeRequiredTenant(ctx, 'product:write');
  if (!tenant.ok) return tenant;
  const parsed = salesLinkUpdateSchema.safeParse(input);
  if (!parsed.success) return err(validation('Invalid sales link', parsed.error.flatten()));
  const existing = await deps.salesLinks.findById(tenant.value, parsed.data.id);
  if (existing === null) return err(notFound('Sales link was not found'));
  const products = await validatedProducts(tenant.value, parsed.data, deps);
  if (!products.ok) return products;
  const { expectedRevision, ...fields } = parsed.data;
  const saved = await deps.salesLinks.save(tenant.value, { ...existing, ...fields, revision: expectedRevision + 1, updatedAt: deps.clock.nowIso() }, expectedRevision);
  return saved.ok ? ok({ salesLink: saved.value }) : saved;
};
export const deleteSalesLink = async (ctx: Ctx, input: { id: string }, deps: SalesLinkDeps) => {
  const tenant = authorizeRequiredTenant(ctx, 'product:write');
  if (!tenant.ok) return tenant;
  const deleted = await deps.salesLinks.delete(tenant.value, input.id, deps.clock.nowIso());
  return deleted.ok ? ok({ deleted: true as const }) : deleted;
};
const buildPublicSalesLink = async (tenantId: string, salesLink: SalesLink, deps: SalesLinkDeps, selections?: SalesLinkVariantSelection[]) => {
  if (!salesLinkAvailable(salesLink, deps.clock.nowIso())) return err(notFound('Sales link was not found'));
  const products = await validatedProducts(tenantId, salesLink, deps);
  if (!products.ok) return err(notFound('Sales link was not found'));
  const settings = await deps.tenants.findSettings(tenantId);
  const bases = products.value.products;
  const first = products.value.prices[0];
  if (first === undefined) return err(notFound('Sales link was not found'));
  const published = selections === undefined || !bases.some((base) => base.variantGroup != null) ? [] : await deps.products.listPublishedByTenant(tenantId);
  const candidates = published.filter((product) => bases.some((base) => base.variantGroup != null && base.variantGroup === product.variantGroup));
  const prices = candidates.length === 0 ? products.value.prices : await deps.prices.listActiveByProducts(tenantId, [...new Set([...salesLink.productIds, ...candidates.map((product) => product.id)])]);
  const siblings = (base: Product) => published.filter((candidate) => candidate.id === base.id || salesLinkVariantEligible(base, candidate, prices, first.currency, settings));
  const selected = selectSalesLinkVariants(bases, selections ?? [], (base, id) => siblings(base).find((product) => product.id === id), false);
  if (!selected.ok) return selected;
  const stockIds = [...new Set([...selected.value.map((product) => product.id), ...bases.flatMap((base) => siblings(base).map((product) => product.id))])];
  const stock = await deps.stock?.listByProducts(tenantId, stockIds) ?? [];
  const soldOutIds = new Set(stock.filter((level) => publicProductStock(level).soldOut).map((level) => level.productId));
  const lines = selected.value.flatMap((product, index) => {
    const base = bases[index];
    const price = prices.find((item) => item.productId === product.id && item.active && item.kind === 'one_time' && item.imported !== true);
    const vat = resolveProductVat(product, settings);
    if (vat === null || price === undefined || base === undefined) return [];
    const vatRate = vat.kind === 'rate' ? vat.percent : 'exempt';
    return [{ baseProductId: base.id, variants: productVariants(base, siblings(base), soldOutIds), productId: product.id, name: product.title, type: product.type, deliveryMethod: product.deliveryMethod, compliance: toPublicCompliance(product.compliance), ...splitProductGross(price.amountCents, vatRate), vatRate, vatExemptionBasis: vat.kind === 'exempt' ? vat.basis : null }];
  });
  if (lines.length !== products.value.products.length) return err(notFound('Sales link was not found'));
  const soldOut = firstSoldOutProductId(selected.value.map((product) => product.id), stock) !== null;
  return ok({ salesLink: { slug: salesLink.slug, heading: salesLink.heading, description: salesLink.description, validFrom: salesLink.validFrom, validTo: salesLink.validTo }, descriptionHtml: renderPostContent(salesLink.description, 'markdown').html, lines, currency: first.currency, totalCents: lines.reduce((sum, line) => sum + line.grossCents, 0), soldOut });
};

export const getPublicSalesLink = async (tenantId: string, slug: string, deps: SalesLinkDeps, selections: SalesLinkVariantSelection[] = []) => {
  const salesLink = await deps.salesLinks.findBySlug(tenantId, slug);
  return salesLink === null ? err(notFound('Sales link was not found')) : buildPublicSalesLink(tenantId, salesLink, deps, selections);
};

export const listPublicSalesLinks = async (tenantId: string, deps: SalesLinkDeps, preloaded?: SalesLink[]) => {
  const links = (preloaded ?? await deps.salesLinks.list(tenantId)).filter((link) => link.listed && salesLinkAvailable(link, deps.clock.nowIso()));
  const offers = await Promise.all(links.map((link) => buildPublicSalesLink(tenantId, link, deps)));
  return offers.flatMap((offer, index) => offer.ok && links[index] !== undefined ? [{ id: links[index].id, slug: offer.value.salesLink.slug, heading: offer.value.salesLink.heading, description: offer.value.salesLink.description, totalCents: offer.value.totalCents, currency: offer.value.currency }] : []);
};
