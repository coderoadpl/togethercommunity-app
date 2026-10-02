import { describe, expect, it, vi } from 'vitest';
import { CONTACT_AUDIENCE_LIST_OVERLAP_MESSAGE, campaignSchema, ok, type Campaign, type ConsentDefinition, type ConsentDefinitionVersion, type ContactCampaignAudience, type MarketingList } from '#core/domain/index.js';
import type { MarketingContactAudienceDeps } from '../marketing-audience-ports.js';
import { marketingContactCtx, marketingContactDeps } from '../testing/marketing-contact-fakes.js';
import { FakeScheduler, InMemoryCampaignRepository, InMemoryConsentDefinitionRepository, InMemoryMarketingAudienceRepository } from '../testing/marketing-fakes.js';
import { createCampaign } from './marketing-email.js';
import { returnMarketingCampaignToDraft, scheduleMarketingContactCampaign, setMarketingCampaignAudience } from './marketing-contact-campaigns.js';

const audience: ContactCampaignAudience = { version: 2, includeLists: [], excludeLists: [], excludeProductIds: [], includeMembersWithConsent: false };
const definition: ConsentDefinition = {
  id: 'consent', tenantId: 'tenant-a', key: 'newsletter', kind: 'optional_marketing',
  channel: 'email', doubleOptIn: true, documentRef: { mode: 'url', url: 'https://tenant.test/privacy' },
  status: 'active', createdAt: '2026-09-08T10:00:00.000Z', updatedAt: '2026-09-08T10:00:00.000Z',
};
const definitionVersion: ConsentDefinitionVersion = {
  id: 'consent-version', tenantId: 'tenant-a', definitionId: definition.id, version: 1,
  label: 'Send me news', documentVersionRef: { mode: 'url', url: 'https://tenant.test/privacy' }, createdAt: '2026-09-08T10:00:00.000Z', createdBy: 'owner',
};
const list = (id: string): MarketingList => ({
  id, tenantId: 'tenant-a', key: id, name: id, kind: 'static', rule: null, revision: 1,
  createdAt: '2026-09-08T10:00:00.000Z', updatedAt: '2026-09-08T10:00:00.000Z', archivedAt: null,
});
const draft = (status: Campaign['status'] = 'draft'): Campaign => campaignSchema.parse({
  id: 'campaign', tenantId: 'tenant-a', name: 'News', subject: 'News', bodyHtml: '<p>News</p>', bodySource: 'News',
  layoutId: null, consentDefinitionId: 'consent', audienceFilter: { productIds: ['legacy-product'] }, status,
  sendAt: null, snapshotMaxMemberId: null, cursorMemberId: null, toSend: 0, sent: 0, failed: 0,
  lockedUntil: null, lockedBy: null, errorCount: 0, pausedReason: null, audienceNameSnapshot: null,
  consentLabelSnapshot: null, startedAt: null, finishedAt: null, createdAt: '2026-09-08T10:00:00.000Z',
});
const fixture = (campaign = draft()) => {
  const directory = marketingContactDeps();
  const deps: MarketingContactAudienceDeps = {
    directory, clock: directory.clock,
    contactAudience: { preview: async () => { throw new Error('Unexpected preview'); }, createSnapshot: async () => { throw new Error('Snapshot must use the scheduling transaction'); }, fetchSnapshotPage: async () => [] },
    contactCampaigns: { schedule: vi.fn(async () => ok({ ...campaign, status: 'scheduled' as const })) },
  };
  return { ...deps, campaigns: new InMemoryCampaignRepository([campaign]), logger: { warn: vi.fn() } };
};

