import { eq } from 'drizzle-orm';
import { afterEach, describe, expect, it } from 'vitest';
import { addMarketingListContacts, createMarketingList, createCampaign, scheduleCampaign, campaignTick, dispatchMarketingOutbox, updateMarketingCampaign, pauseCampaign, cancelCampaign } from '#core/server/index.js';
import { eraseMarketingMemberContact } from './marketing-contact-erasure.js';
import { createContactCampaignFixture } from './marketing-contact-campaign-test-fixture.js';
import { deliveryCtx, deliveryWorkerCtx, DELIVERY_NOW } from './marketing-delivery-test-fixture.js';
import { directoryValue } from './marketing-contact-test-fixture.js';
import { campaignSends, campaigns, marketingOutbox, unsubscribeTokens, members, marketingContacts, marketingCampaignAudienceContacts } from './schema.js';

let fixture: Awaited<ReturnType<typeof createContactCampaignFixture>>;
afterEach(async () => { await fixture?.close(); });
const setup = async (eligible = true) => {
  fixture = await createContactCampaignFixture();
  const contact = await fixture.directory.contacts.upsertByEmail('delivery-a', { email: 'contact@example.test', displayName: 'Contact' });
  if (eligible) await fixture.consent(contact.contact.email);
  const list = directoryValue(await createMarketingList(deliveryCtx(), { key: 'recipients', name: 'Recipients' }, fixture.directory)).list;
  directoryValue(await addMarketingListContacts(deliveryCtx(), { listId: list.id, contactIds: [contact.contact.id] }, fixture.directory));
  const draft = directoryValue(await createCampaign(deliveryCtx(), { name: 'Contact campaign', subject: 'Hello', bodyHtml: '<p>Hello</p>', consentDefinitionId: 'consent', audience: { version: 2, includeLists: [list.id], excludeLists: [], excludeProductIds: [], includeMembersWithConsent: false } }, fixture.deps));
  const campaign = directoryValue(await scheduleCampaign(deliveryCtx(), { campaignId: draft.id, sendAt: DELIVERY_NOW }, fixture.deps));
  return { contact: contact.contact, campaign };
};
const enumerate = (id: string) => campaignTick(deliveryWorkerCtx(), { campaignId: id, workerId: crypto.randomUUID(), tickSeconds: 50 }, { ...fixture.deps, marketingOutbox: { ...fixture.deps.marketingOutbox, claim: async () => null } });

