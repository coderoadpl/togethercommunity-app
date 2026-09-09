import { and, eq } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { memberTombstone } from '#core/domain/index.js';
import { syncMarketingMemberContacts, upsertMarketingContact, uploadMarketingContactImport } from '#core/server/index.js';

import { createDirectoryFixture, directoryCtx, directoryWorkerCtx, directoryValue, DIRECTORY_NOW } from './marketing-contact-test-fixture.js';
import { createMemberErasureRepository } from './repositories.js';
import { members, user, marketingContacts, marketingMemberSyncJobs } from './schema.js';

let fixture: Awaited<ReturnType<typeof createDirectoryFixture>>;
beforeAll(async () => { fixture = await createDirectoryFixture(); fixture.setNow('2099-01-01T00:00:00.000Z'); }, 60_000);
afterAll(async () => { await fixture?.close(); });
const sync = () => syncMarketingMemberContacts(directoryWorkerCtx(), { maxJobs: 100, deadlineAt: '2099-01-01T00:01:00.000Z' }, fixture.deps);
const addMember = async (id: string, email: string) => {
  await fixture.db.insert(user).values({ id: `user-${id}`, email, name: 'Member' });
  await fixture.db.insert(members).values({ id, tenantId: 'directory-a', userId: `user-${id}`, email, displayName: 'Member', createdAt: DIRECTORY_NOW });
};
describe('member directory projection', () => {
  it('links direct member insertions immediately and materializes absent contacts', async () => {
    const existing = directoryValue(await upsertMarketingContact(directoryCtx(), { email: 'later@example.test', source: 'external-export' }, fixture.deps)).contact;
    await addMember('later', existing.email);
    expect(await fixture.deps.contacts.findById('directory-a', existing.id)).toMatchObject({ memberId: 'later' });
    await addMember('absent', 'absent@example.test');
    expect(await fixture.deps.contacts.findByEmail('directory-a', 'absent@example.test')).toBeNull();
    expect(directoryValue(await sync())).toEqual({ processed: 2, pending: false });
    expect(await fixture.deps.contacts.findByEmail('directory-a', 'absent@example.test')).toMatchObject({ source: 'member', memberId: 'absent' });
    expect(await fixture.deps.contacts.findById('directory-a', existing.id)).toMatchObject({ source: 'external-export' });
  });
  it('fences stale revisions and leaves the old address unlinked on email changes', async () => {
    const old = await fixture.deps.contacts.findByEmail('directory-a', 'absent@example.test');
    await fixture.db.update(members).set({ email: 'changed@example.test' }).where(and(eq(members.tenantId, 'directory-a'), eq(members.id, 'absent')));
    expect(await fixture.deps.memberSync.complete('directory-a', 'absent', 1, DIRECTORY_NOW)).toBe(false);
    expect(await fixture.deps.contacts.findById('directory-a', old?.id ?? '')).toMatchObject({ email: 'absent@example.test', memberId: null });
    directoryValue(await sync());
    expect(await fixture.deps.contacts.findByEmail('directory-a', 'changed@example.test')).toMatchObject({ memberId: 'absent' });
  });
  it('reconciles concurrent contact and member creation without duplicate contacts', async () => {
    await Promise.all([
      upsertMarketingContact(directoryCtx(), { email: 'concurrent-member@example.test' }, fixture.deps).then(directoryValue),
      addMember('concurrent-member', 'concurrent-member@example.test'),
    ]);
    directoryValue(await sync());
    expect(await fixture.deps.contacts.findByEmail('directory-a', 'concurrent-member@example.test')).toMatchObject({ memberId: 'concurrent-member' });
    expect(await fixture.db.select().from(marketingContacts).where(and(eq(marketingContacts.tenantId, 'directory-a'), eq(marketingContacts.email, 'concurrent-member@example.test')))).toHaveLength(1);
  });
  it('erases identifying directory metadata and keeps the original HMAC suppressed', async () => {
    const contact = await fixture.deps.contacts.findByEmail('directory-a', 'later@example.test');
    const staged = directoryValue(await uploadMarketingContactImport(directoryCtx(), { csv: 'email,name\nlater@example.test,Original member\n', metadata: { kind: 'contacts', datasetVersion: 'together-marketing-contacts/v1', fileName: 'erasure.csv', idempotencyKey: 'erasure-staging' } }, fixture.deps));
    const tombstone = memberTombstone('later');
    await createMemberErasureRepository(fixture.db, fixture.deps.hmac).pseudonymize('directory-a', { memberId: 'later', deletedAt: DIRECTORY_NOW, tombstoneEmail: tombstone.email, severedUserId: tombstone.userId, postAuthorDisplay: 'Deleted member' });
    expect(await fixture.deps.contacts.findById('directory-a', contact?.id ?? '')).toMatchObject({ email: tombstone.email, memberId: null, source: 'erasure', displayName: null, firstName: null, lastName: null, tags: [], archivedAt: DIRECTORY_NOW });
    expect(await fixture.deps.imports.readCsv('directory-a', staged.import.id)).toBeNull();
    expect((await fixture.deps.imports.rows('directory-a', staged.import.id))[0]).toMatchObject({ stagedPayload: null, normalizedPayload: null });
    expect((await fixture.deps.imports.findById('directory-a', staged.import.id))?.status).toBe('cancelled');
    expect(await fixture.deps.suppressions.isSuppressed('directory-a', fixture.deps.hmac.compute('directory-a', 'later@example.test'))).toBe(true);
    directoryValue(await upsertMarketingContact(directoryCtx(), { email: 'later@example.test', displayName: 'Must stay erased' }, fixture.deps));
    expect(await fixture.deps.contacts.findById('directory-a', contact?.id ?? '')).toMatchObject({ email: tombstone.email, displayName: null });
    expect((await fixture.db.select().from(marketingContacts).where(eq(marketingContacts.email, 'later@example.test')))).toHaveLength(0);
    expect((await fixture.db.select().from(marketingMemberSyncJobs).where(eq(marketingMemberSyncJobs.memberId, 'later')))[0]?.status).toBe('completed');
  });
});
