import { and, desc, eq, sql } from 'drizzle-orm';

import { invoiceSchema } from '@core/domain/index.js';
import type { InvoiceRepository } from '@core/server/index.js';

import type { Db } from './client.js';
import { fiscalArtifacts, invoiceEvents, invoices, ksefSubmissionJobs } from './app-schema.js';

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
          ),
        )
        .orderBy(desc(sql`${invoices.status} <> 'failed'`), desc(invoices.createdAt))
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
  claimRetry: async (tenantId, invoice, event) =>
    db.transaction(async (tx) => {
      const claimed = await tx
        .update(invoices)
        .set({ status: invoice.status, error: invoice.error })
        .where(
          and(
            eq(invoices.tenantId, tenantId),
            eq(invoices.id, invoice.id),
            eq(invoices.status, 'failed'),
          ),
        )
        .returning({ id: invoices.id });
      if (claimed.length === 0) return false;
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
            ksef: invoice.ksef,
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
  createFrozenKsef: async (tenantId, invoice, event, artifact, job) =>
    db.transaction(async (tx) => {
      const inserted = await tx
        .insert(invoices)
        .values({ ...invoice, tenantId })
        .onConflictDoNothing()
        .returning({ id: invoices.id });
      if (inserted.length === 0) return false;
      await tx.insert(fiscalArtifacts).values({ ...artifact, tenantId });
      await tx.insert(invoiceEvents).values({ ...event, tenantId });
      await tx.insert(ksefSubmissionJobs).values({ ...job, tenantId });
      return true;
    }),
  checkpointKsef: async (tenantId, invoice) => {
    const row = (
      await db
        .update(invoices)
        .set({
          status: invoice.status,
          providerInvoiceId: invoice.providerInvoiceId,
          invoiceNumber: invoice.invoiceNumber,
          error: invoice.error,
          issuedAt: invoice.issuedAt,
          ksef: invoice.ksef,
        })
        .where(and(
          eq(invoices.tenantId, tenantId),
          eq(invoices.id, invoice.id),
          sql`coalesce((${invoices.ksef}->>'version')::int, -1) = ${invoice.ksef?.version === undefined
            ? -1
            : invoice.ksef.version - 1}`,
        ))
        .returning()
    )[0];
    return row === undefined ? null : invoiceSchema.parse(row);
  },
});