describe('contact campaign materialization and delivery', () => {
  it('rolls back payload, token, send and cursor together, then resumes after the lease expires', async () => {
    const { campaign } = await setup();
    const delivery = fixture.deps.delivery;
    const failed = await campaignTick(deliveryWorkerCtx(), { campaignId: campaign.id, workerId: 'failing', tickSeconds: 50 }, { ...fixture.deps,
      delivery: { run: (tenantId, operation) => delivery.run(tenantId, (repos) => operation({ ...repos, campaigns: { ...repos.campaigns, advanceCursor: async () => null } })) },
    });
    expect(failed).toMatchObject({ ok: false, error: { code: 'conflict' } });
    expect(await fixture.db.select().from(campaignSends)).toHaveLength(0);
    expect(await fixture.db.select().from(marketingOutbox)).toHaveLength(0);
    expect(await fixture.db.select().from(unsubscribeTokens)).toHaveLength(0);
    expect((await fixture.deps.campaigns.findById('delivery-a', campaign.id))?.cursorContactId).toBeNull();
    fixture.setNow('2026-09-09T10:00:51.000Z');
    directoryValue(await enumerate(campaign.id));
    expect(await fixture.db.select().from(campaignSends)).toHaveLength(1);
    expect(await fixture.db.select().from(marketingOutbox)).toHaveLength(1);
    expect((await fixture.deps.campaigns.findById('delivery-a', campaign.id))?.cursorContactId).toBe(campaign.snapshotMaxContactId);
    await fixture.db.update(campaigns).set({ cursorContactId: null, lockedUntil: null }).where(eq(campaigns.id, campaign.id));
    directoryValue(await enumerate(campaign.id));
    expect(await fixture.db.select().from(campaignSends)).toHaveLength(1);
    expect(await fixture.db.select().from(unsubscribeTokens)).toHaveLength(1);
  });
  it('finishes a skipped-only snapshot without reviving later consent', async () => {
    const { campaign, contact } = await setup(false);
    await fixture.consent(contact.email);
    directoryValue(await enumerate(campaign.id));
    expect(await fixture.db.select().from(marketingOutbox)).toHaveLength(0);
    expect((await fixture.deps.sends.listByCampaign('delivery-a', campaign.id))[0]).toMatchObject({ contactId: contact.id, status: 'skipped', skipReason: 'not_consented' });
    expect(await fixture.deps.campaigns.findById('delivery-a', campaign.id)).toMatchObject({ status: 'finished', skipped: 1, candidateCount: 1, toSend: 0, cursorContactId: contact.id });
  });
  it('excludes archived contacts at dispatch and prevents competing workers from duplicating sends', async () => {
    const { campaign, contact } = await setup();
    const results = await Promise.all([enumerate(campaign.id), enumerate(campaign.id)]);
    expect(results.every((result) => result.ok)).toBe(true);
    expect(await fixture.db.select().from(campaignSends)).toHaveLength(1);
    await fixture.directory.contacts.archive('delivery-a', { contactId: contact.id, archivedAt: DELIVERY_NOW });
    directoryValue(await dispatchMarketingOutbox(deliveryWorkerCtx(), { workerId: 'sender', deadlineAt: '2026-09-09T10:00:50.000Z', maxSends: 10 }, fixture.deps));
    expect(fixture.sent).toHaveLength(0);
    expect((await fixture.deps.sends.listByCampaign('delivery-a', campaign.id))[0]?.skipReason).toBe('contact_archived');
    expect((await fixture.deps.campaigns.findById('delivery-a', campaign.id))?.skipped).toBe(1);
  });
  it('preserves version 2 audiences through old content clients and keeps legacy member drafts schedulable', async () => {
    fixture = await createContactCampaignFixture();
    const audience = { version: 2 as const, includeLists: [], excludeLists: [], excludeProductIds: [], includeMembersWithConsent: false };
    const content = { name: 'Draft', subject: 'News', bodyHtml: '<p>News</p>', consentDefinitionId: 'consent' };
    const modern = directoryValue(await createCampaign(deliveryCtx(), { ...content, audience }, fixture.deps));
    const edited = directoryValue(await updateMarketingCampaign(deliveryCtx(), { ...content, campaignId: modern.id, subject: 'Edited', productIds: [], layoutId: null }, fixture.deps));
    expect(edited.campaign.audience).toEqual(audience);
    expect(edited.campaign.audienceVersion).toBe(2);
    directoryValue(await scheduleCampaign(deliveryCtx(), { campaignId: modern.id, sendAt: DELIVERY_NOW }, fixture.deps));
    directoryValue(await enumerate(modern.id));
    expect(await fixture.deps.campaigns.findById('delivery-a', modern.id)).toMatchObject({ status: 'finished', candidateCount: 0 });
    await fixture.db.insert(members).values({ id: 'legacy-member', tenantId: 'delivery-a', userId: 'legacy-user', email: 'legacy@example.test', displayName: 'Legacy', createdAt: DELIVERY_NOW });
    await fixture.consent('legacy@example.test');
    const legacy = directoryValue(await createCampaign(deliveryCtx(), content, fixture.deps));
    expect(legacy.audienceVersion).toBe(1);
    const scheduled = directoryValue(await scheduleCampaign(deliveryCtx(), { campaignId: legacy.id, sendAt: DELIVERY_NOW }, fixture.deps));
    expect(scheduled.snapshotMaxMemberId).toBe('legacy-member');
    directoryValue(await campaignTick(deliveryWorkerCtx(), { campaignId: legacy.id, workerId: 'legacy', tickSeconds: 50 }, fixture.deps));
    expect(fixture.sent).toHaveLength(1);
    expect(await fixture.deps.campaigns.findById('delivery-a', legacy.id)).toMatchObject({ status: 'finished', cursorMemberId: 'legacy-member', cursorContactId: null });
    expect((await fixture.deps.sends.listByCampaign('delivery-a', legacy.id))[0]).toMatchObject({ memberId: 'legacy-member', contactId: null });
  });
  it('does not redirect a frozen send when the contact address changes', async () => {
    const { campaign, contact } = await setup();
    directoryValue(await enumerate(campaign.id));
    await fixture.db.update(marketingContacts).set({ email: 'changed@example.test', emailHmac: fixture.deps.hmac.compute('delivery-a', 'changed@example.test') }).where(eq(marketingContacts.id, contact.id));
    directoryValue(await dispatchMarketingOutbox(deliveryWorkerCtx(), { workerId: 'sender', deadlineAt: '2026-09-09T10:00:50.000Z', maxSends: 10 }, fixture.deps));
    expect(fixture.sent).toHaveLength(0);
    expect((await fixture.deps.sends.listByCampaign('delivery-a', campaign.id))[0]).toMatchObject({ email: contact.email, status: 'skipped', skipReason: 'contact_address_changed' });
    expect((await fixture.db.select().from(marketingCampaignAudienceContacts))[0]?.email).toBe(contact.email);
  });
  it('pseudonymizes snapshot identity on erasure and prevents subsequent delivery', async () => {
    const { campaign, contact } = await setup();
    await fixture.db.transaction((tx) => eraseMarketingMemberContact(tx, 'delivery-a', { memberId: 'erased-member', email: contact.email, tombstoneEmail: 'erased@example.invalid', deletedAt: DELIVERY_NOW }, fixture.deps.hmac));
    expect((await fixture.db.select().from(marketingCampaignAudienceContacts))[0]).toMatchObject({ email: 'erased@example.invalid', displayNameSnapshot: null, firstNameSnapshot: null, memberIdSnapshot: null });
    directoryValue(await campaignTick(deliveryWorkerCtx(), { campaignId: campaign.id, workerId: 'sender', tickSeconds: 50 }, fixture.deps));
    expect(fixture.sent).toHaveLength(0);
    expect((await fixture.deps.sends.listByCampaign('delivery-a', campaign.id))[0]?.status).toBe('skipped');
  });
  it('holds contact outbox rows while paused and counts cancellation only once', async () => {
    const { campaign } = await setup();
    directoryValue(await enumerate(campaign.id));
    directoryValue(await pauseCampaign(deliveryCtx(), { campaignId: campaign.id }, fixture.deps));
    const dispatch = () => dispatchMarketingOutbox(deliveryWorkerCtx(), { workerId: 'sender', deadlineAt: '2026-09-09T10:02:00.000Z', maxSends: 10 }, fixture.deps);
    expect(directoryValue(await dispatch()).sent).toBe(0);
    expect((await fixture.db.select().from(marketingOutbox))[0]?.status).toBe('pending');
    directoryValue(await cancelCampaign(deliveryCtx(), { campaignId: campaign.id }, fixture.deps));
    fixture.setNow('2026-09-09T10:01:01.000Z');
    expect(directoryValue(await dispatch()).skipped).toBe(1);
    expect(directoryValue(await dispatch()).skipped).toBe(0);
    expect(fixture.sent).toHaveLength(0);
    expect(await fixture.deps.campaigns.findById('delivery-a', campaign.id)).toMatchObject({ status: 'cancelled', skipped: 1 });
  });
});
