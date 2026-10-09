import { and, asc, eq, sql } from 'drizzle-orm';

import { orderSchema, SALES_LINK_TIME_ZONE } from '#core/domain/index.js';
import type { ConsumerSalesRepository } from '#core/server/index.js';

import type { Db } from './client.js';
import { invoices, orders } from './schema.js';

export const createConsumerSalesRepository = (db: Db): ConsumerSalesRepository => ({
  listUninvoicedConsumers: async (tenantId, query) => (
    await db.select().from(orders).where(and(
      eq(orders.tenantId, tenantId),
      eq(orders.mode, 'live'),
      eq(orders.status, 'paid'),
      sql`nullif(${orders.billing}->>'nip', '') IS NULL`,
      sql`(${orders.createdAt}::timestamptz AT TIME ZONE ${SALES_LINK_TIME_ZONE})::date BETWEEN ${query.from}::date AND ${query.to}::date`,
      sql`NOT EXISTS (SELECT 1 FROM ${invoices}
        WHERE ${invoices.tenantId} = ${orders.tenantId}
          AND ${invoices.orderId} = ${orders.id}
          AND (${invoices.status} IN ('requested', 'queued', 'submitting', 'processing', 'issued', 'delivered', 'conflict')
            OR ${invoices.error} = 'provider_create_uncertain'
            OR ${invoices.issuedAt} IS NOT NULL
            OR (${invoices.provider} = 'ifirma' AND ${invoices.providerInvoiceId} IS NOT NULL)
            OR ${invoices.ksef}->>'ksefNumber' IS NOT NULL
            OR ${invoices.ksef}->>'originalKsefNumber' IS NOT NULL))`,
    )).orderBy(asc(orders.createdAt), asc(orders.id))
  ).map((row) => orderSchema.parse(row)),
});
