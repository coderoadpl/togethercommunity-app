import { and, asc, desc, eq, lte, ne, sql } from 'drizzle-orm';
import { err, metaCapiEventSchema, notFound, ok, orderSchema } from '#core/domain/index.js';
import type { MetaCapiOrder, MetaCapiOrderAccess, MetaCapiRepository } from '#core/server/meta-capi-ports.js';
import type { Db } from './client.js';
import { members, orders, products } from './app-schema.js';
import { salesLinks } from './sales-link-schema.js';
import { metaCapiConsentEvidence, metaCapiEvents, metaCapiOutbox } from './meta-capi-schema.js';
import { normalizeOrderDates } from './order-dates.js';

const accessFilter = (access: MetaCapiOrderAccess) => 'sessionId' in access
  ? sql`${orders.providerObjectIds}->>'checkoutSession' = ${access.sessionId}`
  : 'orderToken' in access ? eq(orders.verificationToken, access.orderToken)
    : and(eq(orders.id, access.orderId), eq(orders.memberId, access.memberId));
const stateOf = (row: typeof orders.$inferSelect) => ({ consent: row.metaCapiConsent, withdrawnAt: row.metaCapiConsentWithdrawnAt });

export const createMetaCapiRepository = (db: Db, resolveOrigin: (tenantId: string) => Promise<string>): MetaCapiRepository => {
  const enrich = async (connection: Db, tenantId: string, row: typeof orders.$inferSelect): Promise<MetaCapiOrder> => {
    const member = (await connection.select({ email: members.email }).from(members)
      .where(and(eq(members.tenantId, tenantId), eq(members.id, row.memberId))).limit(1))[0];
    const product = (await connection.select({ slug: products.slug }).from(products)
      .where(and(eq(products.tenantId, tenantId), eq(products.id, row.productId))).limit(1))[0];
    const link = row.salesLinkId === null ? undefined : (await connection.select({ slug: salesLinks.slug }).from(salesLinks)
      .where(and(eq(salesLinks.tenantId, tenantId), eq(salesLinks.id, row.salesLinkId))).limit(1))[0];
    const path = link ? `/offer/${encodeURIComponent(link.slug)}` : `/checkout/${encodeURIComponent(product?.slug ?? '')}`;
    return {
      order: orderSchema.parse(normalizeOrderDates(row)), consent: stateOf(row), consentAt: row.metaCapiConsentAt,
      email: member?.email ?? '', sourceUrl: new URL(path, await resolveOrigin(tenantId)).toString(),
    };
  };
  return {
    findOrder: async (tenantId, access) => {
      const row = (await db.select().from(orders).where(and(eq(orders.tenantId, tenantId), accessFilter(access))).limit(1))[0];
      return row ? enrich(db, tenantId, row) : null;
    },
    decide: async (tenantId, access, decide) => db.transaction(async (tx) => {
      const row = (await tx.select().from(orders).where(and(eq(orders.tenantId, tenantId), accessFilter(access))).limit(1).for('update'))[0];
      if (!row) return err(notFound('Order not found'));
      const decision = await decide(await enrich(tx, tenantId, row));
      if (!decision.ok) return decision;
      const { capture, decision: choice } = decision.value;
      if (row.metaCapiConsentWithdrawnAt !== null || (choice !== 'withdrawn' && row.metaCapiConsent !== 'undecided')) return ok(stateOf(row));
      const source = 'memberId' in access ? 'account-privacy' : 'orderToken' in access ? 'order-link' : 'return-page';
      const updated = (await tx.update(orders).set(choice === 'withdrawn' ? { metaCapiConsentWithdrawnAt: capture.at } : {
        metaCapiConsent: choice, metaCapiConsentAt: capture.at,
        metaCapiConsentTextVersion: capture.textVersion, metaCapiConsentSource: source,
      }).where(and(eq(orders.tenantId, tenantId), eq(orders.id, row.id))).returning())[0];
      await tx.insert(metaCapiConsentEvidence).values({ tenantId, orderId: row.id, decision: choice,
        occurredAt: capture.at, textVersion: capture.textVersion, textSnapshot: capture.textSnapshot, source }).onConflictDoNothing();
      if (choice === 'granted') {
        await tx.insert(metaCapiOutbox).values({ tenantId, orderId: row.id, availableAt: capture.at, consentAt: capture.at,
          ip: capture.ip, userAgent: capture.userAgent, fbp: capture.fbp, textVersion: capture.textVersion, textSnapshot: capture.textSnapshot }).onConflictDoNothing();
      } else {
        await tx.delete(metaCapiOutbox).where(and(eq(metaCapiOutbox.tenantId, tenantId), eq(metaCapiOutbox.orderId, row.id)));
        await tx.insert(metaCapiEvents).values({ tenantId, transactionId: row.id, orderId: row.id,
          consentAt: row.metaCapiConsentAt ?? capture.at, eventTime: row.paidAt == null ? null : new Date(row.paidAt).toISOString(),
          recordedAt: capture.at, sentAt: null, status: 'blocked', fbtraceId: null, error: null, fieldsSent: [] }).onConflictDoNothing();
      }
      return ok(updated ? stateOf(updated) : stateOf(row));
    }),
    processNext: async (tenantId, now, process) => db.transaction(async (tx) => {
      const found = (await tx.select({ order: orders, job: metaCapiOutbox }).from(orders)
        .innerJoin(metaCapiOutbox, and(eq(metaCapiOutbox.orderId, orders.id), eq(metaCapiOutbox.tenantId, orders.tenantId)))
        .where(and(eq(orders.tenantId, tenantId), eq(metaCapiOutbox.tenantId, tenantId), lte(metaCapiOutbox.availableAt, now)))
        .orderBy(asc(metaCapiOutbox.availableAt)).limit(1).for('update', { of: orders, skipLocked: true }))[0];
      if (!found) return false;
      const filter = and(eq(metaCapiOutbox.tenantId, tenantId), eq(metaCapiOutbox.orderId, found.order.id));
      const prior = (await tx.select().from(metaCapiEvents).where(and(eq(metaCapiEvents.tenantId, tenantId), eq(metaCapiEvents.transactionId, found.order.id))).limit(1))[0];
      if (prior) { await tx.delete(metaCapiOutbox).where(filter); return true; }
      const outcome = await process({ ...await enrich(tx, tenantId, found.order), attempts: found.job.attempts,
        capture: { ip: found.job.ip, userAgent: found.job.userAgent, fbp: found.job.fbp, at: found.job.consentAt,
          textVersion: found.job.textVersion, textSnapshot: found.job.textSnapshot } });
      if ('retryAt' in outcome) {
        await tx.update(metaCapiOutbox).set({ attempts: found.job.attempts + 1, availableAt: outcome.retryAt }).where(filter);
      } else {
        await tx.insert(metaCapiEvents).values({ ...outcome.event, tenantId, transactionId: found.order.id, orderId: found.order.id }).onConflictDoNothing();
        await tx.delete(metaCapiOutbox).where(filter);
      }
      return true;
    }),
    listEvents: async (tenantId) => (await db.select().from(metaCapiEvents).where(eq(metaCapiEvents.tenantId, tenantId))
      .orderBy(desc(metaCapiEvents.recordedAt)).limit(100)).map((row) => metaCapiEventSchema.parse(row)),
    listMemberConsents: async (tenantId, memberId) => (await db.select({ orderId: orders.id, consent: orders.metaCapiConsent,
      withdrawnAt: orders.metaCapiConsentWithdrawnAt, consentAt: orders.metaCapiConsentAt }).from(orders)
      .where(and(eq(orders.tenantId, tenantId), eq(orders.memberId, memberId), ne(orders.metaCapiConsent, 'undecided')))
      .orderBy(desc(orders.createdAt))),
  };
};
