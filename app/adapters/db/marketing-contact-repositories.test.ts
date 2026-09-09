import { members, products, productGrants } from './schema.js';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { appError, err } from '#core/domain/index.js';
import { upsertMarketingContact, listMarketingContacts, createMarketingList, addMarketingListContacts, removeMarketingListContacts, previewMarketingList, archiveMarketingContact, updateMarketingList, syncMarketingMemberContacts } from '#core/server/index.js';

import { createDirectoryFixture, directoryCtx, directoryValue, directoryWorkerCtx } from './marketing-contact-test-fixture.js';

let fixture: Awaited<ReturnType<typeof createDirectoryFixture>>;
beforeAll(async () => { fixture = await createDirectoryFixture(); }, 60_000);
afterAll(async () => { await fixture?.close(); });
describe('contact and list repositories', () => {
  it('serializes concurrent upserts, isolates tenants and preserves archival', async () => {
    const results = await Promise.all(['one', 'two'].map((tag) => upsertMarketingContact(directoryCtx(), { email: ' A+Tag@Example.Test ', firstName: 'Anna', lastName: 'Example', tags: [tag] }, fixture.deps)));
    const first = directoryValue(results[0] ?? err(appError('internal', 'Missing result'))).contact;
    const found = await fixture.deps.contacts.findByEmail('directory-a', 'a+tag@example.test');
    expect(found?.id).toBe(first.id); expect(found?.tags.sort()).toEqual(['one', 'two']); expect(found?.displayName).toBe('Anna Example');
    const other = directoryValue(await upsertMarketingContact(directoryCtx('directory-b'), { email: 'a+tag@example.test' }, fixture.deps));
    expect(other.contact.id).not.toBe(first.id);
    expect((await fixture.deps.contacts.findByEmail('directory-b', 'a+tag@example.test'))?.emailHmac).not.toBe(found?.emailHmac);
    expect(await fixture.deps.contacts.findById('directory-b', first.id)).toBeNull();
    directoryValue(await archiveMarketingContact(directoryCtx(), { contactId: first.id }, fixture.deps));
    const reimport = directoryValue(await upsertMarketingContact(directoryCtx(), { email: first.email, firstName: '' }, fixture.deps));
    expect(reimport.contact.archivedAt).not.toBeNull(); expect(reimport.contact.firstName).toBe('Anna');
  });
  it('evaluates current tag lists, revision conflicts and reversible static membership', async () => {
    const contact = directoryValue(await upsertMarketingContact(directoryCtx(), { email: 'list@example.test', tags: ['launch', 'news'] }, fixture.deps)).contact;
    const list = directoryValue(await createMarketingList(directoryCtx(), { key: 'static', name: 'Same name' }, fixture.deps)).list;
    const dynamic = directoryValue(await createMarketingList(directoryCtx(), { key: 'dynamic', name: 'Same name', rule: { kind: 'tag', tags: ['launch', 'news'], match: 'all' } }, fixture.deps)).list;
    expect(directoryValue(await addMarketingListContacts(directoryCtx(), { listId: list.id, contactIds: [contact.id] }, fixture.deps)).changed).toBe(1);
    expect(directoryValue(await addMarketingListContacts(directoryCtx(), { listId: list.id, contactIds: [contact.id] }, fixture.deps)).changed).toBe(0);
    expect(directoryValue(await previewMarketingList(directoryCtx(), { listId: dynamic.id }, fixture.deps)).counts.contactCount).toBe(1);
    expect(await addMarketingListContacts(directoryCtx(), { listId: dynamic.id, contactIds: [contact.id] }, fixture.deps)).toMatchObject({ ok: false, error: { code: 'validation' } });
    expect(directoryValue(await removeMarketingListContacts(directoryCtx(), { listId: list.id, contactIds: [contact.id] }, fixture.deps)).changed).toBe(1);
    expect(directoryValue(await previewMarketingList(directoryCtx(), { listId: list.id }, fixture.deps)).counts.contactCount).toBe(0);
    directoryValue(await updateMarketingList(directoryCtx(), { listId: list.id, expectedRevision: 1, name: 'Renamed' }, fixture.deps));
    expect(await updateMarketingList(directoryCtx(), { listId: list.id, expectedRevision: 1, name: 'Lost update' }, fixture.deps)).toMatchObject({ ok: false, error: { code: 'conflict' } });
  });
  it('evaluates product grant windows at the supplied time and active consent independently', async () => {
    await fixture.db.insert(members).values({ tenantId: 'directory-a', id: 'grant-member', userId: 'grant-user', email: 'grant@example.test', createdAt: '2026-09-08T10:00:00.000Z' });
    await fixture.db.insert(products).values({ tenantId: 'directory-a', id: 'grant-product', slug: 'grant-product', title: 'Example product', description: '', priceCents: 0, currency: 'PLN', createdAt: '2026-09-08T10:00:00.000Z' });
    await fixture.db.insert(productGrants).values({ tenantId: 'directory-a', id: 'grant', memberId: 'grant-member', productId: 'grant-product', source: 'manual', startsAt: '2026-09-09T00:00:00.000Z', expiresAt: '2026-09-10T00:00:00.000Z', createdAt: '2026-09-08T10:00:00.000Z' });
    directoryValue(await upsertMarketingContact(directoryCtx(), { email: 'grant@example.test' }, fixture.deps));
    fixture.setNow('2099-01-01T00:00:00.000Z');
    directoryValue(await syncMarketingMemberContacts(directoryWorkerCtx(), { maxJobs: 10, deadlineAt: '2099-01-01T00:01:00.000Z' }, fixture.deps));
    fixture.setNow('2026-09-08T10:00:00.000Z');
    const active = directoryValue(await createMarketingList(directoryCtx(), { key: 'active-grants', name: 'Active grants', rule: { kind: 'product_grant', productIds: ['grant-product'], state: 'active' } }, fixture.deps)).list;
    const ever = directoryValue(await createMarketingList(directoryCtx(), { key: 'ever-grants', name: 'Any grant', rule: { kind: 'product_grant', productIds: ['grant-product'], state: 'ever' } }, fixture.deps)).list;
    expect((await fixture.deps.lists.counts('directory-a', active.id, null, '2026-09-08T12:00:00.000Z')).contactCount).toBe(0);
    expect((await fixture.deps.lists.counts('directory-a', active.id, null, '2026-09-09T12:00:00.000Z')).contactCount).toBe(1);
    expect((await fixture.deps.lists.counts('directory-a', active.id, null, '2026-09-10T00:00:00.000Z')).contactCount).toBe(0);
    expect((await fixture.deps.lists.counts('directory-a', ever.id, 'newsletter', '2026-09-10T00:00:00.000Z'))).toMatchObject({ contactCount: 1, eligibleCount: 0 });
    const consent = directoryValue(await createMarketingList(directoryCtx(), { key: 'consented', name: 'Active consent', rule: { kind: 'consent_definition', definitionId: 'newsletter', state: 'active' } }, fixture.deps)).list;
    expect((await fixture.deps.lists.counts('directory-a', consent.id, 'newsletter', '2026-09-10T00:00:00.000Z')).contactCount).toBe(0);
  });
  it('rolls back projections and lifecycle events together', async () => {
    const result = await fixture.deps.transaction.run('directory-a', async (repos) => {
      await repos.contacts.upsertByEmail('directory-a', { email: 'rollback@example.test' });
      return err(appError('conflict', 'Abort transaction'));
    });
    expect(result.ok).toBe(false); expect(await fixture.deps.contacts.findByEmail('directory-a', 'rollback@example.test')).toBeNull();
  });
  it('binds keyset cursors to filters and omits HMAC from public data', async () => {
    await upsertMarketingContact(directoryCtx(), { email: 'page@example.test' }, fixture.deps);
    const first = directoryValue(await listMarketingContacts(directoryCtx(), { limit: 1 }, fixture.deps));
    expect(first.nextCursor).not.toBeNull(); expect(first.contacts[0]).not.toHaveProperty('emailHmac');
    expect(await listMarketingContacts(directoryCtx(), { limit: 1, search: 'different', cursor: first.nextCursor }, fixture.deps)).toMatchObject({ ok: false, error: { code: 'validation' } });
  });
});
