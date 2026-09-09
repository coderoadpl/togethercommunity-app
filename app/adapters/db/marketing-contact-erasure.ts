import { and, eq, inArray, isNull, or, sql } from 'drizzle-orm';

import type { EmailHmac } from '#core/server/index.js';

import type { Db } from './client.js';
import { marketingContacts, marketingContactImports, marketingContactImportRows, marketingListMemberships } from './schema.js';
import { createMarketingDirectoryEventRepository, lockMarketingAddress } from './marketing-contact-repositories.js';

export const eraseMarketingMemberContact = async (db: Db, tenantId: string, input: { memberId: string; email: string; tombstoneEmail: string; deletedAt: string }, hmac: EmailHmac): Promise<void> => {
  const addressHmac = hmac.compute(tenantId, input.email);
  const stagedAddress = and(eq(marketingContactImportRows.tenantId, tenantId), or(eq(marketingContactImportRows.normalizedEmailHmac, addressHmac), sql`lower(btrim(${marketingContactImportRows.stagedPayload}->>'email')) = ${input.email}`));
  const batches = await db.selectDistinct({ importId: marketingContactImportRows.importId }).from(marketingContactImportRows).where(stagedAddress);
  for (const batch of batches.sort((a, b) => a.importId.localeCompare(b.importId))) await db.execute(sql`SELECT pg_advisory_xact_lock(hashtextextended(${tenantId + ':' + batch.importId}, 3))`);
  await lockMarketingAddress(db, tenantId, input.email);
  const contacts = await db.update(marketingContacts).set({ email: input.tombstoneEmail, displayName: null, firstName: null, lastName: null, source: 'erasure', tags: [], memberId: null, archivedAt: input.deletedAt, updatedAt: input.deletedAt })
    .where(and(eq(marketingContacts.tenantId, tenantId), or(eq(marketingContacts.memberId, input.memberId), eq(marketingContacts.emailHmac, addressHmac)))).returning();
  for (const contact of contacts) {
    const removed = await db.update(marketingListMemberships).set({ removedAt: input.deletedAt }).where(and(eq(marketingListMemberships.tenantId, tenantId), eq(marketingListMemberships.contactId, contact.id), isNull(marketingListMemberships.removedAt))).returning();
    for (const membership of removed) await createMarketingDirectoryEventRepository(db).append(tenantId, { id: crypto.randomUUID(), tenantId, subjectKind: 'membership', subjectId: `${membership.listId}:${contact.id}`, type: 'membership_removed', actor: 'member_erasure', importId: null, payload: {}, occurredAt: input.deletedAt, createdAt: input.deletedAt });
    await createMarketingDirectoryEventRepository(db).append(tenantId, { id: crypto.randomUUID(), tenantId, subjectKind: 'contact', subjectId: contact.id, type: 'contact_erased', actor: 'member_erasure', importId: null, payload: {}, occurredAt: input.deletedAt, createdAt: input.deletedAt });
  }
  const affected = await db.update(marketingContactImportRows).set({ stagedPayload: null, normalizedPayload: null, normalizedEmailHmac: addressHmac, errors: ['Address erased'], warnings: [] })
    .where(stagedAddress).returning({ importId: marketingContactImportRows.importId });
  const importIds = [...new Set(affected.map((row) => row.importId))];
  if (importIds.length > 0) {
    await db.update(marketingContactImports).set({ rawCsv: null }).where(and(eq(marketingContactImports.tenantId, tenantId), inArray(marketingContactImports.id, importIds)));
    const cancelled = await db.update(marketingContactImports).set({ status: 'cancelled', finishedAt: input.deletedAt, lockedBy: null, lockedUntil: null }).where(and(eq(marketingContactImports.tenantId, tenantId), inArray(marketingContactImports.id, importIds), inArray(marketingContactImports.status, ['draft', 'ready', 'queued', 'processing', 'failed']))).returning();
    for (const batch of cancelled) await createMarketingDirectoryEventRepository(db).append(tenantId, { id: crypto.randomUUID(), tenantId, subjectKind: 'import', subjectId: batch.id, type: 'import_cancelled', actor: 'member_erasure', importId: batch.id, payload: {}, occurredAt: input.deletedAt, createdAt: input.deletedAt });
  }
};
