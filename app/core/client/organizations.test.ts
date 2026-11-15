import { describe, expect, it } from 'vitest';

import { SCHEDULER_OPERATOR_SECRET_HEADER } from '#core/contract/index.js';
import type { Organization } from '#core/domain/index.js';

import { createApiClient } from './http.js';

const organization: Organization = {
  id: 'org-1', slug: 'holding', name: 'Holding', status: 'active', maxWorkspaces: 2,
  createdAt: '2026-11-15T12:00:00.000Z', updatedAt: '2026-11-15T12:00:00.000Z',
};

const recordingClient = (data: unknown) => {
  const calls: Array<{ url: string; init: RequestInit | undefined }> = [];
  const api = createApiClient({
    baseUrl: 'http://localhost:48730',
    fetchImpl: async (url, init) => {
      calls.push({ url: String(url), init });
      return Response.json({ ok: true, data });
    },
  });
  return { api, calls };
};

describe('organization client', () => {
  it('sends the operator secret only in its header for create and limits', async () => {
    const { api, calls } = recordingClient({ organization, created: true, ownerUserId: 'owner-1' });
    expect(await api.operatorCreateOrganization({ slug: 'holding', name: 'Holding', ownerEmail: 'owner@example.test' }, 'hidden'))
      .toEqual({ ok: true, value: { organization, created: true, ownerUserId: 'owner-1' } });
    const limits = recordingClient({ organization });
    expect(await limits.api.operatorSetOrganizationLimits({ organizationId: 'org/1', maxWorkspaces: 2 }, 'hidden'))
      .toEqual({ ok: true, value: { organization } });
    const all = [...calls, ...limits.calls];
    expect(all.map((call) => [call.init?.method, call.url])).toEqual([
      ['POST', 'http://localhost:48730/api/internal/organizations'],
      ['POST', 'http://localhost:48730/api/internal/organizations/org%2F1/limits'],
    ]);
    expect(limits.calls[0]?.init?.body).toBe(JSON.stringify({ maxWorkspaces: 2 }));
    for (const call of all) {
      expect(new Headers(call.init?.headers).get(SCHEDULER_OPERATOR_SECRET_HEADER)).toBe('hidden');
      expect(`${call.url}${String(call.init?.body)}`).not.toContain('hidden');
    }
  });

  it('reads organizations, members and audit events from their session routes', async () => {
    const list = recordingClient({ organizations: [{ id: 'org-1', slug: 'holding', name: 'Holding', status: 'active', role: 'admin' }] });
    expect(await list.api.listOrganizations()).toMatchObject({ ok: true, value: { organizations: [{ role: 'admin' }] } });
    const show = recordingClient({ organization, role: 'admin' });
    expect(await show.api.getOrganization({ organizationId: 'org-1' })).toEqual({ ok: true, value: { organization, role: 'admin' } });
    const members = recordingClient({ members: [] });
    expect(await members.api.listOrganizationMembers({ organizationId: 'org-1' })).toEqual({ ok: true, value: { members: [] } });
    const audit = recordingClient({ events: [] });
    expect(await audit.api.listOrganizationAuditEvents({ organizationId: 'org-1', limit: 5 })).toEqual({ ok: true, value: { events: [] } });
    expect([list, show, members, audit].map(({ calls }) => calls[0]?.url)).toEqual([
      'http://localhost:48730/api/organizations',
      'http://localhost:48730/api/organizations/org-1',
      'http://localhost:48730/api/organizations/org-1/members',
      'http://localhost:48730/api/organizations/org-1/audit-events?limit=5',
    ]);
    for (const { calls } of [list, show, members, audit]) {
      expect(new Headers(calls[0]?.init?.headers).has(SCHEDULER_OPERATOR_SECRET_HEADER)).toBe(false);
    }
  });
});
