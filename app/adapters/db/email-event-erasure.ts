import { and, asc, eq, gt, inArray, isNotNull, or, sql } from 'drizzle-orm';

import { emailEventSchema, normalizeEmail, snapshotPayloadsEqual, type EmailEventType } from '#core/domain/index.js';
import { readStoredMarketingSesCorrelations, scrubErasedMarketingSnsBody, type MarketingSesCorrelation } from '#core/domain/marketing-sns-erasure.js';
import { scrubErasedEmailEvent } from '#core/domain/email-event-erasure.js';
import type { EmailHmac } from '#core/server/index.js';

import type { Db } from './client.js';
import { campaignSends, emailEvents, emailOutbox, erasedMemberImports, marketingContacts, marketingSnsInbox, members, suppressions } from './schema.js';

export const lockEmailEventErasure = async (db: Db, tenantId: string): Promise<void> => {
  // Feedback and erasure must observe one order, including feedback that started before the member was erased.
  await db.execute(sql`select pg_advisory_xact_lock(hashtextextended(${tenantId}, 814))`);
};

const scrubRow = (row: typeof emailEvents.$inferSelect) => scrubErasedEmailEvent(emailEventSchema.parse({
  ...row, occurredAt: new Date(row.occurredAt).toISOString(), createdAt: new Date(row.createdAt).toISOString(),
}));

const scrubInbox = async (
  db: Db, tenantId: string, matches: (event: MarketingSesCorrelation) => boolean, apply: boolean, hmac: EmailHmac,
): Promise<{ matched: number; changed: number }> => {
  const totals = { matched: 0, changed: 0 };
  let cursor: string | undefined;
  while (true) {
    const rows = await db.select().from(marketingSnsInbox).where(and(eq(marketingSnsInbox.tenantId, tenantId),
      cursor === undefined ? undefined : gt(marketingSnsInbox.id, cursor))).orderBy(asc(marketingSnsInbox.id)).limit(500);
    if (rows.length === 0) break;
    for (const row of rows) {
      if (row.messageType !== 'Notification' || !readStoredMarketingSesCorrelations(row.rawBody, row.topicArn).some(matches)) continue;
      totals.matched += 1;
      const rawBody = scrubErasedMarketingSnsBody(row.rawBody, row.topicArn, (email) => hmac.compute(tenantId, email));
      if (rawBody === row.rawBody) continue;
      totals.changed += 1;
      if (apply) await db.update(marketingSnsInbox).set({ rawBody }).where(and(eq(marketingSnsInbox.tenantId, tenantId), eq(marketingSnsInbox.id, row.id)));
    }
    cursor = rows.at(-1)?.id;
  }
  return totals;
};

export const scrubMemberEmailEvents = async (
  db: Db,
  tenantId: string,
  input: { memberId: string; email: string; emailHmac: string },
  hmac: EmailHmac,
): Promise<void> => {
  const address = normalizeEmail(input.email);
  const sends = await db.select({ id: campaignSends.id, sesMessageId: campaignSends.sesMessageId }).from(campaignSends).where(and(eq(campaignSends.tenantId, tenantId), or(
    eq(campaignSends.memberId, input.memberId), sql`lower(btrim(${campaignSends.email})) = ${address}`,
    inArray(campaignSends.contactId, db.select({ id: marketingContacts.id }).from(marketingContacts).where(and(
      eq(marketingContacts.tenantId, tenantId), or(eq(marketingContacts.memberId, input.memberId), eq(marketingContacts.emailHmac, input.emailHmac)),
    ))),
  )));
  const outbox = await db.select({ id: emailOutbox.id, sesMessageId: emailOutbox.sesMessageId }).from(emailOutbox)
    .where(and(eq(emailOutbox.tenantId, tenantId), sql`lower(btrim(${emailOutbox.to})) = ${address}`));
  const sendIds = new Set(sends.map((row) => row.id));
  const messageIds = new Set([...sends, ...outbox].flatMap((row) => row.sesMessageId === null ? [] : [row.sesMessageId]));
  await scrubInbox(db, tenantId, (event) => messageIds.has(event.messageId)
    || (event.campaignSendId !== undefined && sendIds.has(event.campaignSendId))
    || event.recipients.some((email) => normalizeEmail(email) === address), true, hmac);
  const rows = await db.select().from(emailEvents).where(and(eq(emailEvents.tenantId, tenantId), or(
    and(eq(emailEvents.mailKind, 'marketing'), inArray(emailEvents.refId, [...sendIds])),
    and(eq(emailEvents.mailKind, 'transactional'), inArray(emailEvents.refId, outbox.map((row) => row.id))),
  )));
  for (const row of rows) {
    await db.update(emailEvents).set({ meta: scrubRow(row).meta }).where(and(eq(emailEvents.tenantId, tenantId), eq(emailEvents.id, row.id)));
  }
};

