import { describe, expect, it } from 'vitest';

import { CONTACT_AUDIENCE_LIST_OVERLAP_MESSAGE, contactCampaignAudienceInputSchema, contactCampaignAudienceSchema } from './marketing-audience.js';

const empty = { version: 2, includeLists: [], excludeLists: [], excludeProductIds: [], includeMembersWithConsent: false };
const overlapping = { ...empty, includeLists: ['newsletter'], excludeLists: ['newsletter'] };

describe('contact campaign audience schema', () => {
  it('preserves an explicitly empty audience and canonicalizes list IDs', () => {
    expect(contactCampaignAudienceSchema.parse(empty)).toEqual(empty);
    expect(contactCampaignAudienceSchema.parse({ ...empty, includeLists: ['b', 'a', 'b'] }).includeLists).toEqual(['a', 'b']);
  });

  it('rejects unknown legacy filters and unbounded references', () => {
    for (const value of [{ ...empty, productIds: ['product'] }, { ...empty, version: 1 }, { ...empty, excludeLists: [''] }, { ...empty, includeLists: Array.from({ length: 101 }, (_value, id) => String(id)) }]) expect(contactCampaignAudienceSchema.safeParse(value).success).toBe(false);
  });

  it('keeps already stored overlapping audiences readable', () => {
    expect(contactCampaignAudienceSchema.parse(overlapping)).toEqual(overlapping);
  });

  it('rejects lists selected for inclusion and exclusion on the input schema', () => {
    const parsed = contactCampaignAudienceInputSchema.safeParse(overlapping);

    expect(parsed.success).toBe(false);
    if (parsed.success) return;
    expect(parsed.error.flatten().fieldErrors.includeLists).toEqual([CONTACT_AUDIENCE_LIST_OVERLAP_MESSAGE]);
    expect(parsed.error.flatten().fieldErrors.excludeLists).toEqual([CONTACT_AUDIENCE_LIST_OVERLAP_MESSAGE]);
  });
});
