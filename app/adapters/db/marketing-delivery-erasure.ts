import { and, eq, sql } from 'drizzle-orm';

import { marketingSnsJsonValue, storedSnsEnvelopeSchema } from '#core/domain/marketing-sns-inbox.js';

import type { Db } from './client.js';
import { campaignSends, emailEvents, marketingOutbox, marketingSnsInbox, marketingSnsInboxEvents } from './schema.js';

export const eraseMarketingDeliveryPayloads = async (db: Db, tenantId: string, input: { email: string; deletedAt: string }): Promise<void> => {
  const address = input.email.toLowerCase();
  const erased = await db.update(marketingOutbox).set({ payload: null, payloadPurgedAt: input.deletedAt,
    status: sql`CASE WHEN ${marketingOutbox.status} IN ('pending', 'retry') THEN 'skipped' WHEN ${marketingOutbox.status} = 'dispatching' THEN 'uncertain' ELSE ${marketingOutbox.status} END`,
    lockedBy: null, lockedUntil: null, claimVersion: sql`${marketingOutbox.claimVersion} + 1`, updatedAt: input.deletedAt,
  }).where(and(eq(marketingOutbox.tenantId, tenantId), sql`lower(${marketingOutbox.payload}->>'to') = ${address}`)).returning();
  for (const row of erased) {
    if (row.status !== 'skipped') continue;
    const [send] = await db.update(campaignSends).set({ status: 'skipped', skipReason: 'suppressed' }).where(and(eq(campaignSends.tenantId, tenantId), eq(campaignSends.id, row.campaignSendId), eq(campaignSends.status, 'pending'))).returning();
    if (send !== undefined) await db.insert(emailEvents).values({ id: crypto.randomUUID(), tenantId, mailKind: 'marketing', refId: send.id, type: 'skipped', meta: { reason: 'suppressed', source: 'erasure', ...(send.runId === null ? {} : { runId: send.runId }) }, occurredAt: input.deletedAt, createdAt: input.deletedAt });
  }
  const receipts = await db.select().from(marketingSnsInbox).where(and(eq(marketingSnsInbox.tenantId, tenantId), sql`${marketingSnsInbox.rawBody} IS NOT NULL`));
  for (const receipt of receipts) {
    const envelope = storedSnsEnvelopeSchema.safeParse(marketingSnsJsonValue(receipt.rawBody ?? ''));
    const content = envelope.success ? JSON.stringify(marketingSnsJsonValue(envelope.data.Message)) : receipt.rawBody;
    if (!content?.toLowerCase().includes(address)) continue;
    const terminal = receipt.status === 'processed' || receipt.status === 'ignored';
    await db.update(marketingSnsInbox).set({ rawBody: null, status: terminal ? receipt.status : 'ignored',
      ignoreReason: terminal ? receipt.ignoreReason : 'Recipient erasure', processedAt: receipt.processedAt ?? input.deletedAt,
      lockedBy: null, lockedUntil: null, claimVersion: sql`${marketingSnsInbox.claimVersion} + 1`, lastError: null,
    }).where(and(eq(marketingSnsInbox.tenantId, tenantId), eq(marketingSnsInbox.id, receipt.id)));
    await db.insert(marketingSnsInboxEvents).values({ id: crypto.randomUUID(), tenantId, inboxId: receipt.id, type: 'payload_erased', occurredAt: input.deletedAt });
  }
};
