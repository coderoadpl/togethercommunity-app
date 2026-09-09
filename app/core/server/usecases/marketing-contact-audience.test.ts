import { describe, expect, it, vi } from 'vitest';
import { ok, type ContactAudiencePreview, type ContactCampaignAudience } from '#core/domain/index.js';
import type { MarketingContactAudienceDeps } from '../marketing-audience-ports.js';
import { marketingContactCtx, marketingContactDeps } from '../testing/marketing-contact-fakes.js';
import { previewMarketingContactAudience } from './marketing-contact-audience.js';

const audience: ContactCampaignAudience = { version: 2, includeLists: [], excludeLists: [], excludeProductIds: [], includeMembersWithConsent: false };
const empty: ContactAudiencePreview = { count: 0, candidateCount: 0, excludedCount: 0, skipped: { suppressed: 0, withdrawn: 0, pendingConfirmation: 0, noConsent: 0 }, sample: [], computedAt: '2026-09-08T10:00:00.000Z', audienceHash: 'hash' };
const fixture = (): MarketingContactAudienceDeps => {
  const directory = marketingContactDeps();
  return { directory, clock: directory.clock, contactAudience: { preview: vi.fn(async () => ok(empty)), createSnapshot: async () => { throw new Error('Preview must not create a snapshot'); }, fetchSnapshotPage: async () => [] }, contactCampaigns: { schedule: async () => { throw new Error('Preview must not schedule'); } } };
};
describe('contact audience preview authorization and synchronization', () => {
  it('requires both campaign and contact read capabilities before exposing addresses', async () => {
    for (const capabilities of [['marketing:campaign:read'], ['marketing:contact:read']] as const) {
      const deps = fixture();
      expect(await previewMarketingContactAudience({ ...marketingContactCtx(), capabilities: [...capabilities] }, { audience, consentDefinitionId: 'consent' }, deps)).toMatchObject({ ok: false, error: { code: 'forbidden' } });
      expect(deps.contactAudience.preview).not.toHaveBeenCalled();
    }
  });
  it('keeps empty selection empty without touching member synchronization', async () => {
    expect(await previewMarketingContactAudience(marketingContactCtx(), { audience, consentDefinitionId: 'consent' }, fixture())).toEqual(ok(empty));
  });
  it('rejects missing and archived lists before resolving an estimate', async () => {
    const deps = fixture();
    deps.directory.lists.findById = async () => null;
    expect(await previewMarketingContactAudience(marketingContactCtx(), { audience: { ...audience, includeLists: ['foreign-list'] }, consentDefinitionId: 'consent' }, deps)).toMatchObject({ ok: false, error: { code: 'validation' } });
    expect(deps.contactAudience.preview).not.toHaveBeenCalled();
  });
  it('returns synchronization progress instead of an understated count', async () => {
    const deps = fixture();
    deps.directory.memberSync.next = async () => ({ memberId: 'member', revision: 1, email: 'member@example.test', displayName: null });
    deps.directory.transaction.run = async () => { throw new Error('Synchronization transaction unavailable'); };
    await expect(previewMarketingContactAudience(marketingContactCtx(), { audience: { ...audience, includeMembersWithConsent: true }, consentDefinitionId: 'consent' }, deps)).rejects.toThrow('Synchronization transaction unavailable');
    let reads = 0;
    deps.clock = { nowIso: () => ++reads === 1 ? empty.computedAt : '2026-09-08T10:00:03.000Z' };
    deps.directory.clock = deps.clock;
    expect(await previewMarketingContactAudience(marketingContactCtx(), { audience: { ...audience, includeMembersWithConsent: true }, consentDefinitionId: 'consent' }, deps)).toMatchObject({ ok: false, error: { code: 'conflict', message: expect.stringContaining('synchronization in progress') } });
    expect(deps.contactAudience.preview).not.toHaveBeenCalled();
  });
});
