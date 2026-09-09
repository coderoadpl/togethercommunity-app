import { and, asc, eq, inArray, isNull, lt, lte, or, sql } from 'drizzle-orm';

import { marketingOutboxSchema } from '#core/domain/marketing-outbox.js';
import type { MarketingOutboxRepository } from '#core/server/index.js';

import type { Db } from './client.js';
import { campaignSends, campaigns, emailEvents, marketingOutbox } from './schema.js';

const parse = (row: typeof marketingOutbox.$inferSelect) => marketingOutboxSchema.parse({
  ...row, nextAttemptAt: new Date(row.nextAttemptAt).toISOString(),
  createdAt: new Date(row.createdAt).toISOString(), updatedAt: new Date(row.updatedAt).toISOString(),
  lockedUntil: row.lockedUntil === null ? null : new Date(row.lockedUntil).toISOString(),
  payloadPurgedAt: row.payloadPurgedAt === null ? null : new Date(row.payloadPurgedAt).toISOString(),
});

export const createMarketingOutboxRepository = (db: Db): MarketingOutboxRepository => ({
  enqueue: async (tenantId, row) => {
    await db.insert(marketingOutbox).values(marketingOutboxSchema.parse({ ...row, tenantId }));
  },
  claim: async (tenantId, input) => db.transaction(async (tx) => {
    const [row] = await tx.select().from(marketingOutbox).where(and(
      eq(marketingOutbox.tenantId, tenantId), inArray(marketingOutbox.status, ['pending', 'retry']),
      lte(marketingOutbox.nextAttemptAt, input.now),
      or(isNull(marketingOutbox.lockedUntil), lte(marketingOutbox.lockedUntil, input.now)),
    )).orderBy(asc(marketingOutbox.nextAttemptAt), asc(marketingOutbox.id)).limit(1).for('update', { skipLocked: true });
    if (row === undefined) return null;
    const [claimed] = await tx.update(marketingOutbox).set({
      lockedBy: input.workerId, lockedUntil: input.lockedUntil, claimVersion: row.claimVersion + 1,
    }).where(and(eq(marketingOutbox.tenantId, tenantId), eq(marketingOutbox.id, row.id))).returning();
    return claimed === undefined ? null : parse(claimed);
  }),
  save: async (tenantId, row) => (await db.update(marketingOutbox).set({ ...marketingOutboxSchema.parse(row), tenantId }).where(and(
    eq(marketingOutbox.tenantId, tenantId), eq(marketingOutbox.id, row.id), eq(marketingOutbox.claimVersion, row.claimVersion),
  )).returning({ id: marketingOutbox.id })).length > 0,
  recoverExpired: async (tenantId, now) => db.transaction(async (tx) => {
    const rows = await tx.update(marketingOutbox).set({
      status: 'uncertain', lockedBy: null, lockedUntil: null, updatedAt: now,
      claimVersion: sql`${marketingOutbox.claimVersion} + 1`, lastError: 'Worker lease expired after dispatch began',
    }).where(and(eq(marketingOutbox.tenantId, tenantId), eq(marketingOutbox.status, 'dispatching'), lte(marketingOutbox.lockedUntil, now))).returning();
    for (const row of rows) await tx.insert(emailEvents).values({
      id: `${row.id}:uncertain:${String(row.claimVersion)}`, tenantId, mailKind: 'marketing', refId: row.campaignSendId,
      type: 'uncertain', meta: { error: row.lastError ?? 'Worker lease expired after dispatch began' }, occurredAt: now, createdAt: now,
    });
    return rows.length;
  }),
  listTenantIds: async () => (await db.select({ tenantId: marketingOutbox.tenantId }).from(marketingOutbox)
    .groupBy(marketingOutbox.tenantId).having(sql`bool_or(${marketingOutbox.status} IN ('pending', 'retry', 'dispatching'))`)
    .orderBy(sql`max(${marketingOutbox.updatedAt}) ASC`, asc(marketingOutbox.tenantId))).map((row) => row.tenantId),
  purge: async (tenantId, before, now) => (await db.update(marketingOutbox).set({ payload: null, payloadPurgedAt: now })
    .where(and(eq(marketingOutbox.tenantId, tenantId), inArray(marketingOutbox.status, ['sent', 'skipped', 'failed']), lt(marketingOutbox.updatedAt, before), isNull(marketingOutbox.payloadPurgedAt)))
    .returning({ id: marketingOutbox.id })).length,
  reconcile: async (tenantId, send, event) => {
    const [row] = await db.update(marketingOutbox).set({ status: 'sent', sesMessageId: send.sesMessageId, updatedAt: event.occurredAt,
      lockedBy: null, lockedUntil: null, claimVersion: sql`${marketingOutbox.claimVersion} + 1`, lastError: null,
    }).where(and(eq(marketingOutbox.tenantId, tenantId), eq(marketingOutbox.campaignSendId, send.id), inArray(marketingOutbox.status, ['dispatching', 'uncertain']))).returning();
    if (row === undefined) return;
    await db.update(campaignSends).set({ status: 'sent', sesMessageId: send.sesMessageId, sentAt: event.occurredAt }).where(and(eq(campaignSends.tenantId, tenantId), eq(campaignSends.id, send.id)));
    if (send.campaignId !== null) await db.update(campaigns).set({ sent: sql`${campaigns.sent} + 1` }).where(and(eq(campaigns.tenantId, tenantId), eq(campaigns.id, send.campaignId)));
    await db.insert(emailEvents).values(event);
  },
});
