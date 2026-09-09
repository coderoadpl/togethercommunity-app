import { describe, expect, it } from 'vitest';
import { contactCampaignAudienceSchema } from './marketing-audience.js';

const empty = { version: 2, includeLists: [], excludeLists: [], excludeProductIds: [], includeMembersWithConsent: false };
describe('contact campaign audiences', () => {
  it('preserves an explicitly empty audience and canonicalizes overlapping IDs', () => {
    expect(contactCampaignAudienceSchema.parse(empty)).toEqual(empty);
    expect(contactCampaignAudienceSchema.parse({ ...empty, includeLists: ['b', 'a', 'b'] }).includeLists).toEqual(['a', 'b']);
  });
  it('rejects unknown legacy filters and unbounded references', () => {
    for (const value of [{ ...empty, productIds: ['product'] }, { ...empty, version: 1 }, { ...empty, excludeLists: [''] }, { ...empty, includeLists: Array.from({ length: 101 }, (_, id) => String(id)) }]) expect(contactCampaignAudienceSchema.safeParse(value).success).toBe(false);
  });
});
