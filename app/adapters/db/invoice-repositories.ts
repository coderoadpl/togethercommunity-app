import { and, desc, eq, sql } from 'drizzle-orm';

import { invoiceEventSchema, invoiceSchema } from '#core/domain/index.js';
import type { InvoiceRepository, KsefSubmissionRepository } from '#core/server/index.js';

import type { Db } from './client.js';
import { fiscalArtifacts, invoiceEvents, invoices, ksefSubmissionJobs, orders } from './app-schema.js';

export const createInvoiceRepository = (
  db: Db,
): InvoiceRepository & KsefSubmissionRepository => ({
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
  findByIdForMember: async (tenantId, memberId, id) => {
    const row = (
      await db
        .select({ invoice: invoices })
        .from(invoices)
        .innerJoin(
          orders,
          and(
            eq(orders.tenantId, invoices.tenantId),
            eq(orders.id, invoices.orderId),
            eq(orders.memberId, memberId),
          ),
        )
        .where(and(eq(invoices.tenantId, tenantId), eq(invoices.id, id)))
        .limit(1)
    )[0];
    return row === undefined ? null : invoiceSchema.parse(row.invoice);
  },
  listForMember: async (tenantId, memberId) =>
    (
      await db
        .select({ invoice: invoices })
        .from(invoices)
        .innerJoin(
          orders,
          and(
            eq(orders.tenantId, invoices.tenantId),
            eq(orders.id, invoices.orderId),
            eq(orders.memberId, memberId),
          ),
        )
        .where(eq(invoices.tenantId, tenantId))
        .orderBy(desc(invoices.createdAt), desc(invoices.id))
    ).map((row) => invoiceSchema.parse(row.invoice)),
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
  findLatestRequestedEvent: async (tenantId, invoiceId) => {
    const row = (
      await db
        .select()
        .from(invoiceEvents)
        .where(and(
          eq(invoiceEvents.tenantId, tenantId),
          eq(invoiceEvents.invoiceId, invoiceId),
          eq(invoiceEvents.type, 'requested'),
        ))
        .orderBy(desc(invoiceEvents.occurredAt))
        .limit(1)
    )[0];
    return row === undefined ? null : invoiceEventSchema.parse(row);
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
  checkpointKsef: async (tenantId, invoice, event) =>
    db.transaction(async (tx) => {
      const row = (
        await tx
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
      if (row === undefined) return null;
      await tx.insert(invoiceEvents).values({ ...event, tenantId });
      return invoiceSchema.parse(row);
    }),
});
