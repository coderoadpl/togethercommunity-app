import { QueryClient } from '@tanstack/query-core';
import { describe, expect, it } from 'vitest';

import { memberSettingsOutputSchema } from '#core/contract/index.js';

import { createApiClient } from './http.js';
import { memberSettingsQuery, tenantSettingsInvalidates, tenantSettingsQuery } from './queries.js';

const settings = {
  billingPortalUrl: 'https://billing.example.test/portal',
  supportConfigured: true,
  supportUrl: 'https://example.test/support',
  videoAutoplayDefault: true,
  memberVideoAutoplayOverride: false,
};

describe('member settings client', () => {
  it('requires the five-field member contract without staff configuration', () => {
    expect(memberSettingsOutputSchema.parse({ settings })).toEqual({ settings });
    expect(Object.keys(memberSettingsOutputSchema.shape.settings.shape).sort()).toEqual(Object.keys(settings).sort());
    expect(memberSettingsOutputSchema.safeParse({ settings: { ...settings, billingPortalUrl: 'invalid' } }).success).toBe(false);
    expect(memberSettingsOutputSchema.safeParse({ settings: { ...settings, supportConfigured: undefined } }).success).toBe(false);
  });

  it('requests the member route and validates its response', async () => {
    const requests: string[] = [];
    const api = createApiClient({
      baseUrl: 'https://example.test',
      fetchImpl: async (url, init) => {
        requests.push(`${init?.method} ${String(url)}`);
        return Response.json({ ok: true, data: { settings } });
      },
    });
    expect(await api.getMemberSettings()).toEqual({ ok: true, value: { settings } });
    expect(requests).toEqual(['GET https://example.test/api/member/settings']);
  });

  it('rejects malformed member settings at the response boundary', async () => {
    const api = createApiClient({
      baseUrl: 'https://example.test',
      fetchImpl: async () => Response.json({ ok: true, data: { settings: { ...settings, videoAutoplayDefault: 'true' } } }),
    });
    expect(await api.getMemberSettings()).toMatchObject({ ok: false });
  });

  it('isolates member and staff cache entries and invalidates both after settings saves', async () => {
    const client = new QueryClient();
    const api = createApiClient({
      baseUrl: 'https://example.test',
      fetchImpl: async () => Response.json({ ok: true, data: { settings } }),
    });
    const member = memberSettingsQuery(api);
    const staff = tenantSettingsQuery(api);
    client.setQueryData(staff.queryKey, { settings: { name: 'Private staff settings' } });
    expect(client.getQueryData(member.queryKey)).toBeUndefined();
    expect(await client.fetchQuery(member)).toEqual({ settings });
    await client.invalidateQueries(tenantSettingsInvalidates());
    expect(client.getQueryState(member.queryKey)?.isInvalidated).toBe(true);
    expect(client.getQueryState(staff.queryKey)?.isInvalidated).toBe(true);
    client.clear();
  });
});
