import { and, desc, eq, inArray, isNull, sql } from 'drizzle-orm';
import { appError, err, notFound, ok, salesLinkSchema, validation } from '#core/domain/index.js';
import type { SalesLinkRepository } from '#core/server/index.js';
import type { Db } from './client.js';
import { orders, products } from './app-schema.js';
import { salesLinks, salesLinkEvents } from './sales-link-schema.js';

const parseRow = (row: typeof salesLinks.$inferSelect) => salesLinkSchema.parse({ ...row, validFrom: row.validFrom === null ? null : new Date(row.validFrom).toISOString(), validTo: row.validTo === null ? null : new Date(row.validTo).toISOString(), createdAt: new Date(row.createdAt).toISOString(), updatedAt: new Date(row.updatedAt).toISOString() });
export const createSalesLinkRepository = (db: Db): SalesLinkRepository => ({
  list: async (tenantId) => (await db.select().from(salesLinks).where(and(eq(salesLinks.tenantId, tenantId), isNull(salesLinks.deletedAt))).orderBy(desc(salesLinks.createdAt), salesLinks.id)).map(parseRow),
  findById: async (tenantId, id) => {
    const [row] = await db.select().from(salesLinks).where(and(eq(salesLinks.tenantId, tenantId), eq(salesLinks.id, id), isNull(salesLinks.deletedAt)));
    return row === undefined ? null : parseRow(row);
  },
  findBySlug: async (tenantId, slug) => {
    const [row] = await db.select().from(salesLinks).where(and(eq(salesLinks.tenantId, tenantId), eq(salesLinks.slug, slug), isNull(salesLinks.deletedAt)));
    return row === undefined ? null : parseRow(row);
  },
  save: async (tenantId, input, expectedRevision) => db.transaction(async (tx) => {
    const link = salesLinkSchema.parse({ ...input, tenantId });
    await tx.execute(sql`SELECT pg_advisory_xact_lock(hashtextextended(${`sales-links:${tenantId}`}, 0))`);
    if (expectedRevision !== null) {
      const [existing] = await tx.select().from(salesLinks).where(and(eq(salesLinks.tenantId, tenantId), eq(salesLinks.id, link.id), isNull(salesLinks.deletedAt))).for('update');
      if (existing === undefined) return err(notFound('Sales link was not found'));
      if (existing.revision !== expectedRevision) return err(appError('conflict', 'Sales link changed; reload before saving'));
    }
    const [sameSlug] = await tx.select({ id: salesLinks.id }).from(salesLinks).where(and(eq(salesLinks.tenantId, tenantId), eq(salesLinks.slug, link.slug), isNull(salesLinks.deletedAt)));
    if (sameSlug !== undefined && sameSlug.id !== link.id) return err(appError('conflict', 'Sales-link slug already exists'));
    const included = await tx.select().from(products).where(and(eq(products.tenantId, tenantId), inArray(products.id, link.productIds))).orderBy(products.id).for('share');
    if (included.length !== link.productIds.length || (link.active && included.some((product) => !product.published))) return err(validation('Every active sales-link product must be published in this workspace'));
    const rows = expectedRevision === null
      ? await tx.insert(salesLinks).values(link).onConflictDoNothing().returning()
      : await tx.update(salesLinks).set(link).where(and(eq(salesLinks.tenantId, tenantId), eq(salesLinks.id, link.id), eq(salesLinks.revision, expectedRevision), isNull(salesLinks.deletedAt))).returning();
    const row = rows[0];
    if (row === undefined) return err(appError('conflict', 'Sales-link id or revision already exists'));
    await tx.insert(salesLinkEvents).values({ tenantId, salesLinkId: link.id, revision: link.revision, type: expectedRevision === null ? 'created' : 'updated', snapshot: link, occurredAt: link.updatedAt });
    return ok(parseRow(row));
  }),
  delete: async (tenantId, id, occurredAt) => db.transaction(async (tx) => {
    await tx.execute(sql`SELECT pg_advisory_xact_lock(hashtextextended(${`sales-links:${tenantId}`}, 0))`);
    const [existing] = await tx.select().from(salesLinks).where(and(eq(salesLinks.tenantId, tenantId), eq(salesLinks.id, id), isNull(salesLinks.deletedAt))).for('update');
    if (existing === undefined) return err(notFound('Sales link was not found'));
    const [paid] = await tx.select({ id: orders.id }).from(orders).where(and(eq(orders.tenantId, tenantId), eq(orders.salesLinkId, id), inArray(orders.status, ['paid', 'partially_refunded', 'refunded']))).limit(1);
    if (paid !== undefined) return err(appError('conflict', 'This sales link has paid orders; deactivate it instead'));
    const revision = existing.revision + 1;
    await tx.update(salesLinks).set({ deletedAt: occurredAt, active: false, revision, updatedAt: occurredAt }).where(and(eq(salesLinks.tenantId, tenantId), eq(salesLinks.id, id)));
    await tx.insert(salesLinkEvents).values({ tenantId, salesLinkId: id, revision, type: 'deleted', snapshot: { ...parseRow(existing), revision, active: false, updatedAt: occurredAt }, occurredAt });
    return ok(undefined);
  }),
});
