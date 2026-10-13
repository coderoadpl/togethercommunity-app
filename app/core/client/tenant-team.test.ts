import { describe, expect, it } from 'vitest';

import { createApiClient } from './http.js';

describe('tenant team client', () => {
  it('uses the team routes and validates their envelopes', async () => {
    const requests: Array<{ url: string; method: string | undefined; body: BodyInit | null | undefined }> = [];
    const members = [{ userId: 'owner-1', email: 'owner@example.test', name: null, role: 'owner' }];
    const api = createApiClient({ baseUrl: 'http://localhost:48730', fetchImpl: async (url, init) => {
      requests.push({ url: String(url), method: init?.method, body: init?.body });
      return Response.json({ ok: true, data: init?.method === 'GET' ? { members } : { userId: 'admin-1' } });
    } });
    expect(await api.listTenantTeam()).toEqual({ ok: true, value: { members } });
    expect(await api.addTenantAdmin({ email: 'admin@example.test' })).toEqual({ ok: true, value: { userId: 'admin-1' } });
    expect(await api.removeTenantAdmin({ userId: 'admin-1' })).toEqual({ ok: true, value: { userId: 'admin-1' } });
    expect(requests).toEqual([
      { url: 'http://localhost:48730/api/tenant/team', method: 'GET', body: null },
      { url: 'http://localhost:48730/api/tenant/team', method: 'POST', body: JSON.stringify({ email: 'admin@example.test' }) },
      { url: 'http://localhost:48730/api/tenant/team/remove', method: 'POST', body: JSON.stringify({ userId: 'admin-1' }) },
    ]);
  });

  it('rejects invalid team data at the response boundary', async () => {
    const api = createApiClient({ baseUrl: 'http://localhost:48730', fetchImpl: async () =>
      Response.json({ ok: true, data: { members: [{ userId: 'u-1', email: 'invalid', role: 'owner', name: null }] } }) });
    expect(await api.listTenantTeam()).toMatchObject({ ok: false });
  });
});
