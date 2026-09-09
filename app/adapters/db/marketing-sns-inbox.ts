import { and, asc, desc, eq, inArray, isNull, lt, lte, or, sql } from 'drizzle-orm';

import { appError, err, ok } from '#core/domain/index.js';
import { marketingSnsInboxSchema } from '#core/domain/marketing-sns-inbox.js';
import type { MarketingSnsInboxRepository } from '#core/server/index.js';

import type { Db } from './client.js';
import { marketingSnsInbox, marketingSnsInboxEvents } from './schema.js';

const parse = (row: typeof marketingSnsInbox.$inferSelect) => marketingSnsInboxSchema.parse({
  ...row, nextAttemptAt: new Date(row.nextAttemptAt).toISOString(), verifiedAt: new Date(row.verifiedAt).toISOString(),
  receivedAt: new Date(row.receivedAt).toISOString(),
  lockedUntil: row.lockedUntil === null ? null : new Date(row.lockedUntil).toISOString(),
  processedAt: row.processedAt === null ? null : new Date(row.processedAt).toISOString(),
});
export const createMarketingSnsInboxRepository = (db: Db): MarketingSnsInboxRepository => ({
  record: async (tenantId, input) => db.transaction(async (tx) => {
    const row = marketingSnsInboxSchema.parse({ ...input, tenantId });
    const [inserted] = await tx.insert(marketingSnsInbox).values(row).onConflictDoNothing().returning();
    if (inserted !== undefined) {
      await tx.insert(marketingSnsInboxEvents).values({ id: `${row.id}:received`, tenantId, inboxId: row.id, type: 'received', occurredAt: row.receivedAt });
      if (row.status === 'ignored') await tx.insert(marketingSnsInboxEvents).values({ id: `${row.id}:ignored:0`, tenantId, inboxId: row.id, type: 'ignored', occurredAt: row.receivedAt });
      return ok(parse(inserted));
    }
    const [existing] = await tx.select().from(marketingSnsInbox).where(and(eq(marketingSnsInbox.tenantId, tenantId), eq(marketingSnsInbox.topicArn, row.topicArn), eq(marketingSnsInbox.snsMessageId, row.snsMessageId)));
    return existing !== undefined && existing.bodySha256 === row.bodySha256
      ? ok(parse(existing)) : err(appError('conflict', 'SNS message ID has conflicting content'));
  }),
  claim: async (tenantId, input) => db.transaction(async (tx) => {
    const [row] = await tx.select().from(marketingSnsInbox).where(and(
      eq(marketingSnsInbox.tenantId, tenantId), inArray(marketingSnsInbox.status, ['pending', 'retry', 'processing']),
      lte(marketingSnsInbox.nextAttemptAt, input.now), or(isNull(marketingSnsInbox.lockedUntil), lte(marketingSnsInbox.lockedUntil, input.now)),
    )).orderBy(asc(marketingSnsInbox.nextAttemptAt), asc(marketingSnsInbox.id)).limit(1).for('update', { skipLocked: true });
    if (row === undefined) return null;
    const [claimed] = await tx.update(marketingSnsInbox).set({ status: 'processing', lockedBy: input.workerId, lockedUntil: input.lockedUntil, claimVersion: row.claimVersion + 1, attempts: row.attempts + 1 })
      .where(and(eq(marketingSnsInbox.tenantId, tenantId), eq(marketingSnsInbox.id, row.id))).returning();
    return claimed === undefined ? null : parse(claimed);
  }),
  save: async (tenantId, row) => db.transaction(async (tx) => {
    const [updated] = await tx.update(marketingSnsInbox).set({ ...marketingSnsInboxSchema.parse(row), tenantId }).where(and(eq(marketingSnsInbox.tenantId, tenantId), eq(marketingSnsInbox.id, row.id), eq(marketingSnsInbox.claimVersion, row.claimVersion))).returning();
    if (updated === undefined) return false;
    await tx.insert(marketingSnsInboxEvents).values({ id: `${row.id}:${row.status}:${String(row.claimVersion)}`, tenantId, inboxId: row.id, type: row.status, occurredAt: row.processedAt ?? row.nextAttemptAt });
    return true;
  }),
  list: async (tenantId) => (await db.select().from(marketingSnsInbox).where(eq(marketingSnsInbox.tenantId, tenantId)).orderBy(sql`CASE WHEN ${marketingSnsInbox.status} IN ('retry', 'dead_letter', 'processing', 'pending') THEN 0 ELSE 1 END`, desc(marketingSnsInbox.receivedAt)).limit(100)).map(parse),
  retry: async (tenantId, id, now, actor) => db.transaction(async (tx) => {
    const [row] = await tx.update(marketingSnsInbox).set({ status: 'retry', nextAttemptAt: now, lockedBy: null, lockedUntil: null, claimVersion: sql`${marketingSnsInbox.claimVersion} + 1` })
      .where(and(eq(marketingSnsInbox.tenantId, tenantId), eq(marketingSnsInbox.id, id), inArray(marketingSnsInbox.status, ['retry', 'dead_letter']), sql`${marketingSnsInbox.rawBody} is not null`)).returning();
    if (row === undefined) return false;
    await tx.insert(marketingSnsInboxEvents).values({ id: `${row.id}:replay:${String(row.claimVersion)}`, tenantId, inboxId: id, type: 'replay_requested', actor, occurredAt: now });
    return true;
  }),
  listTenantIds: async () => (await db.selectDistinct({ tenantId: marketingSnsInbox.tenantId }).from(marketingSnsInbox)
    .where(inArray(marketingSnsInbox.status, ['pending', 'retry', 'processing']))).map((row) => row.tenantId),
  purge: async (tenantId, before) => (await db.update(marketingSnsInbox).set({ rawBody: null }).where(and(eq(marketingSnsInbox.tenantId, tenantId), inArray(marketingSnsInbox.status, ['processed', 'ignored']), lt(marketingSnsInbox.processedAt, before), sql`${marketingSnsInbox.rawBody} is not null`)).returning({ id: marketingSnsInbox.id })).length,
});
