import { and, desc, eq, lt, or } from 'drizzle-orm';

import { DOWNLOAD_COPY_PAGE_SIZE, downloadCopySchema } from '#core/domain/index.js';
import type { DownloadCopyRepository, DownloadCopyOrderReader } from '#core/server/index.js';

import type { Db } from './client.js';
import { downloadCopies, members, orders } from './schema.js';

export const createDownloadCopyRepository = (db: Db): DownloadCopyRepository => ({
  create: async (tenantId, copy) => db.transaction(async (tx) => {
    const [member] = await tx.select({ deletedAt: members.deletedAt }).from(members)
      .where(and(eq(members.tenantId, tenantId), eq(members.id, copy.memberId))).for('update');
    if (!member || member.deletedAt !== null) return false;
    await tx.insert(downloadCopies).values(downloadCopySchema.parse({ ...copy, tenantId }));
    return true;
  }),
  list: async (tenantId, query) => (await db.select().from(downloadCopies).where(and(
    eq(downloadCopies.tenantId, tenantId),
    query.cursor === undefined ? undefined : or(
      lt(downloadCopies.createdAt, query.cursor.createdAt),
      and(eq(downloadCopies.createdAt, query.cursor.createdAt), lt(downloadCopies.id, query.cursor.id)),
    ),
    query.memberId === undefined ? undefined : eq(downloadCopies.memberId, query.memberId),
    query.orderId === undefined ? undefined : eq(downloadCopies.orderId, query.orderId),
    query.productId === undefined ? undefined : eq(downloadCopies.productId, query.productId),
    query.copyIdentifier === undefined ? undefined : eq(downloadCopies.copyIdentifier, query.copyIdentifier),
  )).orderBy(desc(downloadCopies.createdAt), desc(downloadCopies.id)).limit(DOWNLOAD_COPY_PAGE_SIZE)).map((row) => downloadCopySchema.parse(row)),
});

export const createDownloadCopyOrderReader = (db: Db): DownloadCopyOrderReader => ({
  findLatestPaidOrderId: async (tenantId, memberId, productId) => {
    const [order] = await db.select({ id: orders.id }).from(orders).where(and(
      eq(orders.tenantId, tenantId), eq(orders.memberId, memberId),
      eq(orders.productId, productId), eq(orders.status, 'paid'),
    )).orderBy(desc(orders.createdAt), desc(orders.id)).limit(1);
    return order?.id ?? null;
  },
});
