import { and, eq, or, sql } from 'drizzle-orm';

import { productDownloadAssetSchema } from '#core/domain/index.js';
import type { ProductDraftRepository } from '#core/server/index.js';

import type { Db } from './client.js';
import { checkoutSnapshots, orders, productDownloadAssets, productGrants, productPrices, products, salesLinks } from './schema.js';

export const createProductDraftRepository = (db: Db): ProductDraftRepository => ({
  deleteDraft: async (tenantId, productId) => db.transaction(async (tx) => {
    const [product] = await tx.select().from(products)
      .where(and(eq(products.tenantId, tenantId), eq(products.id, productId))).for('update');
    if (product === undefined) return { kind: 'not_found' };
    if (product.published || product.everPublished === true) return { kind: 'refused', reason: 'published' };
    if (product.everPublished === null) return { kind: 'refused', reason: 'unknown_history' };
    const lineReference = JSON.stringify([{ productId }]);
    const [order] = await tx.select({ id: orders.id }).from(orders).where(and(
      eq(orders.tenantId, tenantId),
      or(eq(orders.productId, productId), sql`${orders.lines} @> ${lineReference}::jsonb`),
    )).limit(1);
    if (order !== undefined) return { kind: 'refused', reason: 'orders' };
    const [grant] = await tx.select({ id: productGrants.id }).from(productGrants)
      .where(and(eq(productGrants.tenantId, tenantId), eq(productGrants.productId, productId))).limit(1);
    if (grant !== undefined) return { kind: 'refused', reason: 'grants' };
    const [link] = await tx.select({ id: salesLinks.id }).from(salesLinks)
      .where(and(eq(salesLinks.tenantId, tenantId), sql`${salesLinks.productIds} @> ${JSON.stringify([productId])}::jsonb`)).limit(1);
    if (link !== undefined) return { kind: 'refused', reason: 'sales_links' };
    const [checkout] = await tx.select({ id: checkoutSnapshots.id }).from(checkoutSnapshots)
      .where(and(eq(checkoutSnapshots.tenantId, tenantId), sql`${checkoutSnapshots.lines} @> ${lineReference}::jsonb`)).limit(1);
    if (checkout !== undefined) return { kind: 'refused', reason: 'checkout_snapshots' };
    const assets = await tx.delete(productDownloadAssets)
      .where(and(eq(productDownloadAssets.tenantId, tenantId), eq(productDownloadAssets.productId, productId))).returning();
    await tx.delete(productPrices).where(and(eq(productPrices.tenantId, tenantId), eq(productPrices.productId, productId)));
    await tx.delete(products).where(and(eq(products.tenantId, tenantId), eq(products.id, productId)));
    return { kind: 'deleted', assets: assets.map((asset) => productDownloadAssetSchema.parse(asset)) };
  }),
});
