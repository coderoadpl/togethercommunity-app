import { and, desc, eq, ne } from 'drizzle-orm';

import { invoiceSchema } from '@core/domain/index.js';
import type { InvoiceRepository } from '@core/server/index.js';

import type { Db } from './client.js';
import { invoiceEvents, invoices } from './app-schema.js';

export const createInvoiceRepository = (db: Db): InvoiceRepository => ({
  findById: async (tenantId, id) => {
    const row = (
      await db
        .select()
        .from(invoices)
        .where(and(eq(invoices.tenantId, tenantId), eq(invoices.id, id)))
        .limit(1)
    )[0];
    return row === undefined ? null : invoiceSchema.parse(row);
  },
  findCurrentByOrder: async (tenantId, orderId) => {
    const row = (
      await db
        .select()
        .from(invoices)
        .where(
          and(
            eq(invoices.tenantId, tenantId),
            eq(invoices.orderId, orderId),
            ne(invoices.status, 'failed'),
          ),
        )
        .orderBy(desc(invoices.createdAt))
        .limit(1)
    )[0];
    return row === undefined ? null : invoiceSchema.parse(row);
  },
  create: async (tenantId, invoice, event) =>
    db.transaction(async (tx) => {
      const inserted = await tx
        .insert(invoices)
        .values({ ...invoice, tenantId })
        .onConflictDoNothing()
        .returning({ id: invoices.id });
      if (inserted.length === 0) return false;
      await tx.insert(invoiceEvents).values({ ...event, tenantId });
      return true;
    }),
  update: async (tenantId, invoice, event) =>
    db.transaction(async (tx) => {
      const row = (
        await tx
          .update(invoices)
          .set({
            status: invoice.status,
            providerInvoiceId: invoice.providerInvoiceId,
            invoiceNumber: invoice.invoiceNumber,
            pdfUrl: invoice.pdfUrl,
            error: invoice.error,
            issuedAt: invoice.issuedAt,
          })
          .where(and(eq(invoices.tenantId, tenantId), eq(invoices.id, invoice.id)))
          .returning()
      )[0];
      if (row === undefined) return null;
      await tx.insert(invoiceEvents).values({ ...event, tenantId });
      return invoiceSchema.parse(row);
    }),
  appendEvent: async (tenantId, event) => {
    await db.insert(invoiceEvents).values({ ...event, tenantId });
  },
});