describe('contact campaign lifecycle authorization', () => {
  it('rejects unauthorized audience changes, scheduling and draft transitions before persistence', async () => {
    const deps = fixture();
    const ctx = { ...marketingContactCtx(), capabilities: [] };
    expect(await setMarketingCampaignAudience(ctx, { campaignId: 'campaign', audience }, deps)).toMatchObject({ ok: false, error: { code: 'forbidden' } });
    expect(await scheduleMarketingContactCampaign(ctx, { campaignId: 'campaign', sendAt: deps.clock.nowIso() }, deps)).toMatchObject({ ok: false, error: { code: 'forbidden' } });
    expect(await returnMarketingCampaignToDraft(ctx, { campaignId: 'campaign' }, deps)).toMatchObject({ ok: false, error: { code: 'forbidden' } });
    expect(await deps.campaigns.findById('tenant-a', 'campaign')).toEqual(draft());
    expect(deps.contactCampaigns.schedule).not.toHaveBeenCalled();
  });
  it('only converts drafts and never reinterprets the legacy inclusive product filter', async () => {
    const deps = fixture();
    expect(await setMarketingCampaignAudience(marketingContactCtx(), { campaignId: 'campaign', audience }, deps)).toMatchObject({ ok: true, value: { campaign: { audienceVersion: 2, audience, audienceFilter: { productIds: ['legacy-product'] } } } });
    for (const status of ['scheduled', 'running', 'paused', 'finished', 'cancelled'] as const) {
      expect(await setMarketingCampaignAudience(marketingContactCtx(), { campaignId: 'campaign', audience }, fixture(draft(status)))).toMatchObject({ ok: false, error: { code: 'validation' } });
    }
  });
  it('scopes campaign lookup and delegates snapshot creation to one scheduling transaction', async () => {
    const deps = fixture({ ...draft(), audienceVersion: 2, audience });
    const ctx = marketingContactCtx();
    expect(await scheduleMarketingContactCampaign({ ...ctx, identity: { ...ctx.identity, tenantId: 'tenant-b' } }, { campaignId: 'campaign', sendAt: deps.clock.nowIso() }, deps)).toMatchObject({ ok: false, error: { code: 'not_found' } });
    expect(deps.contactCampaigns.schedule).not.toHaveBeenCalled();
    expect(await scheduleMarketingContactCampaign(ctx, { campaignId: 'campaign', sendAt: deps.clock.nowIso() }, deps)).toMatchObject({ ok: true });
    expect(deps.contactCampaigns.schedule).toHaveBeenCalledExactlyOnceWith('tenant-a', { campaignId: 'campaign', sendAt: deps.clock.nowIso(), asOf: deps.clock.nowIso() });
  });
  it('schedules legacy overlapping audiences after normalizing include lists', async () => {
    const stored = { ...audience, includeLists: ['keep', 'overlap'], excludeLists: ['overlap'] };
    const deps = fixture({ ...draft(), audienceVersion: 2, audience: stored });
    deps.directory.lists.findById = async (_tenantId, id) => list(id);

    expect(await scheduleMarketingContactCampaign(marketingContactCtx(), { campaignId: 'campaign', sendAt: deps.clock.nowIso() }, deps)).toMatchObject({ ok: true });
    expect(deps.contactCampaigns.schedule).toHaveBeenCalledExactlyOnceWith('tenant-a', {
      campaignId: 'campaign',
      sendAt: deps.clock.nowIso(),
      asOf: deps.clock.nowIso(),
    });
    expect(deps.logger.warn).toHaveBeenCalledWith('[marketing] normalized overlapping contact audience campaign=campaign');
  });
  it('rejects overlapping audiences on create and update inputs', async () => {
    const deps = fixture();
    const overlapping = { ...audience, includeLists: ['list'], excludeLists: ['list'] };
    const definitions = new InMemoryConsentDefinitionRepository();
    await definitions.create('tenant-a', definition, definitionVersion);

    expect(await createCampaign(marketingContactCtx(), {
      name: 'Overlapping',
      subject: 'Overlapping',
      bodyHtml: '<p>Hello</p>',
      consentDefinitionId: definition.id,
      audience: overlapping,
    }, {
      contactAudienceDeps: deps,
      campaigns: deps.campaigns,
      audience: new InMemoryMarketingAudienceRepository(),
      definitions,
      ids: { nextId: () => 'created-campaign' },
      clock: deps.clock,
      scheduler: new FakeScheduler(),
    })).toMatchObject({
      ok: false,
      error: {
        code: 'validation',
        details: { fieldErrors: { includeLists: [CONTACT_AUDIENCE_LIST_OVERLAP_MESSAGE], excludeLists: [CONTACT_AUDIENCE_LIST_OVERLAP_MESSAGE] } },
      },
    });

    expect(await setMarketingCampaignAudience(marketingContactCtx(), { campaignId: 'campaign', audience: overlapping }, deps)).toMatchObject({
      ok: false,
      error: {
        code: 'validation',
        details: { fieldErrors: { includeLists: [CONTACT_AUDIENCE_LIST_OVERLAP_MESSAGE], excludeLists: [CONTACT_AUDIENCE_LIST_OVERLAP_MESSAGE] } },
      },
    });
    expect(deps.contactCampaigns.schedule).not.toHaveBeenCalled();
  });
  it('detaches a scheduled snapshot for explicit rescheduling but cannot restart an in-flight campaign', async () => {
    const deps = fixture({ ...draft('scheduled'), audienceVersion: 2, audience, audienceSnapshotId: 'snapshot', snapshotMaxContactId: 'contact', candidateCount: 1, toSend: 1 });
    expect(await returnMarketingCampaignToDraft(marketingContactCtx(), { campaignId: 'campaign' }, deps)).toMatchObject({ ok: true, value: { status: 'draft', audience, audienceSnapshotId: null, snapshotMaxContactId: null, candidateCount: 0, toSend: 0 } });
    expect(await returnMarketingCampaignToDraft(marketingContactCtx(), { campaignId: 'campaign' }, fixture(draft('running')))).toMatchObject({ ok: false, error: { code: 'validation' } });
  });
});
