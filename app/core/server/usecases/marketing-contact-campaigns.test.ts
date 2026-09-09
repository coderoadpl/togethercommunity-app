import { describe, expect, it, vi } from 'vitest';
import { campaignSchema, ok, type Campaign, type ContactCampaignAudience } from '#core/domain/index.js';
import type { MarketingContactAudienceDeps } from '../marketing-audience-ports.js';
import { marketingContactCtx, marketingContactDeps } from '../testing/marketing-contact-fakes.js';
import { InMemoryCampaignRepository } from '../testing/marketing-fakes.js';
import { returnMarketingCampaignToDraft, scheduleMarketingContactCampaign, setMarketingCampaignAudience } from './marketing-contact-campaigns.js';

const audience: ContactCampaignAudience = { version: 2, includeLists: [], excludeLists: [], excludeProductIds: [], includeMembersWithConsent: false };
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
  return { ...deps, campaigns: new InMemoryCampaignRepository([campaign]) };
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
  it('detaches a scheduled snapshot for explicit rescheduling but cannot restart an in-flight campaign', async () => {
    const deps = fixture({ ...draft('scheduled'), audienceVersion: 2, audience, audienceSnapshotId: 'snapshot', snapshotMaxContactId: 'contact', candidateCount: 1, toSend: 1 });
    expect(await returnMarketingCampaignToDraft(marketingContactCtx(), { campaignId: 'campaign' }, deps)).toMatchObject({ ok: true, value: { status: 'draft', audience, audienceSnapshotId: null, snapshotMaxContactId: null, candidateCount: 0, toSend: 0 } });
    expect(await returnMarketingCampaignToDraft(marketingContactCtx(), { campaignId: 'campaign' }, fixture(draft('running')))).toMatchObject({ ok: false, error: { code: 'validation' } });
  });
});