export const repairErasedEmailEvents = async (
  db: Db,
  tenantId: string,
  hmac: EmailHmac,
  apply: boolean,
): Promise<{ matched: Partial<Record<EmailEventType, number>>; changed: Partial<Record<EmailEventType, number>>; unlinked: number; inbox: { matched: number; changed: number } }> => db.transaction(async (tx) => {
  await lockEmailEventErasure(tx, tenantId);
  const erased = await tx.select({ id: members.id, email: members.email }).from(members)
    .where(and(eq(members.tenantId, tenantId), isNotNull(members.deletedAt)));
  const imports = await tx.select({ emailHmac: erasedMemberImports.emailHmac }).from(erasedMemberImports)
    .where(eq(erasedMemberImports.tenantId, tenantId));
  const tombstones = await tx.select({ emailHmac: suppressions.emailHmac }).from(suppressions)
    .where(and(eq(suppressions.tenantId, tenantId), eq(suppressions.reason, 'erasure')));
  const contacts = await tx.select({ id: marketingContacts.id, emailHmac: marketingContacts.emailHmac }).from(marketingContacts)
    .where(and(eq(marketingContacts.tenantId, tenantId), eq(marketingContacts.source, 'erasure')));
  const addresses = new Set(erased.map((member) => normalizeEmail(member.email)));
  const memberIds = new Set(erased.map((member) => member.id));
  const contactIds = new Set(contacts.map((contact) => contact.id));
  const hashes = new Set([...imports.map((row) => row.emailHmac), ...tombstones.map((row) => row.emailHmac), ...contacts.map((row) => row.emailHmac)]);
  const erasedAddress = (email: string) => addresses.has(normalizeEmail(email)) || hashes.has(hmac.compute(tenantId, email));
  const sends = await tx.select({ id: campaignSends.id, sesMessageId: campaignSends.sesMessageId, email: campaignSends.email, memberId: campaignSends.memberId, contactId: campaignSends.contactId })
    .from(campaignSends).where(eq(campaignSends.tenantId, tenantId));
  const outbox = await tx.select({ id: emailOutbox.id, sesMessageId: emailOutbox.sesMessageId, to: emailOutbox.to }).from(emailOutbox).where(eq(emailOutbox.tenantId, tenantId));
  const erasedSends = new Set(sends.filter((send) => erasedAddress(send.email)
    || (send.memberId !== null && memberIds.has(send.memberId))
    || (send.contactId !== null && contactIds.has(send.contactId))).map((send) => send.id));
  const erasedOutbox = new Set(outbox.filter((row) => erasedAddress(row.to)).map((row) => row.id));
  const knownSends = new Set(sends.map((send) => send.id));
  const knownOutbox = new Set(outbox.map((row) => row.id));
  const matched: Partial<Record<EmailEventType, number>> = {};
  const changed: Partial<Record<EmailEventType, number>> = {};
  let unlinked = 0;
  let cursor: string | undefined;
  while (true) {
    const rows = await tx.select().from(emailEvents).where(and(eq(emailEvents.tenantId, tenantId),
      cursor === undefined ? undefined : gt(emailEvents.id, cursor))).orderBy(asc(emailEvents.id)).limit(500);
    if (rows.length === 0) break;
    for (const row of rows) {
      if (!(row.mailKind === 'marketing' ? knownSends : knownOutbox).has(row.refId)) unlinked += 1;
      if (!(row.mailKind === 'marketing' ? erasedSends : erasedOutbox).has(row.refId)) continue;
      matched[row.type] = (matched[row.type] ?? 0) + 1;
      const scrubbed = scrubRow(row);
      if (snapshotPayloadsEqual(scrubbed.meta, row.meta)) continue;
      changed[row.type] = (changed[row.type] ?? 0) + 1;
      if (apply) await tx.update(emailEvents).set({ meta: scrubbed.meta }).where(and(eq(emailEvents.tenantId, tenantId), eq(emailEvents.id, row.id)));
    }
    cursor = rows.at(-1)?.id;
  }
  const messageIds = new Set([...sends.filter((row) => erasedSends.has(row.id)), ...outbox.filter((row) => erasedOutbox.has(row.id))]
    .flatMap((row) => row.sesMessageId === null ? [] : [row.sesMessageId]));
  const inbox = await scrubInbox(tx, tenantId, (event) => messageIds.has(event.messageId)
    || (event.campaignSendId !== undefined && erasedSends.has(event.campaignSendId))
    || event.recipients.some(erasedAddress), apply, hmac);
  return { matched, changed, unlinked, inbox };
});
